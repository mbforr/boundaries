#!/usr/bin/env python3
"""Step W3 — fetch the out-of-state geometry a few scenes need as props.

Three scenes need shapes from outside New York: Tulsa's city limits for the McGirt beat,
Paradise and Las Vegas for the CDP beat, and two congressional districts for the
gerrymander gallery. None of them belong in the boundary stack's analytical manifest —
census_place is deliberately a state-36 subset under CLAUDE.md rule 6, and appending three
more states to it would change a P0 layer that the locked ESB count is computed from, for
the sake of two b-roll shots (rule 10).

So they are fetched here instead, as scene props, with full provenance: the exact URL, the
sha256 of the raw file, and the retrieval date all land in qa/scene_props.md. Rule 1 still
holds — every polygon is an authoritative download, nothing is hand-digitised.

TIGER 2025 publishes congressional districts per state only; there is no
tl_2025_us_cd119.zip (checked 2026-09-08, 404, 112 per-state files present). The 113th
Congress is the reverse: national only.

AZ-264 is the fourth prop and the only line among them. The Arizona beat drives a dot east
along the corridor while the clock changes under it, and that road has to be the real one:
a stylised highway would be the single fabricated geometry in a film about real lines,
which is why the scene previously drew no road at all. TIGER publishes it — Arizona's
primary and secondary roads, FULLNAME "State Hwy 264" — so the corridor can be shown
without inventing a metre of it.

Which zone each stretch of road falls in is computed here rather than asserted, by testing
every vertex against fedadmin_time_zone, the same file the scene draws. The clock in the
animation therefore changes exactly where the polygons say it changes.

Writes:
    app/public/data/derived/scene_places.geojson    Tulsa, Paradise, Las Vegas
    app/public/data/derived/gerrymander.geojson     IL-4 (119th), NC-12 (113th)
    app/public/data/derived/az264.geojson           AZ-264, split into time zone runs
    qa/scene_props.md                               provenance

Usage:
    python3 scripts/fetch_scene_props.py
    python3 scripts/fetch_scene_props.py --skip-gerrymander   # skips a 39 MB download
    python3 scripts/fetch_scene_props.py --only az264
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw_props"
OUT = ROOT / "app" / "public" / "data" / "derived"
LOG = ROOT / "qa" / "scene_props.md"

UA = "us-boundary-stack/0.1 (Ground Truth Lab; matt@wherobots.com)"
TIGER = "https://www2.census.gov/geo/tiger"

# (key, url, what we pull out of it)
SOURCES = {
    "ok_place":  f"{TIGER}/TIGER2025/PLACE/tl_2025_40_place.zip",
    "nv_place":  f"{TIGER}/TIGER2025/PLACE/tl_2025_32_place.zip",
    "il_cd119":  f"{TIGER}/TIGER2025/CD/tl_2025_17_cd119.zip",
    "us_cd113":  f"{TIGER}/TIGER2013/CD/tl_2013_us_cd113.zip",
    "az_roads":  f"{TIGER}/TIGER2025/PRISECROADS/tl_2025_04_prisecroads.zip",
}

# The time zone layer the Arizona scene draws. The road is classified against this exact
# file, so the animation and the polygons under it can never disagree.
TZ_FILE = ROOT / "app" / "public" / "data" / "fedadmin_time_zone.geojson"
# Which nation each stretch is on, so the clock can name it. Also derived, not asserted.
LAND_FILE = ROOT / "app" / "public" / "data" / "derived" / "navajo_hopi.geojson"
AZ_ZONES = ("America/Denver", "America/Phoenix")

# A run of road shorter than this is folded into its neighbour. Two exist — a single vertex
# at the western terminus and a 70 m sliver near Moenkopi — and both are artefacts of where
# a polygon edge happens to cut the centreline, not anywhere a driver changes their watch.
# Every other run is over a kilometre. The raw count is reported either way.
MIN_RUN_KM = 0.5


def fetch(key: str, url: str) -> tuple[Path, str]:
    RAW.mkdir(parents=True, exist_ok=True)
    dest = RAW / f"{key}__{url.rsplit('/', 1)[-1]}"
    if not dest.exists():
        print(f"  downloading {dest.name} …", flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    else:
        print(f"  {dest.name} already on disk (raw is immutable)")
    sha = hashlib.sha256(dest.read_bytes()).hexdigest()
    return dest, sha


def read_zip(path: Path) -> gpd.GeoDataFrame:
    with zipfile.ZipFile(path) as z:
        shp = next(n for n in z.namelist() if n.endswith(".shp"))
    return gpd.read_file(f"zip://{path}!{shp}", engine="pyogrio").to_crs(4326)


def write(gdf: gpd.GeoDataFrame, name: str, keep: list[str], tol: float) -> float:
    OUT.mkdir(parents=True, exist_ok=True)
    out = gdf[[c for c in keep if c in gdf.columns] + [gdf.geometry.name]].copy()
    out["geometry"] = out.geometry.simplify(tol, preserve_topology=True)
    fc = json.loads(out.to_json())

    def rnd(o):
        if isinstance(o, list):
            return [rnd(x) for x in o]
        return round(o, 5) if isinstance(o, float) else o

    for f in fc["features"]:
        f.pop("id", None)
        if f.get("geometry"):
            f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    blob = json.dumps(fc, separators=(",", ":"))
    (OUT / name).write_text(blob)
    return len(blob) / 1e6


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle-ish distance, good to a metre over a stretch of highway."""
    kx = 111.32 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110.57)


def az264_centreline(roads: gpd.GeoDataFrame) -> list[tuple[float, float]]:
    """AZ-264 as one continuous path, ordered west to east.

    TIGER holds the route as 11 separate features which merge into 9 pieces, four of which
    are the two carriageways of a divided stretch digitised twice. Chaining without
    dropping the duplicates walks the same 9 km of road twice and the dot doubles back, so
    pieces whose extent repeats one already taken are skipped. What is left chains end to
    end from the US-160 junction near Tuba City to Window Rock.
    """
    from shapely.geometry import MultiLineString
    from shapely.ops import linemerge

    sel = roads[roads["FULLNAME"].astype(str).str.replace("Rte", "Hwy") == "State Hwy 264"]
    if sel.empty:
        raise ValueError("no AZ-264 features in the Arizona roads file")
    merged = linemerge(MultiLineString(list(sel.geometry)))
    pieces = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]

    seen: set[tuple[float, ...]] = set()
    path: list[tuple[float, float]] = []
    for piece in sorted(pieces, key=lambda g: g.bounds[0]):
        key = tuple(round(v, 3) for v in piece.bounds)
        if key in seen:
            continue
        seen.add(key)
        pts = [(float(x), float(y)) for x, y in piece.coords]
        if pts[0][0] > pts[-1][0]:
            pts.reverse()
        if path and path[-1] == pts[0]:
            pts = pts[1:]
        path.extend(pts)
    return path


def build_az264(roads: gpd.GeoDataFrame) -> tuple[float, list[str]]:
    """Split the centreline into runs of constant time zone and write them out."""
    from shapely.geometry import Point

    path = az264_centreline(roads)
    cum = [0.0]
    for i in range(1, len(path)):
        cum.append(cum[-1] + km(path[i - 1], path[i]))
    total = cum[-1]

    if not TZ_FILE.exists():
        raise FileNotFoundError(
            f"{TZ_FILE} is missing — run scripts/export_web.py first, the road is "
            "classified against the same time zone file the scene draws")
    tz = gpd.read_file(TZ_FILE)
    tz = tz[tz["std_name"].isin(AZ_ZONES)]

    zones = []
    for x, y in path:
        hit = tz[tz.contains(Point(x, y))]
        zones.append(str(hit.iloc[0]["std_name"]) if len(hit) else None)

    runs: list[list] = []
    for i, z in enumerate(zones):
        if not runs or runs[-1][0] != z:
            runs.append([z, i, i])
        else:
            runs[-1][2] = i
    raw = len(runs)

    # Fold the artefacts into whatever they interrupt, then re-merge neighbours that have
    # become the same zone. By distance, not by vertex count: TIGER digitises bends densely,
    # so a run can be many vertices and still be 70 m of road.
    #
    # Repeatedly absorbing the shortest offender, rather than one pass forward, because a
    # single pass cannot fix the first run — there is nothing behind it to fold into, and
    # the westernmost run here is a single vertex at the US-160 junction. It survived, and
    # the drive opened by announcing a zone it was in for no distance at all.
    kept = [list(r) for r in runs]
    while len(kept) > 1:
        lengths = [cum[b] - cum[a] for _, a, b in kept]
        i = min(range(len(kept)), key=lambda j: lengths[j])
        if lengths[i] >= MIN_RUN_KM:
            break
        # Absorb into the longer neighbour, so a sliver never redefines a real stretch.
        if i == 0:
            j = 1
        elif i == len(kept) - 1:
            j = i - 1
        else:
            j = i - 1 if lengths[i - 1] >= lengths[i + 1] else i + 1
        lo, hi = min(i, j), max(i, j)
        kept[lo] = [kept[j][0], kept[lo][1], kept[hi][2]]
        del kept[hi]
        # Two stretches of the same zone can now be adjacent; make them one run.
        merged: list[list] = []
        for run in kept:
            if merged and merged[-1][0] == run[0]:
                merged[-1][2] = run[2]
            else:
                merged.append(run)
        kept = merged

    # Name the nation under each run from its midpoint. Hopi is tested first because the
    # Hopi Reservation sits inside the Navajo Nation and a point in it is in both.
    land = gpd.read_file(LAND_FILE) if LAND_FILE.exists() else None

    def land_at(i: int, j: int) -> str | None:
        if land is None:
            return None
        mid = path[(i + j) // 2]
        for order in (1, 0):
            sel = land[land["order"] == order]
            if len(sel) and sel.contains(Point(*mid)).any():
                return str(sel.iloc[0]["NAME"])
        return None

    feats = []
    for seq, (zone, a, b) in enumerate(kept):
        feats.append({
            "type": "Feature",
            "properties": {
                "seq": seq,
                "std_name": zone,
                "clock": "MDT" if zone == "America/Denver" else "MST",
                # A summer afternoon: Arizona stays on standard time, so America/Denver
                # reads an hour ahead of America/Phoenix for half the year.
                "time": "2:00" if zone == "America/Denver" else "1:00",
                "land": land_at(a, b),
                "t0": round(cum[a] / total, 6),
                "t1": round(cum[b] / total, 6),
                "km": round(cum[b] - cum[a], 2),
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(x, 5), round(y, 5)] for x, y in path[a:b + 1]],
            },
        })

    OUT.mkdir(parents=True, exist_ok=True)
    blob = json.dumps({"type": "FeatureCollection", "features": feats},
                      separators=(",", ":"))
    (OUT / "az264.geojson").write_text(blob)

    notes = [
        f"AZ-264: {total:.1f} km ({total / 1.609344:.0f} miles), {len(path):,} vertices",
        f"time zone runs: {raw} raw, {len(kept)} after folding runs under {MIN_RUN_KM} km",
    ]
    for zone, a, b in kept:
        notes.append(f"  {str(zone).split('/')[-1]:<8} {cum[b] - cum[a]:7.2f} km "
                     f"from {cum[a]:6.1f} km   {land_at(a, b) or '—'}")
    return len(blob) / 1e6, notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-gerrymander", action="store_true")
    ap.add_argument("--only", choices=["places", "gerrymander", "az264"],
                    help="build just one prop, leaving the others alone")
    args = ap.parse_args()
    want = lambda name: args.only in (None, name)

    receipts, failures = [], []

    def grab(key: str) -> gpd.GeoDataFrame:
        path, sha = fetch(key, SOURCES[key])
        receipts.append({"key": key, "url": SOURCES[key], "sha256": sha,
                         "bytes": path.stat().st_size, "retrieved_at": date.today().isoformat()})
        return read_zip(path)

    # ── places ────────────────────────────────────────────────────────────────
    if want("places"):
      try:
        ok = grab("ok_place")
        nv = grab("nv_place")
        want = [("Tulsa", ok), ("Paradise", nv), ("Las Vegas", nv)]
        rows = []
        for name, src in want:
            hit = src[src["NAME"] == name]
            if hit.empty:
                failures.append(f"{name} not found in its TIGER place file")
                continue
            # Paradise appears as a CDP; Las Vegas and Tulsa as incorporated places.
            hit = hit.iloc[[hit.to_crs(5070).geometry.area.argmax()]].copy()
            hit["std_name"] = name
            hit["kind"] = "cdp" if hit.iloc[0].get("LSAD") == "57" else "incorporated"
            rows.append(hit)
            print(f"  {name:11} {hit.iloc[0]['kind']:14} "
                  f"{hit.to_crs(5070).geometry.area.iloc[0] / 2.59e6:,.0f} sq mi")
        places = gpd.GeoDataFrame(gpd.pd.concat(rows, ignore_index=True), crs=rows[0].crs)
        mb = write(places, "scene_places.geojson", ["std_name", "kind", "NAME", "LSAD"], 0.0002)
        print(f"  wrote scene_places.geojson ({mb:.2f} MB)\n")
      except Exception as e:
        failures.append(f"places — {type(e).__name__}: {e}")

    # ── AZ-264, the only line among the props ─────────────────────────────────
    if want("az264"):
        try:
            mb, notes = build_az264(grab("az_roads"))
            for n in notes:
                print(f"  {n}")
            print(f"  wrote az264.geojson ({mb:.2f} MB)\n")
        except Exception as e:
            failures.append(f"az264 — {type(e).__name__}: {e}")

    # ── the gerrymander gallery ───────────────────────────────────────────────
    if want("gerrymander") and not args.skip_gerrymander:
        try:
            il = grab("il_cd119")
            il4 = il[il["CD119FP"] == "04"].copy()
            il4["std_name"] = "Illinois 4th (119th Congress)"
            us13 = grab("us_cd113")
            nc12 = us13[(us13["STATEFP"] == "37") & (us13["CD113FP"] == "12")].copy()
            nc12["std_name"] = "North Carolina 12th (113th Congress)"
            for g, label in ((il4, "IL-4"), (nc12, "NC-12")):
                if g.empty:
                    failures.append(f"{label} not found in its source file")
            gg = gpd.GeoDataFrame(
                gpd.pd.concat([il4[["std_name", "geometry"]], nc12[["std_name", "geometry"]]],
                              ignore_index=True), crs=4326)
            mb = write(gg, "gerrymander.geojson", ["std_name"], 0.0002)
            print(f"  wrote gerrymander.geojson: {len(gg)} districts ({mb:.2f} MB)\n")
        except Exception as e:
            failures.append(f"gerrymander — {type(e).__name__}: {e}")

    L = ["# Scene props\n",
         "Geometry fetched for individual scenes rather than added to the boundary stack.",
         "census_place is a state-36 subset by CLAUDE.md rule 6 and the locked ESB count is",
         "computed from it, so out-of-state city limits are kept out of it deliberately.",
         "AZ-264 is here for a different reason: it is a road, not a boundary, so it has no",
         "pen and belongs in no manifest — but it is a real road, downloaded like the rest,",
         "because the alternative was drawing an invented one.\n",
         "| prop | source | retrieved | bytes | sha256 |", "|---|---|---|---:|---|"]
    for r in receipts:
        L.append(f"| `{r['key']}` | {r['url']} | {r['retrieved_at']} | "
                 f"{r['bytes']:,} | `{r['sha256'][:12]}…` |")
    if failures:
        L += ["\n## Failures\n"] + [f"- {f}" for f in failures]
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text("\n".join(L) + "\n")
    print(f"  wrote {LOG.relative_to(ROOT)}")
    for f in failures:
        print(f"  FAILED — {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
