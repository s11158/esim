// Единый аналитический дашборд по всем тарифам всех источников, до которых мы дотянулись.
//
// Складывает в один файл розницу конкурентов и партнёров из карты рынка и закупочные
// прайсы поставщиков, считает места 1-2-3 по каждому направлению и выдаёт локальную
// HTML-страницу с фильтрами. Наружу ничего не публикуется: в данных наша себестоимость.
//
// В CI и на Pages этот дашборд НЕ собирается и НЕ публикуется: входные файлы
// *-dealer.local.csv, market-wholesale.local.csv и zesimo-packages.local.json содержат
// оптовые закупочные цены, репозиторий публичный. Пересборка только локальная.
//
// Запуск: npm run analytics (или node scripts/build-analytics.mjs)
// Выход:  data/analytics.local.html (плюс копия в Downloads делается вручную)
import { readFileSync, writeFileSync } from 'node:fs';

const TITLES = {
  canada: 'Канада', turkey: 'Турция', thailand: 'Таиланд', georgia: 'Грузия',
  vietnam: 'Вьетнам', japan: 'Япония', uae: 'ОАЭ', italy: 'Италия', spain: 'Испания',
  usa: 'США', france: 'Франция', germany: 'Германия', uk: 'Британия',
  indonesia: 'Индонезия', malaysia: 'Малайзия', singapore: 'Сингапур', mexico: 'Мексика',
  egypt: 'Египет', greece: 'Греция', china: 'Китай',
};
const ISO = {
  canada: 'CA', turkey: 'TR', thailand: 'TH', georgia: 'GE', vietnam: 'VN', japan: 'JP',
  uae: 'AE', italy: 'IT', spain: 'ES', usa: 'US', france: 'FR', germany: 'DE', uk: 'GB',
  indonesia: 'ID', malaysia: 'MY', singapore: 'SG', mexico: 'MX', egypt: 'EG',
  greece: 'GR', china: 'CN',
};

function readCsv(file) {
  let text;
  try {
    text = readFileSync(new URL(file, import.meta.url), 'utf8');
  } catch {
    return [];
  }
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  return lines.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0)
      .map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

// kind: розница это то, что платит покупатель, опт это наша закупка.
const rows = [];
const push = (provider, kind, country, gb, days, usd, name, scope) => {
  const g = Number(gb);
  const u = Number(usd);
  const d = Number(days) || 0;
  if (!(g > 0) || !(u > 0)) return;
  rows.push({
    p: provider, k: kind, c: country || '', t: TITLES[country] || country || '',
    s: scope || 'country', g: +g.toFixed(2), d, u: +u.toFixed(2),
    r: +(u / g).toFixed(4), n: (name || '').slice(0, 90),
  });
};

for (const r of readCsv('../data/market-map.csv')) {
  push(r.provider, 'розница', r.country, r.gb, r.days, r.usd, r.name, 'country');
}
for (const r of readCsv('../data/market-wholesale.local.csv')) {
  push('eSimerge', 'опт', r.country, r.gb, r.days, r.usd, r.name, 'country');
}
const dealerFiles = [
  ['../data/gloesim-dealer.local.csv', 'GloEsim'],
  ['../data/mobisim-dealer.local.csv', 'MobiSIM'],
  ['../data/microesim-dealer.local.csv', 'MicroEsim'],
  ['../data/roamwifi-dealer.local.csv', 'RoamWiFi'],
  ['../data/airhub-dealer.local.csv', 'Airhub'],
  ['../data/zendit-dealer.local.csv', 'Zendit'],
];
for (const [file, label] of dealerFiles) {
  for (const r of readCsv(file)) {
    push(label, 'опт', r.country, r.gb, r.days, r.usd, r.name || r.destination, r.scope);
  }
}
// Zesimo лежит снапшотом JSON, а не CSV.
try {
  const zes = JSON.parse(readFileSync(new URL('../data/zesimo-packages.local.json', import.meta.url), 'utf8'));
  const byIso = Object.fromEntries(Object.entries(ISO).map(([k, v]) => [v, k]));
  for (const p of zes) {
    const cs = (p.countries || []).map((x) => String(x).toUpperCase());
    if (cs.length !== 1) continue;
    const key = byIso[cs[0]];
    if (!key) continue;
    push('Zesimo', 'опт', key, p.data_gb, p.duration_days, p.reseller_price, p.name, 'country');
  }
} catch { /* снапшота нет, источник просто отсутствует */ }

const providers = [...new Set(rows.map((r) => r.p))].sort();
console.log(`строк: ${rows.length}, источников: ${providers.length}`);
for (const p of providers) console.log(`  ${p}: ${rows.filter((r) => r.p === p).length}`);

const payload = JSON.stringify(rows);
const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Аналитика рынка eSIM</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#252a34;--txt:#e6e8ee;--dim:#9aa3b2;--acc:#ffb02e;--g1:#f2c14e;--g2:#c9d1d9;--g3:#c98a4b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}
header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
h1{font-size:19px;margin:0;font-weight:600}
.sub{color:var(--dim);font-size:13px}
main{padding:18px 22px;max-width:1600px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:130px}
.card b{display:block;font-size:22px;font-weight:600}
.card span{color:var(--dim);font-size:12px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:18px}
.panel h2{font-size:15px;margin:0 0 12px;font-weight:600}
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end}
label{display:block;font-size:12px;color:var(--dim);margin-bottom:4px}
select,input{background:#0d1016;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:7px 9px;font-size:13px;min-width:110px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--dim);font-weight:500;cursor:pointer;user-select:none;position:sticky;top:0;background:var(--card)}
tbody tr:hover{background:#1c2029}
.m1{color:var(--g1);font-weight:600}.m2{color:var(--g2)}.m3{color:var(--g3)}
.tag{display:inline-block;padding:1px 7px;border-radius:20px;font-size:11px;border:1px solid var(--line);color:var(--dim)}
.wrap{overflow:auto;max-height:520px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:7px;background:#2a2f3a;border-radius:4px;overflow:hidden;min-width:80px}
.bar i{display:block;height:100%;background:var(--acc)}
.pager{display:flex;gap:8px;align-items:center;margin-top:10px;color:var(--dim);font-size:12px}
button{background:#20242e;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:6px 11px;cursor:pointer;font-size:13px}
button:hover{border-color:var(--acc)}
</style></head><body>
<header>
  <h1>Аналитика рынка eSIM</h1>
  <div class="sub" id="stamp"></div>
</header>
<main>
  <div class="cards" id="kpi"></div>

  <div class="panel">
    <h2>Фильтры</h2>
    <div class="filters">
      <div><label>Направление</label><select id="fCountry"></select></div>
      <div><label>Тип цены</label><select id="fKind"><option value="">все</option><option value="опт">опт, наша закупка</option><option value="розница">розница, цена покупателя</option></select></div>
      <div><label>Источник</label><select id="fProvider"></select></div>
      <div><label>Объём, ГБ от</label><input id="fGb" type="number" value="10" step="1" min="0"></div>
      <div><label>Срок, дней от</label><input id="fDays" type="number" value="14" step="1" min="0"></div>
      <div><label>Покрытие</label><select id="fScope"><option value="">любое</option><option value="country">страновое</option><option value="regional">региональное</option></select></div>
      <div><label>Поиск по названию</label><input id="fText" type="text" placeholder="например 50GB"></div>
      <div><button id="reset">Сбросить</button></div>
    </div>
  </div>

  <div class="panel">
    <h2>Зачёт по призовым местам</h2>
    <div class="sub" style="margin-bottom:10px">Считается по каждому направлению при текущих фильтрах: у кого самая низкая цена за гигабайт, тот берёт первое место.</div>
    <div class="wrap"><table id="tBoard"><thead><tr>
      <th>источник</th><th>тип</th><th class="num">1 место</th><th class="num">2 место</th><th class="num">3 место</th><th class="num">очки</th><th>доля первых мест</th>
    </tr></thead><tbody></tbody></table></div>
  </div>

  <div class="panel">
    <h2>Пьедестал по направлениям</h2>
    <div class="wrap"><table id="tPodium"><thead><tr>
      <th>направление</th><th>1 место</th><th class="num">цена за ГБ</th><th>2 место</th><th class="num">цена за ГБ</th><th>3 место</th><th class="num">цена за ГБ</th><th class="num">разрыв 1 и 2</th>
    </tr></thead><tbody></tbody></table></div>
  </div>

  <div class="panel">
    <h2>Все тарифы</h2>
    <div class="wrap"><table id="tAll"><thead><tr>
      <th data-s="t">направление</th><th data-s="p">источник</th><th data-s="k">тип</th>
      <th data-s="g" class="num">ГБ</th><th data-s="d" class="num">дней</th>
      <th data-s="u" class="num">цена</th><th data-s="r" class="num">за ГБ</th><th data-s="n">тариф</th>
    </tr></thead><tbody></tbody></table></div>
    <div class="pager"><button id="prev">назад</button><span id="pinfo"></span><button id="next">вперёд</button></div>
  </div>
</main>
<script>
const DATA = ${payload};
const $ = (id) => document.getElementById(id);
const fmt = (n, d = 3) => Number(n).toFixed(d);
let page = 0, sortKey = 'r', sortDir = 1;

const countries = [...new Set(DATA.map(r => r.t).filter(Boolean))].sort();
const provs = [...new Set(DATA.map(r => r.p))].sort();
$('fCountry').innerHTML = '<option value="">все</option>' + countries.map(c => '<option>' + c + '</option>').join('');
$('fProvider').innerHTML = '<option value="">все</option>' + provs.map(c => '<option>' + c + '</option>').join('');
$('stamp').textContent = DATA.length + ' тарифов, ' + provs.length + ' источников, ' + countries.length + ' направлений';

function filtered() {
  const c = $('fCountry').value, k = $('fKind').value, p = $('fProvider').value;
  const gb = Number($('fGb').value) || 0, dd = Number($('fDays').value) || 0;
  const sc = $('fScope').value, q = $('fText').value.trim().toLowerCase();
  return DATA.filter(r => (!c || r.t === c) && (!k || r.k === k) && (!p || r.p === p)
    && r.g >= gb && r.d >= dd && (!sc || r.s === sc)
    && (!q || (r.n + ' ' + r.p).toLowerCase().includes(q)));
}

function podium(rows) {
  const byCountry = {};
  for (const r of rows) {
    if (!r.t) continue;
    (byCountry[r.t] = byCountry[r.t] || []).push(r);
  }
  const out = [];
  for (const [t, list] of Object.entries(byCountry)) {
    const bestByProv = {};
    for (const r of list) if (!bestByProv[r.p] || r.r < bestByProv[r.p].r) bestByProv[r.p] = r;
    const top = Object.values(bestByProv).sort((a, b) => a.r - b.r).slice(0, 3);
    out.push({ t, top });
  }
  return out.sort((a, b) => a.t.localeCompare(b.t, 'ru'));
}

function render() {
  const rows = filtered();
  const pod = podium(rows);

  const opt = rows.filter(r => r.k === 'опт').length;
  $('kpi').innerHTML = [
    ['тарифов в выборке', rows.length],
    ['из них опт', opt],
    ['из них розница', rows.length - opt],
    ['направлений', pod.length],
    ['источников', new Set(rows.map(r => r.p)).size],
  ].map(([s, b]) => '<div class="card"><b>' + b + '</b><span>' + s + '</span></div>').join('');

  const medals = {};
  for (const { top } of pod) {
    top.forEach((r, i) => {
      const m = medals[r.p] = medals[r.p] || { p: r.p, k: r.k, g: 0, s: 0, b: 0 };
      if (i === 0) m.g++; else if (i === 1) m.s++; else m.b++;
    });
  }
  const board = Object.values(medals).map(m => ({ ...m, pts: m.g * 3 + m.s * 2 + m.b }))
    .sort((a, b) => b.pts - a.pts || b.g - a.g);
  const maxG = Math.max(1, ...board.map(m => m.g));
  $('tBoard').tBodies[0].innerHTML = board.map(m =>
    '<tr><td><b>' + m.p + '</b></td><td><span class="tag">' + m.k + '</span></td>'
    + '<td class="num m1">' + m.g + '</td><td class="num m2">' + m.s + '</td><td class="num m3">' + m.b + '</td>'
    + '<td class="num">' + m.pts + '</td>'
    + '<td><div class="bar"><i style="width:' + Math.round(m.g / maxG * 100) + '%"></i></div></td></tr>').join('')
    || '<tr><td colspan="7">нет данных под фильтр</td></tr>';

  $('tPodium').tBodies[0].innerHTML = pod.map(({ t, top }) => {
    const cell = (r, cls) => r ? '<td class="' + cls + '">' + r.p + '</td><td class="num">' + fmt(r.r) + '</td>' : '<td>-</td><td class="num">-</td>';
    const gap = top[0] && top[1] ? fmt(top[1].r / top[0].r, 2) + 'x' : '-';
    return '<tr><td><b>' + t + '</b></td>' + cell(top[0], 'm1') + cell(top[1], 'm2') + cell(top[2], 'm3')
      + '<td class="num">' + gap + '</td></tr>';
  }).join('') || '<tr><td colspan="8">нет данных под фильтр</td></tr>';

  const sorted = rows.slice().sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ru')) * sortDir;
  });
  const per = 200, pages = Math.max(1, Math.ceil(sorted.length / per));
  if (page >= pages) page = pages - 1;
  const slice = sorted.slice(page * per, page * per + per);
  $('tAll').tBodies[0].innerHTML = slice.map(r =>
    '<tr><td>' + (r.t || '-') + '</td><td>' + r.p + '</td><td><span class="tag">' + r.k + '</span></td>'
    + '<td class="num">' + r.g + '</td><td class="num">' + r.d + '</td>'
    + '<td class="num">$' + fmt(r.u, 2) + '</td><td class="num"><b>' + fmt(r.r) + '</b></td>'
    + '<td>' + r.n + '</td></tr>').join('') || '<tr><td colspan="8">нет данных под фильтр</td></tr>';
  $('pinfo').textContent = 'страница ' + (page + 1) + ' из ' + pages + ', всего строк ' + sorted.length;
}

for (const id of ['fCountry', 'fKind', 'fProvider', 'fGb', 'fDays', 'fScope', 'fText']) {
  $(id).addEventListener('input', () => { page = 0; render(); });
}
$('reset').onclick = () => {
  $('fCountry').value = ''; $('fKind').value = ''; $('fProvider').value = '';
  $('fGb').value = 10; $('fDays').value = 14; $('fScope').value = ''; $('fText').value = '';
  page = 0; render();
};
$('prev').onclick = () => { if (page > 0) { page--; render(); } };
$('next').onclick = () => { page++; render(); };
document.querySelectorAll('#tAll th[data-s]').forEach(th => {
  th.onclick = () => {
    const k = th.dataset.s;
    sortDir = sortKey === k ? -sortDir : 1;
    sortKey = k; render();
  };
});
render();
</script></body></html>`;

writeFileSync(new URL('../data/analytics.local.html', import.meta.url), html);
console.log('готово: data/analytics.local.html');
