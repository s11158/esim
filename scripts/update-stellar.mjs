// Держит цены Stellar в index.html актуальными.
//
// Stellar отдаёт публичный фид без авторизации, но в ЕВРО, а каталог сайта живёт в долларах.
// Поэтому берём официальный курс ЕЦБ на сегодня и конвертируем. Курс — из первоисточника,
// а не «примерно 1.1», чтобы цену на сайте всегда можно было воспроизвести.
//
// Обновляем только поле price у строк provider:'Stellar', сопоставляя по стране, объёму и сроку.
// Если фид или курс недоступны — выходим без правок: лучше вчерашняя проверенная цена, чем выдуманная.
import { readFileSync, writeFileSync } from 'node:fs';

const FEED = 'https://stellarsecurity.com/assets/esim/products.snapshot.json';
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const FILE = new URL('../index.html', import.meta.url);

// country в index.html -> слуг направления у Stellar
const SLUGS = {
  'Турция': 'turkey', 'Таиланд': 'thailand', 'ОАЭ': 'united-arab-emirates',
  'Индонезия': 'indonesia', 'Япония': 'japan', 'Грузия': 'georgia', 'Египет': 'egypt',
  'Италия': 'italy', 'Испания': 'spain', 'Франция': 'france', 'Германия': 'germany',
  'Великобритания': 'united-kingdom', 'США': 'united-states', 'Вьетнам': 'vietnam',
  'Малайзия': 'malaysia', 'Сингапур': 'singapore', 'Мексика': 'mexico',
};

const ecbXml = await (await fetch(ECB)).text();
const rate = Number(ecbXml.match(/currency='USD'\s+rate='([\d.]+)'/)?.[1]);
const rateDate = ecbXml.match(/time='([\d-]+)'/)?.[1];
if (!Number.isFinite(rate) || rate <= 0) { console.error('курс ЕЦБ не прочитался — выходим без правок'); process.exit(1); }
console.log(`курс ЕЦБ EUR->USD: ${rate} (${rateDate})`);

const res = await fetch(FEED, { headers: { 'User-Agent': 'esim.pizza price sync' } });
if (!res.ok) { console.error(`фид Stellar отдал HTTP ${res.status} — выходим без правок`); process.exit(1); }
const feed = await res.json();
const products = Array.isArray(feed) ? feed : (feed.products || feed.data || []);
if (!products.length) { console.error('фид пустой — выходим без правок'); process.exit(1); }

const priceFor = (country, gb, days) => {
  const slug = SLUGS[country];
  if (!slug) return null;
  const product = products.find((p) => p.slug === `${slug}-esim`);
  if (!product) return null;
  const variant = (product.variants || []).find(
    (v) => v.active && v.data_gb === gb && v.duration_days === days && !/\/Day/i.test(v.name || '')
  );
  if (!variant) return null;
  return +(variant.unit_price_cents / 100 * rate).toFixed(2);
};

let html = readFileSync(FILE, 'utf8');
const changed = [];
const missing = [];

html = html.replace(/\{id:\d+,[^\n]*provider:'Stellar'[^\n]*\},?/g, (row) => {
  const country = row.match(/country:'([^']+)'/)?.[1];
  const gb = Number(row.match(/data:(\d+)/)?.[1]);
  const days = Number(row.match(/days:(\d+)/)?.[1]);
  const current = Number(row.match(/price:(\d+(?:\.\d+)?)/)?.[1]);

  const fresh = priceFor(country, gb, days);
  if (fresh === null) { missing.push(`${country} ${gb}ГБ/${days}д`); return row; }
  if (fresh === current) return row;

  changed.push(`${country} ${gb}ГБ/${days}д: ${current} -> ${fresh}`);
  return row.replace(/price:\d+(?:\.\d+)?/, `price:${fresh}`);
});

if (missing.length) console.warn('тарифы пропали из фида (проверить вручную):\n  ' + missing.join('\n  '));
if (!changed.length) { console.log('цены Stellar совпадают с фидом — правок нет'); process.exit(0); }

writeFileSync(FILE, html);
console.log('обновлено:\n  ' + changed.join('\n  '));
