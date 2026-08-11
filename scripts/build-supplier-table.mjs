// Единая таблица рынка: один файл, где по каждому направлению видно, почём продаёт
// каждый источник, до которого мы дотянулись, и кто дно.
//
// Розница берётся из data/market-map.csv (Stellar, Airalo, Saily, eSIM.dog), закупка -
// из локальных файлов поставщиков. Правило сравнения то же, что в карте рынка:
// поездочный минимум от 10 ГБ и от 14 дней, пакеты от 500 ГБ не считаем.
//
// Выход:
//   data/supplier-table.local.csv - машинная версия
//   data/supplier-table.local.md  - человеческая, для чтения и пересылки
//
// Запуск: node scripts/build-supplier-table.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const MIN_GB = 10;
const MIN_DAYS = 14;

const DESTINATIONS = [
  ['canada', 'Канада'], ['turkey', 'Турция'], ['thailand', 'Таиланд'], ['georgia', 'Грузия'],
  ['vietnam', 'Вьетнам'], ['japan', 'Япония'], ['uae', 'ОАЭ'], ['italy', 'Италия'],
  ['spain', 'Испания'], ['usa', 'США'], ['france', 'Франция'], ['germany', 'Германия'],
  ['uk', 'Британия'], ['indonesia', 'Индонезия'], ['malaysia', 'Малайзия'],
  ['singapore', 'Сингапур'], ['mexico', 'Мексика'], ['egypt', 'Египет'],
  ['greece', 'Греция'], ['china', 'Китай'],
];

// Закупочные источники: файл и подпись в таблице.
const WHOLESALE = [
  ['../data/market-wholesale.local.csv', 'eSimerge'],
  ['../data/gloesim-dealer.local.csv', 'GloEsim'],
  ['../data/mobisim-dealer.local.csv', 'MobiSIM'],
  ['../data/microesim-dealer.local.csv', 'MicroEsim'],
  ['../data/roamwifi-dealer.local.csv', 'RoamWiFi'],
  ['../data/airhub-dealer.local.csv', 'Airhub'],
];
const RETAIL = ['Stellar', 'Airalo', 'Saily', 'eSIM.dog'];

function readCsv(file) {
  let text;
  try {
    text = readFileSync(new URL(file, import.meta.url), 'utf8');
  } catch {
    return [];
  }
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  return lines.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0)
      .map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

const trip = (gb, days) => gb >= MIN_GB && days >= MIN_DAYS && gb < 500;

function best(rows, country, providerFilter) {
  let out = null;
  for (const r of rows) {
    if (r.country !== country) continue;
    if (r.scope && r.scope !== 'country') continue;
    if (providerFilter && r.provider !== providerFilter) continue;
    const gb = Number(r.gb);
    const days = Number(r.days);
    const usd = Number(r.usd);
    if (!(gb > 0) || !(usd > 0) || !trip(gb, days)) continue;
    const perGb = usd / gb;
    if (!out || perGb < out.perGb) out = { perGb, gb, days, usd, name: r.name || '' };
  }
  return out;
}

const map = readCsv('../data/market-map.csv');
const sources = WHOLESALE.map(([file, label]) => [label, readCsv(file)]);

const cols = ['country', 'title', ...RETAIL, ...WHOLESALE.map(([, l]) => l), 'bestPrice', 'bestSource', 'bestPlan'];
const csv = [cols.join(',')];
const md = [
  '# Единая таблица рынка eSIM',
  '',
  `Сравнение по цене за гигабайт, поездочный минимум от ${MIN_GB} ГБ и от ${MIN_DAYS} дней.`,
  'Розница читается из фидов провайдеров, закупка - из прайсов и API поставщиков.',
  '',
  `| направление | ${RETAIL.join(' | ')} | ${WHOLESALE.map(([, l]) => l).join(' | ')} | дно и у кого |`,
  `|${'---|'.repeat(2 + RETAIL.length + WHOLESALE.length)}`,
];

for (const [key, title] of DESTINATIONS) {
  const row = { country: key, title };
  const cells = [];
  let champion = null;
  for (const p of RETAIL) {
    const b = best(map, key, p);
    row[p] = b ? b.perGb.toFixed(3) : '';
    cells.push(b ? b.perGb.toFixed(3) : '-');
  }
  for (const [label, rows] of sources) {
    const b = best(rows, key);
    row[label] = b ? b.perGb.toFixed(3) : '';
    cells.push(b ? b.perGb.toFixed(3) : '-');
    if (b && (!champion || b.perGb < champion.b.perGb)) champion = { label, b };
  }
  row.bestPrice = champion ? champion.b.perGb.toFixed(3) : '';
  row.bestSource = champion ? champion.label : '';
  row.bestPlan = champion ? `${champion.b.gb}GB/${champion.b.days}d $${champion.b.usd.toFixed(2)}` : '';
  csv.push(cols.map((c) => {
    const v = String(row[c] ?? '');
    return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','));
  md.push(`| ${title} | ${cells.join(' | ')} | **${row.bestPrice} ${row.bestSource}** |`);
}

md.push('');
md.push('Пустая клетка означает, что у поставщика нет странового тарифа по этому направлению');
md.push('в поездочном формате, а не то, что он дорогой.');

writeFileSync(new URL('../data/supplier-table.local.csv', import.meta.url), `${csv.join('\n')}\n`);
writeFileSync(new URL('../data/supplier-table.local.md', import.meta.url), `${md.join('\n')}\n`);
console.log(md.join('\n'));
