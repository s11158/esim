// Экспорт каталога тарифов из index.html в data/plans.json - единый источник данных
// для всех внешних каналов (боты, дайджесты). Витрина остаётся единственным местом,
// где тарифы правятся руками, поэтому не дублируем массив, а вырезаем его из HTML
// и исполняем в песочнице: так ссылки aff вида AFF.stellar+'canada-esim' получаются
// уже склеенными, без самодельного парсинга JS-выражений.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// Фрагмент с партнёрскими ссылками: от объявления AFF до закрывающей "};".
const affStart = html.indexOf('const AFF');
if (affStart < 0) {
  console.error('Не нашёл "const AFF" в index.html - структура файла изменилась, поправь маркеры в export-plans.mjs');
  process.exit(1);
}
const affEnd = html.indexOf('};', affStart);
if (affEnd < 0) {
  console.error('Не нашёл конец объекта AFF ("};") - поправь маркеры в export-plans.mjs');
  process.exit(1);
}
const affCode = html.slice(affStart, affEnd + 2);

// Массив plans заканчивается прямо перед "const rates=" - это надёжнее, чем искать "];",
// потому что внутри массива есть автогенерируемый блок STELLAR AUTO с комментариями.
const plansStart = html.indexOf('const plans', affEnd);
if (plansStart < 0) {
  console.error('Не нашёл "const plans" в index.html - поправь маркеры в export-plans.mjs');
  process.exit(1);
}
const plansEnd = html.indexOf('const rates=', plansStart);
if (plansEnd < 0) {
  console.error('Не нашёл "const rates=" после массива plans - поправь маркеры в export-plans.mjs');
  process.exit(1);
}
const plansCode = html.slice(plansStart, plansEnd);

// Песочница нужна не для красоты: вырезанный код не должен видеть fs/сеть,
// а последнее выражение отдаёт готовые объекты наружу.
const {AFF, plans} = vm.runInNewContext(`${affCode}\n${plansCode}\n({AFF, plans});`, {}, {timeout: 5000});

if (!AFF || !Array.isArray(plans) || plans.length === 0) {
  console.error('Песочница не вернула AFF или plans - проверь вырезанные фрагменты');
  process.exit(1);
}

const out = {generatedAt: new Date().toISOString(), plans};
mkdirSync(join(root, 'data'), {recursive: true});
writeFileSync(join(root, 'data', 'plans.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

const countries = new Set(plans.map(p => p.country));
const providers = new Set(plans.map(p => p.provider));
console.log(`data/plans.json: тарифов ${plans.length}, стран ${countries.size}, провайдеров ${providers.size} (${[...providers].join(', ')})`);
