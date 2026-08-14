// Оптовый каталог Stellar через их Wholesale API.
// Ключ в .env, в репозиторий не попадает. Результат: data/stellar-wholesale.local.csv
// в том же формате, что и остальные дилерские прайсы, плюс сырой JSON для разбора.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const PER_PAGE = 100;
const PAUSE_MS = 1100; // лимит ключа 60 запросов в минуту

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const base = env.STELLAR_WHOLESALE_BASE;
const headers = { Authorization: 'Bearer ' + env.STELLAR_WHOLESALE_KEY };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function eurUsd() {
  const xml = await (await fetch(ECB)).text();
  const m = xml.match(/currency='USD'\s+rate='([\d.]+)'/);
  if (!m) throw new Error('курс ЕЦБ не прочитан');
  return Number(m[1]);
}

async function page(n) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${base}/plans?page=${n}&per_page=${PER_PAGE}`, { headers });
    if (res.ok) return res.json();
    if (res.status === 429) { await sleep(5000); continue; }
    if (attempt === 3) throw new Error(`страница ${n}: HTTP ${res.status}`);
    await sleep(2000);
  }
}

const rate = await eurUsd();
const first = await page(1);
const pages = first.meta.last_page;
const all = [...first.data];
process.stdout.write(`Stellar: ${first.meta.total} тарифов, ${pages} страниц, курс ${rate}\n`);

for (let n = 2; n <= pages; n++) {
  await sleep(PAUSE_MS);
  const p = await page(n);
  all.push(...p.data);
  if (n % 10 === 0 || n === pages) process.stdout.write(`  страница ${n} из ${pages}, накоплено ${all.length}\n`);
}

fs.writeFileSync(path.join(root, 'data', 'stellar-wholesale.local.json'), JSON.stringify(all));

function scopeOf(p) {
  const codes = p.coverage?.codes ?? [];
  if (codes.length > 30) return 'global';
  if (codes.length > 1) return 'regional';
  return 'country';
}

const q = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const rows = [];
let skippedUnlimited = 0;
for (const p of all) {
  if (p.available === false) continue;
  const scope = scopeOf(p);
  const gb = (p.data?.megabytes ?? 0) / 1024;
  const days = p.validity_days ?? 0;
  const usd = Math.round(Number(p.price?.amount ?? 0) * rate * 100) / 100;
  // Безлимитные посуточные считаем по объёму суток: megabytes у них дневная норма.
  const daily = /daily/i.test(p.data?.type ?? '');
  const totalGb = daily ? gb * days : gb;
  if (!totalGb || !usd) { skippedUnlimited++; continue; }
  rows.push([
    scope === 'country' ? (p.country_code ?? '') : '',
    p.destination ?? '',
    scope,
    'Stellar (опт)',
    p.name ?? '',
    daily ? 'daily' : 'data',
    totalGb.toFixed(3).replace(/\.?0+$/, ''),
    days,
    usd,
    Math.round((usd / totalGb) * 1000) / 1000,
    'Stellar Wholesale API /plans',
  ].map(q).join(','));
}

const out = path.join(root, 'data', 'stellar-wholesale.local.csv');
fs.writeFileSync(out, 'country,destination,scope,provider,name,type,gb,days,usd,perGb,source\n' + rows.join('\n') + '\n');
process.stdout.write(`Записано ${rows.length} строк в ${out}, пропущено без цены или объёма: ${skippedUnlimited}\n`);
