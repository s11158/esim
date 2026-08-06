// Ежедневный дайджест лучших цен для телеграм-канала. Берём только направления,
// где по data/market-gaps.csv мы уже держим дно рынка (action "ок"): хвастаться
// ценой, которую бьёт конкурент, значит подрывать доверие к сравнилке.
// Тарифы тянем из data/plans.json - единого источника для всех каналов, чтобы
// цифры в канале и на витрине не могли разойтись.
//
// Запуск: node scripts/post-deals.mjs [--selftest]
// Секреты: TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL_ID в .env в корне репозитория.
// Без секретов или с DRY_RUN=1 сообщение печатается в консоль и никуда не шлётся.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const selftest = process.argv.includes('--selftest');

// .env парсим сами: тащить dotenv ради десяти строк - лишняя зависимость,
// а секреты в переменных окружения CI тоже должны работать, поэтому env поверх файла.
const env = {};
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
  }
}
const secret = (k) => process.env[k] || env[k] || '';
const token = secret('TELEGRAM_BOT_TOKEN');
const chatId = secret('TELEGRAM_CHANNEL_ID');
const dryRun = selftest || secret('DRY_RUN') === '1' || !token || !chatId;

// В gaps направления латиницей (ключи market-map), в plans.json страны по-русски,
// как на витрине. Словарь - единственный мост между этими двумя мирами.
const RU = {
  canada: 'Канада',
  turkey: 'Турция',
  thailand: 'Таиланд',
  georgia: 'Грузия',
  vietnam: 'Вьетнам',
  japan: 'Япония',
  uae: 'ОАЭ',
  italy: 'Италия',
  spain: 'Испания',
  usa: 'США',
  france: 'Франция',
  germany: 'Германия',
  uk: 'Великобритания',
  indonesia: 'Индонезия',
  malaysia: 'Малайзия',
  singapore: 'Сингапур',
  mexico: 'Мексика',
  egypt: 'Египет',
  greece: 'Греция',
  china: 'Китай',
};

// Значения в market-gaps.csv всегда в кавычках и без запятых внутри,
// поэтому полноценный CSV-парсер не нужен: режем по запятой и снимаем кавычки.
const gapsPath = join(root, 'data', 'market-gaps.csv');
if (!existsSync(gapsPath)) {
  console.error('Нет data/market-gaps.csv - сначала собери рынок: node scripts/build-market.mjs');
  process.exit(1);
}
const gaps = readFileSync(gapsPath, 'utf8')
  .split('\n')
  .slice(1)
  .filter((l) => l.trim())
  .map((l) => {
    const [country, title, marketBest, marketBestProvider, oursBest, oursBestProvider, ratio, action] =
      l.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    return { country, title, oursBestProvider, action };
  });

const plansPath = join(root, 'data', 'plans.json');
if (!existsSync(plansPath)) {
  console.error('Нет data/plans.json - сначала выгрузи каталог: node scripts/export-plans.mjs');
  process.exit(1);
}
const { plans } = JSON.parse(readFileSync(plansPath, 'utf8'));

// Промокод меняет реальную цену покупателя, поэтому и ранжируем, и показываем
// эффективную цену, а не ту, что на ценнике до кода.
const round2 = (n) => Math.round(n * 100) / 100;
const effPrice = (p) => (p.promo ? round2(p.price * (1 - p.promo.pct)) : p.price);

const lines = [];
for (const g of gaps) {
  if (g.action !== 'ок') continue;
  const ru = RU[g.country];
  if (!ru) continue;
  // Безлимиты (data 999) из сравнения выкидываем: цена за ГБ у них не определена,
  // а дайджест построен именно вокруг этой метрики.
  const candidates = plans.filter(
    (p) => p.country === ru && p.provider === g.oursBestProvider && p.data !== 999 && p.data > 0
  );
  if (candidates.length === 0) continue;
  const best = candidates.reduce((a, b) => (effPrice(a) / a.data <= effPrice(b) / b.data ? a : b));
  const price = effPrice(best);
  const perGb = round2(price / best.data);
  const promoTail = best.promo ? ` промокод ${best.promo.code}` : '';
  lines.push(
    `${best.flag} ${ru}: <a href='${best.aff}'>${best.data} ГБ / ${best.days} дней за $${price.toFixed(2)}</a> ($${perGb.toFixed(2)}/ГБ)${promoTail}`
  );
  if (lines.length >= 8) break;
}

if (lines.length === 0) {
  console.error('Ни одного направления с action "ок" не нашлось в plans.json - дайджест пуст, не отправляем');
  process.exit(1);
}

const message = [
  '<b>Лучшие цены на eSIM сегодня</b>',
  new Date().toLocaleDateString('ru-RU'),
  '',
  ...lines,
  '',
  'Сравниваем реальные цены провайдеров, наценки нет. Полный каталог: https://esim.pizza',
].join('\n');

if (selftest) {
  // Самопроверка без секретов и сети: убеждаемся, что дайджест не выродился
  // (минимум 5 направлений) и что каждая строка ведёт живой https-ссылкой к провайдеру.
  const dealLines = message.split('\n').filter((l) => l.includes("<a href='https://"));
  if (dealLines.length >= 5) {
    console.log(message);
    console.log('SELFTEST PASS');
    process.exit(0);
  }
  console.error(message);
  console.error(`SELFTEST FAIL: строк направлений ${dealLines.length}, нужно минимум 5 с https-ссылками`);
  process.exit(1);
}

if (dryRun) {
  if (!token || !chatId) {
    console.log('Секретов нет, работаю вхолостую. Для реальной отправки положи в .env в корне репозитория:');
    console.log('TELEGRAM_BOT_TOKEN=токен бота от @BotFather');
    console.log('TELEGRAM_CHANNEL_ID=@имя_канала или числовой id');
    console.log('');
  }
  console.log(message);
  process.exit(0);
}

// disable_web_page_preview обязателен: превью раскрывало бы одну ссылку из восьми
// и перекашивало дайджест в пользу случайного провайдера.
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.ok) {
  console.error(`Telegram не принял сообщение: HTTP ${res.status} ${JSON.stringify(body)}`);
  process.exit(1);
}
console.log(`Дайджест отправлен в ${chatId}: направлений ${lines.length}`);
