// Снимает рыночный бенчмарк: eSIM.dog публикует собственную сравнительную таблицу
// (10 ГБ / 30 дней, колонки eSIM.dog / Airalo / Nomad / Saily) на /cheapest-esim.
// Их сайт гео-блокирует ОАЭ, поэтому ходим через reader-прокси r.jina.ai.
//
// Зачем: их цены плавают (за три дня Турция 2.08 -> 2.10, Таиланд 3.23 -> 3.43),
// а вся наша ценовая стратегия меряется относительно них. Данные складываем в
// data/, на сайт они НЕ попадают — это внутренний ориентир, а не наши цены.
import { writeFileSync, mkdirSync } from 'node:fs';

const SOURCE = 'https://r.jina.ai/https://esim.dog/cheapest-esim';
const OUT = new URL('../data/esimdog-benchmark-10gb-30d.csv', import.meta.url);

const res = await fetch(SOURCE, { headers: { 'User-Agent': 'esim.pizza benchmark' } });
if (!res.ok) { console.error(`источник отдал HTTP ${res.status} — выходим без правок`); process.exit(1); }
const text = await res.text();

const clean = (s) => (s || '').replace(/\[|\]\([^)]*\)/g, '').replace(/Lowest/g, '').trim();
const price = (cell) => clean(cell).match(/\$(\d+(?:\.\d+)?)/)?.[1] ?? '';

const rows = [];
for (const line of text.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').map((s) => s.trim());
  if (cells.length < 6) continue;
  const country = clean(cells[1]).replace(/^[^A-Za-z]+/, '');
  if (!country || country === 'Country') continue;
  rows.push([country, price(cells[2]), price(cells[3]), price(cells[4]), price(cells[5])]);
}

// Меньше сотни строк — почти наверняка сломался парсинг, а не рынок.
// Лучше упасть, чем записать огрызок и решить, что конкурент ушёл с рынка.
if (rows.length < 100) {
  console.error(`распознано только ${rows.length} строк — похоже, изменилась вёрстка. Выходим без правок.`);
  process.exit(1);
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(OUT, ['country,esimdog,airalo,nomad,saily', ...rows.map((r) => r.join(','))].join('\n') + '\n');
console.log(`записано стран: ${rows.length}`);
