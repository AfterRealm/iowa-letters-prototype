#!/usr/bin/env python3
"""Apply the remaining Curb Cut findings as mechanical edits across all pages.

  - Footer <h4> -> <h3> (heading-order)
  - build-tag span: drop aria-label="Build version" (empty-element AT noise)
  - seal-trigger <img alt="..."> -> alt="" (button's aria-label is the
    accessible name; provenance lives in the dialog's data-caption)
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = [
    "index.html", "items.html", "item.html", "map.html",
    "add-letter.html", "methodology.html",
    "authoring-pipeline.html", "about-this-build.html",
]


def fix(text: str) -> tuple[str, int]:
    n = 0

    # 1. Footer h4 -> h3 (only inside .site-footer area; both h4 instances)
    new = re.sub(
        r'<h4>(About this prototype|Standards used|Contact)</h4>',
        r'<h3>\1</h3>',
        text,
    )
    if new != text:
        n += text.count('<h4>') - new.count('<h4>')
        text = new

    # 2. Drop aria-label="Build version" from the build-tag span
    new = re.sub(
        r'(<span class="build-tag" data-build-tag) aria-label="Build version">',
        r'\1>',
        text,
    )
    if new != text:
        n += 1
        text = new

    # 3. Seal img alt -> empty (button has the accessible name)
    new = re.sub(
        r'(<img class="site-seal" src="/apple-touch-icon\.png") alt="[^"]*"',
        r'\1 alt=""',
        text,
    )
    if new != text:
        n += 1
        text = new

    return text, n


def main() -> None:
    for name in PAGES:
        path = ROOT / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        new, n = fix(text)
        if n:
            path.write_text(new, encoding="utf-8")
            print(f"  {name}: {n} edits")
        else:
            print(f"  {name}: unchanged")


if __name__ == "__main__":
    main()
