#!/usr/bin/env python3
"""
Build geospatial views of the Iowa Letters dataset.

Reads:
    ../data/items.json       Source records (Dublin Core)
    ../data/gazetteer.json   Curated place authority file

Emits:
    ../data/letters.geojson  RFC 7946 FeatureCollection of letter origins
    ../data/letters.csv      Flat tabular export with a WKT geometry column
    ../data/letters.shp      ESRI Shapefile (also writes .shx, .dbf, .prj)

This script is the prototype's geoprocessing layer. In a production GIS
workflow on UIowa Libraries infrastructure, the same shape of work would be
done with ArcPy (against an ArcGIS Pro project) or PyQGIS (against a QGIS
project). Pure Python plus pyshp is used here because the dataset is small,
the dependencies are trivial, and the pipeline is reproducible on any
machine with Python 3.9+ installed.

Provenance notes:
    - Coordinates come from the curated gazetteer, not from a geocoder
      service. This is the controlled-vocabulary pattern: the descriptive
      metadata in Omeka uses the canonical place name as dcterms:spatial,
      and the gazetteer is the authority file that maps that name to a
      WGS 84 (EPSG:4326) coordinate. Swapping the gazetteer for GeoNames
      or for an LCSH-backed authority record is a one-file change.
    - The home-county anchor for each soldier is keyed off the addressee
      field in items.json and is recorded both as letter properties and
      as a separate geometry per feature (a multi-geometry SHP would be
      idiomatic for that, but for portability the home anchor ships as
      properties only).
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import re
from pathlib import Path

import shapefile  # pyshp

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA = REPO_ROOT / "data"

ITEMS_JSON = DATA / "items.json"
GAZETTEER_JSON = DATA / "gazetteer.json"

OUT_GEOJSON = DATA / "letters.geojson"
OUT_CSV = DATA / "letters.csv"
OUT_SHP_STEM = DATA / "letters"

PROJ4_WGS84 = (
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,'
    'AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],'
    'PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],'
    'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],'
    'AUTHORITY["EPSG","4326"]]'
)


def load_gazetteer() -> dict:
    g = json.loads(GAZETTEER_JSON.read_text(encoding="utf-8"))
    index: dict[str, dict] = {}
    for place in g["places"]:
        for name in [place["canonical"], *place.get("aliases", [])]:
            index[name.lower()] = place
    return {"raw": g, "by_name": index}


def lookup_place(name: str | None, gaz: dict) -> dict | None:
    if not name:
        return None
    key = name.strip().lower()
    if key in gaz["by_name"]:
        return gaz["by_name"][key]
    # Try a forgiving alias match: strip leading "Near " and trailing region.
    cleaned = re.sub(r"^near\s+", "", key)
    if cleaned in gaz["by_name"]:
        return gaz["by_name"][cleaned]
    # Try first comma-delimited token (city only).
    head = cleaned.split(",", 1)[0].strip()
    if head in gaz["by_name"]:
        return gaz["by_name"][head]
    return None


def parse_home_from_addressee(addressee: str | None, gaz: dict) -> dict | None:
    """The seed data records addressee as 'Name, County Name, Iowa'. Pull the
    county and resolve it through the gazetteer."""
    if not addressee:
        return None
    parts = [p.strip() for p in addressee.split(",")]
    candidates = []
    for i, p in enumerate(parts):
        if "county" in p.lower():
            candidates.append(", ".join([p] + parts[i + 1 :]))
    for c in candidates:
        match = lookup_place(c, gaz)
        if match:
            return match
    return None


def build_features() -> list[dict]:
    items = json.loads(ITEMS_JSON.read_text(encoding="utf-8"))["items"]
    gaz = load_gazetteer()
    features: list[dict] = []
    misses: list[str] = []

    for item in items:
        spatial = item.get("dcterms:spatial")
        place = lookup_place(spatial, gaz)
        if not place:
            misses.append(f'  - item {item["o:id"]}: no gazetteer hit for "{spatial}"')
            continue

        home = parse_home_from_addressee(item.get("addressee"), gaz)

        props = {
            "id": item["o:id"],
            "title": item.get("dcterms:title"),
            "creator": item.get("dcterms:creator"),
            "date": item.get("dcterms:date"),
            "regiment": item.get("regiment"),
            "company": item.get("company"),
            "addressee": item.get("addressee"),
            "place_canonical": place["canonical"],
            "place_id": place["id"],
            "theater": place["theater"],
            "home_canonical": home["canonical"] if home else None,
            "home_id": home["id"] if home else None,
            "home_lat": home["lat"] if home else None,
            "home_lon": home["lon"] if home else None,
            "transcription": item.get("transcription"),
        }

        features.append(
            {
                "type": "Feature",
                "id": item["o:id"],
                "geometry": {
                    "type": "Point",
                    "coordinates": [place["lon"], place["lat"]],
                },
                "properties": props,
            }
        )

    if misses:
        print("WARNING: gazetteer misses:")
        print("\n".join(misses))

    return features


def write_geojson(features: list[dict]) -> None:
    fc = {
        "type": "FeatureCollection",
        "name": "Iowa Letters — letter origins",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "metadata": {
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "source": "data/items.json + data/gazetteer.json",
            "license": "CC0 1.0 (illustrative prototype content).",
            "note": "Each Feature is the geocoded origin of a letter. The home anchor for each letter is carried as home_lat / home_lon properties (not as a second geometry) for portability across formats.",
        },
        "features": features,
    }
    OUT_GEOJSON.write_text(json.dumps(fc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  -> {OUT_GEOJSON.relative_to(REPO_ROOT)}  ({len(features)} features)")


def write_csv(features: list[dict]) -> None:
    fieldnames = [
        "id", "title", "creator", "date", "regiment", "company", "addressee",
        "place_canonical", "place_id", "theater",
        "home_canonical", "home_id", "home_lat", "home_lon",
        "lat", "lon", "wkt", "transcription",
    ]
    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        for feat in features:
            lon, lat = feat["geometry"]["coordinates"]
            row = {**feat["properties"], "lon": lon, "lat": lat, "wkt": f"POINT({lon} {lat})"}
            writer.writerow(row)
    print(f"  -> {OUT_CSV.relative_to(REPO_ROOT)}")


def write_shapefile(features: list[dict]) -> None:
    # Field definitions. SHP/DBF field names are limited to 10 chars.
    fields: list[tuple[str, str, int]] = [
        ("id",         "N", 6),
        ("title",      "C", 120),
        ("creator",    "C", 60),
        ("date",       "C", 10),
        ("regiment",   "C", 60),
        ("company",    "C", 20),
        ("addressee",  "C", 120),
        ("place_name", "C", 120),
        ("place_id",   "C", 40),
        ("theater",    "C", 30),
        ("home_name",  "C", 120),
        ("home_id",    "C", 40),
        ("home_lat",   "F", 12),
        ("home_lon",   "F", 12),
    ]

    with shapefile.Writer(str(OUT_SHP_STEM), shapeType=shapefile.POINT, encoding="utf-8") as w:
        for fname, ftype, fsize in fields:
            if ftype == "F":
                w.field(fname, "F", fsize, 6)
            elif ftype == "N":
                w.field(fname, "N", fsize, 0)
            else:
                w.field(fname, ftype, fsize)

        for feat in features:
            lon, lat = feat["geometry"]["coordinates"]
            p = feat["properties"]
            w.point(lon, lat)
            w.record(
                p["id"],
                (p.get("title") or "")[:120],
                (p.get("creator") or "")[:60],
                (p.get("date") or "")[:10],
                (p.get("regiment") or "")[:60],
                (p.get("company") or "")[:20],
                (p.get("addressee") or "")[:120],
                (p.get("place_canonical") or "")[:120],
                (p.get("place_id") or "")[:40],
                (p.get("theater") or "")[:30],
                (p.get("home_canonical") or "")[:120],
                (p.get("home_id") or "")[:40],
                p.get("home_lat"),
                p.get("home_lon"),
            )

    # Write the .prj sidecar with WGS 84 WKT
    (OUT_SHP_STEM.with_suffix(".prj")).write_text(PROJ4_WGS84, encoding="utf-8")
    print(f"  -> {OUT_SHP_STEM.relative_to(REPO_ROOT)}.{{shp,shx,dbf,prj}}")


def main() -> None:
    print("=== Iowa Letters spatial pipeline ===\n")
    print("[1/4] Building features (items.json + gazetteer.json)...")
    features = build_features()
    print(f"      {len(features)} features built\n")

    print("[2/4] Writing GeoJSON...")
    write_geojson(features)

    print("\n[3/4] Writing CSV...")
    write_csv(features)

    print("\n[4/4] Writing Shapefile...")
    write_shapefile(features)

    print("\nDone.")


if __name__ == "__main__":
    main()
