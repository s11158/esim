// Держит цены Saily и Airalo в index.html синхронными с их сайтами.
//
// Почему так: оба рендерят цены через JS и режут прямые запросы, поэтому ходим
// через reader-прокси r.jina.ai — он отдаёт отрендеренную страницу текстом.
// Обновляем ТОЛЬКО поле price у строк, которые нашли на странице по связке
// провайдер + направление + объём + срок. Ничего не добавляем и не удаляем.
//
// Правило проекта: выдуманных цен быть не может. Если страница не открылась или
// тариф на ней не найден — строку не трогаем, а пишем в лог, что она устарела.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../index.html', import.meta.url);
const proxy = (url) => 'https://r.jina.ai/' + url;

// country в конфиге должен совпадать с полем country в plans[].
const SOURCES = [
  { provider: 'Saily', country: 'Турция',    url: 'https://saily.com/esim-turkey/' },
  { provider: 'Saily', country: 'Таиланд',   url: 'https://saily.com/esim-thailand/' },
  { provider: 'Saily', country: 'Япония',    url: 'https://saily.com/esim-japan/' },
  { provider: 'Saily', country: 'Индонезия', url: 'https://saily.com/esim-indonesia/' },
  { provider: 'Saily', country: 'Грузия',    url: 'https://saily.com/esim-georgia/' },
  { provider: 'Saily', country: 'Египет',    url: 'https://saily.com/esim-egypt/' },
  { provider: 'Saily', country: 'ОАЭ',       url: 'https://saily.com/esim-united-arab-emirates/' },
  { provider: 'Saily', country: 'Азия',      url: 'https://saily.com/esim-asia/' },
  { provider: 'Saily', country: 'Европа',    url: 'https://saily.com/esim-europe/' },
  { provider: 'Airalo', country: 'Турция',    url: 'https://www.airalo.com/turkey-esim' },
  { provider: 'Airalo', country: 'Таиланд',   url: 'https://www.airalo.com/thailand-esim' },
  { provider: 'Airalo', country: 'Индонезия', url: 'https://www.airalo.com/indonesia-esim' },
  { provider: 'Airalo', country: 'Япония',    url: 'https://www.airalo.com/japan-esim' },
  { provider: 'Airalo', country: 'Грузия',    url: 'https://www.airalo.com/georgia-esim' },
  { provider: 'Airalo', country: 'Египет',    url: 'https://www.airalo.com/egypt-esim' },
  { provider: 'Airalo', country: 'ОАЭ',       url: 'https://www.airalo.com/united-arab-emirates-esim' },
  { provider: 'Airalo', country: 'Европа',    url: 'https://www.airalo.com/europe-esim' },
  { provider: 'Airalo', country: 'Азия',      url: 'https://www.airalo.com/asia-esim' },
  // Расширение каталога 2026-08-02
  { provider: 'Saily', country: 'Италия',         url: 'https://saily.com/esim-italy/' },
  { provider: 'Saily', country: 'Испания',        url: 'https://saily.com/esim-spain/' },
  { provider: 'Saily', country: 'Франция',        url: 'https://saily.com/esim-france/' },
  { provider: 'Saily', country: 'Германия',       url: 'https://saily.com/esim-germany/' },
  { provider: 'Saily', country: 'Великобритания', url: 'https://saily.com/esim-united-kingdom/' },
  { provider: 'Saily', country: 'США',            url: 'https://saily.com/esim-united-states/' },
  { provider: 'Saily', country: 'Вьетнам',        url: 'https://saily.com/esim-vietnam/' },
  { provider: 'Saily', country: 'Малайзия',       url: 'https://saily.com/esim-malaysia/' },
  { provider: 'Saily', country: 'Сингапур',       url: 'https://saily.com/esim-singapore/' },
  { provider: 'Saily', country: 'Мексика',        url: 'https://saily.com/esim-mexico/' },
  { provider: 'Airalo', country: 'Италия',         url: 'https://www.airalo.com/italy-esim' },
  { provider: 'Airalo', country: 'Испания',        url: 'https://www.airalo.com/spain-esim' },
  { provider: 'Airalo', country: 'Франция',        url: 'https://www.airalo.com/france-esim' },
  { provider: 'Airalo', country: 'Германия',       url: 'https://www.airalo.com/germany-esim' },
  { provider: 'Airalo', country: 'Великобритания', url: 'https://www.airalo.com/united-kingdom-esim' },
  { provider: 'Airalo', country: 'США',            url: 'https://www.airalo.com/united-states-esim' },
  { provider: 'Airalo', country: 'Вьетнам',        url: 'https://www.airalo.com/vietnam-esim' },
  { provider: 'Airalo', country: 'Малайзия',       url: 'https://www.airalo.com/malaysia-esim' },
  { provider: 'Airalo', country: 'Сингапур',       url: 'https://www.airalo.com/singapore-esim' },
  { provider: 'Airalo', country: 'Мексика',        url: 'https://www.airalo.com/mexico-esim' },
];

// Saily: "* 10 GB" / "30 days" / "US$15.99" идут подряд отдельными строками.
function parseSaily(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const gb = line.match(/^\*?\s*(\d+)\s?GB$/i);
    if (!gb) return;
    const window = lines.slice(i, i + 6);
    const days = window.join(' ').match(/(\d+)\s?days/i);
    const usd = window.join(' ').match(/US\$(\d+(?:\.\d+)?)/);
    if (days && usd) out.push({ data: +gb[1], days: +days[1], price: +usd[1] });
  });
  return out;
}

// Airalo: "7 days" / "Unlimited GB" / "$27.00 USD" — у них безлимиты, объём 999.
function parseAiralo(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const days = line.match(/^(\d+)\s?days$/i);
    if (!days) return;
    // между "7 days", "Unlimited GB" и ценой попадаются пустые строки — берём окно с запасом
    const window = lines.slice(i, i + 8).join(' ');
    const usd = window.match(/\$(\d+(?:\.\d+)?)\s?USD/);
    if (!usd) return;
    // У Airalo встречаются и безлимиты, и тарифы с фиксированным объёмом (999 = безлимит).
    const gb = window.match(/(\d+)\s?GB/i);
    if (/Unlimited GB/i.test(window)) out.push({ data: 999, days: +days[1], price: +usd[1] });
    else if (gb) out.push({ data: +gb[1], days: +days[1], price: +usd[1] });
  });
  return out;
}

const catalogue = new Map(); // "Provider|Country" -> [{data,days,price}]
let fetchFailures = 0;

for (const src of SOURCES) {
  try {
    const res = await fetch(proxy(src.url), { headers: { 'User-Agent': 'esim.pizza price sync' } });
    const text = await res.text();
    if (!res.ok || /Title: 404|could not be found/i.test(text)) {
      console.warn(`  ! ${src.provider} ${src.country}: страница недоступна (${res.status}) — строки оставлены как есть`);
      fetchFailures++;
      continue;
    }
    const lines = text.split('\n').map((l) => l.trim());
    const plans = src.provider === 'Saily' ? parseSaily(lines) : parseAiralo(lines);
    if (!plans.length) {
      console.warn(`  ! ${src.provider} ${src.country}: тарифы не распознались — возможно, изменилась вёрстка`);
      fetchFailures++;
      continue;
    }
    catalogue.set(`${src.provider}|${src.country}`, plans);
  } catch (e) {
    console.warn(`  ! ${src.provider} ${src.country}: ${e.cause?.code || e.message}`);
    fetchFailures++;
  }
}

if (!catalogue.size) {
  console.error('не удалось получить ни одного источника — выходим без правок');
  process.exit(1);
}

let html = readFileSync(FILE, 'utf8');
const changed = [];
const stale = [];

html = html.replace(/\{id:\d+,[^\n]*provider:'(?:Saily|Airalo)'[^\n]*\},?/g, (row) => {
  const provider = row.match(/provider:'(\w+)'/)?.[1];
  const country = row.match(/country:'([^']+)'/)?.[1];
  const data = Number(row.match(/data:(\d+)/)?.[1]);
  const days = Number(row.match(/days:(\d+)/)?.[1]);
  const price = Number(row.match(/price:(\d+(?:\.\d+)?)/)?.[1]);

  const plans = catalogue.get(`${provider}|${country}`);
  if (!plans) return row; // источник не опрошен — молча оставляем

  const match = plans.find((p) => p.data === data && p.days === days);
  if (!match) { stale.push(`${provider} ${country} ${data === 999 ? '∞' : data + 'ГБ'}/${days}д`); return row; }
  if (match.price === price) return row;

  changed.push(`${provider} ${country} ${data === 999 ? '∞' : data + 'ГБ'}/${days}д: ${price} -> ${match.price}`);
  return row.replace(/price:\d+(?:\.\d+)?/, `price:${match.price}`);
});

if (stale.length) console.warn('\nтарифы пропали со страниц провайдера (проверить вручную):\n  ' + stale.join('\n  '));
if (!changed.length) { console.log('\nцены совпадают с источниками — правок нет'); process.exit(0); }

writeFileSync(FILE, html);
console.log('\nобновлено:\n  ' + changed.join('\n  '));
