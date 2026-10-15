// Аудит гарантии низкой цены для витрины esim.free.
//
// esim.free обещает самую низкую цену и выдаёт QR сам, без ссылок на чужие сайты.
// Обещание держится ровно до тех пор, пока чей-то розничный тариф не оказался
// дешевле нашего при том же или меньшем объёме и сроке. Этот скрипт ежедневно
// проверяет обещание против розницы, которую мы читаем машинно из фидов самих
// провайдеров (data/market-map.csv: Stellar, Airalo, Saily, eSIM.dog).
//
// Правило сравнения - самое строгое из честных: для КАЖДОГО чужого тарифа ищем
// у себя тариф с объёмом не меньше, сроком не меньше и ценой не выше. Нашли -
// чужой тариф «побит». Не нашли - разбираем, почему:
//   - ценовая дыра: тариф нужной формы у нас есть, но дороже. Это нарушение
//     обещания, по нему алерт в CI;
//   - дыра формы: тарифа с таким объёмом и сроком у нас нет вовсе (например,
//     чужие пакеты на 90 или 365 дней, а поставщик даёт максимум 60). Это не
//     проигрыш по цене, а пробел в ассортименте, идёт в отчёт отдельной строкой.
// Сравнение за гигабайт при поездочном минимуме тоже считаем, но как справку.
//
// Мелкие промо-пакеты (меньше MIN_GB или короче MIN_DAYS) не проверяем: у eSIM.dog
// сотни однодневных пакетов по доллару, для поездки они не конкуренты.
//
// Каталог esim.free публичный (https://esim.free/data/catalog.csv), себестоимости
// в нём нет: цена там и есть цена продажи. Скрипту не нужны секреты.
//
// Выход:
//   data/esim-free-guarantee.md       - отчёт для чтения
//   data/esim-free-guarantee.csv      - по направлению: наш пол, пол рынка, дыры
//   data/esim-free-guarantee-holes.txt - строка на каждую ценовую дыру, для алерта в CI
//
// Запуск:
//   node scripts/esim-free-guarantee.mjs                      # каталог с esim.free
//   node scripts/esim-free-guarantee.mjs --catalog path.csv   # каталог из файла
//   node scripts/esim-free-guarantee.mjs --min-gb 5 --min-days 7
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CATALOG_URL = 'https://esim.free/data/catalog.csv';
const UA = 'esim.free guarantee audit';

const DESTINATIONS = [
  ['canada', 'CA', 'Канада'], ['turkey', 'TR', 'Турция'], ['thailand', 'TH', 'Таиланд'],
  ['georgia', 'GE', 'Грузия'], ['vietnam', 'VN', 'Вьетнам'], ['japan', 'JP', 'Япония'],
  ['uae', 'AE', 'ОАЭ'], ['italy', 'IT', 'Италия'], ['spain', 'ES', 'Испания'],
  ['usa', 'US', 'США'], ['france', 'FR', 'Франция'], ['germany', 'DE', 'Германия'],
  ['uk', 'GB', 'Британия'], ['indonesia', 'ID', 'Индонезия'], ['malaysia', 'MY', 'Малайзия'],
  ['singapore', 'SG', 'Сингапур'], ['mexico', 'MX', 'Мексика'], ['egypt', 'EG', 'Египет'],
  ['greece', 'GR', 'Греция'], ['china', 'CN', 'Китай'],
];

// Поездочный минимум для строгой проверки. Ниже него - промо и однодневки.
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MIN_GB = Number(argValue('--min-gb', 3));
const MIN_DAYS = Number(argValue('--min-days', 7));
// Пакеты от 500 ГБ у поставщиков - синтетические безлимиты, в сравнение не идут.
const MAX_GB = 500;
// Порог для справки по цене за гигабайт: тот же, что в карте рынка.
const TRIP_GB = 10;
const TRIP_DAYS = 14;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; if (row.some((f) => f !== '')) rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

async function loadCatalog() {
  const local = argValue('--catalog', '');
  if (local) return { text: readFileSync(local, 'utf8'), source: local };
  const res = await fetch(CATALOG_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`каталог esim.free: HTTP ${res.status}`);
  return { text: await res.text(), source: CATALOG_URL };
}

const usable = (gb, days) => gb >= MIN_GB && days >= MIN_DAYS && gb < MAX_GB;
const money = (n) => `$${Number(n).toFixed(2)}`;
const shape = (p) => `${+p.gb.toFixed(1)}GB/${p.days}d ${money(p.usd)}`;

const { text: catalogText, source: catalogSource } = await loadCatalog();
// Безлимиты витрина помечает флагом или синтетическим объёмом от 1000 ГБ - так же
// их читает и сама витрина esim.free. В сравнении по объёму им делать нечего.
const catalog = parseCsv(catalogText)
  .filter((r) => r.scope === 'country' && r.unlimited !== 'yes')
  .map((r) => ({ iso: r.dest_code, gb: Number(r.gb), days: Number(r.days), usd: Number(r.price_usd), id: r.id }))
  .filter((p) => p.gb > 0 && p.gb < 1000 && p.days > 0 && p.usd > 0);

const market = parseCsv(readFileSync(new URL('../data/market-map.csv', import.meta.url), 'utf8'))
  .map((r) => ({ country: r.country, provider: r.provider, name: r.name, gb: Number(r.gb), days: Number(r.days), usd: Number(r.usd) }))
  .filter((p) => p.gb > 0 && p.days > 0 && p.usd > 0);

// Наш тариф, который бьёт чужой: объём и срок не меньше, цена не выше.
// Из подходящих берём самый дешёвый - его и покажем в отчёте как ответ.
function beats(ours, theirs) {
  let best = null;
  for (const p of ours) {
    if (p.gb + 1e-9 < theirs.gb || p.days < theirs.days || p.usd > theirs.usd + 1e-9) continue;
    if (!best || p.usd < best.usd) best = p;
  }
  return best;
}

const perGbFloor = (list) => {
  let best = null;
  for (const p of list) {
    if (!(p.gb >= TRIP_GB && p.days >= TRIP_DAYS && p.gb < MAX_GB)) continue;
    const perGb = p.usd / p.gb;
    if (!best || perGb < best.perGb) best = { ...p, perGb };
  }
  return best;
};

const lines = [];
const holes = [];
const csvRows = [];
let checked = 0;
let beaten = 0;
let shapeTotal = 0;

for (const [key, iso, title] of DESTINATIONS) {
  const ours = catalog.filter((p) => p.iso === iso);
  const theirs = market.filter((p) => p.country === key && usable(p.gb, p.days));
  const ourFloor = perGbFloor(ours);
  const marketFloor = perGbFloor(theirs);
  const missing = [];
  for (const t of theirs) {
    checked += 1;
    if (beats(ours, t)) { beaten += 1; continue; }
    missing.push(t);
  }
  // Наш самый дешёвый тариф той же или большей формы. Нет такого - дыра формы.
  const nearestOurs = (t) => {
    let best = null;
    for (const p of ours) {
      if (p.gb + 1e-9 < t.gb || p.days < t.days) continue;
      if (!best || p.usd < best.usd) best = p;
    }
    return best;
  };
  // Ценовые дыры ранжируем по тому, во сколько раз наш ближайший дороже чужого.
  const ranked = missing.map((t) => ({ t, near: nearestOurs(t) }))
    .filter((h) => h.near)
    .map((h) => ({ ...h, ratio: h.near.usd / h.t.usd }))
    .sort((a, b) => b.ratio - a.ratio);
  const shapeHoles = missing.filter((t) => !nearestOurs(t));
  const maxOurDays = ours.reduce((m, p) => Math.max(m, p.days), 0);
  const maxOurGb = ours.reduce((m, p) => Math.max(m, p.gb), 0);
  const shapeNote = shapeHoles.length
    ? `${shapeHoles.length} чужих форм не предлагаем (у нас максимум ${maxOurGb} ГБ и ${maxOurDays} дн): ${[...new Set(shapeHoles.slice().sort((a, b) => b.days - a.days || b.gb - a.gb).slice(0, 3).map((t) => `${t.provider} ${shape(t)}`))].join('; ')}`
    : '';

  csvRows.push({
    country: key,
    title,
    ourPlans: ours.length,
    theirPlans: theirs.length,
    priceHoles: ranked.length,
    shapeHoles: shapeHoles.length,
    ourFloorPerGb: ourFloor ? ourFloor.perGb.toFixed(3) : '',
    ourFloorPlan: ourFloor ? shape(ourFloor) : '',
    marketFloorPerGb: marketFloor ? marketFloor.perGb.toFixed(3) : '',
    marketFloorProvider: marketFloor ? marketFloor.provider : '',
    marketFloorPlan: marketFloor ? shape(marketFloor) : '',
    worstPriceHole: ranked[0] ? `${ranked[0].t.provider} ${shape(ranked[0].t)}` : '',
    worstPriceHoleOurs: ranked[0] ? shape(ranked[0].near) : '',
    maxOurGb,
    maxOurDays,
  });

  if (!ours.length) lines.push(`| ${title} | нет тарифов в каталоге | - | - | ${theirs.length} | **нет предложения** | |`);
  else {
    const holeText = ranked.length
      ? `**${ranked.length}**: ${ranked.slice(0, 3).map((h) => `${h.t.provider} ${shape(h.t)} против нашего ${shape(h.near)}`).join('; ')}`
      : '0';
    lines.push(`| ${title} | ${ourFloor ? `${money(ourFloor.perGb)}/ГБ (${shape(ourFloor)})` : '-'} | ${marketFloor ? `${money(marketFloor.perGb)}/ГБ (${marketFloor.provider}, ${shape(marketFloor)})` : '-'} | ${ours.length} | ${theirs.length} | ${holeText} | ${shapeNote} |`);
  }
  for (const h of ranked) {
    holes.push(`${title}: ${h.t.provider} ${shape(h.t)} - наш ближайший ${shape(h.near)} (${h.ratio.toFixed(2)}x)`);
  }
  shapeTotal += shapeHoles.length;
}

const today = new Date().toISOString().slice(0, 10);
const coverage = checked ? ((beaten / checked) * 100).toFixed(1) : '0';
const md = [
  `# Гарантия низкой цены esim.free - ${today}`,
  '',
  `Каталог: ${catalogSource}. Розница: data/market-map.csv (фиды Stellar, Airalo, Saily, eSIM.dog).`,
  `Проверено чужих тарифов от ${MIN_GB} ГБ и ${MIN_DAYS} дней: ${checked}, из них побито нашим тарифом с объёмом и сроком не меньше и ценой не выше: ${beaten} (${coverage}%).`,
  `Ценовых дыр (тариф такой формы у нас есть, но дороже чужого): ${holes.length}. Дыр формы (такого объёма или срока у нас нет вовсе): ${shapeTotal}.`,
  '',
  '| Направление | Наш пол $/ГБ (от 10 ГБ, 14 дн) | Пол рынка $/ГБ | Наших тарифов | Чужих проверено | Ценовые дыры | Дыры формы |',
  '|---|---|---|---|---|---|---|',
  ...lines,
  '',
  holes.length
    ? 'Ценовая дыра - нарушение обещания: у конкурента тариф не больше нашего по объёму и сроку, но дешевле. Лечится либо ценой у поставщика, либо вторым поставщиком по направлению. Дыра формы - пробел ассортимента, обещание низкой цены её не касается, но клиент с такой поездкой уйдёт к конкуренту.'
    : 'Ценовых дыр нет: на каждую чужую форму, которую мы предлагаем, наша цена не выше.',
];

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/esim-free-guarantee.md', import.meta.url), `${md.join('\n')}\n`);
const cols = Object.keys(csvRows[0]);
writeFileSync(new URL('../data/esim-free-guarantee.csv', import.meta.url),
  `${[cols.join(','), ...csvRows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, "'")}"`).join(','))].join('\n')}\n`);
writeFileSync(new URL('../data/esim-free-guarantee-holes.txt', import.meta.url), holes.length ? `${holes.join('\n')}\n` : '');

console.log(md.join('\n'));
