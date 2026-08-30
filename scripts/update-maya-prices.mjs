// Синхронизирует цены тарифов Maya в data/plans.json с их живым affiliate-фидом.
// Источник истины: https://assets.maya.net/affiliates/plans.json (USD, priceDiscounted).
// index.html подтягивает data/plans.json fetch-ом и перекрывает цены Maya поверх
// встроенного массива, поэтому правки HTML регэкспом больше не нужны.
// Меняет ТОЛЬКО поле price у записей provider:'Maya'; ссылки, промокоды и флаги не трогает.
// Правило проекта: никаких выдуманных цен - если фид недоступен или отдал мусор, выходим без правок.
import { readFileSync, writeFileSync } from 'node:fs';

const FEED = 'https://assets.maya.net/affiliates/plans.json';
const FILE = new URL('../data/plans.json', import.meta.url);

const res = await fetch(FEED, { headers: { 'User-Agent': 'esim.pizza price sync' } });
if (!res.ok) { console.error(`feed HTTP ${res.status} - выходим без правок`); process.exit(1); }
const feed = await res.json();
const feedPlans = Array.isArray(feed?.plans) ? feed.plans : null;
if (!feedPlans?.length) { console.error('фид без plans[] - выходим без правок'); process.exit(1); }

// Берём только глобальные безлимиты (не круизные: они в 5-6 раз дороже и в сравнилке не участвуют).
const byDays = new Map();
for (const p of feedPlans) {
  if (p.dataUsageAllowanceType !== 'UNLIMITED') continue;
  if (!/^https:\/\/maya\.net\/esim\/global\//.test(p.url || '')) continue;
  const usd = Number(p.priceDiscounted?.USD ?? p.priceOriginal?.USD);
  const days = Number(p.validityInDays);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(days)) continue;
  byDays.set(days, usd);
}
if (!byDays.size) { console.error('в фиде нет global unlimited - выходим без правок'); process.exit(1); }

const catalog = JSON.parse(readFileSync(FILE, 'utf8'));
if (!Array.isArray(catalog?.plans)) { console.error('data/plans.json без plans[] - выходим без правок'); process.exit(1); }

const changes = [];
for (const row of catalog.plans) {
  if (row.provider !== 'Maya') continue;
  const fresh = byDays.get(Number(row.days));
  if (fresh === undefined || !Number.isFinite(Number(row.price)) || fresh === row.price) continue;
  changes.push(`${row.days}д: ${row.price} стало ${fresh}`);
  row.price = fresh;
}

if (!changes.length) { console.log('цены Maya совпадают с фидом - правок нет'); process.exit(0); }
catalog.generatedAt = new Date().toISOString();
writeFileSync(FILE, JSON.stringify(catalog, null, 2) + '\n');
console.log('обновлено:\n' + changes.map((c) => '  ' + c).join('\n'));
