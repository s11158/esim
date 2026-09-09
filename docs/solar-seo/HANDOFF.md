# Solar Beauty SEO - передача контекста между сессиями

Прочитай этот файл в начале любой новой сессии по проекту solar-beauty.ae. Здесь всё, что было сделано и решено в облачной сессии 7 сентября 2026, и с чего продолжать.

## Правила общения

- Отвечать на русском. Никаких длинных тире и стрелок, только обычный дефис.
- Премиум-тон, без жаргона. Не упоминать DHA и AI/GEO-оптимизацию в материалах для клиента.
- При работе в Tilda: пошагово, со скриншотами, не угадывать.

## Файлы проекта (ветка claude/solar-beauty-seo-strategy-rqfhml, PR s11158/esim#5)

- docs/solar-seo/2026-09-strategy-month-5.md - саммари сделанного за май-август и стратегия на пятый месяц (8 сентября - 7 октября). Есть Word и PDF версии рядом.
- docs/solar-seo/2026-09-new-keywords-sprint.md - 10 новых ключевиков и спринт на 2 месяца под новые страницы в /aesthetic-services/.
- В Google Drive: Solar-SEO-Project-Handoff.md (3 июня), Context-Handoff-Solar-SEO.md (2 июня), Solar_SEO_Proposal_v2. Там baseline на 2 июня, стек, контакты, история решений.

## Ключевые факты

- Клиника Solar Beauty & Aesthetics, Sobha Hartland Waves, Дубай. Tilda Personal, Altegio, EN + RU.
- Контракт "Стандарт" 3500 AED в месяц, 8 месяцев, старт середина мая 2026. Сейчас пятый месяц.
- Search Console: июнь 112 кликов, июль 165 и 6,1 тыс. показов, август 207 и 12,7 тыс. показов. Клики с Google Maps 42 в августе.
- Topvisor, проект "SOLAR Beauty - позиции Dubai", 14 запросов: в топ-100 только "hydra facial dubai" (46 место на 26 июля).
- Ahrefs Site Audit, 6 сентября: Health Score 23, 264 ошибки, 239 страниц-сирот, 7 URL 4XX в sitemap, 12 страниц тяжелее 2 МБ, 313 изображений без alt.
- Search Console, 6 сентября: новое предупреждение "проиндексировано, несмотря на блокировку в robots.txt". 10 августа: ошибки структурированных данных товаров.

## Решения клиента от 7 сентября

- Раздел /park выведен из индексации и не продвигается. Все страницы услуг живут в /aesthetic-services/ и /ru/aesthetic-services/.
- Существующие страницы услуг: hydra-facial, smas-lifting-ultraformer-mpt, lifting-virtue-rf, lymphatic-drainage-icoone, ulfit (non-surgical-liposuction-ulfit в RU), botox, laser hair removal, heleo4 (светотерапия), tesla former. Возможно, Harmony XL. Блог: tesla-former-muscle-training, icoone-robotic-massage.
- Техническую гигиену можно начинать делать. Клиент считает, что большая часть уже сделана, это нужно сверить по живому сайту и в Tilda.
- Новые ключевики согласовывать по файлу 2026-09-new-keywords-sprint.md, спринт 2 месяца, 10 страниц.

## Что делать в новой локальной сессии первым делом

1. `git fetch origin claude/solar-beauty-seo-strategy-rqfhml && git checkout claude/solar-beauty-seo-strategy-rqfhml`.
2. Открыть Tilda через Claude in Chrome (пользователь уже вошёл) и сверить пункты технической гигиены из раздела 4.2 стратегии: robots.txt, 7 URL 4XX в sitemap, дубли sitemap, структурированные данные, страницы-сироты, видео на главной, alt-тексты. Отметить: сделано, частично, не сделано.
3. Обновить раздел 4.2 и таблицу показателей в 2026-09-strategy-month-5.md по факту, пересобрать Word и PDF, закоммитить в ту же ветку.
4. Спринт по страницам ВЫПОЛНЕН 10 сентября: все десять текстов лежат в docs/solar-seo/pages/, список ключевиков пересмотрен по данным Semrush. Дальше идёт перенос в Tilda, порядок и инструкция в docs/solar-seo/pages/README.md.
5. Прочитать docs/solar-seo/existing-pages-audit-2026-09-10.md перед любыми правками существующих страниц: их теги в порядке, переделывать не нужно, узкое место это внешние ссылки и контентная перелинковка.
