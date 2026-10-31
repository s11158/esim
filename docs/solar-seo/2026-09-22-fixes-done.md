# Выполненные правки на сайте solar-beauty.ae, 22 сентября 2026 (вечер)

Все правки сделаны в Tilda через API редактора под сессией владельца и опубликованы. Проверка - живой HTML через r.jina.ai (прямой curl с рабочего IP отдаёт 403).

## 1. Меты 12 статей третьей волны
Title и description проставлены по docs/solar-seo/articles-wave3 (пары pid из wave3_meta.json). Раньше в title стоял H1, в description - первый абзац.
RU: 230559203, 230744103, 231042103, 231107703, 231172003, 231234303. EN: 231396103, 231396303, 231396403, 231396503, 231396603, 231396703.
Проверено: /ru/blog/lechenie-pigmentacii-harmony-dubai отдаёт title "Лечение пигментации в Дубае на Alma Harmony XL | SOLAR".

## 2. hreflang v4
В HEAD-коде сайта массив enPaths расширен с 49 до 53 путей (добавлены body-sculpting-tesla-former, lifting-virtue-rf, lymphatic-drainage-icoone, massage-spa и др.), пометка скрипта solar-lang-hreflang v4 (2026-09-22). Проверено на /ru/policy и /aesthetic-services/lifting-virtue-rf.

## 3. noindex снят с /ru/policy (95828836) и /ru/oferta (95834786)
Флаг в настройках уже был снят, не хватало публикации. После публикации meta robots на живых страницах отсутствует.

## 4. Длинные тире в title и description: 34 страницы
Замена U+2014/U+2013 на " - " в текущих значениях мет (список из crawl-2026-09-22.md). Все 34 сохранены и опубликованы, повторное открытие формы подтвердило отсутствие тире. Выборочно проверены /team, /ru/team, /catalog, /ru/blog/botoks-mify-dozirovki, /blog/virtue-rf-mikronidling.

## 5. Шапка и подвал (страницы Header 87017176, Footer 87086776)
- alt у иконок шапки: логотип, бургер, избранное, язык, корзина, поиск (Zero-блоки 1441260881 и 1572053861). Проверено: img Burger_Black.svg отдаёт alt="Open menu".
- /park убран из меню EN (блок 1572053901) и RU (блок 1442252921).
- Подвал: удалены мёртвые ссылки, все вели на 404-страницу /ops: /vacancies, /ru/vacancies, /news (в обоих языках), /loyalty, /ru/loyalty (дубли программы лояльности), /park, /ru/park, /ru/portfolio. Ссылки /special-offers и /ru/special-offers заменены на /special и /ru/special (были редиректами). Zero-блоки 1572251231 (EN, 25 элементов стало 21) и 1442575771 (RU, 24 стало 19).
- Вывод по sitemap: /special-offers, /ru/special-offers, /ru/portfolio добавлять в карту не нужно - это редиректы на /special, /ru/special и /ru/park (noindex). Статьи "rf-microneedling-which-device" и "rf-mikronidling-kakoy-apparat-vybrat" не существуют (404): ссылки на них удалены из текста страниц Virtue RF (Zero-блоки 2428628073 на 151650663 и 2426957823 на 151589603) и из карты перелинковки в HEAD-коде.

## 6. H1 на 18 страниц
Скрипт solar-h1-inject в HEAD дополнен до 18 страниц (v2): добавлены /ar/corporate-gifts, /blog, /ru/blog, /certificates, /oferta, /policy, /ru/oferta, /ru/policy, /team/olga-dimova, /team/valerija-orlove; длинные тире в существующих H1 заменены на дефисы. H1 вставляется скриптом на клиенте - для Google достаточно, но постоянное решение - настоящий H1 в блоках Tilda.

## Что не сделано и почему
- Блоки "Статьи по теме" (пункт 6 HANDOFF): уже реализованы скриптом перелинковки в HEAD (карта MAP rel/posts), отдельные блоки не создавались.
- Страницы dermal fillers и lip fillers, русская версия подтяжки кожи, страница Sobha Hartland - не начаты (нужны цены от клиники и отдельная сессия контента).
- GBP, Bing, Яндекс, Fresha - нужны аккаунты клиники.
