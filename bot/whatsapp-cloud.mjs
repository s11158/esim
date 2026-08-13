// Автоответчик WhatsApp Cloud API: человек пишет страну и параметры, бот отвечает
// топ-3 тарифами с партнёрскими ссылками. Мы сравнилка и работаем в ноль: покупка -
// это переход по ссылке aff на сайт провайдера, деньги принимает провайдер, не мы.
// Чистый node:http без зависимостей, чтобы бот запускался на любой машине с Node 20+
// одной командой и не тянул npm install.
import {readFileSync, existsSync} from 'node:fs';
import http from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Английские названия стран: часть гостей приходит из Instagram и пишет латиницей.
// Сравниваем по целым токенам, а не подстрокой, чтобы "uk" не находился внутри
// случайных слов. Значения - русские названия ровно как в data/plans.json.
const EN_COUNTRIES = {
  canada: 'Канада', turkey: 'Турция', thailand: 'Таиланд', japan: 'Япония',
  uae: 'ОАЭ', dubai: 'ОАЭ', usa: 'США', italy: 'Италия', spain: 'Испания',
  france: 'Франция', germany: 'Германия', uk: 'Великобритания', england: 'Великобритания',
  vietnam: 'Вьетнам', georgia: 'Грузия', mexico: 'Мексика', egypt: 'Египет',
  indonesia: 'Индонезия', malaysia: 'Малайзия', singapore: 'Сингапур', china: 'Китай',
};

// Русские синонимы, которых нет в plans.json как названий стран: "дубай" пишут
// чаще, чем "ОАЭ", и терять такие запросы обидно. Ключи - основы слов без
// окончаний, чтобы ловить падежи ("в америку", "по англии").
const RU_SYNONYMS = {
  'дубай': 'ОАЭ', 'эмират': 'ОАЭ', 'англи': 'Великобритания',
  'британи': 'Великобритания', 'америк': 'США', 'штат': 'США',
};

// .env парсим сами: тащить dotenv ради десяти строк незачем.
function readEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

// Каталог читаем при каждом запросе: витрина обновляется скриптами несколько раз
// в день, и перезапускать бота после каждого обновления цен не хочется.
function loadPlans() {
  return JSON.parse(readFileSync(join(root, 'data', 'plans.json'), 'utf8')).plans;
}

// Эффективная цена с промокодом - именно её честно показывать пользователю,
// иначе сравнение по цене за ГБ будет врать в пользу тарифов без промо.
function effPrice(p) {
  return p.promo ? Math.round(p.price * (1 - p.promo.pct) * 100) / 100 : p.price;
}

function daysWord(n) {
  const d = n % 100;
  if (d >= 11 && d <= 14) return 'дней';
  const r = d % 10;
  if (r === 1) return 'день';
  if (r >= 2 && r <= 4) return 'дня';
  return 'дней';
}

// Разбор свободного текста: страна подстрокой без регистра (длинные названия
// проверяем первыми, чтобы не срабатывали куски коротких), ГБ - число рядом с
// "гб"/"gb", дни - число рядом со словом "дн", иначе второе число в сообщении.
// Без чисел берём разумный дефолт 10 ГБ / 30 дней - обычная поездка.
function parseRequest(text, countries) {
  const lower = text.toLowerCase();

  let country = null;
  for (const c of [...countries].sort((a, b) => b.length - a.length)) {
    if (lower.includes(c.toLowerCase())) { country = c; break; }
  }
  if (!country) {
    for (const [syn, ru] of Object.entries(RU_SYNONYMS)) {
      if (lower.includes(syn) && countries.includes(ru)) { country = ru; break; }
    }
  }
  if (!country) {
    for (const token of lower.match(/[a-z]+/g) || []) {
      const ru = EN_COUNTRIES[token];
      if (ru && countries.includes(ru)) { country = ru; break; }
    }
  }

  let gb = null;
  const gbM = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:гб|gb)/);
  if (gbM) gb = parseFloat(gbM[1].replace(',', '.'));

  let days = null;
  const dBefore = lower.match(/(\d{1,3})\s*дн/);      // "14 дней"
  const dAfter = lower.match(/дн\D{0,2}(\d{1,3})/);   // "дней: 14"
  if (dBefore && +dBefore[1] <= 365) days = +dBefore[1];
  else if (dAfter && +dAfter[1] <= 365) days = +dAfter[1];
  if (days === null) {
    const nums = (lower.match(/\d+(?:[.,]\d+)?/g) || []).map(n => parseFloat(n.replace(',', '.')));
    // Число без единиц измерения: первое считаем гигабайтами, второе - днями.
    if (gb === null && nums.length) gb = nums[0];
    if (nums.length >= 2 && nums[1] <= 365 && nums[1] !== gb) days = nums[1];
  }
  if (gb === null) gb = 10;
  if (days === null) days = 30;

  return {country, gb, days};
}

// Отбор: сначала тарифы, покрывающие запрос (объём и срок не меньше нужных,
// 999 значит безлимит и подходит под любой объём). Если таких нет - показываем
// все тарифы страны: лучше ближайшие варианты, чем пустой ответ. Сортировка
// по цене за ГБ, потому что это главный критерий нашей витрины.
function pickPlans(plans, country, gb, days) {
  const all = plans.filter(p => p.country === country);
  let list = all.filter(p => (p.data === 999 || p.data >= gb) && p.days >= days);
  const exact = list.length > 0;
  if (!exact) list = all;
  list = [...list].sort((a, b) => effPrice(a) / a.data - effPrice(b) / b.data);
  return {list: list.slice(0, 3), exact};
}

function buildReply(text) {
  const plans = loadPlans();
  const countries = [...new Set(plans.map(p => p.country))];
  const {country, gb, days} = parseRequest(text, countries);

  if (!country) {
    return 'Привет! Я подбираю выгодные eSIM для поездок. Доступные направления: ' +
      countries.join(', ') + '.\n\n' +
      'Напишите страну и параметры, например: "Канада 20 гб 14 дней".';
  }

  const {list, exact} = pickPlans(plans, country, gb, days);
  const head = exact
    ? `Топ-3 по цене за ГБ под запрос ${gb} ГБ / ${days} ${daysWord(days)}:`
    : `Ровно под ${gb} ГБ / ${days} ${daysWord(days)} ничего нет, вот ближайшие тарифы:`;

  const blocks = list.map(p => {
    const dataStr = p.data === 999 ? 'безлимит' : `${p.data} ГБ`;
    const promoStr = p.promo ? ` (промокод ${p.promo.code})` : '';
    return `${p.flag} ${p.country}, ${dataStr} / ${p.days} ${daysWord(p.days)}: $${effPrice(p).toFixed(2)} у ${p.provider}${promoStr}\n${p.aff}`;
  });

  return [head, ...blocks, 'Полное сравнение: https://esim.pizza'].join('\n\n');
}

// Обход стандартного payload Cloud API: entry[].changes[].value.messages[].
// Статусы доставки и не-текст молча пропускаем - на них отвечать нечем.
// Отправку принимаем параметром, чтобы селфтест подменял её без сети.
async function handleIncoming(payload, send) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) {
        if (msg.type !== 'text' || !msg.text?.body) continue;
        try {
          await send(msg.from, buildReply(msg.text.body));
        } catch (e) {
          console.error('Не смог ответить на сообщение:', e.message);
        }
      }
    }
  }
}

// --- Селфтест: без сети и без секретов, отправка подменена на копилку. ---
if (process.argv.includes('--selftest')) {
  const sent = [];
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{id: '0', changes: [{field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: {display_phone_number: '10000000000', phone_number_id: '111'},
      messages: [{from: '79990000000', id: 'wamid.TEST', timestamp: '0', type: 'text',
        text: {body: 'Канада 20 гб 14 дней'}}],
    }}]}],
  };
  await handleIncoming(payload, async (to, body) => sent.push({to, body}));

  const reply = sent[0]?.body || '';
  const checks = [
    ['ответ отправлен ровно один', sent.length === 1],
    ['в ответе есть провайдер Stellar', reply.includes('Stellar')],
    ['в ответе есть ссылка stellarafi.com', reply.includes('stellarafi.com')],
    ['в конце ссылка на витрину', reply.includes('Полное сравнение: https://esim.pizza')],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error('SELFTEST FAIL:', failed.map(([name]) => name).join('; '));
    console.error('Ответ бота:\n' + reply);
    process.exit(1);
  }
  console.log('SELFTEST PASS');
  process.exit(0);
}

// --- Боевой режим: секреты обязательны, без них объясняем что положить в .env. ---
const env = readEnv() || {};
const missing = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN']
  .filter(k => !env[k]);
if (missing.length) {
  console.error('Не хватает секретов: ' + missing.join(', ') + '.');
  console.error('Создай файл .env в корне репозитория и положи туда строки:');
  console.error('WHATSAPP_TOKEN=постоянный токен System User из Business Settings');
  console.error('WHATSAPP_PHONE_NUMBER_ID=ID номера из настроек продукта WhatsApp');
  console.error('WHATSAPP_VERIFY_TOKEN=любая своя строка, её же указать в настройках вебхука');
  console.error('PORT=3100 (необязательно, это порт по умолчанию)');
  console.error('Пошаговая инструкция: docs/WHATSAPP_SETUP.md');
  process.exit(1);
}
const PORT = Number(env.PORT) || 3100;

async function sendMessage(to, body) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {preview_url: false, body},
    }),
  });
  if (!res.ok) {
    console.error(`Cloud API ответил ${res.status}: ${await res.text()}`);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Верификация вебхука: Meta дергает GET с challenge при подписке.
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === env.WHATSAPP_VERIFY_TOKEN;
    res.writeHead(ok ? 200 : 403, {'Content-Type': 'text/plain'});
    res.end(ok ? url.searchParams.get('hub.challenge') || '' : 'Forbidden');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // защита от мусорных мегабайтов
    });
    req.on('end', () => {
      // Отвечаем 200 сразу: Meta ждёт недолго и при таймауте начинает ретраить,
      // а ответ пользователю уходит асинхронно и вебхук не тормозит.
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('OK');
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return; // не JSON - значит не Cloud API, игнорируем
      }
      handleIncoming(payload, sendMessage).catch(e => console.error('Ошибка обработки вебхука:', e.message));
    });
    return;
  }

  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`WhatsApp-бот слушает http://localhost:${PORT}/webhook`);
  console.log('Туннель для Meta: cloudflared tunnel --url http://localhost:' + PORT);
});
