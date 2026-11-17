#!/usr/bin/env python3
"""
Build the explorer's catalog: one row per boundary type counted in the video (93 rows).

    python3 scripts/build_catalog.py               validate docs/catalog.yaml, write outputs
    python3 scripts/build_catalog.py --check-urls  also fetch every URL and record `verified`
    python3 scripts/build_catalog.py --seed        write a first docs/catalog.yaml (one-off)

Inputs
    docs/beats.yaml                the 93 counted types, in video order (rows, labels, scope)
    app/src/layers.generated.ts    the layer registry export_web.py wrote (paths, counts)
    app/public/data/**.geojson     the exported layers (feature counts, extents, the pin test)
    docs/catalog.yaml              the curated part: pens, sources, licenses, missing reasons
    ../boundaries (optional)       the data repo. Seed reads its receipts; every run
                                   cross-checks the pin test against qa/esb_final_count.md

Outputs
    app/src/catalog.generated.ts   typed rows the explorer imports
    app/public/data/catalog.csv    the same rows for download
    qa/catalog_url_check.md        only with --check-urls

Every count the page shows is computed from these rows. Nothing here hardcodes one.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
BEATS = ROOT / "docs" / "beats.yaml"
CATALOG = ROOT / "docs" / "catalog.yaml"
REGISTRY = APP / "src" / "layers.generated.ts"
OUT_TS = APP / "src" / "catalog.generated.ts"
OUT_CSV = APP / "public" / "data" / "catalog.csv"
URL_REPORT = ROOT / "qa" / "catalog_url_check.md"
DATA_REPO = Path(os.environ.get("BOUNDARY_REPO", ROOT.parent / "boundaries"))

PENS = ("congress", "statisticians", "politicians", "courts", "markets", "surveyors")
REASONS = ("buildable", "no_national_file", "licensed", "blocked", "derivable")
# Registry entries that exist only to stage a scene in the deck. Never a counted type.
SCENE_ONLY = {"esb_arc", "esb_stack", "ok_mcgirt", "yellowstone", "navajo_hopi",
              "scene_places", "gerrymander"}
# The Empire State Building, 350 Fifth Avenue. Same point as app/src/config.ts ESB.
ESB = (-73.985654, 40.748428)

HEADER = """\
# The explorer's catalog: one row per boundary type counted in the video.
#
# Rows, labels, chapter pens and scope come from docs/beats.yaml and are checked
# against it on every build. Everything else here is curated: who drew the line (pen),
# sources, licenses, and why a type has no geometry. scripts/build_catalog.py validates
# this file and writes app/src/catalog.generated.ts and app/public/data/catalog.csv.
#
#   pen          who drew the line (the explorer groups by this)
#   chapter_pen  the video chapter the type is counted in (from beats.yaml)
#   status       mapped | missing. A missing type never gets geometry.
#   filter       for two types that share one file: which features belong to this type
#   at_esb       does the type's polygon contain the Empire State Building. Mapped rows
#                are recomputed from the exported GeoJSON on every build; missing rows
#                come from the data repo's qa/esb_expected.csv, or are left out.
#   verified     the URL was fetched and returned 200 (--check-urls). false means it
#                could not be confirmed, not that it is wrong.
"""


# ── inputs ────────────────────────────────────────────────────────────────────────────

def load_beats() -> list[dict]:
    return yaml.safe_load(BEATS.read_text())["beats"]


def load_registry() -> dict[str, dict]:
    """Parse layers.generated.ts. One entry per line: `"key": { field: value, ... },`."""
    out: dict[str, dict] = {}
    field = re.compile(r'(\w+): ("(?:[^"\\]|\\.)*"|null|-?\d+)')
    for line in REGISTRY.read_text().splitlines():
        m = re.match(r'\s*"([^"]+)": \{ (.*) \},?$', line)
        if not m:
            continue
        entry = {}
        for k, v in field.findall(m.group(2)):
            entry[k] = None if v == "null" else int(v) if v.lstrip("-").isdigit() else json.loads(v)
        out[m.group(1)] = entry
    if not out:
        sys.exit(f"could not parse any entries from {REGISTRY}")
    return out


def registry_key(layer: str, scope: str) -> str:
    """Same rule as beatLayerId in app/src/scenes.ts."""
    return f"{layer}@nyc" if scope == "nyc" else layer


def load_catalog() -> list[dict]:
    return yaml.safe_load(CATALOG.read_text())["types"]


def write_catalog(rows: list[dict]) -> None:
    body = yaml.safe_dump({"types": rows}, sort_keys=False, allow_unicode=True, width=100)
    CATALOG.write_text(HEADER + "\n" + body)


# ── geometry: counts, extents and the pin test ────────────────────────────────────────

_geojson_cache: dict[str, dict] = {}


def features_for(path: str, flt: dict | None) -> list[dict]:
    if path not in _geojson_cache:
        _geojson_cache[path] = json.loads((APP / "public" / path).read_text())
    feats = _geojson_cache[path]["features"]
    if flt:
        for prop, allowed in flt.items():
            feats = [f for f in feats if str(f["properties"].get(prop)) in set(map(str, allowed))]
    return feats


def bbox(feats: list[dict]) -> list[float]:
    xs, ys = [], []
    for f in feats:
        b = shape(f["geometry"]).bounds
        xs += [b[0], b[2]]
        ys += [b[1], b[3]]
    return [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]


def pin_test(feats: list[dict]) -> tuple[bool, str | None]:
    pt = Point(*ESB)
    for f in feats:
        if shape(f["geometry"]).covers(pt):
            return True, f["properties"].get("std_name")
    return False, None


def esb_final_layers() -> set[str] | None:
    """Layer ids the data repo's locked pin count says contain the pin, or None if absent."""
    p = DATA_REPO / "qa" / "esb_final_count.md"
    if not p.exists():
        return None
    ids = set()
    for line in p.read_text().splitlines():
        m = re.match(r"\|\s*\d+\s*\|\s*`?([a-z0-9_]+)`?\s*\|", line)
        if m:
            ids.add(m.group(1))
    return ids


# ── validate ──────────────────────────────────────────────────────────────────────────

def validate(rows: list[dict], beats: list[dict], registry: dict) -> list[str]:
    errs: list[str] = []
    ns = [r["n"] for r in rows]
    if sorted(ns) != list(range(1, len(beats) + 1)) or len(ns) != len(set(ns)):
        errs.append(f"rows must be 1..{len(beats)}, each once; got {len(ns)} rows")
    by_n = {b["n"]: b for b in beats}
    for r in rows:
        n = r["n"]
        b = by_n.get(n)
        if b is None:
            errs.append(f"#{n}: not in beats.yaml")
            continue
        if r["label"] != b["label"]:
            errs.append(f"#{n}: label {r['label']!r} != beats.yaml {b['label']!r}")
        if r["chapter_pen"] != b["pen"]:
            errs.append(f"#{n}: chapter_pen {r['chapter_pen']} != beats.yaml {b['pen']}")
        if r["pen"] not in PENS:
            errs.append(f"#{n}: pen {r['pen']!r} is not one of the six")
        want = "mapped" if b["render"] == "polygon" else "missing"
        if r["status"] != want:
            errs.append(f"#{n}: status {r['status']} but beats.yaml render is {b['render']}")
        if r["status"] == "mapped":
            if r["layer"] != b["layer"] or r["scope"] != b["scope"]:
                errs.append(f"#{n}: layer/scope {r['layer']}/{r['scope']} != beats.yaml "
                            f"{b['layer']}/{b['scope']}")
            if r["layer"] in SCENE_ONLY:
                errs.append(f"#{n}: {r['layer']} is a scene-only layer")
            key = registry_key(r["layer"], r["scope"])
            if key not in registry:
                errs.append(f"#{n}: {key} not in the layer registry")
            elif not (APP / "public" / registry[key]["path"]).exists():
                errs.append(f"#{n}: {registry[key]['path']} does not exist")
            for f in ("authority", "dataset", "source_url", "license", "vintage", "retrieved"):
                if not r.get(f):
                    errs.append(f"#{n}: mapped row has no {f}")
            if r.get("missing_reason"):
                errs.append(f"#{n}: mapped row has a missing_reason")
        else:
            if r.get("layer"):
                errs.append(f"#{n}: missing row names a layer; never fake a polygon")
            if r.get("missing_reason") not in REASONS:
                errs.append(f"#{n}: missing row needs a reason in {REASONS}")
            if not r.get("missing_note"):
                errs.append(f"#{n}: missing row needs a missing_note")
            if r.get("missing_reason") == "buildable" and not r.get("candidate_source"):
                errs.append(f"#{n}: buildable row needs a candidate_source")
        for k, v in r.items():
            if isinstance(v, str) and "—" in v:
                errs.append(f"#{n}: {k} contains an em dash")
    return errs


# ── outputs ───────────────────────────────────────────────────────────────────────────

def enrich(rows: list[dict], registry: dict) -> tuple[list[dict], list[str]]:
    """Add what is computed, not curated: path, feature count, extent, the pin test."""
    out, notes = [], []
    final = esb_final_layers()
    for r in rows:
        r = dict(r)
        r["path"] = r["features"] = r["extent"] = None
        if r["status"] == "mapped":
            key = registry_key(r["layer"], r["scope"])
            path = registry[key]["path"]
            feats = features_for(path, r.get("filter"))
            hit, name = pin_test(feats)
            r.update(path=path, features=len(feats), extent=bbox(feats))
            if r.get("at_esb") is not None and r["at_esb"] != hit:
                notes.append(f"#{r['n']}: catalog.yaml at_esb={r['at_esb']} but the pin test "
                             f"says {hit}; using the pin test")
            r["at_esb"], r["esb_value"] = hit, name
        out.append(r)
    # Compare per layer, not per row: the locked count tests each file once, and two
    # types that share a file (#14/#17) split one hit between them.
    if final is not None:
        hit_layers = {r["layer"] for r in out if r["status"] == "mapped" and r["at_esb"]}
        type_layers = {r["layer"] for r in out if r["status"] == "mapped"}
        for lid in sorted(hit_layers - final):
            notes.append(f"{lid}: contains the pin here, but not in qa/esb_final_count.md")
        for lid in sorted((final & type_layers) - hit_layers):
            notes.append(f"{lid}: in qa/esb_final_count.md, but no type's pin test hits it")
        for lid in sorted(final - type_layers):
            notes.append(f"{lid}: in qa/esb_final_count.md but is not a counted type (expected "
                         "for nyc_borough, the reveal's second Manhattan)")
    return out, notes


TS_HEAD = """\
// GENERATED by scripts/build_catalog.py from docs/catalog.yaml and docs/beats.yaml.
// Do not hand-edit: change docs/catalog.yaml and rerun `python3 scripts/build_catalog.py`.

import type { Pen } from './pens';

export type CatalogStatus = 'mapped' | 'missing';
export type MissingReason = 'buildable' | 'no_national_file' | 'licensed' | 'blocked' | 'derivable';

export interface CandidateSource {
  name: string; maintainer: string; url: string | null; verified: boolean;
}

export interface CatalogRow {
  /** The type's number in the video's counter, 1..93. */
  n: number;
  label: string;
  /** Who drew the line. */
  pen: Pen;
  /** The video chapter it is counted in. */
  chapterPen: Pen;
  penNote: string | null;
  status: CatalogStatus;
  scope: 'national' | 'nyc' | null;
  layer: string | null;
  /** Site-relative GeoJSON path, mapped rows only. */
  path: string | null;
  /** Feature property → allowed values, for two types that share one file. */
  filter: Record<string, string[]> | null;
  features: number | null;
  extent: [number, number, number, number] | null;
  authority: string | null;
  dataset: string | null;
  sourceUrl: string | null;
  derivation: string | null;
  inputUrl: string | null;
  license: string | null;
  vintage: string | null;
  retrieved: string | null;
  verified: boolean | null;
  atEsb: boolean | null;
  esbValue: string | null;
  missingReason: MissingReason | null;
  missingNote: string | null;
  keeper: string | null;
  candidate: CandidateSource | null;
}

"""


def ts_row(r: dict) -> dict:
    c = r.get("candidate_source")
    return {
        "n": r["n"], "label": r["label"], "pen": r["pen"], "chapterPen": r["chapter_pen"],
        "penNote": r.get("pen_note"), "status": r["status"], "scope": r.get("scope"),
        "layer": r.get("layer"), "path": r.get("path"), "filter": r.get("filter"),
        "features": r.get("features"), "extent": r.get("extent"),
        "authority": r.get("authority"), "dataset": r.get("dataset"),
        "sourceUrl": r.get("source_url"), "derivation": r.get("derivation"),
        "inputUrl": r.get("input_url"), "license": r.get("license"),
        "vintage": None if r.get("vintage") is None else str(r["vintage"]),
        "retrieved": None if r.get("retrieved") is None else str(r["retrieved"]),
        "verified": r.get("verified"), "atEsb": r.get("at_esb"),
        "esbValue": r.get("esb_value"), "missingReason": r.get("missing_reason"),
        "missingNote": r.get("missing_note"), "keeper": r.get("keeper"),
        "candidate": None if not c else {
            "name": c["name"], "maintainer": c["maintainer"], "url": c.get("url"),
            "verified": bool(c.get("verified")),
        },
    }


def write_ts(rows: list[dict]) -> None:
    lines = [TS_HEAD, "export const CATALOG: CatalogRow[] = ["]
    for r in rows:
        lines.append("  " + json.dumps(ts_row(r), ensure_ascii=False) + " as CatalogRow,")
    lines.append("];\n")
    OUT_TS.write_text("\n".join(lines))


CSV_COLS = ["n", "label", "pen", "chapter_pen", "status", "scope", "layer", "authority",
            "dataset", "vintage", "retrieved", "license", "source_url", "derivation",
            "input_url", "verified", "features", "at_esb", "esb_value", "missing_reason",
            "missing_note", "keeper", "candidate_name", "candidate_maintainer",
            "candidate_url", "candidate_verified"]


def write_csv(rows: list[dict]) -> None:
    with OUT_CSV.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_COLS)
        w.writeheader()
        for r in rows:
            c = r.get("candidate_source") or {}
            w.writerow({
                **{k: r.get(k) for k in CSV_COLS if k in r},
                "candidate_name": c.get("name"), "candidate_maintainer": c.get("maintainer"),
                "candidate_url": c.get("url"), "candidate_verified": c.get("verified"),
            })


def review_table(rows: list[dict]) -> str:
    """The Gate 1 table: one line per type, for a person to approve pens and reasons."""
    def link(url: str | None, ok: bool | None) -> str:
        if not url:
            return "none"
        host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
        return f"[{host}]({url})" + ("" if ok else " (unverified)")

    out = ["| # | Boundary | Pen | Chapter | Status | Why missing / source |",
           "|---:|---|---|---|---|---|"]
    for r in rows:
        flag = " ⚑" if r["pen"] != r["chapter_pen"] else ""
        unsure = " ?" if (r.get("pen_note") or "").startswith("Least certain") else ""
        if r["status"] == "mapped":
            status = "US" if r["scope"] == "national" else "NYC"
            detail = f"{r.get('dataset')}: {link(r.get('source_url'), r.get('verified'))}"
        else:
            status = "missing"
            c = r.get("candidate_source") or {}
            detail = f"**{r['missing_reason']}**. {r['missing_note']}"
            if c:
                detail += f" Candidate: {c.get('name')}, {link(c.get('url'), c.get('verified'))}"
            if r.get("registry_pen") and r["registry_pen"] != r["pen"]:
                detail += f" *(layers.yaml says {r['registry_pen']})*"
        out.append(f"| {r['n']} | {r['label']} | {r['pen']}{flag}{unsure} | "
                   f"{r['chapter_pen']} | {status} | {detail} |")
    return "\n".join(out)


# ── URL checks ────────────────────────────────────────────────────────────────────────

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def fetch_status(url: str) -> int | str:
    """200 if any attempt gets a 200 or 206, else the last attempt's status or error.

    Some hosts refuse a browser user-agent (fema.gov) and others refuse anything else, so
    both are tried, each with HEAD then a 1 KB ranged GET.
    """
    last: int | str = "unknown"
    for ua in ("boundaries-catalog-check/1.0", UA):
        for method, headers in (("HEAD", {}), ("GET", {"Range": "bytes=0-1023"})):
            req = urllib.request.Request(url, method=method, headers={"User-Agent": ua, **headers})
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    if res.status in (200, 206):
                        return 200
                    last = res.status
            except urllib.error.HTTPError as e:
                last = e.code
            except Exception as e:  # noqa: BLE001 - any failure is just "not verified"
                last = type(e).__name__
    # Last, curl itself: some hosts (fema.gov) fingerprint Python's TLS client, and some
    # (acq.osd.mil) serve a certificate chain only the system store accepts.
    for flags in (["-I"], ["-r", "0-1023"]):
        try:
            code = subprocess.run(
                ["curl", "-sL", *flags, "-o", "/dev/null", "-w", "%{http_code}",
                 "--max-time", "30", url], capture_output=True, text=True, timeout=40,
            ).stdout.strip()
        except Exception:  # noqa: BLE001
            continue
        if code in ("200", "206"):
            return 200
        last = int(code) if code.isdigit() and code != "000" else last
    return last


def check_urls(rows: list[dict]) -> None:
    seen: dict[str, int | str] = {}
    report = ["# Catalog URL check", "",
              f"Run {dt.datetime.now().isoformat(timespec='seconds')} by "
              "`scripts/build_catalog.py --check-urls`. HEAD, then a ranged GET if HEAD fails. "
              "Only a 200 (or 206) counts as verified.", "",
              "| # | field | status | url |", "|---|---|---|---|"]

    def check(n: int, field: str, url: str | None) -> bool | None:
        if not url:
            return None
        if url not in seen:
            seen[url] = fetch_status(url)
            time.sleep(0.5)
        s = seen[url]
        report.append(f"| {n} | {field} | {s} | {url} |")
        return s == 200

    for r in rows:
        ok = [check(r["n"], f, r.get(f)) for f in ("source_url", "input_url")]
        ok = [x for x in ok if x is not None]
        if r["status"] == "mapped":
            r["verified"] = bool(ok) and all(ok)
        c = r.get("candidate_source")
        if c:
            v = check(r["n"], "candidate", c.get("url"))
            c["verified"] = bool(v)
    bad = [line for line in report[6:] if "| 200 |" not in line]
    report += ["", f"{len(seen)} distinct URLs, {len(bad)} rows not verified."]
    URL_REPORT.write_text("\n".join(report) + "\n")
    print(f"checked {len(seen)} URLs; {len(bad)} rows not verified (see {URL_REPORT.relative_to(ROOT)})")


# ── seed (one-off) ────────────────────────────────────────────────────────────────────

# Who drew the line, for the 41 types with no geometry (draft from the Nov 16 handoff,
# Appendix A). Mapped types take the registry's pen, except the two overrides below.
SEED_MISSING_PEN = {
    24: "politicians", 25: "politicians", 27: "politicians", 28: "politicians",
    29: "politicians", 36: "congress", 38: "congress", 39: "congress", 40: "congress",
    41: "markets", 44: "markets", 45: "markets", 46: "markets", 47: "markets",
    49: "congress", 50: "congress", 53: "congress", 54: "congress", 55: "congress",
    57: "surveyors", 58: "surveyors", 59: "congress", 60: "congress", 62: "markets",
    63: "markets", 64: "markets", 67: "politicians", 69: "politicians", 70: "politicians",
    72: "politicians", 73: "politicians", 74: "politicians", 80: "surveyors",
    84: "surveyors", 86: "surveyors", 87: "statisticians", 88: "surveyors",
    89: "politicians", 91: "congress", 92: "politicians", 93: "congress",
}
SEED_PEN_OVERRIDE = {
    1: ("congress", "The file is derived from the states, which is why the registry says "
                    "statisticians, but the national border is set by treaty and statute."),
    9: ("statisticians", "Shares the census_place file with #5, but this type includes the "
                         "census designated places, which only the Census Bureau draws."),
}
SEED_UNSURE = {
    36: "Least certain: Congress drew these in ANCSA 1971, but they could sit with the courts.",
    55: "Least certain: Congress created them in the 2017 tax law, governors nominated the "
        "tracts and Treasury certified them.",
    93: "Least certain: Congress if this means the federal EDA districts, the politicians if "
        "it means state regions.",
}
# The data repo's planned layer for a missing type, and the pen layers.yaml gives it.
SEED_PLANNED = {
    27: ("nces_sabs", "politicians"), 36: ("census_anrc", "statisticians"),
    38: ("padus_fed_land", "congress"), 39: ("padus_fed_land", "congress"),
    41: ("energy_interconnection", "markets"), 44: ("energy_nyiso_zone", "markets"),
    45: ("energy_nerc_region", "markets"), 46: ("energy_utility_territory", "markets"),
    49: ("fedadmin_frb_district", "congress"), 50: ("fedadmin_fhlb_district", "congress"),
    53: ("fedadmin_std_federal_region", "congress"), 55: ("hud_opportunity_zone", "congress"),
    57: ("nws_cwa", "surveyors"), 58: ("nws_fire_zone", "surveyors"),
    59: ("faa_artcc", "markets"), 60: ("faa_class_airspace", "markets"),
    62: ("telecom_area_code", "markets"), 63: ("media_dma", "markets"),
    64: ("fcc_contours", "markets"), 80: ("usgs_wbd_huc4", "surveyors"),
    84: ("epa_ecoregion_l4", "surveyors"), 86: ("usda_soil_survey_area", "surveyors"),
    87: ("usda_crop_district", "surveyors"), 88: ("blm_plss", "surveyors"),
    89: ("nyc_historic_district", "politicians"), 91: ("nps_nrhp", "congress"),
}
SEED_REASON = {
    "no national file exists": "no_national_file",
    "drawn state by state, no national file": "no_national_file",
    "39,500 of them, no single file": "no_national_file",
    "privately licensed. Not shippable.": "licensed",
    "privately owned. Not licensable.": "licensed",
    "the source blocks automated access": "blocked",
    "derivable from balancing authorities": "derivable",
}
SEED_NOTE = {
    "buildable": "A public file exists. I haven't added it to the stack yet.",
    "no_national_file": "Nobody publishes a national file. These lines are drawn place by "
                        "place, and each one is kept separately.",
}
SEED_NOTE_N = {
    25: "Nobody publishes a national file. Each state draws its own.",
    27: "The Department of Education collected attendance zones once, for 2015-16. That "
        "file is public but out of date, and it isn't in the stack.",
    41: "There are three: Eastern, Western and Texas. They could be drawn from the "
        "balancing authorities already on this map, but I haven't done it.",
    49: "The Kansas City Fed publishes a county file, but its site blocks automated "
        "downloads, so it isn't in the stack yet.",
    62: "The boundaries are sold by private data vendors. I can't publish them.",
    63: "Nielsen owns the map and licenses it. I can't publish it.",
    80: "Watershed regions (#79) are on the map. Subregions come from the same USGS file, "
        "but I haven't added them.",
    84: "Level 3 ecoregions (#83) are on the map. Level 4 is a public file I haven't added.",
    92: "There are about 39,500 of them and no single file.",
}
SEED_KEEPER = {
    24: "Each county", 25: "Each state legislature", 27: "Each school district",
    28: "Each state, under its school law", 29: "Each state, under its school law",
    36: "Set by the Alaska Native Claims Settlement Act of 1971",
    38: "US Forest Service", 39: "Bureau of Land Management", 40: "Department of Defense",
    41: "The grid's owners, overseen by NERC and FERC",
    44: "Each grid operator, such as NYISO or PJM",
    45: "NERC and its regional entities, approved by FERC",
    46: "State utility commissions", 47: "State utility commissions",
    49: "Federal Reserve, under the Federal Reserve Act of 1913",
    50: "Federal Housing Finance Agency, under the Federal Home Loan Bank Act of 1932",
    53: "Office of Management and Budget", 54: "US Customs and Border Protection",
    55: "US Treasury, from tracts the governors nominated",
    57: "National Weather Service", 58: "National Weather Service",
    59: "Federal Aviation Administration", 60: "Federal Aviation Administration",
    62: "North American Numbering Plan Administrator", 63: "Nielsen",
    64: "Federal Communications Commission", 67: "Counties, cities and fire districts",
    69: "Local water authorities", 70: "Local sewer authorities",
    72: "Local library boards", 73: "City councils",
    74: "Counties and local district boards", 80: "US Geological Survey",
    84: "US Environmental Protection Agency", 86: "USDA Natural Resources Conservation Service",
    87: "USDA National Agricultural Statistics Service", 88: "Bureau of Land Management",
    89: "Local landmark commissions and the National Park Service",
    91: "National Park Service, for the Secretary of the Interior",
    92: "Thousands of local boards set up under state law",
    93: "US Economic Development Administration",
}
# Missing types the data repo's qa/esb_expected.csv gives an expected value at the pin for.
SEED_ESB_EXPECTED = {
    44: "energy_nyiso_zone", 45: "energy_nerc_region", 46: "energy_utility_territory",
    49: "fedadmin_frb_district", 50: "fedadmin_fhlb_district", 57: "nws_cwa",
    91: "nps_nrhp",
}
# Two types share a file; this is which features belong to each.
SEED_FILTER = {
    5: {"LSAD": ["25", "47"]},   # incorporated places: cities and villages
    14: {"LSAD": ["M1"]},        # metropolitan
    17: {"LSAD": ["M2"]},        # micropolitan
}
TIGER_NAMES = {
    "STATE": "States", "COUNTY": "Counties", "COUSUB": "County subdivisions (New York)",
    "TRACT": "Census tracts (New York)", "BG": "Block groups (New York)",
    "TABBLOCK20": "2020 census blocks (New York)", "PLACE": "Places (New York)",
    "ZCTA520": "ZIP code tabulation areas", "PUMA20": "2020 PUMAs (New York)",
    "UAC20": "2020 urban areas", "CD": "119th Congress districts (New York)",
    "SLDU": "State senate districts (New York)", "SLDL": "State assembly districts (New York)",
    "UNSD": "Unified school districts (New York)", "CBSA": "Core based statistical areas",
    "CSA": "Combined statistical areas", "METDIV": "Metropolitan divisions",
    "AIANNH": "American Indian, Alaska Native and Native Hawaiian areas",
}
# Derived layers: (reference page key in sources.json, input layer, how it was built)
SEED_DERIVED = {
    "census_nation": (None, "census_state", "Dissolved from the TIGER/Line 2025 state polygons."),
    "census_region": ("d12", "census_state", "TIGER/Line 2025 states grouped into the four Census regions."),
    "census_division": ("d12", "census_state", "TIGER/Line 2025 states grouped into the nine Census divisions."),
    "courts_fed_district": ("d33", "census_county", "TIGER/Line 2025 counties grouped by 28 USC 81-131, using the crosswalk scripts/crosswalks/county_fed_district.csv in the data repo."),
    "courts_fed_circuit": ("d34", "census_county", "Federal districts grouped into circuits by 28 USC 41, using scripts/crosswalks/county_fed_district.csv in the data repo."),
    "courts_ny_judicial_district": ("d31", "census_county", "TIGER/Line 2025 counties grouped into New York's judicial districts, using scripts/crosswalks/ny_county_judicial_district.csv in the data repo."),
    "courts_ny_appellate_dept": ("d32", "census_county", "Judicial districts grouped into Appellate Division departments, using scripts/crosswalks/ny_county_judicial_district.csv in the data repo."),
    "fedadmin_fema_region": ("d51", "census_state", "TIGER/Line 2025 states grouped into FEMA's ten regions, using scripts/crosswalks/state_fema_region.csv in the data repo."),
    "fedadmin_epa_region": ("d52", "census_state", "TIGER/Line 2025 states grouped into EPA's ten regions, using scripts/crosswalks/state_epa_region.csv in the data repo."),
    "fedadmin_padd": ("d48", "census_state", "TIGER/Line 2025 states grouped into EIA's five PADDs, using scripts/crosswalks/state_padd.csv in the data repo."),
}
# Dataset names for layers that are neither TIGER downloads nor derived. NYC titles are
# the Socrata dataset names (api/views/<id>.json), checked 2026-11-16.
SEED_DATASET = {
    "energy_balancing_authority": "HIFLD Control Areas (2021), archived on ICPSR DataLumos",
    "energy_rto_iso": "HIFLD Independent System Operators (2020), archived on ICPSR DataLumos",
    "fedadmin_time_zone": "timezone-boundary-builder, release 2026c",
    "nps_boundary": "NPS Land Resources Division unit boundaries",
    "nws_forecast_zone": "NWS public forecast zones (z_16ap26)",
    "fema_flood_nfhl": "National Flood Hazard Layer, flood hazard zones",
    "usgs_wbd_huc2": "Watershed Boundary Dataset, 2-digit HUCs",
    "usgs_wbd_huc8": "Watershed Boundary Dataset, 8-digit HUCs",
    "usgs_wbd_huc12": "Watershed Boundary Dataset, 12-digit HUCs",
    "epa_ecoregion_l3": "Level III ecoregions of the continental United States",
    "usda_hardiness_zone": "2023 USDA Plant Hardiness Zone Map",
    "nyc_community_district": "NYC Open Data: Community Districts",
    "nyc_council_district": "NYC Open Data: City Council Districts",
    "nyc_election_district": "NYC Open Data: Election Districts",
    "nyc_police_precinct": "NYC Open Data: Police Precincts",
    "nyc_fire_battalion": "NYC Open Data: Fire Battalions",
    "nyc_sanitation_district": "NYC Open Data: DSNY Districts",
    "nyc_school_district": "NYC Open Data: School Districts",
    "nyc_zoning_district": "NYC GIS Zoning Features, June 2026: zoning districts",
    "nyc_special_purpose_district": "NYC GIS Zoning Features, June 2026: special purpose districts",
    "nyc_bid": "NYC Open Data: Business Improvement Districts",
    "nyc_landmark_lot": "NYC Open Data: Individual Landmark Sites",
}
PD = "Public domain (US government work)"
# Checked before the prefixes: the time zone file is a fedadmin_ layer but is ODbL.
SEED_LICENSE_LAYER = {
    "fedadmin_time_zone": "ODbL-1.0 (attribution required)",
    "usda_hardiness_zone": "Free to reproduce with credit to the PRISM Group, Oregon State "
                           "University, and USDA-ARS",
    "energy_balancing_authority": "Public domain (US government work), archived by ICPSR DataLumos",
    "energy_rto_iso": "Public domain (US government work), archived by ICPSR DataLumos",
}
SEED_LICENSE_PREFIX = {
    "census_": PD, "courts_": PD, "fedadmin_": PD, "nws_": PD, "usgs_": PD, "epa_": PD,
    "fema_": PD, "nps_": PD, "nyc_": "NYC Open Data terms of use",
}


def seed(beats: list[dict], registry: dict, sources: dict) -> list[dict]:
    receipts = json.loads((DATA_REPO / "data" / "raw" / "_receipts.json").read_text())["latest"]
    expected = {}
    exp_path = DATA_REPO / "qa" / "esb_expected.csv"
    for row in csv.DictReader(exp_path.open()):
        expected[row["layer_id"]] = row

    def src(key: str) -> dict:
        return sources.get(key) or {}

    rows = []
    for b in beats:
        n = b["n"]
        r: dict = {"n": n, "label": b["label"], "pen": None, "chapter_pen": b["pen"],
                   "pen_note": None, "status": None}
        if b["render"] == "polygon":
            key = registry_key(b["layer"], b["scope"])
            reg = registry[key]
            pen, note = SEED_PEN_OVERRIDE.get(n, (reg["pen"], None))
            r.update(pen=pen, pen_note=note, status="mapped", scope=b["scope"], layer=b["layer"])
            if n in SEED_FILTER:
                r["filter"] = SEED_FILTER[n]
            lid = b["layer"]
            rec = receipts.get(lid)
            r["authority"] = reg["authority"]
            if lid in SEED_DERIVED:
                ref, inp, how = SEED_DERIVED[lid]
                r["dataset"] = how.split(",")[0].split(" using")[0].rstrip(".")
                r["source_url"] = src(ref).get("url") if ref else receipts[inp]["source_url"]
                r["derivation"] = how
                r["input_url"] = receipts[inp]["source_url"]
            elif rec and "/tiger/" in rec["source_url"].lower():
                folder = rec["source_url"].split("/")[-2]
                r["dataset"] = f"TIGER/Line 2025: {TIGER_NAMES.get(folder, folder)}"
                r["source_url"] = rec["source_url"]
            else:
                r["dataset"] = SEED_DATASET.get(lid)
                r["source_url"] = reg["sourceUrl"]
            r["license"] = SEED_LICENSE_LAYER.get(lid) or next(
                (v for p, v in SEED_LICENSE_PREFIX.items() if lid.startswith(p)), None)
            r["vintage"] = reg["vintage"]
            r["retrieved"] = (rec or {}).get("retrieved_at") or reg["retrievedAt"]
            r["verified"] = None
        else:
            reason = SEED_REASON.get(b["card_sub"], "buildable")
            r.update(pen=SEED_MISSING_PEN[n], pen_note=SEED_UNSURE.get(n), status="missing",
                     scope=None, layer=None)
            if n in SEED_PLANNED:
                r["planned_layer"], r["registry_pen"] = SEED_PLANNED[n]
            r["missing_reason"] = reason
            r["missing_note"] = SEED_NOTE_N.get(n) or SEED_NOTE.get(reason)
            r["keeper"] = SEED_KEEPER[n]
            c = src(f"k{n}")
            if c:
                r["candidate_source"] = {"name": c.get("name"), "maintainer": c.get("maintainer"),
                                         "url": c.get("url"), "verified": bool(c.get("verified")),
                                         "license": c.get("license")}
                if c.get("note"):
                    r["candidate_source"]["note"] = c["note"]
            if n in SEED_ESB_EXPECTED and SEED_ESB_EXPECTED[n] in expected:
                e = expected[SEED_ESB_EXPECTED[n]]
                r["at_esb"] = True
                r["esb_value"] = e["expected_std_name"]
                r["esb_evidence"] = f"expected, not tested: qa/esb_expected.csv ({e['confidence']})"
        rows.append({k: v for k, v in r.items()})
    return rows


# ── main ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", action="store_true", help="write a first docs/catalog.yaml")
    ap.add_argument("--sources", type=Path, help="with --seed: researched sources JSON")
    ap.add_argument("--check-urls", action="store_true", help="fetch every URL, record verified")
    ap.add_argument("--force", action="store_true", help="with --seed: overwrite catalog.yaml")
    ap.add_argument("--table", type=Path, help="also write the review table (markdown) here")
    args = ap.parse_args()

    beats, registry = load_beats(), load_registry()

    if args.seed:
        if CATALOG.exists() and not args.force:
            sys.exit(f"{CATALOG.relative_to(ROOT)} exists; pass --force to overwrite it")
        sources = json.loads(args.sources.read_text()) if args.sources else {}
        write_catalog(seed(beats, registry, sources))
        print(f"seeded {CATALOG.relative_to(ROOT)}")

    rows = load_catalog()
    if args.check_urls:
        check_urls(rows)
        write_catalog(rows)

    errs = validate(rows, beats, registry)
    if errs:
        print("catalog.yaml failed validation:", *errs, sep="\n  ")
        sys.exit(1)

    rows, notes = enrich(rows, registry)
    write_ts(rows)
    write_csv(rows)
    if args.table:
        args.table.write_text(review_table(rows) + "\n")

    mapped = [r for r in rows if r["status"] == "mapped"]
    missing = [r for r in rows if r["status"] == "missing"]
    print(f"{len(rows)} boundary types · {len(mapped)} mapped "
          f"({sum(r['scope'] == 'national' for r in mapped)} national, "
          f"{sum(r['scope'] == 'nyc' for r in mapped)} NYC only) "
          f"over {len({r['layer'] for r in mapped})} layers · {len(missing)} missing")
    for reason in REASONS:
        print(f"  missing, {reason}: {sum(r['missing_reason'] == reason for r in missing)}")
    for p in PENS:
        pr = [r for r in rows if r["pen"] == p]
        print(f"  {p:13} {sum(r['status'] == 'mapped' for r in pr):2} of {len(pr):2} mapped")
    print(f"  pen differs from video chapter: {sum(r['pen'] != r['chapter_pen'] for r in rows)}")
    print(f"  at the pin (mapped, tested): {sum(bool(r.get('at_esb')) for r in mapped)}")
    unverified = [r["n"] for r in mapped if not r.get("verified")]
    print(f"  mapped rows with an unverified source: {len(unverified)} {unverified or ''}")
    for n in notes:
        print("  NOTE", n)
    print(f"wrote {OUT_TS.relative_to(ROOT)} and {OUT_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
