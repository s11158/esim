// Внутренняя карта рынка: один нормализованный прайс по всем источникам, которые мы
// умеем читать машинно, плюс отчёт «где мы проигрываем».
//
// Зачем отдельно от fetch-competitors.mjs: тот берёт esimdb и видит только то, что
// попало в серверный HTML. Проверено 04.08.2026 на Канаде — там нет ни Movisim 75 ГБ
// за $19.99, ни нашего же Stellar 75 ГБ за $22.12, хотя в интерфейсе сайта они есть.
// Агрегатор годится как список имён провайдеров, но не как источник цен.
//
// Здесь каждая цена приходит из фида самого провайдера. Что не читается машинно —
// в таблицу не попадает совсем, чтобы не смешивать проверенное с приблизительным.
//
// Выход:
//   data/market-map.csv     — все тарифы всех источников, нормализованные
//   data/market-gaps.csv    — по направлению: дно рынка против нашего лучшего
//
// Запуск: node scripts/build-market.mjs [страна ...]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const UA = 'esim.pizza market map';
const READER = (url) => `https://r.jina.ai/${url}`;

// Комиссия — только там, где партнёрство подтверждено письмом. Ноль означает
// «продаём себе в убыток по времени, но по лучшей цене», и это осознанно.
const COMMISSION = {
  Stellar: 0.10,
  Maya: 0.15,
  Airalo: 0.12,
  Saily: 0.12,
  'eSIM.dog': 0,
  Movisim: 0,
};

// Направления: слаг esim.dog, название в фиде Stellar, человеческое имя.
const DESTINATIONS = [
  { key: 'canada', dog: 'ca', stellar: 'canada-esim', title: 'Канада' },
  { key: 'turkey', dog: 'tr', stellar: 'turkey-esim', title: 'Турция' },
  { key: 'thailand', dog: 'th', stellar: 'thailand-esim', title: 'Таиланд' },
  { key: 'georgia', dog: 'ge', stellar: 'georgia-esim', title: 'Грузия' },
  { key: 'vietnam', dog: 'vn', stellar: 'vietnam-esim', title: 'Вьетнам' },
  { key: 'japan', dog: 'jp', stellar: 'japan-esim', title: 'Япония' },
  { key: 'uae', dog: 'ae', stellar: 'united-arab-emirates-esim', title: 'ОАЭ' },
  { key: 'italy', dog: 'it', stellar: 'italy-esim', title: 'Италия' },
  { key: 'spain', dog: 'es', stellar: 'spain-esim', title: 'Испания' },
  // У Stellar нет продукта по США — там eSIM продают не все, проверено 04.08.2026.
  { key: 'usa', dog: 'us', stellar: null, title: 'США' },
];

const rows = [];
const notes = [];
const add = (r) => { if (r.gb > 0 && r.usd > 0) rows.push({ ...r, perGb: +(r.usd / r.gb).toFixed(3) }); };

// --- курс евро: цены Stellar приходят в EUR, а сравниваем всё в долларах ---
async function eurUsd() {
  try {
    const xml = await (await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')).text();
    const m = xml.match(/currency='USD'\s+rate='([\d.]+)'/);
    if (m) return Number(m[1]);
  } catch { /* ниже фолбэк */ }
  notes.push('курс ЕЦБ недоступен, взят запасной 1.155');
  return 1.155;
}

// --- Stellar: публичный снапшот каталога, EUR ---
async function fromStellar(rate) {
  const res = await fetch('https://stellarsecurity.com/assets/esim/products.snapshot.json', { headers: { 'User-Agent': UA } });
  if (!res.ok) { notes.push(`Stellar: HTTP ${res.status}`); return; }
  const payload = await res.json();
  const products = Array.isArray(payload) ? payload : payload.products || payload.data || [];
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  for (const dest of DESTINATIONS) {
    if (!dest.stellar) continue;
    const product = bySlug.get(dest.stellar);
    if (!product) { notes.push(`Stellar: нет продукта ${dest.stellar}`); continue; }
    for (const v of product.variants || []) {
      if (!v.active) continue;
      add({
        country: dest.key,
        provider: 'Stellar',
        name: v.name || '',
        gb: Number(v.data_gb) || 0,
        days: Number(v.duration_days) || 0,
        usd: +((Number(v.unit_price_cents) || 0) / 100 * rate).toFixed(2),
        source: 'stellar feed',
      });
    }
  }
}

// --- Maya: партнёрский JSON, уже в USD ---
async function fromMaya() {
  const res = await fetch('https://assets.maya.net/affiliates/plans.json', { headers: { 'User-Agent': UA } });
  if (!res.ok) { notes.push(`Maya: HTTP ${res.status}`); return; }
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.plans || data.data || [];
  for (const p of list) {
    const blob = JSON.stringify(p).toLowerCase();
    const dest = DESTINATIONS.find((d) => blob.includes(d.key) || blob.includes(d.title.toLowerCase()));
    if (!dest) continue;
    const gb = Number(p.data_gb ?? p.dataGb ?? p.data ?? 0);
    add({
      country: dest.key,
      provider: 'Maya',
      name: p.name || p.title || '',
      gb: gb > 500 ? gb / 1000 : gb, // часть фидов отдаёт мегабайты
      days: Number(p.days ?? p.validity ?? p.duration ?? 0),
      usd: Number(p.price ?? p.price_usd ?? p.usd ?? 0),
      source: 'maya plans.json',
    });
  }
}

// --- eSIM.dog: сетка тарифов адресуется прямо в URL, читаем через reader-прокси ---
const DOG_GRID = [
  [10, 30], [20, 30], [50, 30],
  [10, 14], [20, 14], [30, 14], [50, 14],
];
async function fromDog(dest) {
  for (const [gb, days] of DOG_GRID) {
    const url = `https://esim.dog/${dest.dog}?tab=fixedgb&data=${gb}&validity=${days}`;
    try {
      const text = await (await fetch(READER(url), { headers: { 'User-Agent': UA } })).text();
      // Страница печатает подобранный тариф как «30GB • 14d$21.76». Если точного
      // размера нет, eSIM.dog молча отдаёт ближайший — поэтому сверяем, что вернули
      // именно запрошенное, иначе цена уедет не к тому объёму.
      const m = text.match(new RegExp(`${gb}GB\\s*.\\s*${days}d\\$([0-9]+\\.[0-9]{2})`));
      if (!m) continue;
      add({
        country: dest.key,
        provider: 'eSIM.dog',
        name: `${gb}GB / ${days}d`,
        gb,
        days,
        usd: Number(m[1]),
        source: url,
      });
    } catch (e) {
      notes.push(`eSIM.dog ${dest.key} ${gb}/${days}: ${e.message}`);
    }
  }
}

// --- eSimerge: оптовый каталог, цены в риалах. Это наша себестоимость, а не рынок,
// поэтому строки идут в отдельный локальный файл и в публичный репозиторий не попадают.
const SAR_USD = 0.2666;
const wholesale = [];
async function fromEsimerge() {
  let key = process.env.ESIMERGE_LIVE_KEY;
  if (!key) {
    try {
      const file = readFileSync(process.env.ESIMERGE_KEY_FILE || 'C:/Users/LENOVO/Downloads/esimerge_key.txt', 'utf8');
      key = (file.match(/^ESIMERGE_LIVE_KEY=(.+)$/m) || [])[1]?.trim();
    } catch { /* ниже */ }
  }
  if (!key) { notes.push('eSimerge: ключ не найден — опт в отчёт не попал'); return; }

  const names = new Map(DESTINATIONS.map((d) => [d.title.toLowerCase(), d]));
  for (let offset = 0; offset < 20000; offset += 1000) {
    // Портал регулярно отдаёт 502 на большой странице — это их шлюз, а не наш ключ,
    // поэтому пробуем несколько раз, прежде чем считать источник недоступным.
    let res = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      res = await fetch(`https://portal.esimerge.com/api/public/v1/catalog?limit=1000&offset=${offset}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': UA },
      }).catch(() => null);
      if (res?.ok) break;
      if (res && res.status !== 502 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
    if (!res?.ok) {
      notes.push(`eSimerge: HTTP ${res ? res.status : 'нет ответа'} на offset ${offset}${res?.status === 401 || res?.status === 403 ? ' — ключ отозван, перевыпустить в портале' : ' — временный сбой их шлюза'}`);
      return;
    }
    const page = await res.json();
    const items = page.data || [];
    if (!items.length) break;
    // Неполная страница — она последняя. Дальше идти нельзя: за концом каталога
    // их шлюз отвечает 502, и это выглядело бы как отзыв ключа.
    const isLastPage = items.length < 1000;
    for (const p of items) {
      const blob = JSON.stringify(p).toLowerCase();
      const dest = DESTINATIONS.find((d) => blob.includes(`"${d.key}"`) || blob.includes(d.key)) || names.get('');
      if (!dest) continue;
      const gb = Number(p.data_mb ?? p.data ?? 0) / 1024;
      // Безлимиты приходят синтетическим объёмом в терабайтах — в сравнении по цене
      // за гигабайт они дают ноль и вытесняют реальные тарифы наверх.
      if (!(gb > 0) || gb > 1000) continue;
      const usd = +(Number(p.price_sar ?? p.price ?? 0) * SAR_USD).toFixed(2);
      if (!(usd > 0)) continue;
      wholesale.push({
        country: dest.key,
        provider: 'eSimerge (опт)',
        name: p.name || '',
        gb: +gb.toFixed(1),
        days: Number(p.validity_days ?? p.validity ?? 0),
        usd,
        // считаем сразу: страница может оборваться на сбое их шлюза, и добор
        // цены за гигабайт «потом» тогда не выполнится вовсе
        perGb: +(usd / gb).toFixed(3),
        source: 'esimerge api',
      });
    }
    if (isLastPage) break;
  }
}

const rate = await eurUsd();
const only = process.argv.slice(2);
const targets = only.length ? DESTINATIONS.filter((d) => only.includes(d.key)) : DESTINATIONS;

await fromStellar(rate);
const beforeMaya = rows.length;
await fromMaya();
if (rows.length === beforeMaya) {
  // Ожидаемо: Maya продаёт только глобальные безлимиты, страновых тарифов у неё нет.
  // Держим строку в отчёте, чтобы «ноль от Maya» читался как факт, а не как сбой фида.
  notes.push('Maya: страновых тарифов нет — только глобальные безлимиты, в карту не попадают');
}
for (const dest of targets) await fromDog(dest);
await fromEsimerge();

// --- отчёт: где наш лучший вариант проигрывает рынку ---
const partners = new Set(Object.entries(COMMISSION).filter(([, pct]) => pct > 0).map(([name]) => name));
const gaps = [];
const costLines = [];
for (const dest of DESTINATIONS) {
  const here = rows.filter((r) => r.country === dest.key);
  if (!here.length) continue;
  const best = here.reduce((a, b) => (a.perGb <= b.perGb ? a : b));
  const ours = here.filter((r) => partners.has(r.provider));
  const bestOurs = ours.length ? ours.reduce((a, b) => (a.perGb <= b.perGb ? a : b)) : null;
  const cost = wholesale.filter((r) => r.country === dest.key);
  const bestCost = cost.length ? cost.reduce((a, b) => (a.perGb <= b.perGb ? a : b)) : null;
  costLines.push({
    country: dest.key,
    title: dest.title,
    marketBest: best.perGb,
    marketBestProvider: best.provider,
    ourCost: bestCost ? bestCost.perGb : '',
    ourCostPlan: bestCost ? `${bestCost.gb}GB/${bestCost.days}d $${bestCost.usd}` : '',
    // во сколько раз мы могли бы продавать дешевле рынка, если бы торговали сами
    couldUndercut: bestCost ? +(best.perGb / bestCost.perGb).toFixed(2) : '',
  });
  gaps.push({
    country: dest.key,
    title: dest.title,
    marketBest: best.perGb,
    marketBestProvider: best.provider,
    oursBest: bestOurs ? bestOurs.perGb : '',
    oursBestProvider: bestOurs ? bestOurs.provider : '',
    // во сколько раз наш лучший дороже рыночного дна: >1 значит, что по этому
    // направлению нам нужен новый поставщик, а не новая скидка у старого
    ratio: bestOurs ? +(bestOurs.perGb / best.perGb).toFixed(2) : '',
    action: bestOurs ? (bestOurs.perGb <= best.perGb * 1.05 ? 'ок' : `написать ${best.provider}`) : `нет партнёра — написать ${best.provider}`,
  });
}

const csv = (header, list) => [header.join(','), ...list.map((o) => header.map((h) => `"${String(o[h] ?? '').replace(/"/g, "'")}"`).join(','))].join('\n');
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/market-map.csv', import.meta.url),
  csv(['country', 'provider', 'name', 'gb', 'days', 'usd', 'perGb', 'source'], rows.sort((a, b) => a.country.localeCompare(b.country) || a.perGb - b.perGb)), 'utf8');
writeFileSync(new URL('../data/market-gaps.csv', import.meta.url),
  csv(['country', 'title', 'marketBest', 'marketBestProvider', 'oursBest', 'oursBestProvider', 'ratio', 'action'], gaps), 'utf8');

// Себестоимость — только локально: имя по маске *.local.csv закрыто .gitignore.
if (wholesale.length) {
  writeFileSync(new URL('../data/market-wholesale.local.csv', import.meta.url),
    csv(['country', 'provider', 'name', 'gb', 'days', 'usd', 'perGb', 'source'], wholesale.sort((a, b) => a.country.localeCompare(b.country) || a.perGb - b.perGb)), 'utf8');
  writeFileSync(new URL('../data/market-cost-vs-retail.local.csv', import.meta.url),
    csv(['country', 'title', 'marketBest', 'marketBestProvider', 'ourCost', 'ourCostPlan', 'couldUndercut'], costLines), 'utf8');
}

console.log(`тарифов собрано: ${rows.length}, направлений: ${new Set(rows.map((r) => r.country)).size}`);
for (const g of gaps) {
  console.log(`${g.title.padEnd(10)} дно $${g.marketBest}/ГБ (${g.marketBestProvider})   наш лучший ${g.oursBest ? '$' + g.oursBest + '/ГБ (' + g.oursBestProvider + ')' : '—'}   ${g.action}`);
}
if (costLines.some((c) => c.ourCost)) {
  console.log('\nсебестоимость против рынка (локально, в репозиторий не идёт):');
  for (const c of costLines.filter((x) => x.ourCost)) {
    console.log(`${c.title.padEnd(10)} рынок $${c.marketBest}/ГБ   наш опт $${c.ourCost}/ГБ (${c.ourCostPlan})   дешевле рынка в ${c.couldUndercut}x`);
  }
}
if (notes.length) console.log('\nзамечания:\n' + notes.map((n) => ' - ' + n).join('\n'));
