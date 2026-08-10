// Внутренняя карта рынка: один нормализованный прайс по всем источникам, которые мы
// умеем читать машинно, плюс отчёт «где мы проигрываем».
//
// Зачем отдельно от fetch-competitors.mjs: тот берёт esimdb и видит только то, что
// попало в серверный HTML. Проверено 04.08.2026 на Канаде - там нет ни Movisim 75 ГБ
// за $19.99, ни нашего же Stellar 75 ГБ за $22.12, хотя в интерфейсе сайта они есть.
// Агрегатор годится как список имён провайдеров, но не как источник цен.
//
// Здесь каждая цена приходит из фида самого провайдера. Что не читается машинно -
// в таблицу не попадает совсем, чтобы не смешивать проверенное с приблизительным.
//
// Выход:
//   data/market-map.csv     - все тарифы всех источников, нормализованные
//   data/market-gaps.csv    - по направлению: дно рынка против нашего лучшего
//
// Запуск: node scripts/build-market.mjs [страна ...]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const UA = 'esim.pizza market map';
const READER = (url) => `https://r.jina.ai/${url}`;

// Комиссия - только там, где партнёрство подтверждено письмом. Ноль означает
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
// Слаги Stellar - только одностраничные продукты: у них есть и региональные пакеты
// вроде singapore-malaysia-thailand-esim, но их цена за гигабайт несравнима с местным
// тарифом и перекашивает «дно рынка» по конкретной стране.
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
  { key: 'usa', dog: 'us', stellar: 'united-states-esim', title: 'США' },
  { key: 'france', dog: 'fr', stellar: 'france-esim', title: 'Франция' },
  { key: 'germany', dog: 'de', stellar: 'germany-esim', title: 'Германия' },
  { key: 'uk', dog: 'gb', stellar: 'united-kingdom-esim', title: 'Британия' },
  { key: 'indonesia', dog: 'id', stellar: 'indonesia-esim', title: 'Индонезия' },
  { key: 'malaysia', dog: 'my', stellar: 'malaysia-esim', title: 'Малайзия' },
  { key: 'singapore', dog: 'sg', stellar: 'singapore-esim', title: 'Сингапур' },
  { key: 'mexico', dog: 'mx', stellar: 'mexico-esim', title: 'Мексика' },
  { key: 'egypt', dog: 'eg', stellar: 'egypt-esim', title: 'Египет' },
  { key: 'greece', dog: 'gr', stellar: 'greece-esim', title: 'Греция' },
  { key: 'china', dog: 'cn', stellar: 'china-esim', title: 'Китай' },
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

// --- Airalo: цены лежат в payload их Nuxt-страницы, в теге __NUXT_DATA__.
// Это плоский массив, где число означает ссылку на другой элемент массива.
// Регулярка по HTML тут не годится: на странице Канады рядом с канадскими тарифами
// висят карибские и североамериканские региональные пакеты. Поэтому берём массив
// packages именно у объекта страны, чей слаг совпадает с открытой страницей.
//
// Слаги страниц Airalo совпали со слагами Stellar по всем двадцати направлениям
// (проверено 09.08.2026 запросом каждой страницы). Поле airalo нужно на случай,
// когда они разойдутся.
const airaloSlug = (d) => d.airalo || d.stellar;
async function fromAiralo(dest) {
  const slug = airaloSlug(dest);
  const url = `https://www.airalo.com/${slug}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) { notes.push(`Airalo ${dest.key}: HTTP ${res.status}`); return; }
    const html = await res.text();
    const tag = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!tag) { notes.push(`Airalo ${dest.key}: на странице нет __NUXT_DATA__, разметка изменилась`); return; }
    const flat = JSON.parse(tag[1]);
    const deref = (i, depth = 0) => (depth > 8 ? null : (typeof flat[i] === 'number' ? deref(flat[i], depth + 1) : flat[i]));
    const country = slug.replace(/-esim$/, '');
    const holder = flat.find((v) => v && typeof v === 'object' && !Array.isArray(v)
      && 'packages' in v && 'slug' in v && deref(v.slug) === country);
    if (!holder) { notes.push(`Airalo ${dest.key}: страна ${country} не найдена в payload`); return; }
    let taken = 0;
    for (const ref of deref(holder.packages) || []) {
      const p = deref(ref);
      if (!p || typeof p !== 'object') continue;
      const gb = /^([\d.]+)\s*GB$/i.exec(String(deref(p.data)));
      const days = /^(\d+)\s*days?$/i.exec(String(deref(p.validity)));
      const price = deref(p.price);
      const usd = price && typeof price === 'object' ? Number(deref(price.amount)) : NaN;
      if (!gb || !days || !(usd > 0)) continue;
      add({
        country: dest.key,
        provider: 'Airalo',
        name: String(deref(p.slug) || ''),
        gb: Number(gb[1]),
        days: Number(days[1]),
        usd,
        source: url,
      });
      taken += 1;
    }
    if (!taken) notes.push(`Airalo ${dest.key}: страна найдена, но ни один тариф не разобрался`);
  } catch (e) {
    notes.push(`Airalo ${dest.key}: ${e.message}`);
  }
}

// --- Saily: сайт закрыт Cloudflare и с этой машины не открывается напрямую
// (Connect Timeout по IPv6), поэтому читаем через тот же reader-прокси, что и eSIM.dog.
// В его markdown тариф печатается тремя строками: объём, срок, цена в долларах.
// Слаг страницы - это слаг направления без хвоста -esim: united-arab-emirates, а не uae.
const SAILY_PLAN = /(\d+(?:\.\d+)?)\s*GB\s+(\d+)\s*days\s+US\$([\d.]+)/gi;
async function fromSaily(dest) {
  const slug = airaloSlug(dest).replace(/-esim$/, '');
  const url = `https://saily.com/esim-${slug}/`;
  try {
    const text = await (await fetch(READER(url), { headers: { 'User-Agent': UA } })).text();
    const seen = new Set();
    for (const m of text.matchAll(SAILY_PLAN)) {
      const gb = Number(m[1]);
      const days = Number(m[2]);
      const usd = Number(m[3]);
      // Один и тот же тариф печатается на странице дважды - в списке и в подборке.
      const id = `${gb}/${days}/${usd}`;
      if (seen.has(id)) continue;
      seen.add(id);
      add({ country: dest.key, provider: 'Saily', name: `${gb}GB / ${days}d`, gb, days, usd, source: url });
    }
    if (!seen.size) notes.push(`Saily ${dest.key}: тарифы не разобрались, разметка страницы изменилась`);
  } catch (e) {
    notes.push(`Saily ${dest.key}: ${e.message}`);
  }
}

// --- eSIM.dog: весь каталог страны лежит в RSC-потоке их страницы, полем allPlans.
//
// Раньше здесь была сетка из семи точек, и каждая точка запрашивалась отдельным URL
// вида ?tab=fixedgb&data=10&validity=30. Из 140 запросов доходило 29, по Египту и
// Таиланду ноль, и отчёт молча писал «ок» там, где мы просто не увидели чужую цену.
//
// Причина оказалась не в прокси: esim.dog отдаёт на наш IP страницу Access Restricted
// (проверено 09.08.2026 прямым запросом - HTTP 200, но это /blocked). Читать их можно
// только через reader-прокси, а тот при 140 запросах подряд отваливался.
//
// Теперь один запрос на страну вместо семи, и в ответе не одна подобранная цена,
// а весь их прайс: 117-183 тарифа на направление. Reader просим отдать HTML, а не
// markdown: цены живут в скриптах RSC, в markdown они не попадают.
const DOG_TRIES = 3;

// Поток RSC собирается из вызовов self.__next_f.push([1,"кусок"]) и склеивается в
// одну строку, в которой уже лежит JSON. Границу массива ищем счётчиком скобок:
// внутри значений встречаются и скобки, и кавычки.
function dogPlans(html) {
  let payload = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    payload += JSON.parse(`"${m[1]}"`);
  }
  const at = payload.indexOf('"allPlans":[');
  if (at === -1) return null;
  const start = payload.indexOf('[', at);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < payload.length; i += 1) {
    const c = payload[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth += 1;
    else if (c === ']') { depth -= 1; if (!depth) { try { return JSON.parse(payload.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function fromDog(dest) {
  const url = `https://esim.dog/${dest.dog}`;
  let plans = null;
  let last = '';
  for (let attempt = 1; attempt <= DOG_TRIES && !plans; attempt += 1) {
    try {
      const res = await fetch(READER(url), { headers: { 'User-Agent': UA, 'X-Return-Format': 'html' } });
      if (!res.ok) { last = `HTTP ${res.status}`; }
      else {
        const html = await res.text();
        plans = dogPlans(html);
        if (!plans) last = /Access Restricted/i.test(html) ? 'прокси получил Access Restricted' : 'в ответе нет allPlans';
      }
    } catch (e) {
      last = e.message;
    }
    if (!plans && attempt < DOG_TRIES) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  // Направление без цен - это дыра в сравнении, а не «мы не проигрываем».
  if (!plans) { notes.push(`eSIM.dog ${dest.key}: каталог не прочитан за ${DOG_TRIES} попытки (${last}) - сравнение по этому направлению без них`); return; }

  // Часть их тарифов работает только с платным VPN сверху: голая цена такого пакета
  // несравнима с обычной и занижала бы дно рынка. Считаем их отдельной строкой отчёта.
  let vpn = 0;
  let taken = 0;
  for (const p of plans) {
    if (p.vpnRequired === true) { vpn += 1; continue; }
    const gb = Number(p.gb);
    const usd = Number(p.price);
    if (!(gb > 0) || !(usd > 0)) continue;
    add({
      country: dest.key,
      provider: 'eSIM.dog',
      name: String(p.planid || ''),
      gb: +gb.toFixed(2),
      days: Number(p.days) || 0,
      usd,
      source: url,
    });
    taken += 1;
  }
  if (!taken) notes.push(`eSIM.dog ${dest.key}: каталог прочитан, но ни один тариф не разобрался`);
  else if (vpn) notes.push(`eSIM.dog ${dest.key}: ${taken} тарифов, ещё ${vpn} пропущено - они требуют платный VPN сверху`);
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
  if (!key) { notes.push('eSimerge: ключ не найден - опт в отчёт не попал'); return; }

  // Страну берём из country_code, а не поиском по тексту записи. Слаг esim.dog у нас
  // совпадает с ISO-2, поэтому карта строится прямо из него. Поиск подстрокой, который
  // здесь стоял раньше, находил опт только по десяти направлениям из двадцати и при этом
  // записывал украинские тарифы в Британию, потому что 'uk' лежит внутри 'ukraine'.
  const byIso = new Map(DESTINATIONS.map((d) => [d.dog.toUpperCase(), d]));
  const seen = new Set();
  for (let offset = 0; offset < 20000; offset += 1000) {
    // Портал регулярно отдаёт 502 на большой странице - это их шлюз, а не наш ключ,
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
      notes.push(`eSimerge: HTTP ${res ? res.status : 'нет ответа'} на offset ${offset}${res?.status === 401 || res?.status === 403 ? ' - ключ отозван, перевыпустить в портале' : ' - временный сбой их шлюза'}`);
      return;
    }
    const page = await res.json();
    const items = page.data || [];
    if (!items.length) break;
    // Неполная страница - она последняя. Дальше идти нельзя: за концом каталога
    // их шлюз отвечает 502, и это выглядело бы как отзыв ключа.
    const isLastPage = items.length < 1000;
    for (const p of items) {
      // Только страновые пакеты: региональные и глобальные покрывают десятки стран,
      // и их цена за гигабайт несравнима с местным тарифом.
      if (p.scope && p.scope !== 'country') continue;
      const iso = String(p.country_code || p.destination_code || '').toUpperCase();
      const dest = byIso.get(iso);
      if (!dest) continue;
      seen.add(dest.key);
      const gb = Number(p.data_mb ?? p.data ?? 0) / 1024;
      // Безлимиты приходят синтетическим объёмом в терабайтах - в сравнении по цене
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
  // Пустое направление - это факт о каталоге поставщика, а не молчаливый ноль в отчёте.
  const missing = DESTINATIONS.filter((d) => !seen.has(d.key)).map((d) => d.title);
  if (missing.length) notes.push(`eSimerge: страновых пакетов нет по направлениям: ${missing.join(', ')}`);
}

// --- Zesimo: оптовый агрегатор (Test Mode подключён 10.08.2026), цены reseller_price
// уже в долларах. Это себестоимость, как и eSimerge: строки идут в wholesale и только
// в локальные файлы. Ключ лежит в .env worktree (ZESIMO_API_KEY); если API недоступен,
// читаем последний снятый снапшот data/zesimo-packages.local.json.
async function fromZesimo() {
  let key = process.env.ZESIMO_API_KEY;
  if (!key) {
    try {
      const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
      key = (envText.match(/^ZESIMO_API_KEY=(.+)$/m) || [])[1]?.trim();
    } catch { /* ниже фолбэк на снапшот */ }
  }
  const byIso = new Map(DESTINATIONS.map((d) => [d.dog.toUpperCase(), d]));
  let all = null;
  if (key) {
    all = [];
    for (let page = 1; page <= 80; page += 1) {
      let res = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        res = await fetch(`https://zesimo.com/api/v1/packages?page=${page}&per_page=100`, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': UA },
        }).catch(() => null);
        if (res?.ok) break;
        // 429 - их rate limit, ждём дольше с каждой попыткой
        if (res && res.status !== 429 && res.status !== 502) break;
        await new Promise((r) => setTimeout(r, attempt * 5000));
      }
      if (!res?.ok) { notes.push(`Zesimo: HTTP ${res ? res.status : 'нет ответа'} на странице ${page} - дальше каталог из снапшота`); all = null; break; }
      const j = await res.json();
      const list = Array.isArray(j) ? j : (j.data || j.packages || []);
      if (!list.length) break;
      const before = new Set(all.map((p) => p.id)).size;
      all.push(...list);
      // Сервер без пагинации возвращал бы одни и те же 50 - тогда выходим.
      if (new Set(all.map((p) => p.id)).size === before) { all = [...new Map(all.map((p) => [p.id, p])).values()]; break; }
    }
  }
  if (!all) {
    try {
      all = JSON.parse(readFileSync(new URL('../data/zesimo-packages.local.json', import.meta.url), 'utf8'));
      notes.push(`Zesimo: использован локальный снапшот (${all.length} пакетов)`);
    } catch { notes.push('Zesimo: ни API, ни снапшота - опт в отчёт не попал'); return; }
  }
  let unlimited = 0;
  for (const p of all) {
    const cs = p.countries || [];
    if (cs.length !== 1) continue; // только страновые, как у eSimerge
    const dest = byIso.get(String(cs[0]).toUpperCase());
    if (!dest) continue;
    const gb = Number(p.data_gb) || 0;
    if (!(gb > 0) || gb > 500) continue;
    // У «безлимитов» Zesimo data_gb - это высокоскоростной объём по FUP (дневная норма,
    // умноженная на срок), то есть реальный сравнимый объём, а не синтетика. Считаем их,
    // но помечаем счётчиком в замечаниях.
    if (p.is_unlimited) unlimited += 1;
    const usd = Number(p.reseller_price);
    if (!(usd > 0)) continue;
    wholesale.push({
      country: dest.key,
      provider: 'Zesimo (опт)',
      name: p.name || '',
      gb: +gb.toFixed(1),
      days: Number(p.duration_days) || 0,
      usd: +usd.toFixed(2),
      perGb: +(usd / gb).toFixed(3),
      source: 'zesimo api',
    });
  }
  const got = new Set(wholesale.filter((w) => w.provider === 'Zesimo (опт)').map((w) => w.country));
  notes.push(`Zesimo: ${[...got].length} направлений из ${DESTINATIONS.length}, безлимитов в сравнении ${unlimited}`);
}

// --- Дилерские прайсы из файлов: у части поставщиков фида нет вовсе, прайс присылают
// таблицей. Скрипты scripts/import-dealer-price.py и scripts/import-eur-price-list.py
// раскладывают такие таблицы в CSV одной схемы, а здесь они читаются с диска.
// Файла нет - источник просто молчит, это не сбой сборки.
const DEALER_FILES = ['../data/gloesim-dealer.local.csv', '../data/mobisim-dealer.local.csv'];

function fromDealerCsv(file) {
  let text = null;
  try {
    text = readFileSync(new URL(file, import.meta.url), 'utf8');
  } catch {
    notes.push(`Дилерский прайс: файла ${file.replace('../data/', '')} нет, источник пропущен`);
    return;
  }
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  const idx = (name) => head.indexOf(name);
  const iCountry = idx('country');
  const iScope = idx('scope');
  const iProvider = idx('provider');
  const iName = idx('name');
  const iGb = idx('gb');
  const iDays = idx('days');
  const iUsd = idx('usd');
  const iSource = idx('source');
  const keys = new Set(DESTINATIONS.map((d) => d.key));
  let taken = 0;
  for (const line of lines) {
    // В названиях тарифов есть запятые, поэтому разбор с учётом кавычек.
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0)
      .map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (cells[iScope] !== 'country') continue;
    const country = cells[iCountry];
    if (!keys.has(country)) continue;
    const gb = Number(cells[iGb]);
    const usd = Number(cells[iUsd]);
    if (!(gb > 0) || !(usd > 0)) continue;
    wholesale.push({
      country,
      provider: cells[iProvider] || 'дилерский прайс (опт)',
      name: cells[iName] || '',
      gb: +gb.toFixed(1),
      days: Number(cells[iDays]) || 0,
      usd: +usd.toFixed(2),
      perGb: +(usd / gb).toFixed(3),
      source: cells[iSource] || 'dealer price file',
    });
    taken += 1;
  }
  notes.push(`Дилерский прайс ${file.replace('../data/', '')}: ${taken} тарифов по нашим направлениям`);
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
  notes.push('Maya: страновых тарифов нет - только глобальные безлимиты, в карту не попадают');
}
for (const dest of targets) await fromAiralo(dest);
for (const dest of targets) await fromSaily(dest);
for (const dest of targets) await fromDog(dest);
await fromEsimerge();
await fromZesimo();
for (const file of DEALER_FILES) fromDealerCsv(file);

// --- отчёт: где наш лучший вариант проигрывает рынку ---
const partners = new Set(Object.entries(COMMISSION).filter(([, pct]) => pct > 0).map(([name]) => name));
const gaps = [];
const costLines = [];
// Сравнение, в котором опт eSimerge засчитан как наша цена. Только локально.
const realLines = [];
// Сравниваем только сопоставимое. Цена за гигабайт у мелких пакетов почти всегда ниже:
// у Stellar 3 ГБ / 30 дней стоит $0.62 и бьёт по этой метрике любые 50 ГБ конкурента.
// Поездочный минимум - от 10 ГБ и от 14 дней; всё, что меньше, в сравнение дна не идёт.
const TRIP_MIN_GB = 10;
const TRIP_MIN_DAYS = 14;
const forTrip = (r) => r.gb >= TRIP_MIN_GB && r.days >= TRIP_MIN_DAYS;

for (const dest of DESTINATIONS) {
  const here = rows.filter((r) => r.country === dest.key && forTrip(r));
  if (!here.length) continue;
  const best = here.reduce((a, b) => (a.perGb <= b.perGb ? a : b));
  const ours = here.filter((r) => partners.has(r.provider));
  const bestOurs = ours.length ? ours.reduce((a, b) => (a.perGb <= b.perGb ? a : b)) : null;
  // Пакеты от 500 ГБ у eSimerge неотличимы от безлимитов с синтетическим объёмом:
  // США «1000 ГБ за $12.13» дало бы $0.012/ГБ и обрушило бы всю таблицу. В локальный
  // файл они попадают, в сравнение - нет, пока поставщик не подтвердит, что это реальный объём.
  const cost = wholesale.filter((r) => r.country === dest.key && forTrip(r) && r.gb < 500);
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

  // Решение владельца от 09.08.2026: опт eSimerge считать своей ценой, а не «возможностью».
  // Кошелёк не пополнен и заказов не было, но положить туда сотню - вопрос одного платежа,
  // поэтому в планировании эти цены наши. В публичный market-gaps.csv они не идут:
  // репозиторий открытый, а это себестоимость. Полная картина - в локальном файле.
  const withCost = bestCost && (!bestOurs || bestCost.perGb < bestOurs.perGb) ? bestCost : bestOurs;
  realLines.push({
    country: dest.key,
    title: dest.title,
    marketBest: best.perGb,
    marketBestProvider: best.provider,
    oursBest: withCost ? withCost.perGb : '',
    oursBestProvider: withCost ? withCost.provider : '',
    oursBestPlan: withCost ? `${withCost.gb}GB/${withCost.days}d $${withCost.usd}` : '',
    ratio: withCost ? +(withCost.perGb / best.perGb).toFixed(2) : '',
    action: withCost
      ? (withCost.perGb <= best.perGb ? 'дно рынка у нас' : `дороже рынка в ${(withCost.perGb / best.perGb).toFixed(2)}x - искать поставщика`)
      : 'цены нет ни у партнёров, ни в опте',
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
    action: bestOurs ? (bestOurs.perGb <= best.perGb * 1.05 ? 'ок' : `написать ${best.provider}`) : `нет партнёра - написать ${best.provider}`,
  });
}

const csv = (header, list) => [header.join(','), ...list.map((o) => header.map((h) => `"${String(o[h] ?? '').replace(/"/g, "'")}"`).join(','))].join('\n');
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/market-map.csv', import.meta.url),
  csv(['country', 'provider', 'name', 'gb', 'days', 'usd', 'perGb', 'source'], rows.sort((a, b) => a.country.localeCompare(b.country) || a.perGb - b.perGb)), 'utf8');
writeFileSync(new URL('../data/market-gaps.csv', import.meta.url),
  csv(['country', 'title', 'marketBest', 'marketBestProvider', 'oursBest', 'oursBestProvider', 'ratio', 'action'], gaps), 'utf8');

// Себестоимость - только локально: имя по маске *.local.csv закрыто .gitignore.
if (wholesale.length) {
  writeFileSync(new URL('../data/market-wholesale.local.csv', import.meta.url),
    csv(['country', 'provider', 'name', 'gb', 'days', 'usd', 'perGb', 'source'], wholesale.sort((a, b) => a.country.localeCompare(b.country) || a.perGb - b.perGb)), 'utf8');
  writeFileSync(new URL('../data/market-cost-vs-retail.local.csv', import.meta.url),
    csv(['country', 'title', 'marketBest', 'marketBestProvider', 'ourCost', 'ourCostPlan', 'couldUndercut'], costLines), 'utf8');
  writeFileSync(new URL('../data/market-gaps-with-wholesale.local.csv', import.meta.url),
    csv(['country', 'title', 'marketBest', 'marketBestProvider', 'oursBest', 'oursBestProvider', 'oursBestPlan', 'ratio', 'action'], realLines), 'utf8');
}

console.log(`тарифов собрано: ${rows.length}, направлений: ${new Set(rows.map((r) => r.country)).size}`);
for (const g of gaps) {
  console.log(`${g.title.padEnd(10)} дно $${g.marketBest}/ГБ (${g.marketBestProvider})   наш лучший ${g.oursBest ? '$' + g.oursBest + '/ГБ (' + g.oursBestProvider + ')' : '-'}   ${g.action}`);
}
if (costLines.some((c) => c.ourCost)) {
  console.log('\nсебестоимость против рынка (локально, в репозиторий не идёт):');
  for (const c of costLines.filter((x) => x.ourCost)) {
    console.log(`${c.title.padEnd(10)} рынок $${c.marketBest}/ГБ   наш опт $${c.ourCost}/ГБ (${c.ourCostPlan})   дешевле рынка в ${c.couldUndercut}x`);
  }
  const losing = realLines.filter((r) => r.ratio && r.ratio > 1);
  console.log('\nс учётом опта eSimerge как нашей цены (локально):');
  for (const r of realLines) {
    console.log(`${r.title.padEnd(10)} дно $${r.marketBest}/ГБ (${r.marketBestProvider})   наш ${r.oursBest ? '$' + r.oursBest + '/ГБ (' + r.oursBestProvider + ', ' + r.oursBestPlan + ')' : '-'}   ${r.action}`);
  }
  console.log(losing.length
    ? `проигрываем рынку по ${losing.length} направлениям: ${losing.map((r) => r.title).join(', ')}`
    : 'дно рынка держим по всем направлениям');
}
if (notes.length) console.log('\nзамечания:\n' + notes.map((n) => ' - ' + n).join('\n'));
