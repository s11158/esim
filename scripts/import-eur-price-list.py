# -*- coding: utf-8 -*-
# Конвертер прайса поставщика в евро (лист «Price List- с колонками Cost / Retail)
# в тот же CSV, который читает scripts/build-market.mjs.
#
# Формат исходника: Title | Validity (days) | Data | Cost (EUR) | Retail (EUR) | ... | Category.
# В названии тарифа зашито направление: «Turkey Premium 20GB-, «United States 50GB-,
# «Europe Premium 30GB-. Региональные семейства (Europe, Africa) помечаются scope=regional
# и в сравнение по стране не идут: их цена за гигабайт несравнима с местным тарифом.
#
# Запуск:
#   python scripts/import-eur-price-list.py <путь к xlsx> ["Имя поставщика (опт)"]
import csv
import io
import os
import re
import sys
import urllib.request

import openpyxl

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FALLBACK_RATE = 1.155

# Направление по началу названия тарифа. Ключи - как в DESTINATIONS у build-market.mjs.
FAMILIES = [
    ("europe premium", "", "regional"),
    ("turkey premium", "turkey", "country"),
    ("turkey", "turkey", "country"),
    ("united states", "usa", "country"),
    ("philippines", "", "country"),
    ("africa", "", "regional"),
]

COLS = ["country", "destination", "scope", "provider", "name", "type",
        "gb", "days", "usd", "perGb", "source"]


def eur_usd():
    """Курс ЕЦБ. Недоступен - берём запасной и говорим об этом вслух."""
    try:
        with urllib.request.urlopen(
                "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", timeout=20) as r:
            xml = r.read().decode("utf-8", "replace")
        m = re.search(r"currency='USD'\s+rate='([\d.]+)'", xml)
        if m:
            return float(m.group(1)), "ЕЦБ"
    except Exception:
        pass
    return FALLBACK_RATE, "запасной курс"


def classify(title):
    low = title.strip().lower()
    for prefix, key, scope in FAMILIES:
        if low.startswith(prefix):
            return key, scope
    return "", "country"


def num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def main():
    if len(sys.argv) < 2:
        print("нужен путь к xlsx: python scripts/import-eur-price-list.py <файл> [имя поставщика]")
        return 1
    src = sys.argv[1]
    provider = sys.argv[2] if len(sys.argv) > 2 else "Прайс в евро (опт)"
    rate, rate_src = eur_usd()
    source = "файл %s" % os.path.basename(src)

    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    sheet = None
    for ws in wb.worksheets:
        if "price" in ws.title.lower():
            sheet = ws
            break
    if sheet is None:
        print("лист с прайсом не найден")
        return 1

    out = []
    head = None
    for row in sheet.iter_rows(values_only=True):
        if head is None:
            head = [str(c).strip() if c else "" for c in row]
            continue
        rec = dict(zip(head, row))
        title = (rec.get("Title") or "").strip()
        if not title:
            continue
        gb = num(rec.get("Data"))
        days = num(rec.get("Validity (days)"))
        eur = num(rec.get("Cost (€)") or rec.get("Cost (EUR)") or rec.get("Cost"))
        if not (gb > 0 and eur > 0):
            continue
        usd = eur * rate
        key, scope = classify(title)
        # Направление в человеческом виде: название без объёма.
        dest = re.sub(r"\s*\d+\s*GB.*$", "", title, flags=re.I).strip()
        out.append({
            "country": key,
            "destination": dest,
            "scope": scope,
            "provider": provider,
            "name": title,
            "type": "DATA-ONLY",
            "gb": round(gb, 3),
            "days": int(days) if days else "",
            "usd": round(usd, 4),
            "perGb": round(usd / gb, 3),
            "source": "%s, курс %s %.4f" % (source, rate_src, rate),
        })

    path = os.path.join(REPO, "data", "mobisim-dealer.local.csv")
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLS)
        writer.writeheader()
        writer.writerows(out)
    print("тарифов: %d, направлений: %d, курс EUR/USD %.4f (%s)" % (
        len(out), len(set(r["destination"] for r in out)), rate, rate_src))
    return 0


if __name__ == "__main__":
    sys.exit(main())
