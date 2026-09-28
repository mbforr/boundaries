#!/usr/bin/env python3
"""Step W1 — export the boundary stack to the walkthrough app.

Reads the 5.1 GB GeoPackage built by the ../boundaries pipeline and writes the simplified
GeoJSON, the at-pin reveal stack, and the two generated TypeScript modules the app boots
from. Nothing here re-derives a boundary: geometry comes from the GeoPackage, the at-pin
count comes from qa/esb_final_count.md, and provenance is carried forward from the
GeoPackage's own `manifest` table rather than retyped.

Feature count is not the size driver — vertex weight is. usgs_wbd_huc2 has 22 features and
57 MB of raw geometry. So tolerance is set per scope and every output is asserted against a
budget; an over-budget layer is a hard failure, never a silent truncation.

Reads:
    ../boundaries/layers.yaml                   defaults.gpkg, pen and authority defaults
    ../boundaries/data/gpkg/boundary_stack.gpkg the geometry and the manifest table
    ../boundaries/qa/esb_final_count.md         the locked N=49 at-pin list
    docs/beats.yaml                             the 93-beat crosswalk

Writes:
    app/public/data/<layer>.geojson             national, simplified
    app/public/data/nyc/<layer>.geojson         five-borough extent
    app/public/data/esb_stack.geojson           the 49 at-pin polygons, pen + order
    app/src/layers.generated.ts                 registry with provenance
    app/src/beats.generated.ts                  the crosswalk
    qa/web_export_log.md                        the receipt

Usage:
    python3 scripts/export_web.py --dry-run
    python3 scripts/export_web.py
    python3 scripts/export_web.py --layers census_state,nps_boundary
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import yaml

warnings.filterwarnings("ignore", category=RuntimeWarning)

ROOT = Path(__file__).resolve().parent.parent
STACK = Path(os.environ.get("BOUNDARY_STACK", ROOT.parent / "boundaries"))
BEATS = ROOT / "docs" / "beats.yaml"
OUT = ROOT / "app" / "public" / "data"
SRC = ROOT / "app" / "src"
LOG = ROOT / "qa" / "web_export_log.md"

PIN = (-73.985654, 40.748428)

# Scope: the bbox features must intersect, the simplify tolerance in degrees, and the
# per-file budget. pyogrio's bbox filter returns whole geometries of intersecting
# features, so nothing is ever cut mid-polygon.
SCOPES: dict[str, dict] = {
    "national": {"bbox": None,                              "tol": 0.002,   "budget_mb": 25.0},
    "nyc":      {"bbox": (-74.30, 40.45, -73.65, 40.95),    "tol": 0.00002, "budget_mb": 6.0},
}
# The five-borough bbox pulls 48k blocks (12 MB). Every scene that uses blocks is an ESB
# close-up, so they get Manhattan only.
MANHATTAN = (-74.03, 40.68, -73.90, 40.88)
OVERRIDES: dict[tuple[str, str], dict] = {
    ("census_block", "nyc"): {"bbox": MANHATTAN},
    # Raster-derived, so the outlines are far more crenulated than a surveyed boundary:
    # 19 features and 48 MB at the national tolerance.
    ("usda_hardiness_zone", "national"): {"tol": 0.02},
    # The GeoPackage holds the unfiltered global timezone file (419 features, every
    # continent). layers.yaml asks for "America/* zones intersecting US"; the archival
    # copy stays whole, the display copy honours the intent.
    ("fedadmin_time_zone", "national"): {"where": ("tzid", r"^America/")},
}
# Layers no counter mark owns but a choreographed scene needs.
EXTRA: list[tuple[str, str]] = [
    ("nyc_borough", "nyc"),      # the reveal's "Manhattan drawn twice" beat
    ("census_state", "national"),
    ("nps_boundary", "national"),
    # The census nesting scene ends on New York County at ESB zoom, where the national
    # county file's 200 m simplification would visibly distort Manhattan's shoreline.
    ("census_county", "nyc"),
]
PEN_ORDER = ["congress", "politicians", "statisticians", "courts", "markets", "surveyors"]

# McGirt v. Oklahoma (2020) covered the Muscogee (Creek) Nation; Oklahoma's Court of
# Criminal Appeals then applied the same reasoning to nine more. The Osage reservation was
# ruled disestablished. Every other Oklahoma OTSA is a statistical area for a tribe
# without an affirmed reservation, mostly in the west of the state — they are kept in the
# file and flagged, never silently dropped, because showing all 25 under the "43%" caption
# would be wrong: the full set covers 76% of Oklahoma, the affirmed set 44.2%.
MCGIRT_AFFIRMED = ["Creek", "Cherokee", "Choctaw", "Chickasaw", "Seminole",
                   "Quapaw", "Ottawa", "Peoria", "Miami", "Wyandotte", "Eastern Shawnee"]
# The order they fade in: the nation McGirt actually decided, then the rest of the Five
# Tribes largest first, then the small northeast nations together.
MCGIRT_ORDER = ["Creek", "Cherokee", "Choctaw", "Chickasaw", "Seminole"]

# ──────────────────────────────────────────────────────────────────────────────
# inputs


def load_beats() -> list[dict]:
    beats = yaml.safe_load(BEATS.read_text())["beats"]
    ns = [b["n"] for b in beats]
    if ns != list(range(1, 94)):
        dupes = {n for n in ns if ns.count(n) > 1}
        missing = [n for n in range(1, 94) if n not in ns]
        raise RuntimeError(
            f"beats.yaml must carry 1..93 exactly once — missing {missing}, repeated {sorted(dupes)}")
    for b in beats:
        if (b["render"] == "polygon") != bool(b.get("layer")):
            raise RuntimeError(
                f"beat {b['n']} is render:{b['render']} but layer={b.get('layer')!r}")
        if b["scope"] not in SCOPES:
            raise RuntimeError(f"beat {b['n']} has unknown scope {b['scope']!r}")
    return beats


def gpkg_path(cli: str | None) -> Path:
    if cli:
        return Path(cli)
    defaults = yaml.safe_load((STACK / "layers.yaml").read_text())["defaults"]
    return STACK / defaults["gpkg"]


def read_manifest(gpkg: Path) -> dict[str, dict]:
    con = sqlite3.connect(gpkg)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id,pen,authority,vintage,license,source_url,retrieved_at,method,"
        "feature_count FROM manifest").fetchall()
    return {r["id"]: dict(r) for r in rows}


def gpkg_layers(gpkg: Path) -> set[str]:
    con = sqlite3.connect(gpkg)
    return {r[0] for r in con.execute(
        "SELECT table_name FROM gpkg_contents WHERE data_type='features'")}


def parse_esb_count(path: Path) -> tuple[int, list[dict]]:
    """The locked at-pin answer. This file is the authority; we never recompute N."""
    text = path.read_text()
    m = re.search(r"\*\*N = (\d+)\*\*", text)
    if not m:
        raise RuntimeError(f"{path.name} does not state **N = <n>**")
    n = int(m.group(1))
    rows = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 5 or not cells[0].isdigit():
            continue
        rows.append({"i": int(cells[0]), "layer": cells[1].strip("`"),
                     "name": cells[2], "geoid": cells[3], "pen": cells[4]})
    if len(rows) != n:
        raise RuntimeError(f"{path.name} says N = {n} but the table has {len(rows)} rows")
    return n, rows


# ──────────────────────────────────────────────────────────────────────────────
# geometry


def round_coords(o):
    if isinstance(o, list):
        return [round_coords(x) for x in o]
    return round(o, 5) if isinstance(o, float) else o


def adaptive_tol(geom) -> float:
    """A tolerance proportional to the feature's own size.

    The reveal stack spans eight orders of magnitude — the Empire State Building lot and
    the United States are both in it. A fixed tolerance either shreds the lot or leaves
    the nation at 12 MB. Scale to the bounding diagonal, ~1/800th of the feature.
    """
    x0, y0, x1, y1 = geom.bounds
    diag = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    return min(0.01, max(1e-6, diag / 800))


def write_geojson(gdf: gpd.GeoDataFrame, dest: Path, tol: float | None, keep: list[str]) -> float:
    """Simplify, thin the attributes, round to 5 dp, write. Returns megabytes.

    tol=None selects per-feature adaptive simplification.
    """
    cols = [c for c in keep if c in gdf.columns]
    out = gdf[cols + [gdf.geometry.name]].copy()
    if tol is None:
        out["geometry"] = [g.simplify(adaptive_tol(g), preserve_topology=True)
                           for g in out.geometry]
    else:
        out["geometry"] = out.geometry.simplify(tol, preserve_topology=True)
    out = out[~out.geometry.is_empty & out.geometry.notna()]
    fc = json.loads(out.to_json())
    for f in fc["features"]:
        f.pop("id", None)
        if f.get("geometry"):
            f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])
    blob = json.dumps(fc, separators=(",", ":"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(blob)
    return len(blob) / 1e6


KEEP = ["std_name", "std_geoid", "pen", "std_note", "LSAD", "UNIT_CODE", "NAME"]


def export_layer(gpkg: Path, lid: str, scope: str, dry: bool) -> dict:
    spec = dict(SCOPES[scope])
    spec.update(OVERRIDES.get((lid, scope), {}))
    rel = f"{lid}.geojson" if scope == "national" else f"nyc/{lid}.geojson"
    dest = OUT / rel
    gdf = gpd.read_file(gpkg, layer=lid, engine="pyogrio", bbox=spec["bbox"])
    if spec.get("where"):
        col, pattern = spec["where"]
        before = len(gdf)
        gdf = gdf[gdf[col].astype(str).str.match(pattern, na=False)]
        if gdf.empty:
            raise RuntimeError(f"filter {col}~{pattern!r} matched nothing of {before} features")
    stat = {"layer": lid, "scope": scope, "features": len(gdf), "path": rel,
            "tol": spec["tol"], "mb": 0.0}
    if dry:
        return stat
    stat["mb"] = write_geojson(gdf, dest, spec["tol"], KEEP)
    if stat["mb"] > spec["budget_mb"]:
        raise RuntimeError(
            f"{rel} is {stat['mb']:.1f} MB, over the {spec['budget_mb']:.0f} MB budget for "
            f"scope {scope}. Raise the tolerance or tighten the bbox — do not ship it.")
    return stat


def export_esb_stack(gpkg: Path, rows: list[dict], dry: bool) -> dict:
    """The 49 at-pin polygons, in pen order, for the reveal.

    The rows in esb_final_count.md decide WHICH features. We fetch each by a micro-bbox
    around the pin and assert the geometry we get back is the one the file names — a
    verification of the locked answer, not a recomputation of it.
    """
    eps = 1e-7
    bbox = (PIN[0] - eps, PIN[1] - eps, PIN[0] + eps, PIN[1] + eps)
    from shapely.geometry import Point
    pin = Point(*PIN)
    order = {p: i for i, p in enumerate(PEN_ORDER)}
    frames, mismatches = [], []
    for r in sorted(rows, key=lambda r: (order.get(r["pen"], 99), r["i"])):
        g = gpd.read_file(gpkg, layer=r["layer"], engine="pyogrio", bbox=bbox)
        hit = g[g.contains(pin)] if len(g) else g
        if len(hit) != 1:
            mismatches.append(f"{r['layer']}: {len(hit)} features contain the pin, expected 1")
            continue
        got = str(hit.iloc[0].get("std_geoid") or "—")
        if r["geoid"] not in ("—", "") and got != r["geoid"]:
            mismatches.append(f"{r['layer']}: gpkg geoid {got!r} != locked {r['geoid']!r}")
        hit = hit.copy()
        hit["order"] = len(frames)
        hit["beat_layer"] = r["layer"]
        hit["std_name"] = r["name"]
        hit["pen"] = r["pen"]
        frames.append(hit[["std_name", "std_geoid", "pen", "order", "beat_layer", "geometry"]])
    if mismatches:
        raise RuntimeError("esb_final_count.md does not match the GeoPackage:\n  "
                           + "\n  ".join(mismatches))
    stack = gpd.GeoDataFrame(gpd.pd.concat(frames, ignore_index=True), crs=frames[0].crs)
    if len(stack) != len(rows):
        raise RuntimeError(f"built {len(stack)} at-pin polygons, expected {len(rows)}")
    stat = {"layer": "esb_stack", "scope": "nyc", "features": len(stack),
            "path": "esb_stack.geojson", "tol": 0.0, "mb": 0.0}
    if not dry:
        stat["mb"] = write_geojson(stack, OUT / "esb_stack.geojson", None,
                                   ["std_name", "std_geoid", "pen", "order", "beat_layer"])
        if stat["mb"] > 8.0:
            raise RuntimeError(f"esb_stack.geojson is {stat['mb']:.1f} MB, over its 8 MB budget")
    return stat


# ──────────────────────────────────────────────────────────────────────────────
# derived scene geometry
#
# Shapes no counter beat owns, built for a choreographed scene. Every one comes from
# GeoPackage inputs — nothing is hand-digitised (rule 1) — and each carries a std_note
# saying what it is and how it was made.


def derive_oklahoma(gpkg: Path, dry: bool) -> dict:
    """The McGirt map: Oklahoma's OTSAs plus the Osage reservation, flagged by status."""
    aiannh = gpd.read_file(gpkg, layer="census_aiannh", engine="pyogrio")
    states = gpd.read_file(gpkg, layer="census_state", engine="pyogrio")
    ok = states[states["NAME"] == "Oklahoma"]
    ok_geom = ok.to_crs(5070).union_all()

    otsa = aiannh[aiannh["LSAD"] == "88"].copy()
    otsa = otsa[otsa.to_crs(5070).geometry.intersects(ok_geom)]
    osage = aiannh[(aiannh["NAME"] == "Osage") & (aiannh["LSAD"] == "86")].copy()
    if osage.empty:
        raise RuntimeError("census_aiannh has no Osage Reservation — cannot build the McGirt map")

    otsa["mcgirt_status"] = [
        "affirmed" if n in MCGIRT_AFFIRMED else "not_mcgirt" for n in otsa["NAME"]]
    osage["mcgirt_status"] = "disestablished"
    out = gpd.GeoDataFrame(gpd.pd.concat([otsa, osage], ignore_index=True), crs=otsa.crs)
    out["order"] = [
        MCGIRT_ORDER.index(n) if n in MCGIRT_ORDER else
        (len(MCGIRT_ORDER) if st == "affirmed" else 99)
        for n, st in zip(out["NAME"], out["mcgirt_status"])]
    out["std_name"] = out["NAMELSAD"]
    out["std_note"] = (
        "OTSA polygons are the Census Bureau's statistical proxy for the historic "
        "reservation footprint, not a court-drawn line. mcgirt_status: affirmed = McGirt "
        "or the OCCA applying it; disestablished = Osage; not_mcgirt = a statistical area "
        "for a tribe without an affirmed reservation.")

    affirmed = out[out["mcgirt_status"] == "affirmed"].to_crs(5070).union_all()
    pct = 100 * affirmed.intersection(ok_geom).area / ok_geom.area
    print(f"  oklahoma: {len(out)} areas, affirmed set = {pct:.1f}% of Oklahoma "
          f"(the script says 43%)")

    stat = {"layer": "ok_mcgirt", "scope": "national", "features": len(out),
            "path": "derived/ok_mcgirt.geojson", "tol": 0.0005, "mb": 0.0, "pen": "courts"}
    if not dry:
        stat["mb"] = write_geojson(out, OUT / "derived" / "ok_mcgirt.geojson", 0.0005,
                                   ["std_name", "NAME", "mcgirt_status", "order", "std_note"])
    return stat


def derive_yellowstone(gpkg: Path, dry: bool) -> dict:
    """The Zone of Death: the District of Wyoming and the two slivers it swallows.

    The district itself is not rebuilt — courts_fed_district already carries it, patched
    by derive.py under 28 USC 131 so it covers all 3,437 sq mi of the park. This adds the
    two state slivers the camera pushes into.
    """
    from shapely.geometry import mapping  # noqa: F401  (kept for clarity of intent)
    nps = gpd.read_file(gpkg, layer="nps_boundary", engine="pyogrio",
                        bbox=(-112, 43.5, -109, 45.5))
    yell = nps[nps["UNIT_CODE"] == "YELL"]
    if yell.empty:
        raise RuntimeError("nps_boundary has no UNIT_CODE 'YELL'")
    states = gpd.read_file(gpkg, layer="census_state", engine="pyogrio")
    districts = gpd.read_file(gpkg, layer="courts_fed_district", engine="pyogrio",
                              bbox=(-112, 43.5, -109, 45.5))
    wyo = districts[districts["std_name"] == "District of Wyoming"]
    if wyo.empty:
        raise RuntimeError("courts_fed_district has no District of Wyoming")

    park_m = yell.to_crs(5070).union_all()
    rows = []
    for state in ("Idaho", "Montana"):
        sm = states[states["NAME"] == state].to_crs(5070).union_all()
        sliver = park_m.intersection(sm)
        area = sliver.area / 2.59e6
        rows.append({
            "std_name": f"{state} sliver",
            "kind": f"{state.lower()}_sliver",
            "sq_mi": round(area, 1),
            "std_note": (f"Yellowstone National Park inside {state}, inside the District "
                         f"of Wyoming (28 USC 131). Measured {area:.1f} sq mi from "
                         f"nps_boundary x census_state; the script says ~50."),
            "geometry": gpd.GeoSeries([sliver], crs=5070).to_crs(4326).iloc[0],
        })
        print(f"  yellowstone: {state} sliver = {area:.1f} sq mi")
    rows.append({
        "std_name": "District of Wyoming",
        "kind": "district_of_wyoming",
        "sq_mi": round(wyo.to_crs(5070).union_all().area / 2.59e6, 1),
        "std_note": "From courts_fed_district, already patched to include the whole park.",
        "geometry": wyo.union_all(),
    })
    rows.append({
        "std_name": "Yellowstone National Park",
        "kind": "park",
        "sq_mi": round(park_m.area / 2.59e6, 1),
        "std_note": "From nps_boundary, UNIT_CODE YELL.",
        "geometry": yell.union_all(),
    })
    out = gpd.GeoDataFrame(rows, crs=4326)
    stat = {"layer": "yellowstone", "scope": "national", "features": len(out),
            "path": "derived/yellowstone.geojson", "tol": 0.0002, "mb": 0.0, "pen": "courts"}
    if not dry:
        stat["mb"] = write_geojson(out, OUT / "derived" / "yellowstone.geojson", 0.0002,
                                   ["std_name", "kind", "sq_mi", "std_note"])
    return stat


def derive_navajo_hopi(gpkg: Path, dry: bool) -> dict:
    """An island inside an island: the Hopi Reservation sits inside the Navajo Nation."""
    aiannh = gpd.read_file(gpkg, layer="census_aiannh", engine="pyogrio")
    sel = aiannh[(aiannh["LSAD"] == "86") &
                 (aiannh["NAME"].isin(["Navajo Nation", "Hopi"]))].copy()
    if len(sel) != 2:
        raise RuntimeError(f"expected Navajo Nation and Hopi reservations, got {len(sel)}")
    sel["std_name"] = sel["NAMELSAD"]
    sel["order"] = [0 if n == "Navajo Nation" else 1 for n in sel["NAME"]]
    stat = {"layer": "navajo_hopi", "scope": "national", "features": len(sel),
            "path": "derived/navajo_hopi.geojson", "tol": 0.0005, "mb": 0.0, "pen": "courts"}
    if not dry:
        stat["mb"] = write_geojson(sel, OUT / "derived" / "navajo_hopi.geojson", 0.0005,
                                   ["std_name", "NAME", "order"])
    return stat


def derive_arc(gpkg: Path, dry: bool) -> dict:
    """The cold open's great-circle arc, from the pin to the Idaho sliver."""
    from pyproj import Geod
    nps = gpd.read_file(gpkg, layer="nps_boundary", engine="pyogrio",
                        bbox=(-112, 43.5, -109, 45.5))
    states = gpd.read_file(gpkg, layer="census_state", engine="pyogrio")
    park = nps[nps["UNIT_CODE"] == "YELL"].to_crs(5070).union_all()
    idaho = states[states["NAME"] == "Idaho"].to_crs(5070).union_all()
    target = gpd.GeoSeries([park.intersection(idaho).representative_point()],
                           crs=5070).to_crs(4326).iloc[0]

    geod = Geod(ellps="WGS84")
    pts = geod.npts(PIN[0], PIN[1], target.x, target.y, 128)
    line = [list(PIN)] + [[round(x, 5), round(y, 5)] for x, y in pts] + \
           [[round(target.x, 5), round(target.y, 5)]]
    _, _, metres = geod.inv(PIN[0], PIN[1], target.x, target.y)
    miles = metres / 1609.344
    print(f"  arc: pin to the Idaho sliver = {miles:,.0f} miles (the script says 1,890)")

    fc = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {"std_name": "ESB to the Idaho sliver", "miles": round(miles),
                       "std_note": "Great circle, WGS84, from the pin to a representative "
                                   "point in Yellowstone's Idaho sliver."},
        "geometry": {"type": "LineString", "coordinates": line}}]}
    stat = {"layer": "esb_arc", "scope": "national", "features": 1,
            "path": "derived/esb_arc.geojson", "tol": 0.0, "mb": 0.0, "pen": "courts"}
    if not dry:
        dest = OUT / "derived" / "esb_arc.geojson"
        dest.parent.mkdir(parents=True, exist_ok=True)
        blob = json.dumps(fc, separators=(",", ":"))
        dest.write_text(blob)
        stat["mb"] = len(blob) / 1e6
    return stat


DERIVES = [derive_oklahoma, derive_yellowstone, derive_navajo_hopi, derive_arc]


# ──────────────────────────────────────────────────────────────────────────────
# generated TypeScript


def ts_header(src: str) -> str:
    return (f"// GENERATED by scripts/export_web.py from {src}.\n"
            f"// Do not hand-edit — rerun `python3 scripts/export_web.py`.\n\n")


def write_layers_ts(stats: list[dict], man: dict[str, dict], beats: list[dict]) -> None:
    display = {b["layer"]: b["label"] for b in beats if b.get("layer")}
    display["esb_stack"] = "The stack at the pin"
    display["ok_mcgirt"] = "Reservation land in Oklahoma"
    display["yellowstone"] = "The District of Wyoming"
    display["navajo_hopi"] = "Navajo Nation and Hopi"
    display["esb_arc"] = "1,890 miles"
    display["scene_places"] = "City limits"
    display["gerrymander"] = "Drawn on purpose"
    L = [ts_header("the GeoPackage manifest table"),
         "import type { Pen } from './pens';\n",
         "export interface LayerDef {",
         "  id: string; name: string; pen: Pen | null; scope: 'national' | 'nyc';",
         "  path: string; features: number;",
         "  authority: string | null; vintage: string | null;",
         "  sourceUrl: string | null; retrievedAt: string | null;",
         "}\n",
         "export const LAYERS = {"]
    for s in sorted(stats, key=lambda s: (s["layer"], s["scope"])):
        lid = s["layer"]
        m = man.get(lid, {})
        if lid == "esb_stack":
            m = {"pen": None, "authority": "Ground Truth Lab", "vintage": None,
                 "source_url": "qa/esb_final_count.md", "retrieved_at": None}
        elif s.get("pen"):
            m = {"pen": s["pen"], "authority": "Derived for a scene",
                 "vintage": None, "source_url": "scripts/export_web.py",
                 "retrieved_at": None}
        key = lid if s["scope"] == "national" else f"{lid}@nyc"
        name = display.get(lid) or lid.split("_", 1)[-1].replace("_", " ").title()
        L.append(f"  {json.dumps(key)}: {{ id: {json.dumps(lid)}, "
                 f"name: {json.dumps(name)}, pen: {json.dumps(m.get('pen'))} as Pen | null, "
                 f"scope: {json.dumps(s['scope'])}, path: {json.dumps('data/' + s['path'])}, "
                 f"features: {s['features']}, authority: {json.dumps(m.get('authority'))}, "
                 f"vintage: {json.dumps(m.get('vintage'))}, "
                 f"sourceUrl: {json.dumps(m.get('source_url'))}, "
                 f"retrievedAt: {json.dumps(m.get('retrieved_at'))} }},")
    L += ["} as const satisfies Record<string, LayerDef>;\n",
          "export type LayerId = keyof typeof LAYERS;\n"]
    (SRC / "layers.generated.ts").write_text("\n".join(L))


def write_beats_ts(beats: list[dict], man: dict[str, dict]) -> None:
    L = [ts_header("docs/beats.yaml"),
         "import type { Pen } from './pens';\n",
         "export interface Beat {",
         "  /** The pen shown on screen: the layer's own where it has one, else the chapter's. */",
         "  n: number; label: string; chapter: string; pen: Pen; chapterPen: Pen;",
         "  layer: string | null; scope: 'national' | 'nyc';",
         "  render: 'polygon' | 'card'; cardSub?: string; note?: string;",
         "}\n",
         "export const BEATS: Beat[] = ["]
    for b in beats:
        # The layer's own pen wins where there is a layer; the chapter pen covers cards.
        pen = (man.get(b["layer"], {}).get("pen") if b["layer"] else None) or b["pen"]
        parts = [f"n: {b['n']}", f"label: {json.dumps(b['label'])}",
                 f"chapter: {json.dumps(b['chapter'])}",
                 f"pen: {json.dumps(pen)} as Pen",
                 f"chapterPen: {json.dumps(b['pen'])} as Pen",
                 f"layer: {json.dumps(b['layer'])}",
                 f"scope: {json.dumps(b['scope'])}",
                 f"render: {json.dumps(b['render'])}"]
        if b.get("card_sub"):
            parts.append(f"cardSub: {json.dumps(b['card_sub'])}")
        if b.get("note"):
            parts.append(f"note: {json.dumps(b['note'])}")
        L.append("  { " + ", ".join(parts) + " },")
    L += ["];\n"]
    (SRC / "beats.generated.ts").write_text("\n".join(L))


def write_log(stats: list[dict], run_at: str, gpkg: Path, n: int, failures: list[str]) -> None:
    total = sum(s["mb"] for s in stats)
    L = ["# Web export log\n",
         f"Run: **{run_at}**  ",
         f"Source: `{gpkg}`  ",
         f"At-pin stack: **N = {n}** from `qa/esb_final_count.md`\n",
         f"{len(stats)} outputs, {total:.1f} MB total, {len(failures)} failed.\n",
         "| output | scope | features | tolerance | MB |",
         "|---|---|---:|---:|---:|"]
    for s in sorted(stats, key=lambda s: -s["mb"]):
        L.append(f"| `{s['path']}` | {s['scope']} | {s['features']:,} | "
                 f"{s['tol']:g} | {s['mb']:.2f} |")
    if failures:
        L += ["\n## Failures\n"] + [f"- {f}" for f in failures]
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text("\n".join(L) + "\n")


# ──────────────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gpkg", help="override the GeoPackage path")
    ap.add_argument("--layers", help="comma-separated subset")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be written, touch nothing")
    ap.add_argument("--ts-only", action="store_true",
                    help="regenerate the .ts files from the GeoJSON already exported")
    args = ap.parse_args()

    run_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    gpkg = gpkg_path(args.gpkg)
    if not gpkg.exists():
        print(f"FAILED — no GeoPackage at {gpkg}")
        return 1

    beats = load_beats()
    have = gpkg_layers(gpkg)
    man = read_manifest(gpkg)

    wanted: dict[tuple[str, str], None] = {}
    for b in beats:
        if b["layer"]:
            wanted[(b["layer"], b["scope"])] = None
    for pair in EXTRA:
        wanted[pair] = None

    unknown = sorted({lid for lid, _ in wanted} - have)
    if unknown:
        print(f"FAILED — beats.yaml references layers not in the GeoPackage: {unknown}")
        return 1

    only = set(args.layers.split(",")) if args.layers else None
    todo = [p for p in wanted if not only or p[0] in only]

    if args.ts_only:
        stats = []
        # scene props come from scripts/fetch_scene_props.py, so they are picked up from
        # disk here rather than exported; they are optional and skipped if absent.
        derived = [("ok_mcgirt", "courts"), ("yellowstone", "courts"),
                   ("navajo_hopi", "courts"), ("esb_arc", "courts"),
                   ("scene_places", "politicians"), ("gerrymander", "politicians")]
        for lid, scope in (sorted(wanted) + [("esb_stack", "nyc")]
                           + [(d, "national") for d, _ in derived]):
            rel = f"{lid}.geojson" if scope == "national" else f"nyc/{lid}.geojson"
            if lid == "esb_stack":
                rel = "esb_stack.geojson"
            if lid in dict(derived):
                rel = f"derived/{lid}.geojson"
            f = OUT / rel
            if not f.exists():
                if lid in ("scene_places", "gerrymander"):
                    continue  # optional: run scripts/fetch_scene_props.py to add them
                print(f"FAILED — {rel} is missing; run a full export first")
                return 1
            blob = json.loads(f.read_text())
            stats.append({"layer": lid, "scope": scope, "features": len(blob["features"]),
                          "path": rel, "tol": 0.0, "mb": f.stat().st_size / 1e6,
                          **({"pen": dict(derived)[lid]} if lid in dict(derived) else {})})
        SRC.mkdir(parents=True, exist_ok=True)
        write_layers_ts(stats, man, beats)
        write_beats_ts(beats, man)
        print(f"  regenerated the .ts registry from {len(stats)} files on disk")
        return 0

    print(f"  GeoPackage: {gpkg}")
    print(f"  93 beats validated · {sum(1 for b in beats if b['layer'])} polygon · "
          f"{sum(1 for b in beats if not b['layer'])} card")
    print(f"  {len(todo)} layer exports{' (dry run)' if args.dry_run else ''}\n")

    stats, failures = [], []
    for i, (lid, scope) in enumerate(sorted(todo), 1):
        try:
            s = export_layer(gpkg, lid, scope, args.dry_run)
            stats.append(s)
            print(f"[{i:2}/{len(todo)}] {lid:30} {scope:8} {s['features']:>7,} feats  "
                  f"{s['mb']:6.2f} MB")
        except Exception as e:
            failures.append(f"`{lid}` ({scope}) — {type(e).__name__}: {e}")
            print(f"[{i:2}/{len(todo)}] {lid:30} {scope:8} FAILED — {type(e).__name__}: {e}")

    if not only:
        print()
        for fn in DERIVES:
            try:
                d = fn(gpkg, args.dry_run)
                stats.append(d)
            except Exception as e:
                failures.append(f"derive {fn.__name__} — {type(e).__name__}: {e}")
                print(f"  derive {fn.__name__} FAILED — {type(e).__name__}: {e}")
        print()

    n, rows = parse_esb_count(STACK / "qa" / "esb_final_count.md")
    try:
        s = export_esb_stack(gpkg, rows, args.dry_run)
        stats.append(s)
        print(f"\n  esb_stack: {s['features']} at-pin polygons, {s['mb']:.2f} MB")
    except Exception as e:
        failures.append(f"esb_stack — {type(e).__name__}: {e}")
        print(f"\n  esb_stack FAILED — {type(e).__name__}: {e}")

    if not args.dry_run and only:
        print("\n  --layers is a subset run: layers.generated.ts and the log are left "
              "alone so a partial list cannot clobber the registry.")
    elif not args.dry_run:
        SRC.mkdir(parents=True, exist_ok=True)
        write_layers_ts(stats, man, beats)
        write_beats_ts(beats, man)
        write_log(stats, run_at, gpkg, n, failures)
        print(f"  wrote app/src/layers.generated.ts, app/src/beats.generated.ts, "
              f"qa/web_export_log.md")

    print(f"\n  {len(stats)} outputs, {sum(s['mb'] for s in stats):.1f} MB, "
          f"{len(failures)} failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
