// Ежедневная выгрузка рынка: все тарифы всех провайдеров по нашим направлениям.
//
// Источник — esimdb.com, крупнейший агрегатор (190+ провайдеров). Раньше мы читали
// его через reader-прокси и получали огрызок: прокси резал страницу, треть направлений
// не открывалась вовсе, а парсер текста вылавливал 1-3 тарифа из трёхсот.
//
// Оказалось, esimdb — приложение на Nuxt, и весь каталог лежит прямо в HTML внутри
// <script id="__NUXT_DATA__">. Забираем его обычным запросом и разбираем структуру:
// имя, объём, срок, цена в USD, провайдер, промокод. Никакого парсинга текста.
//
// Данные внутренние — это ориентир по рынку, а не наши цены. На сайт не попадают.
import { writeFileSync, mkdirSync } from 'node:fs';

// Слаги — как у esimdb: ОАЭ, Британия и США живут на коротких адресах (/uae, /uk, /usa).
const DESTINATIONS = [
  'turkey', 'thailand', 'uae', 'indonesia', 'japan', 'georgia', 'egypt',
  'italy', 'spain', 'france', 'germany', 'uk', 'usa', 'vietnam',
  'malaysia', 'singapore', 'mexico',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

// Nuxt отдаёт payload «плоским»: массив значений, где поля объектов — индексы в этом же
// массиве. Разворачиваем рекурсивно, с защитой от циклических ссылок.
function makeResolver(arr) {
  return function resolve(index, seen = new Set()) {
    if (typeof index !== 'number' || seen.has(index)) return null;
    const value = arr[index];
    if (value === null || typeof value !== 'object') return value;
    const next = new Set(seen).add(index);
    if (Array.isArray(value)) return value.map((i) => resolve(i, next));
    const out = {};
    for (const [key, i] of Object.entries(value)) out[key] = resolve(i, next);
    return out;
  };
}

async function fetchMarket(destination) {
  const res = await fetch(`https://esimdb.com/${destination}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };

  const html = await res.text();
  const payload = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!payload) return { error: 'в HTML нет __NUXT_DATA__ — сайт сменил движок' };

  const arr = JSON.parse(payload[1]);
  const resolve = makeResolver(arr);

  // Справочник провайдеров: объекты с _id и name, на которые ссылаются тарифы.
  const providers = new Map();
  arr.forEach((value, i) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (!('_id' in value) || !('name' in value) || 'capacity' in value) return;
    const obj = resolve(i);
    if (obj?._id && typeof obj.name === 'string') providers.set(obj._id, obj.name);
  });

  const plans = [];
  arr.forEach((value, i) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (!('capacity' in value) || !('prices' in value) || !('period' in value)) return;

    const plan = resolve(i);
    const usd = Number(plan?.usdPrice ?? plan?.prices?.USD);
    const mb = Number(plan?.capacity);
    const days = Number(plan?.period);
    if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(mb) || mb <= 0 || !Number.isFinite(days)) return;

    const gb = mb / 1000;
    plans.push({
      country: destination,
      provider: providers.get(plan.provider) || plan.provider || 'unknown',
      name: plan.name || '',
      gb: +gb.toFixed(2),
      days,
      usd,
      perGb: +(usd / gb).toFixed(3),
      promo: plan?.promo?.code || '',
      fiveG: plan?.has5G ? 'yes' : 'no',
    });
  });

  return { plans };
}

const csvCell = (s) => `"${String(s).replace(/"/g, "'").replace(/\s+/g, ' ').trim()}"`;

const all = [];
const failures = [];

for (const destination of DESTINATIONS) {
  try {
    const { plans, error } = await fetchMarket(destination);
    if (error || !plans?.length) { failures.push(`${destination}: ${error || 'тарифы не найдены'}`); continue; }
    all.push(...plans);
    const cheapest = plans.filter((p) => p.gb >= 3).sort((a, b) => a.perGb - b.perGb)[0];
    console.log(`${destination.padEnd(22)} тарифов: ${String(plans.length).padStart(4)}` +
      (cheapest ? `   дно рынка: $${cheapest.perGb}/ГБ — ${cheapest.provider}` : ''));
  } catch (e) {
    failures.push(`${destination}: ${e.cause?.code || e.message}`);
  }
}

if (failures.length) console.warn('\nне удалось прочитать:\n  ' + failures.join('\n  '));

// Половина направлений молча пропала — это поломка, а не пустой рынок.
// Лучше упасть, чем записать неполный файл, по которому потом примут решение.
if (all.length === 0 || failures.length > DESTINATIONS.length / 2) {
  console.error('\nданных слишком мало — выходим без записи файла');
  process.exit(1);
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
all.sort((a, b) => a.country.localeCompare(b.country) || a.perGb - b.perGb);
writeFileSync(
  new URL('../data/esimdb-market.csv', import.meta.url),
  ['country,provider,plan,gb,days,price_usd,price_per_gb,promo_code,5g',
    ...all.map((r) => [r.country, csvCell(r.provider), csvCell(r.name), r.gb, r.days, r.usd, r.perGb, r.promo, r.fiveG].join(',')),
  ].join('\n') + '\n'
);
console.log(`\nзаписано тарифов: ${all.length} по ${DESTINATIONS.length - failures.length} направлениям`);
