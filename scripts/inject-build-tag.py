#!/usr/bin/env python3
"""Inject the build-tag span + version.js script tag into every page.

The build-tag lives at the end of the .demo-banner content so it appears
beside the prototype-context line at the top of every page.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = [
    "index.html", "items.html", "item.html", "map.html",
    "add-letter.html", "methodology.html", "map-methodology.html",
    "authoring-pipeline.html", "about-this-build.html",
]

TAG = '<span class="build-tag" data-build-tag aria-label="Build version"></span>'
SCRIPT = '<script src="/assets/js/version.js" defer></script>'


def update(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    if 'data-build-tag' not in text:
        # Insert build-tag span right before </div> closing the demo-banner.
        new = re.sub(
            r'(<div class="demo-banner">.*?)(</div>)',
            lambda m: m.group(1) + ' ' + TAG + m.group(2),
            text, count=1, flags=re.DOTALL,
        )
        if new != text:
            text = new
            changed = True

    if 'version.js' not in text:
        # Add the script tag right before </body> (before site.js if present).
        if '<script src="/assets/js/site.js"' in text:
            new = text.replace(
                '<script src="/assets/js/site.js"',
                SCRIPT + '\n<script src="/assets/js/site.js"',
                1,
            )
        else:
            new = text.replace('</body>', SCRIPT + '\n</body>', 1)
        if new != text:
            text = new
            changed = True

    if changed:
        path.write_text(text, encoding="utf-8")
        print(f"  updated {path.name}")
    else:
        print(f"  unchanged {path.name}")
    return changed


def main() -> None:
    for name in PAGES:
        update(ROOT / name)


if __name__ == "__main__":
    main()
