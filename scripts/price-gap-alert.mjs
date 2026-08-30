// Сопоставляет наши витринные тарифы (data/plans.json) с двумя эталонами:
// - data/esimdog-benchmark-10gb-30d.csv (только 10GB/30d, сравниваем лишь близкие по объёму планы)
// - data/esimdb-market.csv (весь рынок по версии eSIMDB, берём ближайший сопоставимый план)
// Правило честности: не сравниваем 1GB с Unlimited и наоборот. Unlimited у нас - data=999.
// Порог: разрыв больше 1.5x попадает в отчёт, больше 3x помечается как критичный.
// Вывод: data/price-gap-report.md (топ-50 по разрыву) плюс сводка. Критичные строки
// дублируются в data/price-gap-critical.txt для шага алерта в workflow.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Русское имя страны из витрины, имя в esimdog-csv, слаг в esimdb-csv
const COUNTRIES = {
  'Таиланд': { dog: 'Thailand', db: 'thailand' },
  'ОАЭ': { dog: 'UAE', db: 'uae' },
  'Япония': { dog: 'Japan', db: 'japan' },
  'Грузия': { dog: 'Georgia', db: 'georgia' },
  'Египет': { dog: 'Egypt', db: 'egypt' },
  'Индонезия': { dog: 'Indonesia', db: 'indonesia' },
  'Турция': { dog: 'Turkey', db: 'turkey' },
  'Италия': { dog: 'Italy', db: 'italy' },
  'Испания': { dog: 'Spain', db: 'spain' },
  'Франция': { dog: 'France', db: 'france' },
  'Германия': { dog: 'Germany', db: 'germany' },
  'Великобритания': { dog: 'UK', db: 'uk' },
  'США': { dog: 'United States', db: 'usa' },
  'Вьетнам': { dog: 'Vietnam', db: 'vietnam' },
  'Малайзия': { dog: 'Malaysia', db: 'malaysia' },
  'Сингапур': { dog: 'Singapore', db: 'singapore' },
  'Мексика': { dog: 'Mexico', db: 'mexico' },
  'Канада': { dog: 'Canada', db: 'canada' },
};

// Простой CSV-парсер с поддержкой кавычек
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; if (row.some(f => f !== '')) rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(f => f !== '')) rows.push(row); }
  return rows;
}

const plans = JSON.parse(read('data/plans.json')).plans
  .filter(p => p.type === 'country' && COUNTRIES[p.country] && p.price > 0);

// eSIM.dog: цена 10GB/30d по странам
const dogRows = parseCsv(read('data/esimdog-benchmark-10gb-30d.csv')).slice(1);
const dogPrice = new Map(dogRows.map(r => [r[0], parseFloat(r[1])]).filter(([, v]) => v > 0));

// eSIMDB: список планов по странам
const dbRows = parseCsv(read('data/esimdb-market.csv')).slice(1);
const dbPlans = new Map();
for (const r of dbRows) {
  const [country, provider, , gb, days, price] = r;
  const g = parseFloat(gb), d = parseInt(days, 10), p = parseFloat(price);
  if (!(p > 0) || !(d > 0) || !(g >= 0)) continue;
  if (!dbPlans.has(country)) dbPlans.set(country, []);
  dbPlans.get(country).push({ provider, gb: g, days: d, price: p });
}

const results = [];
for (const plan of plans) {
  const map = COUNTRIES[plan.country];
  const unlimited = plan.data >= 999;
  const candidates = [];

  // eSIMDB: сопоставимый план - тот же класс (unlimited или нет), объём в пределах
  // [0.5x, 2x] нашего и не меньше нашего срока (более короткий план нам не замена).
  for (const c of dbPlans.get(map.db) || []) {
    const cUnl = c.gb === 0 || c.gb >= 999;
    if (unlimited !== cUnl) continue;
    if (!unlimited && (c.gb < plan.data * 0.5 || c.gb > plan.data * 2)) continue;
    if (c.days < plan.days) continue;
    candidates.push({ src: 'eSIMDB', provider: c.provider, gb: cUnl ? 'Unl' : c.gb, days: c.days, price: c.price });
  }

  // eSIM.dog: бенчмарк только 10GB/30d - сравниваем лишь планы близкие к этому профилю
  const dp = dogPrice.get(map.dog);
  if (dp && !unlimited && plan.data >= 5 && plan.data <= 20 && plan.days <= 30) {
    candidates.push({ src: 'eSIM.dog', provider: 'eSIM.dog', gb: 10, days: 30, price: dp });
  }

  if (!candidates.length) { results.push({ plan, best: null }); continue; }
  const best = candidates.reduce((a, b) => (b.price < a.price ? b : a));
  results.push({ plan, best, gap: plan.price / best.price });
}

const checked = results.filter(r => r.best);
const flagged = checked.filter(r => r.gap > 1.5).sort((a, b) => b.gap - a.gap);
const critical = flagged.filter(r => r.gap > 3);
const gaps = checked.map(r => r.gap).sort((a, b) => a - b);
const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

const today = new Date().toISOString().slice(0, 10);
const fmt = (n) => '$' + n.toFixed(2);
const lines = [];
lines.push(`# Price gap report - ${today}`);
lines.push('');
lines.push(`Проверено тарифов: ${checked.length} из ${plans.length} витринных (по странам с эталонными данными).`);
lines.push(`С разрывом больше 1.5x: ${flagged.length}, из них критичных (больше 3x): ${critical.length}.`);
lines.push(`Медианный разрыв по всем проверенным: ${median.toFixed(2)}x.`);
lines.push('');
lines.push('| Страна | Наш тариф | Наша цена | Лучшая цена | Чья | Их план | Разрыв |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of flagged.slice(0, 50)) {
  const p = r.plan, b = r.best;
  const mark = r.gap > 3 ? ' KRIT' : '';
  lines.push(`| ${p.country} | ${p.provider} ${p.data >= 999 ? 'Unl' : p.data + 'GB'}/${p.days}d | ${fmt(p.price)} | ${fmt(b.price)} | ${b.provider} (${b.src}) | ${b.gb}GB/${b.days}d | ${r.gap.toFixed(1)}x${mark} |`);
}
lines.push('');
writeFileSync(resolve(root, 'data/price-gap-report.md'), lines.join('\n'), 'utf8');

// Файл для алерта: по строке на критичный разрыв, стабильный формат для сравнения
const critLines = critical.map(r =>
  `${r.plan.country} ${r.plan.provider} ${r.plan.data >= 999 ? 'Unl' : r.plan.data + 'GB'}/${r.plan.days}d ${fmt(r.plan.price)} vs ${fmt(r.best.price)} (${r.best.provider}) = ${r.gap.toFixed(1)}x`);
writeFileSync(resolve(root, 'data/price-gap-critical.txt'), critLines.join('\n') + (critLines.length ? '\n' : ''), 'utf8');

console.log(`Проверено ${checked.length}, с разрывом ${flagged.length}, критичных ${critical.length}, медиана ${median.toFixed(2)}x`);
