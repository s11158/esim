# -*- coding: utf-8 -*-
# Конвертер каталога Zendit (xlsx) в CSV источников закупки.
#
# У них четыре уровня цен по обороту: Top Tier от $100k в месяц, Tier 1 от $50k,
# Tier 2 от $10k и Tier 3 без порога. Мы начинаем с нуля, поэтому наша цена это
# Tier 3, самая дорогая. Остальные уровни тоже сохраняем: они показывают, куда
# цена уйдёт при росте оборота.
#
# Колонки исходника: ID, New, Region, Country, Subtype, Sent Benefits, Gigs, Days,
# Suggested Price, затем по три колонки на каждый уровень (Your Cost, Mark Up, Discount),
# и в конце Description и Coverage. Заголовки лежат в четвёртой строке.
#
# Запуск:
#   python scripts/import-zendit-catalog.py <путь к xlsx>
import csv
import io
import os
import re
import sys

import openpyxl

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DESTINATIONS = {
    "canada": "canada", "turkey": "turkey", "turkiye": "turkey", "thailand": "thailand",
    "georgia": "georgia", "vietnam": "vietnam", "japan": "japan",
    "united arab emirates": "uae", "uae": "uae", "italy": "italy", "spain": "spain",
    "united states": "usa", "usa": "usa", "united states of america": "usa",
    "france": "france", "germany": "germany", "united kingdom": "uk", "uk": "uk",
    "indonesia": "indonesia", "malaysia": "malaysia", "singapore": "singapore",
    "mexico": "mexico", "egypt": "egypt", "greece": "greece", "china": "china",
}

COLS = ["country", "destination", "scope", "provider", "name", "type",
        "gb", "days", "usd", "perGb", "source"]

# Индексы колонок в кортеже строки, как их отдаёт openpyxl в режиме read_only.
# Осторожно: в обычном режиме нумерация сдвинута на единицу из-за объединённых ячеек шапки.
I_ID, I_REGION, I_COUNTRY, I_SUBTYPE, I_GIGS, I_DAYS = 0, 2, 3, 4, 6, 7
I_SUGGESTED = 8
I_COST_TIER3 = 18  # наш уровень: без порога по обороту


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def main():
    if len(sys.argv) < 2:
        print("нужен путь к xlsx: python scripts/import-zendit-catalog.py <файл>")
        return 1
    src = sys.argv[1]
    source = "файл %s, Tier 3" % os.path.basename(src)

    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    out, unlimited = [], 0
    for n, row in enumerate(ws.iter_rows(values_only=True), 1):
        if n <= 4:
            continue
        code = row[I_ID]
        if not code:
            continue
        country = str(row[I_COUNTRY] or "").strip()
        gigs = str(row[I_GIGS] or "").strip()
        if gigs.lower().startswith("unlim"):
            unlimited += 1
            continue
        gb = num(gigs)
        days = num(row[I_DAYS])
        usd = num(row[I_COST_TIER3])
        if not (gb > 0 and usd > 0):
            continue
        key = DESTINATIONS.get(country.lower(), "")
        out.append({
            "country": key,
            "destination": country or str(row[I_REGION] or ""),
            "scope": "country" if key else "regional",
            "provider": "Zendit (опт)",
            "name": "%s %sGB %sd %s [%s]" % (country, gigs, int(days) if days else "",
                                             str(row[I_SUBTYPE] or ""), code),
            "type": "DATA-ONLY",
            "gb": round(gb, 3),
            "days": int(days) if days else "",
            "usd": round(usd, 4),
            "perGb": round(usd / gb, 3),
            "source": source,
        })

    path = os.path.join(REPO, "data", "zendit-dealer.local.csv")
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLS)
        writer.writeheader()
        writer.writerows(out)
    ours = sorted(set(r["country"] for r in out if r["country"]))
    print("тарифов с объёмом: %d, безлимитов пропущено: %d, направлений: %d, наших: %d" % (
        len(out), unlimited, len(set(r["destination"] for r in out)), len(ours)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
