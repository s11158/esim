// Синхронизирует цены тарифов Maya в index.html с их живым affiliate-фидом.
// Источник истины: https://assets.maya.net/affiliates/plans.json (USD, priceDiscounted).
// Меняет ТОЛЬКО поле price у строк plans[] с provider:'Maya'; ссылки, промокоды и флаги не трогает.
// Правило проекта: никаких выдуманных цен — если фид недоступен или отдал мусор, выходим без правок.
import { readFileSync, writeFileSync } from 'node:fs';

const FEED = 'https://assets.maya.net/affiliates/plans.json';
const FILE = new URL('../index.html', import.meta.url);

const res = await fetch(FEED, { headers: { 'User-Agent': 'esim.pizza price sync' } });
if (!res.ok) { console.error(`feed HTTP ${res.status} — выходим без правок`); process.exit(1); }
const feed = await res.json();
const plans = Array.isArray(feed?.plans) ? feed.plans : null;
if (!plans?.length) { console.error('фид без plans[] — выходим без правок'); process.exit(1); }

// Берём только глобальные безлимиты (не круизные: они в 5-6 раз дороже и в сравнилке не участвуют).
const byDays = new Map();
for (const p of plans) {
  if (p.dataUsageAllowanceType !== 'UNLIMITED') continue;
  if (!/^https:\/\/maya\.net\/esim\/global\//.test(p.url || '')) continue;
  const usd = Number(p.priceDiscounted?.USD ?? p.priceOriginal?.USD);
  const days = Number(p.validityInDays);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(days)) continue;
  byDays.set(days, usd);
}
if (!byDays.size) { console.error('в фиде нет global unlimited — выходим без правок'); process.exit(1); }

let html = readFileSync(FILE, 'utf8');
const changes = [];

html = html.replace(/\{id:\d+,[^\n]*provider:'Maya'[^\n]*\},?/g, (row) => {
  const days = Number(row.match(/days:(\d+(?:\.\d+)?)/)?.[1]);
  const price = Number(row.match(/price:(\d+(?:\.\d+)?)/)?.[1]);
  const fresh = byDays.get(days);
  if (fresh === undefined || !Number.isFinite(price) || fresh === price) return row;
  changes.push(`${days}д: ${price} -> ${fresh}`);
  return row.replace(/price:\d+(?:\.\d+)?/, `price:${fresh}`);
});

if (!changes.length) { console.log('цены Maya совпадают с фидом — правок нет'); process.exit(0); }
writeFileSync(FILE, html);
console.log('обновлено:\n' + changes.map((c) => '  ' + c).join('\n'));
