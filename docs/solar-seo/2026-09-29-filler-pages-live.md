# SOLAR: страницы филлеров и губ опубликованы, Bing и регулярная задача (29.09.2026)

## Что сделано
- По разовому разрешению владельца созданы и опубликованы 4 страницы, копированием шаблона Botox (картинки инъекций к месту):
  - https://solar-beauty.ae/aesthetic-services/dermal-fillers (pageid 272811703)
  - https://solar-beauty.ae/ru/aesthetic-services/dermal-fillers (272826403)
  - https://solar-beauty.ae/aesthetic-services/lip-fillers (272834503)
  - https://solar-beauty.ae/ru/aesthetic-services/lip-fillers (272839103)
- Тексты из прототипов tlnt.ae/solar/*-fillers-*/, цены из Altegio (2 300 AED за 1 мл, под глаза 3 465, Radiesse 3 050, Sculptra 3 800; губы 0,5 мл и растворение - на консультации).
- На каждой странице: 23 (EN) или 22 (RU) Zero-блока с новыми текстами, 7 вопросов FAQ (5 из прототипа и 2 новых: цена и кто делает), новый HTML-блок "Сколько стоит" с блоком "рядом с вами" и ссылками на похожие услуги, JSON-LD (BreadcrumbList, MedicalProcedure, FAQPage). Ссылки на PubMed в блоке исследований убраны (относились к ботоксу).
- HEAD-код: пути добавлены в enPaths скрипта solar-lang-hreflang, названия и связи в solar-internal-links (T и MAP); Botox теперь ссылается на филлеры и губы. Переопубликованы 4 новые страницы и Botox EN/RU (массовая публикация упала с Request error, она не нужна).
- Bing: solar-beauty.ae уже подтверждён в Bing Webmaster (аккаунт с TLNT). Скрипт C:/Users/LENOVO/Downloads/solar-bing/bing_solar.py: отправлены все 128 адресов sitemap, sitemap переотправлен, квота 10 000/сутки.
- Google: sitemap переотправлен через сервисный аккаунт (C:/Users/LENOVO/Downloads/solar-gsc/submit_sitemap.py).
- Регулярная задача solar-seo-every-2-days (12:30 раз в 2 дня): один пункт очереди C:/Users/LENOVO/Downloads/solar-seo-loop/backlog.md за запуск, проверка на живом сайте, Bing, журнал log.md.

## Как проверено
- Браузер на живых страницах: title, H1, canonical, hreflang en/ru/x-default, блок "Похожие услуги", 7 FAQ, JSON-LD.
- r.jina.ai: нет остатков Botox (Botulinum, "пациенты", "морщины лба"), длинных тире в новых текстах нет (1 тире в RU - из шаблонного заголовка отзывов).
- Наложения текстов в Zero-блоках: 0 на ширине 1536 и 375 px (26 блоков, 146 текстов на RU-странице губ).

## Инструменты
- Генератор карт замен из прототипов под шаблон Botox: C:/Users/LENOVO/Downloads/solar-seo-loop/tools/gen_plans.py, карты в tools/plans/.
