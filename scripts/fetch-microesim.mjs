// MicroEsim (MicroDrive Tech Co., Ltd): дилерский каталог через их Open API V1.
//
// Аутентификация у них своя, не Bearer. В каждый запрос идут четыре заголовка:
//   MICROESIM-ACCOUNT   - логин, выдают они
//   MICROESIM-NONCE     - случайная строка 6-32 символа
//   MICROESIM-TIMESTAMP - время в миллисекундах, 13 цифр
//   MICROESIM-SIGN      - HMAC-SHA256 от строки account+nonce+timestamp
// Ключ для HMAC получается из secret и salt через PBKDF2-SHA256, 1024 итерации,
// 32 байта, и дальше берётся как ASCII-строка своего hex-представления - именно так,
// как написано в их же примере: Buffer.from(hexKey, 'utf-8'). Это не опечатка,
// а часть их схемы, иначе подпись не сходится.
//
// Доступы кладутся в C:\Users\LENOVO\Downloads\microesim_key.txt в виде
//   account=...
//   secret=...
//   salt=...
// либо в переменные окружения MICROESIM_ACCOUNT, MICROESIM_SECRET, MICROESIM_SALT.
//
// Запуск:
//   node scripts/fetch-microesim.mjs           # прод business.microesim.com
//   node scripts/fetch-microesim.mjs --test    # песочница test.microesim.com
//
// Выход (оба в .gitignore, это себестоимость):
//   data/microesim-packages.local.json - сырой ответ, как пришёл
//   data/microesim-dealer.local.csv    - схема источников закупки для build-market.mjs
import { pbkdf2Sync, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';

const TEST = process.argv.includes('--test');
const BASE = TEST ? 'https://test.microesim.com' : 'https://business.microesim.com';
const KEY_FILE = 'C:/Users/LENOVO/Downloads/microesim_key.txt';

// Наши 20 направлений по ISO, как в build-market.mjs.
const DESTINATIONS = {
  CA: 'canada', TR: 'turkey', TH: 'thailand', GE: 'georgia', VN: 'vietnam', JP: 'japan',
  AE: 'uae', IT: 'italy', ES: 'spain', US: 'usa', FR: 'france', DE: 'germany', GB: 'uk',
  ID: 'indonesia', MY: 'malaysia', SG: 'singapore', MX: 'mexico', EG: 'egypt', GR: 'greece',
  CN: 'china',
};

function credentials() {
  const env = {
    account: process.env.MICROESIM_ACCOUNT,
    secret: process.env.MICROESIM_SECRET,
    salt: process.env.MICROESIM_SALT,
  };
  if (env.account && env.secret && env.salt) return env;
  let text = '';
  try {
    text = readFileSync(KEY_FILE, 'utf8');
  } catch {
    throw new Error(`нет доступов: положите account, secret и salt в ${KEY_FILE}`);
  }
  const pick = (name) => (text.match(new RegExp(`^\\s*${name}\\s*[=:]\\s*(.+)$`, 'mi')) || [])[1]?.trim();
  const out = { account: pick('account'), secret: pick('secret'), salt: pick('salt') };
  const missing = Object.entries(out).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`в ${KEY_FILE} не хватает: ${missing.join(', ')}`);
  return out;
}

function headers({ account, secret, salt }) {
  const nonce = randomBytes(8).toString('hex');
  const timestamp = String(Date.now());
  const hexKey = pbkdf2Sync(secret, Buffer.from(salt, 'hex'), 1024, 32, 'sha256').toString('hex');
  const sign = createHmac('sha256', Buffer.from(hexKey, 'utf-8')).update(account + nonce + timestamp).digest('hex');
  return {
    'Content-Type': 'application/json',
    'MICROESIM-ACCOUNT': account,
    'MICROESIM-NONCE': nonce,
    'MICROESIM-TIMESTAMP': timestamp,
    'MICROESIM-SIGN': sign,
  };
}

// Цены у них в гонконгских долларах. Курс берём у ЕЦБ: там евро к обеим валютам,
// доллар получается делением. Курса нет - падаем, а не выдумываем цифру.
async function hkdUsd() {
  const xml = await (await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')).text();
  const usd = Number((xml.match(/currency='USD'\s+rate='([\d.]+)'/) || [])[1]);
  const hkd = Number((xml.match(/currency='HKD'\s+rate='([\d.]+)'/) || [])[1]);
  if (!(usd > 0) || !(hkd > 0)) throw new Error('курс ЕЦБ не прочитался, пересчёт HKD в USD невозможен');
  return usd / hkd;
}

// Объём в гигабайтах. Безлимиты возвращают ноль: сравнивать их по цене за гигабайт нельзя.
function parseGb(value) {
  const s = String(value ?? '').toLowerCase();
  if (!s || s.includes('unlim')) return 0;
  const m = s.match(/([\d.]+)\s*(tb|gb|mb)/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (m[2] === 'mb') return n / 1024;
  if (m[2] === 'tb') return n * 1024;
  return n;
}

async function page(creds, pageNo) {
  const url = `${BASE}/allesim/v1/esimDataplanListPage?pageNo=${pageNo}&pageSize=500`;
  const res = await fetch(url, { headers: headers(creds) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`HTTP ${res.status} на странице ${pageNo}: ${JSON.stringify(body)?.slice(0, 300)}`);
  if (Number(body.code) !== 1) throw new Error(`ответ ${body.code}: ${body.msg}`);
  return body.result || {};
}

const creds = credentials();
const rate = await hkdUsd();
const all = [];
for (let n = 1; n <= 60; n += 1) {
  const r = await page(creds, n);
  const list = r.list || [];
  all.push(...list);
  if (!list.length || (r.totalPages && n >= Number(r.totalPages))) break;
}
if (!all.length) throw new Error('каталог пуст - проверьте, включён ли аккаунт в прод-среде');

writeFileSync(new URL('../data/microesim-packages.local.json', import.meta.url), JSON.stringify(all, null, 1));

const rows = [];
let unlimited = 0;
for (const p of all) {
  const iso = String(p.code || '').toUpperCase();
  const gb = parseGb(p.data);
  if (!gb) { unlimited += 1; continue; }
  const hkd = Number(p.price);
  if (!(hkd > 0)) continue;
  const usd = hkd * rate;
  rows.push({
    country: DESTINATIONS[iso] || '',
    destination: iso,
    // Мультистрановые тарифы у них помечены не ISO страны, а кодом региона:
    // в сравнение по стране такие не идут.
    scope: DESTINATIONS[iso] ? 'country' : 'regional',
    provider: 'MicroEsim (опт)',
    name: p.channel_dataplan_name || '',
    type: 'DATA-ONLY',
    gb: +gb.toFixed(3),
    days: Number(p.day) || 0,
    usd: +usd.toFixed(4),
    perGb: +(usd / gb).toFixed(3),
    source: `microesim api${TEST ? ' (test)' : ''}, курс ЕЦБ HKD/USD ${rate.toFixed(5)}`,
  });
}

const cols = ['country', 'destination', 'scope', 'provider', 'name', 'type', 'gb', 'days', 'usd', 'perGb', 'source'];
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
writeFileSync(new URL('../data/microesim-dealer.local.csv', import.meta.url), `${csv}\n`);

const ours = new Set(rows.filter((r) => r.country).map((r) => r.country));
console.log(`каталог: ${all.length} тарифов, с объёмом ${rows.length}, безлимитов ${unlimited}`);
console.log(`наших направлений покрыто: ${ours.size} из 20`);
