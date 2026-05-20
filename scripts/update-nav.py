#!/usr/bin/env python3
"""Inject the new Map + Add a Letter nav links into all existing pages.

Each page has two nav menus (header primary + footer). Pattern is the same:
    <li><a href="/items.html"...>Browse Letters</a></li>
    [insert Map + Add a Letter here]
    <li><a href="/methodology.html"...>Methodology</a></li>

aria-current="page" is preserved by matching the exact existing line.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = ["items.html", "item.html", "methodology.html", "about-this-build.html"]

INSERT_AFTER_RE = re.compile(
    r'(<li><a href="/items\.html"[^>]*>Browse Letters</a></li>)',
)
NEW_LIS = (
    '<li><a href="/map.html">Map</a></li>\n'
    '        <li><a href="/add-letter.html">Add a Letter</a></li>'
)


def update(page: Path) -> bool:
    text = page.read_text(encoding="utf-8")
    if "/map.html" in text and "/add-letter.html" in text:
        return False  # already updated
    new_text, n = INSERT_AFTER_RE.subn(
        lambda m: m.group(1) + "\n        " + NEW_LIS,
        text,
    )
    if n == 0:
        print(f"  !! no anchor match in {page.name}")
        return False
    page.write_text(new_text, encoding="utf-8")
    print(f"  updated {page.name} ({n} insertions)")
    return True


def main() -> None:
    for name in PAGES:
        update(ROOT / name)


if __name__ == "__main__":
    main()
