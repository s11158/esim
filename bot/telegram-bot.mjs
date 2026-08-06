// Телеграм-бот подбора eSIM для esim.pizza. Long-polling на чистом fetch:
// вебхук требовал бы публичный HTTPS-адрес, а бот живёт на домашней машине,
// поэтому просто опрашиваем getUpdates. Без npm-зависимостей: Node 20+ уже
// умеет fetch, а телеграмный API - обычные POST с JSON.
//
// data/plans.json перечитывается на каждый запрос пользователя: файл маленький,
// зато бот подхватывает ежедневные обновления цен без рестарта процесса.
//
// Мы сравнилка с партнёрскими ссылками и работаем в ноль: покупка и оплата
// проходят на сайте провайдера, поэтому все тексты говорят "купить у провайдера",
// а не "купить у нас".
import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELFTEST = process.argv.includes('--selftest');

// ---------- секреты ----------
// .env парсим сами: ради одной пары KEY=VALUE тащить dotenv незачем.
function readToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN.trim();
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && m[1] === 'TELEGRAM_BOT_TOKEN') return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

// ---------- данные и ценовая математика ----------
function loadPlans() {
  return JSON.parse(readFileSync(join(root, 'data', 'plans.json'), 'utf8')).plans;
}

// Эффективная цена: промокод даёт скидку pct, округляем до центов как на сайте.
const eff = (p) => (p.promo ? Math.round(p.price * (1 - p.promo.pct) * 100) / 100 : p.price);
// Для цены за ГБ безлимит (999) считаем как 100 ГБ - та же условность, что на витрине,
// иначе безлимиты нечестно выигрывали бы любое сравнение.
const gbFor = (p) => (p.data === 999 ? 100 : p.data);
const perGb = (p) => eff(p) / gbFor(p);
const money = (n) => '$' + n.toFixed(2);
const dataLabel = (d) => (d === 999 ? 'безлимит' : `${d} ГБ`);

function uniqueCountries(plans) {
  const seen = new Map(); // страна -> флаг (флаг берём из первого попавшегося тарифа)
  for (const p of plans) {
    if (p.type === 'country' && !seen.has(p.country)) seen.set(p.country, p.flag);
  }
  return [...seen.keys()].sort((a, b) => a.localeCompare(b, 'ru')).map((c) => ({country: c, flag: seen.get(c)}));
}

// Точный подбор: как на сайте - срок и объём не меньше запрошенных,
// безлимит закрывает любой запрос по объёму, явный запрос безлимита
// отсекает всё остальное. Ранжируем по цене за гигабайт.
function matchPlans(plans, country, days, gb) {
  let list = plans.filter((p) => p.type === 'country' && p.country === country);
  if (days) list = list.filter((p) => p.days >= days);
  if (gb === 999) list = list.filter((p) => p.data === 999);
  else if (gb) list = list.filter((p) => p.data === 999 || p.data >= gb);
  return list.sort((a, b) => perGb(a) - perGb(b)).slice(0, 3);
}

// Когда точных совпадений нет - метрика недобора с сайта: насколько тариф
// недотягивает до запроса в долях от запрошенного, срок и объём весят одинаково.
function nearestPlans(plans, country, days, gb) {
  let list = plans.filter((p) => p.type === 'country' && p.country === country);
  if (!list.length) list = plans.filter((p) => p.type === 'country');
  const miss = (p) =>
    (days ? Math.max(0, days - p.days) / days : 0) + (gb ? Math.max(0, gb - p.data) / gb : 0);
  return list.sort((a, b) => miss(a) - miss(b) || perGb(a) - perGb(b)).slice(0, 3);
}

// ---------- тексты и клавиатуры ----------
const START_TEXT =
  'Привет! Я подбираю eSIM для поездок: сравниваю реальные цены провайдеров ' +
  'и показываю самое дешёвое.\n' +
  'Покупка и оплата проходят на сайте провайдера по нашей ссылке, наценки нет.\n\n' +
  'Куда едете? Выберите страну:';

const HELP_TEXT =
  'Как это работает:\n' +
  '1. Выбираете страну, срок поездки и объём трафика.\n' +
  '2. Я сравниваю тарифы провайдеров из каталога esim.pizza и показываю топ-3 по цене за гигабайт.\n' +
  '3. Кнопка "Купить у провайдера" ведёт на сайт провайдера: покупка и оплата проходят там, мы наценку не добавляем.\n\n' +
  'Команды:\n' +
  '/start - подобрать eSIM\n' +
  '/best - топ цен по всем странам\n\n' +
  'Полный каталог: https://esim.pizza';

function countryKeyboard(plans) {
  const rows = [];
  const all = uniqueCountries(plans);
  for (let i = 0; i < all.length; i += 3) {
    rows.push(all.slice(i, i + 3).map((c) => ({text: `${c.flag} ${c.country}`, callback_data: `c:${c.country}`})));
  }
  return {inline_keyboard: rows};
}

const daysKeyboard = () => ({
  inline_keyboard: [
    [7, 14, 30, 60].map((d) => ({text: String(d), callback_data: `d:${d}`})),
    [{text: 'Не важно', callback_data: 'd:0'}],
  ],
});

const gbKeyboard = () => ({
  inline_keyboard: [
    [5, 10, 20, 50].map((g) => ({text: String(g), callback_data: `g:${g}`})),
    [
      {text: 'Безлимит', callback_data: 'g:999'},
      {text: 'Не важно', callback_data: 'g:0'},
    ],
  ],
});

// Карточка тарифа одним сообщением: цена с учётом промокода, честная сноска
// про цену без кода и цена за гигабайт - главный критерий сравнения.
function planMessage(p) {
  let priceLine = `Цена: ${money(eff(p))}`;
  if (p.promo) {
    priceLine += ` по коду ${p.promo.code} (скидка ${Math.round(p.promo.pct * 100)}%), без кода ${money(p.price)}`;
  }
  return [
    `${p.flag} ${p.name}`,
    `${dataLabel(p.data)} / ${p.days} дней`,
    priceLine,
    `${money(perGb(p))} за ГБ`,
    `Провайдер: ${p.provider}`,
  ].join('\n');
}

const buyButton = (p) => ({inline_keyboard: [[{text: 'Купить у провайдера', url: p.aff}]]});

function bestLines(plans) {
  return plans
    .slice()
    .sort((a, b) => perGb(a) - perGb(b))
    .slice(0, 10)
    .map((p) => `${p.flag} ${p.country}: ${dataLabel(p.data)} / ${p.days} дней ${money(eff(p))} (${money(perGb(p))}/ГБ) ${p.provider}`);
}

// ---------- диалог ----------
// Состояние держим в памяти: бот перезапускается редко, а потеря шага диалога
// стоит пользователю одного нажатия /start - персистентность не окупается.
const sessions = new Map(); // chatId -> {country, days, data}

async function askDays(chatId, country, flag, api) {
  sessions.set(chatId, {country});
  await api.send(chatId, `Страна: ${flag} ${country}. На сколько дней поездка?`, daysKeyboard());
}

async function showResults(chatId, state, api) {
  const plans = loadPlans();
  const {country, days = 0, data: gb = 0} = state;
  let top = matchPlans(plans, country, days, gb);
  let header = `${country}: топ по цене за гигабайт`;
  if (!top.length) {
    header = 'Точных совпадений нет, показываю ближайшие';
    top = nearestPlans(plans, country, days, gb);
  }
  if (!top.length) {
    await api.send(chatId, 'В каталоге пока пусто. Загляните позже или посмотрите https://esim.pizza', null);
    return;
  }
  await api.send(chatId, header, null);
  for (const p of top) await api.send(chatId, planMessage(p), buyButton(p));
  sessions.delete(chatId); // сценарий завершён, следующий запрос начинается заново
}

async function handleMessage(msg, api) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const plans = loadPlans();

  if (text.startsWith('/start')) {
    await api.send(chatId, START_TEXT, countryKeyboard(plans));
    return;
  }
  if (text.startsWith('/best')) {
    await api.send(chatId, 'Топ-10 тарифов по цене за гигабайт:\n\n' + bestLines(plans).join('\n'), null);
    return;
  }
  if (text.startsWith('/help')) {
    await api.send(chatId, HELP_TEXT, null);
    return;
  }

  // Свободный текст: пробуем угадать страну по подстроке, чтобы "таиланд" или
  // "еду в Японию" сразу вели к выбору дней, а не заставляли листать клавиатуру.
  const query = text.toLowerCase();
  if (query.length >= 3) {
    const hit = uniqueCountries(plans).find(
      (c) => c.country.toLowerCase().includes(query) || query.includes(c.country.toLowerCase())
    );
    if (hit) {
      await askDays(chatId, hit.country, hit.flag, api);
      return;
    }
  }
  await api.send(chatId, 'Не узнал страну. Выберите из списка:', countryKeyboard(plans));
}

async function handleCallback(cb, api) {
  const chatId = cb.message?.chat?.id;
  await api.answerCallback(cb.id);
  if (chatId == null) return;
  const data = cb.data || '';
  const sep = data.indexOf(':');
  const kind = data.slice(0, sep);
  const value = data.slice(sep + 1);

  if (kind === 'c') {
    const plans = loadPlans();
    const hit = uniqueCountries(plans).find((c) => c.country === value);
    if (!hit) {
      await api.send(chatId, 'Такой страны уже нет в каталоге. Выберите заново:', countryKeyboard(plans));
      return;
    }
    await askDays(chatId, hit.country, hit.flag, api);
    return;
  }

  const state = sessions.get(chatId);
  if (!state) {
    // Рестарт бота стёр состояние, а кнопка в чате осталась - вежливо начинаем сначала.
    await api.send(chatId, 'Начнём сначала. Выберите страну:', countryKeyboard(loadPlans()));
    return;
  }

  if (kind === 'd') {
    state.days = Number(value) || 0;
    await api.send(chatId, 'Сколько гигабайт нужно?', gbKeyboard());
    return;
  }
  if (kind === 'g') {
    state.data = Number(value) || 0;
    await showResults(chatId, state, api);
  }
}

async function handleUpdate(update, api) {
  if (update.message) await handleMessage(update.message, api);
  else if (update.callback_query) await handleCallback(update.callback_query, api);
}

// ---------- самопроверка без сети ----------
// Прогоняем реальный сценарий на реальном data/plans.json с подменённой отправкой:
// ловим регрессии в фильтрации и форматировании до того, как их увидят пользователи.
async function selftest() {
  const outbox = [];
  const api = {
    send: async (chatId, text, replyMarkup) => outbox.push({chatId, text, replyMarkup}),
    answerCallback: async () => {},
  };
  const chat = {id: 1};
  await handleUpdate({message: {chat, text: '/start'}}, api);
  await handleUpdate({callback_query: {id: '1', message: {chat}, data: 'c:Канада'}}, api);
  await handleUpdate({callback_query: {id: '2', message: {chat}, data: 'd:14'}}, api);
  const before = outbox.length;
  await handleUpdate({callback_query: {id: '3', message: {chat}, data: 'g:20'}}, api);
  const finals = outbox.slice(before);

  const failures = [];
  if (before < 3) failures.push(`до финального шага бот отправил только ${before} сообщений вместо 3`);
  if (!finals.length) failures.push('после выбора гигабайт бот ничего не отправил');
  if (!finals.some((m) => m.text.includes('Stellar'))) failures.push('в финальном ответе нет "Stellar"');
  if (!finals.some((m) => JSON.stringify(m.replyMarkup || {}).includes('stellarafi.com'))) {
    failures.push('в финальном ответе нет кнопки со ссылкой на "stellarafi.com"');
  }

  if (failures.length) {
    console.error('SELFTEST FAIL:\n- ' + failures.join('\n- '));
    console.error('Отправленные сообщения:\n' + JSON.stringify(outbox, null, 2));
    process.exit(1);
  }
  console.log('SELFTEST PASS');
  process.exit(0);
}

if (SELFTEST) {
  await selftest();
}

// ---------- реальный запуск ----------
const token = readToken();
if (!token) {
  console.error(
    'Не найден TELEGRAM_BOT_TOKEN.\n' +
      `Создайте файл ${join(root, '.env')} и добавьте строку:\n` +
      'TELEGRAM_BOT_TOKEN=123456:ABC...\n' +
      'Токен выдаёт @BotFather в Telegram (команда /newbot). После этого запустите бот заново.'
  );
  process.exit(1);
}

async function tg(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(params || {}),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.description || 'HTTP ' + res.status}`);
  return body.result;
}

const liveApi = {
  send: (chatId, text, replyMarkup) =>
    tg('sendMessage', {
      chat_id: chatId,
      text,
      ...(replyMarkup ? {reply_markup: replyMarkup} : {}),
      disable_web_page_preview: true,
    }),
  // Ошибка answerCallbackQuery (например, протухший запрос после рестарта)
  // не должна ломать обработку нажатия.
  answerCallback: (id) => tg('answerCallbackQuery', {callback_query_id: id}).catch((e) => console.error(String(e.message || e))),
};

// Разовая настройка меню. Падение здесь не критично: бот полезен и без меню,
// поэтому логируем и продолжаем.
try {
  await tg('setMyCommands', {
    commands: [
      {command: 'start', description: 'Подобрать eSIM'},
      {command: 'best', description: 'Топ цен по всем странам'},
      {command: 'help', description: 'Как это работает'},
    ],
  });
} catch (e) {
  console.error(`setMyCommands не прошёл: ${e.message} - продолжаем`);
}
try {
  await tg('setChatMenuButton', {
    menu_button: {type: 'web_app', text: 'Каталог', web_app: {url: 'https://esim.pizza'}},
  });
} catch (e) {
  console.error(`setChatMenuButton не прошёл: ${e.message} - продолжаем без кнопки каталога`);
}

console.log('Бот запущен, слушаю getUpdates...');
let offset = 0;
for (;;) {
  let updates;
  try {
    updates = await tg('getUpdates', {timeout: 50, offset, allowed_updates: ['message', 'callback_query']});
  } catch (e) {
    // Сеть моргнула или Telegram недоступен - не роняем процесс, ждём и пробуем снова.
    console.error(`getUpdates: ${e.message} - пауза 3 секунды`);
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  }
  for (const u of updates) {
    offset = u.update_id + 1;
    try {
      await handleUpdate(u, liveApi);
    } catch (e) {
      // Один сломанный апдейт (кривой callback, недоступный chat) не должен
      // останавливать очередь остальных.
      console.error(`обработка апдейта ${u.update_id}: ${e.message}`);
    }
  }
}
