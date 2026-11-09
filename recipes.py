#!/usr/bin/env python3
"""Книга рецептов: хранение и поиск рецептов в recipes.json.

Команды:
  python recipes.py add               — добавить рецепт (интерактивно)
  python recipes.py list              — список всех рецептов
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
    return data


def save(data):
    with DB_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def normalize(text):
    """Нижний регистр, ё→е, слова обрезаются до STEM_LEN букв."""
    text = text.lower().replace("ё", "е")
    return [w[:STEM_LEN] for w in re.findall(r"\w+", text)]


def field_text(recipe, field):
    value = recipe.get(field, "")
    if isinstance(value, list):
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


def print_full(r):
    print(f"\n{r['title']}")
    print("=" * len(r["title"]))
    if r.get("servings") or r.get("time_minutes"):
        print(f"Порции: {r.get('servings', '—')}, время: {r.get('time_minutes', '—')} мин")
    if r.get("tags"):
        print("Теги: " + ", ".join(r["tags"]))
    print("\nИнгредиенты:")
    for item in r.get("ingredients", []):
        print(f"  - {item}")
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


def cmd_add(data):
    title = input("Название: ").strip()
    if not title:
        print("Название обязательно.")
        return
    recipe = {
        "id": max((r["id"] for r in data["recipes"]), default=0) + 1,
        "title": title,
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
    elif cmd == "list":
        if not data["recipes"]:
            print("Рецептов пока нет.")
        for r in data["recipes"]:
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
        print_full(r) if r else print("Рецепт не найден.")
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
