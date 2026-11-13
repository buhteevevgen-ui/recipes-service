#!/usr/bin/env python3
"""Книга рецептов: хранение и поиск рецептов в recipes.json.

Команды:
  python recipes.py add               — добавить рецепт (интерактивно)
  python recipes.py list              — список всех рецептов
  python recipes.py list гриль        — рецепты одного раздела
  python recipes.py sections          — список разделов
  python recipes.py search орзо сыр   — поиск (все слова должны встретиться)
  python recipes.py show 1            — показать рецепт по номеру
  python recipes.py delete 1          — удалить рецепт

Нужен только Python 3, без внешних библиотек.
"""
import json
import re
import sys
from pathlib import Path

DB_PATH = Path(__file__).with_name("recipes.json")

# Веса полей при поиске: совпадение в названии важнее остального.
WEIGHTS = {"title": 5, "tags": 3, "ingredients": 2, "steps": 1, "notes": 1}
STEM_LEN = 5


def load():
    if not DB_PATH.exists():
        return {"recipes": []}
    with DB_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):  # поддержка старого формата — просто список
        data = {"recipes": data}
    data.setdefault("sections", [])
    return data


def section_title(data, sid):
    return next((s["title"] for s in data["sections"] if s["id"] == sid), sid)


def find_section(data, name):
    name = name.lower().replace("ё", "е")
    for s in data["sections"]:
        if name in (s["id"].lower(), s["title"].lower().replace("ё", "е")):
            return s
    return next((s for s in data["sections"] if name in s["title"].lower().replace("ё", "е")), None)


def save(data):
    with DB_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def normalize(text):
    """Нижний регистр, ё→е, слова обрезаются до STEM_LEN букв."""
    text = text.lower().replace("ё", "е")
    return [w[:STEM_LEN] for w in re.findall(r"\w+", text)]


def ing_text(x):
    """Ингредиент: строка или словарь {item, qty, qty_max, unit, note, optional} -> текст для показа и поиска."""
    if isinstance(x, str):
        return x
    if not isinstance(x, dict):
        return "" if x is None else str(x)

    def num(v):
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v).replace(".", ",")
        return v if isinstance(v, str) else ""

    q, qmax, parts = num(x.get("qty")), num(x.get("qty_max")), []
    if q and qmax:
        q += "–" + qmax
    unit = x.get("unit")
    if isinstance(unit, str) and unit:
        q += (" " if q else "") + unit
    if q:
        parts.append(q)
    note = x.get("note")
    if isinstance(note, str) and note:
        parts.append(note)
    if x.get("optional") is True:
        parts.append("по желанию")
    item = x.get("item")
    item = str(item) if isinstance(item, (str, int, float)) and not isinstance(item, bool) else ""
    return item + (((" — " if item else "") + ", ".join(parts)) if parts else "")


def field_text(recipe, field):
    value = recipe.get(field, "")
    if isinstance(value, list):
        if field == "ingredients":
            return " ".join(ing_text(v) for v in value)
        return " ".join(value)
    return str(value or "")


def score(recipe, query_stems):
    total = 0
    for stem in query_stems:
        found = 0
        for field, weight in WEIGHTS.items():
            words = normalize(field_text(recipe, field))
            hits = sum(1 for w in words if w.startswith(stem))
            found += hits * weight
        if found == 0:
            return 0  # каждое слово запроса должно встретиться
        total += found
    return total


def print_short(r):
    meta = []
    if r.get("servings"):
        meta.append(f"{r['servings']} порц.")
    if r.get("time_minutes"):
        meta.append(f"{r['time_minutes']} мин")
    tags = ", ".join(r.get("tags", []))
    line = f"[{r['id']}] {r['title']}"
    if meta:
        line += " — " + ", ".join(meta)
    if tags:
        line += f"  #{tags}"
    print(line)


def print_full(r, data=None):
    if data and r.get("sections"):
        print("\n" + " · ".join(section_title(data, sid) for sid in r["sections"]))
    print(f"\n{r['title']}")
    print("=" * len(r["title"]))
    if r.get("servings") or r.get("time_minutes"):
        print(f"Порции: {r.get('servings', '—')}, время: {r.get('time_minutes', '—')} мин")
    if r.get("tags"):
        print("Теги: " + ", ".join(r["tags"]))
    print("\nИнгредиенты:")
    for item in r.get("ingredients", []):
        print(f"  - {ing_text(item)}")
    print("\nПриготовление:")
    for i, step in enumerate(r.get("steps", []), 1):
        print(f"  {i}. {step}")
    if r.get("notes"):
        print(f"\nЗаметки: {r['notes']}")
    print()


def ask_lines(prompt):
    print(f"{prompt} (по одному на строку, пустая строка — конец):")
    lines = []
    while True:
        line = input("  > ").strip()
        if not line:
            break
        lines.append(line)
    return lines


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def ask_sections(data):
    if not data["sections"]:
        return []
    for i, s in enumerate(data["sections"], 1):
        print(f"  {i}. {s['title']}")
    raw = input("Разделы — номера через запятую: ")
    picked = []
    for part in raw.split(","):
        n = to_int(part.strip())
        if n and 1 <= n <= len(data["sections"]):
            picked.append(data["sections"][n - 1]["id"])
    return picked


def cmd_add(data):
    title = input("Название: ").strip()
    if not title:
        print("Название обязательно.")
        return
    recipe = {
        "id": max((r["id"] for r in data["recipes"]), default=0) + 1,
        "title": title,
        "sections": ask_sections(data),
        "servings": to_int(input("Порций: ").strip()),
        "time_minutes": to_int(input("Время, мин: ").strip()),
        "tags": [t.strip() for t in input("Теги через запятую: ").split(",") if t.strip()],
        "ingredients": ask_lines("Ингредиенты"),
        "steps": ask_lines("Шаги"),
        "notes": input("Заметки: ").strip(),
    }
    data["recipes"].append(recipe)
    save(data)
    print(f"Добавлен рецепт [{recipe['id']}] {title}")


def find(data, rid):
    rid = to_int(rid)
    return next((r for r in data["recipes"] if r["id"] == rid), None)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return
    cmd, args = argv[1], argv[2:]
    data = load()

    if cmd == "add":
        cmd_add(data)
    elif cmd == "sections":
        for sec in data["sections"]:
            n = sum(1 for r in data["recipes"] if sec["id"] in r.get("sections", []))
            print(f"{sec['title']} ({n})")
    elif cmd == "list":
        recipes = data["recipes"]
        if args:
            sec = find_section(data, " ".join(args))
            if not sec:
                print("Такого раздела нет. Разделы: " + ", ".join(s["title"] for s in data["sections"]))
                return
            recipes = [r for r in recipes if sec["id"] in r.get("sections", [])]
        if not recipes:
            print("Рецептов пока нет.")
        for r in recipes:
            print_short(r)
    elif cmd == "search":
        stems = normalize(" ".join(args))
        if not stems:
            print("Укажите слова для поиска.")
            return
        results = [(score(r, stems), r) for r in data["recipes"]]
        results = sorted([x for x in results if x[0] > 0], key=lambda x: -x[0])
        if not results:
            print("Ничего не найдено.")
        for _, r in results:
            print_short(r)
    elif cmd == "show" and args:
        r = find(data, args[0])
        print_full(r, data) if r else print("Рецепт не найден.")
    elif cmd == "delete" and args:
        r = find(data, args[0])
        if not r:
            print("Рецепт не найден.")
            return
        if input(f"Удалить «{r['title']}»? [y/N] ").strip().lower() in ("y", "д", "да", "yes"):
            data["recipes"].remove(r)
            save(data)
            print("Удалено.")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
