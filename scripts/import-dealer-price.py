# -*- coding: utf-8 -*-
# Конвертер дилерского прайса поставщика (xlsx) в плоский CSV, который читает
# scripts/build-market.mjs как ещё один источник закупки.
#
# Зачем отдельный скрипт на питоне: у этого поставщика нет фида, прайс присылают
# файлом Excel, а node без внешних зависимостей xlsx не читает.
#
# Запуск:
#   python scripts/import-dealer-price.py <путь к xlsx> ["Имя поставщика (опт)"]
#
# Выход (оба файла в .gitignore, это себестоимость):
#   data/gloesim-dealer.local.csv            - тарифы с реальным объёмом
#   data/gloesim-dealer-unlimited.local.csv  - безлимиты, в сравнение за гигабайт не идут
import csv
import io
import os
import re
import sys

import openpyxl

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Наши 20 направлений: имя в прайсе, ключ в карте рынка.
ALIAS = {
    "canada": "canada", "turkey": "turkey", "turkiye": "turkey", "thailand": "thailand",
    "georgia": "georgia", "vietnam": "vietnam", "japan": "japan",
    "united arab emirates": "uae", "uae": "uae", "italy": "italy", "spain": "spain",
    "united states": "usa", "usa": "usa", "united states of america": "usa",
    "france": "france", "germany": "germany", "united kingdom": "uk", "uk": "uk",
    "great britain": "uk", "indonesia": "indonesia", "malaysia": "malaysia",
    "singapore": "singapore", "mexico": "mexico", "egypt": "egypt", "greece": "greece",
    "china": "china",
}

COLS = ["country", "destination", "scope", "provider", "name", "type",
        "gb", "days", "usd", "perGb", "source"]


def parse_gb(text):
    """Объём из колонки Data. Безлимит и всё нераспознанное дают ноль."""
    if text is None:
        return 0.0
    s = str(text).strip().lower()
    if "unlim" in s:
        return 0.0
    m = re.match(r"^([\d.]+)\s*(gb|mb|tb)$", s)
    if not m:
        return 0.0
    n = float(m.group(1))
    unit = m.group(2)
    if unit == "mb":
        return n / 1024.0
    if unit == "tb":
        return n * 1024.0
    return n


def num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def main():
    if len(sys.argv) < 2:
        print("нужен путь к xlsx: python scripts/import-dealer-price.py <файл> [имя поставщика]")
        return 1
    src = sys.argv[1]
    provider = sys.argv[2] if len(sys.argv) > 2 else "Дилерский прайс (опт)"
    source = "файл %s" % os.path.basename(src)

    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    limited, unlimited = [], []
    for ws in wb.worksheets:
        title = ws.title.lower()
        scope = "regional" if title.startswith("regional") else ("global" if title.startswith("global") else "country")
        head = None
        for row in ws.iter_rows(values_only=True):
            if head is None:
                head = [str(c).strip() if c else "" for c in row]
                continue
            rec = dict(zip(head, row))
            dest = (rec.get("Destination") or "").strip()
            gb = parse_gb(rec.get("Data"))
            usd = num(rec.get("Price"))
            days = num(rec.get("Validity"))
            out = {
                "country": ALIAS.get(dest.lower(), ""),
                "destination": dest,
                "scope": scope,
                "provider": provider,
                "name": (rec.get("Name") or "").strip(),
                "type": (rec.get("Package Type") or "").strip(),
                "gb": round(gb, 3) if gb else "",
                "days": int(days) if days else "",
                "usd": round(usd, 4) if usd else "",
                "perGb": round(usd / gb, 3) if gb > 0 and usd > 0 else "",
                "source": source,
            }
            (limited if gb > 0 and usd > 0 else unlimited).append(out)

    for path, data in (("data/gloesim-dealer.local.csv", limited),
                       ("data/gloesim-dealer-unlimited.local.csv", unlimited)):
        with io.open(os.path.join(REPO, path), "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=COLS)
            writer.writeheader()
            writer.writerows(data)

    print("тарифов с объёмом: %d, безлимитов: %d, направлений: %d" % (
        len(limited), len(unlimited), len(set(r["destination"] for r in limited))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
