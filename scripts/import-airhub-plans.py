# -*- coding: utf-8 -*-
# Конвертер выгрузки тарифов Airhub (plans.csv из партнёрского портала) в CSV источников закупки.
#
# Формат исходника: Country, Data, Validity, Portal Price, plan_Class, plan_type,
# connectivity, plancode, countries_covered.
# plan_type различает Standard_plan и Premium_plan, countries_covered отличает
# страновые тарифы от региональных и глобальных.
#
# Почему файлом, а не по API: их эндпоинт GetPlanInformation на 11.08.2026 отвечает
# ошибкой "Subquery returns more than 1 row" при любом flag, то есть у них баг на бэкенде.
# Выгрузка из портала это тот же каталог, только без сбоя.
#
# Запуск:
#   python scripts/import-airhub-plans.py <путь к plans.csv>
import csv
import io
import os
import re
import sys

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


def parse_gb(text):
    s = str(text or "").strip().lower()
    if not s or "unlim" in s:
        return 0.0
    m = re.match(r"^([\d.]+)\s*(gb|mb|tb)", s)
    if not m:
        return 0.0
    n = float(m.group(1))
    unit = m.group(2)
    if unit == "mb":
        return n / 1024.0
    if unit == "tb":
        return n * 1024.0
    return n


def parse_days(text):
    m = re.search(r"(\d+)", str(text or ""))
    return int(m.group(1)) if m else 0


def parse_usd(text):
    m = re.search(r"([\d.]+)", str(text or "").replace(",", ""))
    return float(m.group(1)) if m else 0.0


def main():
    if len(sys.argv) < 2:
        print("нужен путь к csv: python scripts/import-airhub-plans.py <файл>")
        return 1
    src = sys.argv[1]
    source = "файл %s" % os.path.basename(src)

    out = []
    with io.open(src, encoding="utf-8-sig", errors="replace", newline="") as f:
        for rec in csv.DictReader(f):
            dest = (rec.get("Country") or "").strip()
            gb = parse_gb(rec.get("Data"))
            usd = parse_usd(rec.get("Portal Price"))
            days = parse_days(rec.get("Validity"))
            if not (gb > 0 and usd > 0):
                continue
            covered = (rec.get("countries_covered") or "").strip().upper()
            key = DESTINATIONS.get(dest.lower(), "")
            # COUNTRY у них означает «покрытие одной строкой-, а не одну страну:
            # регионы вроде Africa приходят с тем же значением. Опираемся на имя.
            scope = "country" if key else "regional"
            out.append({
                "country": key,
                "destination": dest,
                "scope": scope,
                "provider": "Airhub (опт)",
                "name": "%s %s / %s %s" % (dest, rec.get("Data", ""), rec.get("Validity", ""),
                                           (rec.get("plan_type") or "").replace("_plan", "")),
                "type": (rec.get("plan_Class") or "data").strip(),
                "gb": round(gb, 3),
                "days": days,
                "usd": round(usd, 4),
                "perGb": round(usd / gb, 3),
                "source": "%s, %s" % (source, covered or "n/a"),
            })

    path = os.path.join(REPO, "data", "airhub-dealer.local.csv")
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLS)
        writer.writeheader()
        writer.writerows(out)
    ours = sorted(set(r["country"] for r in out if r["country"]))
    print("тарифов: %d, направлений: %d, наших направлений: %d (%s)" % (
        len(out), len(set(r["destination"] for r in out)), len(ours), ", ".join(ours)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
