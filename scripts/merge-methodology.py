#!/usr/bin/env python3
"""Merge map-methodology.html body into methodology.html, then replace
map-methodology.html with a small redirect stub. Idempotent: a 'GIS-MERGED'
marker prevents double-injection.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METH = ROOT / "methodology.html"
MAP_METH = ROOT / "map-methodology.html"
MARKER = "<!-- GIS-METHODOLOGY-MERGED -->"

INTRO = (
    '\n  <hr style="margin: 3rem 0 2rem 0; border: 0; border-top: 1px solid var(--rule);">\n\n'
    '  <h2 id="map">Geospatial methodology (added May 2026)</h2>\n'
    '  <p class="muted text-small" style="margin-bottom: 1.5rem;">'
    'The section below documents the geospatial extension built for the GIS '
    'Developer/Specialist application. The methodology above covers the original '
    'digital edition; everything below covers the map view, the authoring loop, '
    'and the data pipeline added on top of it.</p>\n'
    + MARKER + '\n'
)

REDIRECT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Map Methodology &rarr; Methodology</title>
<meta http-equiv="refresh" content="0; url=/methodology.html#map">
<link rel="canonical" href="/methodology.html#map">
<meta name="robots" content="noindex, nofollow">
</head>
<body>
<p>This page has moved. Redirecting to <a href="/methodology.html#map">/methodology.html#map</a>&hellip;</p>
<script>location.replace('/methodology.html#map');</script>
</body>
</html>
"""


def extract_map_body() -> str:
    src = MAP_METH.read_text(encoding="utf-8")
    m = re.search(r'<main id="main"[^>]*>(.*?)</main>', src, flags=re.DOTALL)
    if not m:
        raise SystemExit("Could not find <main> in map-methodology.html")
    body = m.group(1)
    # Drop the lede h1 and its following <p class="lede"> — these become the
    # new h2 + intro we splice in.
    body = re.sub(
        r'\s*<h1>Map Methodology</h1>\s*<p class="lede">.*?</p>\s*',
        '', body, count=1, flags=re.DOTALL,
    )
    return body.strip()


def main() -> None:
    if not MAP_METH.exists():
        print("Already merged — map-methodology.html does not exist.")
        return

    methodology = METH.read_text(encoding="utf-8")
    if MARKER in methodology:
        print("Methodology page already merged. Replacing map-methodology.html with redirect stub.")
    else:
        body = extract_map_body()
        spliced = methodology.replace(
            '</main>',
            INTRO + body + '\n</main>',
            1,
        )
        if spliced == methodology:
            raise SystemExit("Failed to splice — </main> not found in methodology.html")
        METH.write_text(spliced, encoding="utf-8")
        print(f"Merged GIS methodology into {METH.name}")

    MAP_METH.write_text(REDIRECT, encoding="utf-8")
    print(f"Replaced {MAP_METH.name} with redirect stub")


if __name__ == "__main__":
    main()
