// Semrush: объёмы и сложность ключевиков Solar (v3 Analytics, база ae) + обзор бэклинков (v4).
// Ключи: файл C:\Users\LENOVO\Downloads\.env.semrush, строки SEMRUSH_API_KEY_V3=... (объёмы, органика)
// и SEMRUSH_API_KEY_V4=... (бэклинки, метрики ключевиков v4).
// Запуск: node scripts/solar-semrush.mjs  (результат в docs/solar-seo/semrush-YYYY-MM-DD.json и .md)
import fs from 'node:fs';
import path from 'node:path';

const envPath = 'C:/Users/LENOVO/Downloads/.env.semrush';
if (!fs.existsSync(envPath)) { console.error('Нет файла ' + envPath); process.exit(1); }
const env = fs.readFileSync(envPath, 'utf8');
const KEY3 = env.match(/SEMRUSH_API_KEY_V3=(\S+)/)?.[1];
const KEY4 = env.match(/SEMRUSH_API_KEY_V4=(\S+)/)?.[1];
if (!KEY3 && !KEY4) { console.error('В файле нет SEMRUSH_API_KEY_V3 / SEMRUSH_API_KEY_V4'); process.exit(1); }

const DOMAIN = 'solar-beauty.ae';
const DB = 'ae';
const KEYWORDS = [
  'dermal fillers dubai','lip fillers dubai','skin booster dubai','pigmentation treatment dubai',
  'acne scar treatment dubai','skin tightening dubai','double chin treatment dubai','chemical peel dubai',
  'mesotherapy dubai','hair loss treatment dubai',
  'hydrafacial dubai','botox dubai','laser hair removal dubai','hifu dubai','rf microneedling dubai',
];

async function v3(params) {
  if (!KEY3) throw new Error('нет ключа v3');
  const u = new URL('https://api.semrush.com/');
  for (const [k, v] of Object.entries({ key: KEY3, ...params })) u.searchParams.set(k, v);
  const r = await fetch(u);
  const t = await r.text();
  if (t.startsWith('ERROR')) throw new Error(t);
  const [head, ...rows] = t.trim().split('\n').map(l => l.split(';'));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
async function v4(pathname, params) {
  const u = new URL('https://api.semrush.com/apis/v4/' + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!KEY4) throw new Error('нет ключа v4');
  const r = await fetch(u, { headers: { Authorization: 'Apikey ' + KEY4 } });
  return r.json();
}

const out = { date: new Date().toISOString().slice(0, 10), domain: DOMAIN };
try {
  out.keywords = await v3({ type: 'phrase_these', phrase: KEYWORDS.join(';'), database: DB,
    export_columns: 'Ph,Nq,Cp,Co,Kd,Nr' });
} catch (e) { out.keywords_error = String(e); }
try {
  out.domain_organic = await v3({ type: 'domain_organic', domain: DOMAIN, database: DB, display_limit: 100,
    export_columns: 'Ph,Po,Pp,Nq,Kd,Ur,Tr' });
} catch (e) { out.domain_organic_error = String(e); }
try {
  out.backlinks = await v4('backlinks/v1/overview', { url: DOMAIN, scope: 'ROOT_DOMAIN' });
} catch (e) { out.backlinks_error = String(e); }
try {
  out.keyword_metrics_v4 = await v4('keywords/v1/metrics', { keywords: KEYWORDS.join(','), database: DB });
} catch (e) { out.keyword_metrics_v4_error = String(e); }

const dir = 'docs/solar-seo';
fs.writeFileSync(path.join(dir, `semrush-${out.date}.json`), JSON.stringify(out, null, 2));
let md = `# Semrush, ${out.date}, ${DOMAIN}, база ${DB}\n\n## Ключевики\n\n| Запрос | Объём | CPC | Сложность | Результатов |\n|---|---|---|---|---|\n`;
for (const k of out.keywords || []) md += `| ${k.Keyword} | ${k['Search Volume']} | ${k.CPC} | ${k['Keyword Difficulty Index'] ?? k['Keyword Difficulty']} | ${k['Number of Results']} |\n`;
md += `\n## Органика домена (топ-100)\n\n| Запрос | Позиция | Объём | URL |\n|---|---|---|---|\n`;
for (const k of out.domain_organic || []) md += `| ${k.Keyword} | ${k.Position} | ${k['Search Volume']} | ${k.Url} |\n`;
if (out.keywords_error) md += `\nОшибка ключевиков: ${out.keywords_error}\n`;
if (out.domain_organic_error) md += `\nОшибка органики: ${out.domain_organic_error}\n`;
md += `\n## Бэклинки (v4)\n\n\`\`\`\n${JSON.stringify(out.backlinks ?? out.backlinks_error, null, 2)}\n\`\`\`\n`;
fs.writeFileSync(path.join(dir, `semrush-${out.date}.md`), md);
console.log('Готово: ' + path.join(dir, `semrush-${out.date}.md`));
