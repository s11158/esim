# -*- coding: utf-8 -*-
# Конвертер прайса MicroEsim (xlsx) в CSV источников закупки.
#
# Формат: один лист на направление, имя листа это ISO или пояснение вроде
# «EU( Italy, Spain)- и «JP-Support tiktok-. Первая строка - название страны,
# вторая - заголовки, дальше тарифы. Цена уже пересчитана ими в доллары,
# колонка Price (USD); страна берётся из колонки Country Code, а не из имени листа.
#
# Тот же выходной файл пишет scripts/fetch-microesim.mjs, когда есть доступы к API.
# Пока доступов нет, прайс файлом это единственный способ увидеть их цены.
#
# Запуск:
#   python scripts/import-microesim-price.py <путь к xlsx>
import csv
import io
import os
import sys

import openpyxl

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DESTINATIONS = {
    "CA": "canada", "TR": "turkey", "TH": "thailand", "GE": "georgia", "VN": "vietnam",
    "JP": "japan", "AE": "uae", "IT": "italy", "ES": "spain", "US": "usa", "FR": "france",
    "DE": "germany", "GB": "uk", "ID": "indonesia", "MY": "malaysia", "SG": "singapore",
    "MX": "mexico", "EG": "egypt", "GR": "greece", "CN": "china",
}

COLS = ["country", "destination", "scope", "provider", "name", "type",
        "gb", "days", "usd", "perGb", "source"]


def num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def to_gb(cap, unit):
    n = num(cap)
    u = str(unit or "").strip().upper()
    if not n:
        return 0.0
    if u == "MB":
        return n / 1024.0
    if u == "TB":
        return n * 1024.0
    if u == "GB":
        return n
    return 0.0


def main():
    if len(sys.argv) < 2:
        print("нужен путь к xlsx: python scripts/import-microesim-price.py <файл>")
        return 1
    src = sys.argv[1]
    source = "файл %s" % os.path.basename(src)

    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        head = None
        for row in ws.iter_rows(values_only=True):
            cells = ["" if c is None else str(c).strip() for c in row]
            if head is None:
                # Первая строка листа - просто название страны, заголовки идут следом.
                if "Data Plan Id" in cells:
                    head = cells
                continue
            rec = dict(zip(head, row))
            plan_id = (rec.get("Data Plan Id") or "")
            if not plan_id:
                continue
            iso = str(rec.get("Country Code") or "").strip().upper()
            gb = to_gb(rec.get("Data Cap"), rec.get("Data Unit"))
            usd = num(rec.get("Price (USD)"))
            days = num(rec.get("Days"))
            # Мультистрановые тарифы приходят со списком кодов через запятую:
            # цена за гигабайт по одной стране для них несравнима.
            single = iso in DESTINATIONS
            if not (gb > 0 and usd > 0):
                continue
            out.append({
                "country": DESTINATIONS.get(iso, ""),
                "destination": iso or ws.title,
                "scope": "country" if single else "regional",
                "provider": "MicroEsim (опт)",
                "name": (rec.get("Data Plan Name") or "").strip(),
                "type": (rec.get("Data Type") or "").strip() or "DATA-ONLY",
                "gb": round(gb, 3),
                "days": int(days) if days else "",
                "usd": round(usd, 4),
                "perGb": round(usd / gb, 3),
                "source": source,
            })

    path = os.path.join(REPO, "data", "microesim-dealer.local.csv")
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLS)
        writer.writeheader()
        writer.writerows(out)
    ours = set(r["country"] for r in out if r["country"])
    print("тарифов: %d, направлений: %d, наших направлений: %d" % (
        len(out), len(set(r["destination"] for r in out)), len(ours)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
