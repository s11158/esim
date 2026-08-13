# -*- coding: utf-8 -*-
# Конвертер прайса RoamWiFi (FiROAM) из PDF в CSV источников закупки.
#
# Они присылают прайс таблицей в PDF: колонки Region, Plan, Price(USD), причём
# название направления стоит только в первой строке блока, дальше пусто.
# Скрипт тянет таблицу через pdfplumber и протягивает направление вниз по блоку.
#
# Запуск:
#   python scripts/import-roamwifi-price.py <путь к pdf>
import csv
import io
import os
import re
import sys

import pdfplumber

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DESTINATIONS = {
    "canada": "canada", "turkey": "turkey", "thailand": "thailand", "georgia": "georgia",
    "vietnam": "vietnam", "japan": "japan", "uae": "uae", "italy": "italy", "spain": "spain",
    "usa": "usa", "france": "france", "germany": "germany", "uk": "uk", "indonesia": "indonesia",
    "malaysia": "malaysia", "singapore": "singapore", "mexico": "mexico", "egypt": "egypt",
    "greece": "greece", "china": "china",
}
# Заголовки регионов внутри таблицы, они не направления.
REGIONS = {"asia", "europe", "north america", "south america", "africa", "oceania", "middle east"}

COLS = ["country", "destination", "scope", "provider", "name", "type",
        "gb", "days", "usd", "perGb", "source"]


def clean_dest(text):
    """«UAE(Promo) Asia sim- превращается в «uae-, «Georgia Global sim- в «georgia-."""
    s = re.sub(r"\((?:promo|new)\)", "", str(text or ""), flags=re.I)
    s = re.sub(r"\b(asia|global|europe|america)\s+sim\b", "", s, flags=re.I)
    s = re.sub(r"\bsim\b", "", s, flags=re.I)
    return s.strip().lower()


def main():
    if len(sys.argv) < 2:
        print("нужен путь к pdf: python scripts/import-roamwifi-price.py <файл>")
        return 1
    src = sys.argv[1]
    source = "файл %s" % os.path.basename(src)

    out = []
    current = ""
    with pdfplumber.open(src) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    cells = ["" if c is None else str(c).replace("\n", " ").strip() for c in row]
                    if len(cells) < 3:
                        continue
                    dest, plan, price = cells[0], cells[1], cells[2]
                    if dest and dest.lower() not in REGIONS and dest.lower() != "region":
                        name = clean_dest(dest)
                        if name:
                            current = name
                    m = re.match(r"([\d.]+)\s*(GB|MB|TB)\s*/\s*(\d+)\s*Days?", plan, re.I)
                    p = re.search(r"([\d.]+)", price.replace("US$", ""))
                    if not (m and p and current):
                        continue
                    gb = float(m.group(1))
                    unit = m.group(2).upper()
                    if unit == "MB":
                        gb /= 1024.0
                    if unit == "TB":
                        gb *= 1024.0
                    days = int(m.group(3))
                    usd = float(p.group(1))
                    if not (gb > 0 and usd > 0):
                        continue
                    out.append({
                        "country": DESTINATIONS.get(current, ""),
                        "destination": current,
                        "scope": "country",
                        "provider": "RoamWiFi (опт)",
                        "name": "%s %s" % (dest or current, plan),
                        "type": "DATA-ONLY",
                        "gb": round(gb, 3),
                        "days": days,
                        "usd": round(usd, 4),
                        "perGb": round(usd / gb, 3),
                        "source": source,
                    })

    path = os.path.join(REPO, "data", "roamwifi-dealer.local.csv")
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLS)
        writer.writeheader()
        writer.writerows(out)
    ours = set(r["country"] for r in out if r["country"])
    print("тарифов: %d, направлений: %d, наших направлений: %d (%s)" % (
        len(out), len(set(r["destination"] for r in out)), len(ours), ", ".join(sorted(ours))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
