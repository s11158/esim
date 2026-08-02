// Ежедневная выгрузка цен конкурентов-агрегаторов в data/.
// Нужна, чтобы видеть реальный рынок по каждому направлению, а не только свой каталог.
//
// Источники:
//   esimdb.com   — крупнейший агрегатор, показывает десятки провайдеров с ценой за ГБ.
//   esim.dog     — наш ценовой ориентир, публикует собственную сравнительную таблицу.
// Оба рендерят через JS и режут прямые запросы, поэтому идём через r.jina.ai.
//
// ⚠️ Важно про esimdb: страница отсортирована по абсолютной цене, поэтому наверху
// висят промо-тарифы на 100–500 МБ за копейки. Брать их как «лучшую цену» нельзя —
// фильтруем по объёму от 3 ГБ, иначе рынок выглядит в разы дешевле, чем он есть.
import { writeFileSync, mkdirSync } from 'node:fs';

const DESTINATIONS = [
  'turkey', 'thailand', 'united-arab-emirates', 'indonesia', 'japan', 'georgia', 'egypt',
  'italy', 'spain', 'france', 'germany', 'united-kingdom', 'united-states', 'vietnam',
  'malaysia', 'singapore', 'mexico',
];

const MIN_GB = 3; // ниже этого объёма тарифы не сопоставимы с поездочными

// Прокси регулярно срывается на тяжёлых страницах, поэтому пробуем трижды —
// без этого половина направлений теряется на ровном месте.
const read = async (url, attempts = 3) => {
  for (let n = 1; n <= attempts; n++) {
    try {
      const res = await fetch('https://r.jina.ai/' + url, { headers: { 'User-Agent': 'esim.pizza competitor watch' } });
      const text = await res.text();
      if (res.ok && !/Title: 404|could not be found|Access Restricted/i.test(text) && text.length > 5000) {
        return text.split('\n').map((l) => l.trim()).filter(Boolean);
      }
    } catch { /* сеть моргнула — идём на следующую попытку */ }
    if (n < attempts) await new Promise((r) => setTimeout(r, 2000 * n));
  }
  return null;
};

// Блок тарифа на esimdb: название / [5G] / провайдер / объём / срок / $X/GB / $цена
function parseEsimdb(lines, country) {
  const out = [];
  lines.forEach((line, i) => {
    const vol = line.match(/^(\d+(?:\.\d+)?)\s?(GB|MB)$/i);
    if (!vol) return;
    const gb = vol[2].toUpperCase() === 'MB' ? +vol[1] / 1024 : +vol[1];
    if (gb < MIN_GB) return;

    const days = lines[i + 1]?.match(/^(\d+)\s?Days?$/i);
    const perGb = lines[i + 2]?.match(/^\$(\d+(?:\.\d+)?)\/GB$/);
    const price = lines[i + 3]?.match(/^\$(\d+(?:\.\d+)?)$/);
    if (!days || !perGb || !price) return;

    const provider = lines[i - 1] === '5G' ? lines[i - 2] : lines[i - 1];
    out.push({ country, provider: (provider || '').replace(/,/g, ' '), gb, days: +days[1], price: +price[1], perGb: +perGb[1] });
  });
  return out;
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });

// ── esimdb ────────────────────────────────────────────────────────────────────
const rows = [];
const failed = [];
for (const dest of DESTINATIONS) {
  const lines = await read(`https://esimdb.com/${dest}`);
  if (!lines) { failed.push(dest); continue; }
  const plans = parseEsimdb(lines, dest);
  if (!plans.length) { failed.push(dest); continue; }
  plans.sort((a, b) => a.perGb - b.perGb);
  rows.push(...plans.slice(0, 15)); // 15 лучших по цене за ГБ — этого хватает, чтобы видеть дно рынка
  console.log(`${dest.padEnd(22)} тарифов: ${plans.length}, лучший $${plans[0].perGb}/ГБ (${plans[0].provider})`);
}

if (failed.length) console.warn(`\nне удалось прочитать: ${failed.join(', ')}`);

if (rows.length) {
  writeFileSync(
    new URL('../data/esimdb-market.csv', import.meta.url),
    ['country,provider,gb,days,price_usd,price_per_gb', ...rows.map((r) => `${r.country},${r.provider},${r.gb},${r.days},${r.price},${r.perGb}`)].join('\n') + '\n'
  );
  console.log(`\nesimdb: записано строк ${rows.length}`);
} else {
  console.error('esimdb: не удалось получить ни одной строки');
}
