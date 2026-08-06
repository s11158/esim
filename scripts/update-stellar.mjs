// Тарифы Stellar на витрину - из их публичного фида, без ручного ввода цен.
//
// Зачем: по карте рынка Stellar держит нижнюю границу на 14 направлениях из 20, а на
// сайте его не было вовсе. Мы показывали Airalo и Saily там, где сами же считаем, что
// человеку выгоднее другое - это ровно то, против чего сделан проект.
//
// Цены в фиде в евро, конвертируем по курсу ЕЦБ на сегодня. Берём поездочные пакеты:
// от 10 ГБ и от 14 дней, лучший по цене за гигабайт, и отдельно самый большой объём,
// если он существенно крупнее - люди с длинной поездкой ищут именно его.
//
// ⚠️ Ссылка работает только с параметром redirect: без него Stellar уводит на
// stellarvpn.org и продажа не засчитывается.
//
// Запуск: node scripts/update-stellar.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const FEED = 'https://stellarsecurity.com/assets/esim/products.snapshot.json';
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const PAGE = new URL('../index.html', import.meta.url);
const START = '// >>> STELLAR AUTO - не править руками, генерируется scripts/update-stellar.mjs';
const END = '// <<< STELLAR AUTO';

const DESTINATIONS = [
  { slug: 'canada-esim', country: 'Канада', flag: '🇨🇦' },
  { slug: 'turkey-esim', country: 'Турция', flag: '🇹🇷' },
  { slug: 'thailand-esim', country: 'Таиланд', flag: '🇹🇭' },
  { slug: 'georgia-esim', country: 'Грузия', flag: '🇬🇪' },
  { slug: 'vietnam-esim', country: 'Вьетнам', flag: '🇻🇳' },
  { slug: 'japan-esim', country: 'Япония', flag: '🇯🇵' },
  { slug: 'united-arab-emirates-esim', country: 'ОАЭ', flag: '🇦🇪' },
  { slug: 'italy-esim', country: 'Италия', flag: '🇮🇹' },
  { slug: 'spain-esim', country: 'Испания', flag: '🇪🇸' },
  { slug: 'united-states-esim', country: 'США', flag: '🇺🇸' },
  { slug: 'france-esim', country: 'Франция', flag: '🇫🇷' },
  { slug: 'germany-esim', country: 'Германия', flag: '🇩🇪' },
  { slug: 'united-kingdom-esim', country: 'Великобритания', flag: '🇬🇧' },
  { slug: 'indonesia-esim', country: 'Индонезия', flag: '🇮🇩' },
  { slug: 'malaysia-esim', country: 'Малайзия', flag: '🇲🇾' },
  { slug: 'singapore-esim', country: 'Сингапур', flag: '🇸🇬' },
  { slug: 'mexico-esim', country: 'Мексика', flag: '🇲🇽' },
  { slug: 'egypt-esim', country: 'Египет', flag: '🇪🇬' },
];

const MIN_GB = 10;
const MIN_DAYS = 14;
const FIRST_ID = 100; // существующие тарифы занимают 1-52, оставляем запас

async function eurUsd() {
  const xml = await (await fetch(ECB)).text();
  const m = xml.match(/currency='USD'\s+rate='([\d.]+)'/);
  if (!m) throw new Error('курс ЕЦБ не разобрался - цены не трогаем');
  return Number(m[1]);
}

const rate = await eurUsd();
const payload = await (await fetch(FEED, { headers: { 'User-Agent': 'esim.pizza price sync' } })).json();
const products = payload.data || payload.products || [];
const bySlug = new Map(products.map((p) => [p.slug, p]));

const plans = [];
let id = FIRST_ID;
const missing = [];

for (const dest of DESTINATIONS) {
  const product = bySlug.get(dest.slug);
  if (!product) { missing.push(dest.slug); continue; }
  const variants = (product.variants || [])
    .filter((v) => v.active && Number(v.data_gb) >= MIN_GB && Number(v.duration_days) >= MIN_DAYS && Number(v.unit_price_cents) > 0)
    .map((v) => ({
      gb: Number(v.data_gb),
      days: Number(v.duration_days),
      usd: Math.round((Number(v.unit_price_cents) / 100) * rate * 100) / 100,
    }));
  if (!variants.length) { missing.push(`${dest.slug}: нет пакетов от ${MIN_GB} ГБ и ${MIN_DAYS} дней`); continue; }

  const byValue = [...variants].sort((a, b) => a.usd / a.gb - b.usd / b.gb)[0];
  const biggest = [...variants].sort((a, b) => b.gb - a.gb)[0];
  // Второй карточкой показываем крупный пакет, только если он заметно больше:
  // иначе в выдаче окажутся два почти одинаковых тарифа одного провайдера.
  const chosen = biggest.gb >= byValue.gb * 2 ? [byValue, biggest] : [byValue];

  for (const v of chosen) {
    plans.push({
      id: id++,
      country: dest.country,
      flag: dest.flag,
      name: `Stellar ${v.gb} ГБ`,
      data: v.gb,
      days: v.days,
      price: v.usd,
      coverage: `${dest.country} · + бесплатный VPN`,
      aff: dest.slug,
    });
  }
}

const body = plans
  .map((p) => `      {id:${p.id},type:'country',country:'${p.country}',flag:'${p.flag}',name:'${p.name}',data:${p.data},days:${p.days},price:${p.price},popular:${p.id},coverage:'${p.coverage}',provider:'Stellar',aff:AFF.stellar+'${p.aff}',paid:true},`)
  .join('\n');

const html = readFileSync(PAGE, 'utf8');
const from = html.indexOf(START);
const to = html.indexOf(END);
if (from === -1 || to === -1) throw new Error('в index.html нет маркеров блока Stellar');

const generated = `${START}\n      // Курс ЕЦБ на день сборки: 1 EUR = ${rate} USD. Пакеты от ${MIN_GB} ГБ и ${MIN_DAYS} дней.\n${body}\n      ${END}`;
writeFileSync(PAGE, html.slice(0, from) + generated + html.slice(to + END.length), 'utf8');

console.log(`Stellar: ${plans.length} тарифов по ${new Set(plans.map((p) => p.country)).size} направлениям, курс ${rate}`);
if (missing.length) console.log('пропущено:\n' + missing.map((m) => ' - ' + m).join('\n'));
