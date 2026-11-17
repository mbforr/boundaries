#!/usr/bin/env python3
"""
Smoke test for the layer explorer (app/explore.html).

    cd app && npm run dev                                   # in another shell
    python3 scripts/smoke_explore.py                        # the checks + screenshots
    python3 scripts/smoke_explore.py --all-layers           # also load every mapped layer
    python3 scripts/smoke_explore.py --url https://<preview>/explore.html

Checks: the counts on screen match the catalog CSV; missing types have no toggle and
never get a map layer; one layer per pen turns on and draws; an NYC-only layer from the
national view flies to the city with the toast; a missing type's drawer opens; a deep
link restores its state; no console errors and no failed requests. Screenshots go to
qa/shots/explore/ at 1440x900 and 390x844, light and dark.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "app" / "public" / "data" / "catalog.csv"
SHOTS = ROOT / "qa" / "shots" / "explore"


def catalog() -> list[dict]:
    with CSV.open() as fh:
        return list(csv.DictReader(fh))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173/explore.html")
    ap.add_argument("--all-layers", action="store_true")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    rows = catalog()
    mapped = [r for r in rows if r["status"] == "mapped"]
    missing = [r for r in rows if r["status"] == "missing"]
    SHOTS.mkdir(parents=True, exist_ok=True)
    fails: list[str] = []

    def check(ok: bool, msg: str) -> None:
        print(("  ok   " if ok else "  FAIL ") + msg)
        if not ok:
            fails.append(msg)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True,
                              args=["--use-gl=angle", "--use-angle=metal"])

        def page(w: int, h: int, query: str = ""):
            pg = b.new_page(viewport={"width": w, "height": h})
            errors: list[str] = []
            bad: list[str] = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.on("response", lambda r: bad.append(f"{r.status} {r.url}")
                  if r.status >= 400 and "/data/" in r.url else None)
            sep = "&" if "?" in args.url else "?"
            pg.goto(args.url + (sep + query if query else ""), wait_until="domcontentloaded")
            pg.wait_for_function("window.__map && window.__map.isStyleLoaded()", timeout=30000)
            return pg, errors, bad

        def settle(pg) -> None:
            pg.wait_for_function(
                "window.__explore.loading.size === 0 && window.__map.loaded()", timeout=90000)
            pg.wait_for_timeout(400)

        def has_layer(pg, n: int | str) -> bool:
            return pg.evaluate(f"!!window.__map.getLayer('ex:{n}:fill')")

        def toggle(pg, n: int | str) -> None:
            pg.click(f'.ex-row[data-n="{n}"] .ex-tog')
            settle(pg)

        # ── desktop, light ─────────────────────────────────────────────────────────
        print("desktop 1440x900, light")
        pg, errors, bad = page(1440, 900, "theme=light")
        stats = pg.inner_text("#ex-stats")
        for want in (len(rows), len(mapped), len(missing)):
            check(str(want) in stats, f"stats show {want}")
        nat = sum(r["scope"] == "national" for r in mapped)
        check(f"{nat}/{len(mapped) - nat}" in stats.replace("\n", "").replace(" ", ""),
              f"stats show {nat} national / {len(mapped) - nat} NYC")
        check(pg.locator(".ex-row").count() == len(rows), f"{len(rows)} rows listed")
        check(pg.locator('.ex-row[data-status="missing"] .ex-tog').count() == 0,
              "missing rows have no toggle")

        # One national layer per pen where the pen has one, else any mapped layer.
        per_pen: dict[str, dict] = {}
        for r in mapped:
            cur = per_pen.get(r["pen"])
            if cur is None or (cur["scope"] != "national" and r["scope"] == "national"):
                per_pen[r["pen"]] = r
        pg.evaluate("window.__map.jumpTo({center: [-97, 39.5], zoom: 3.4})")
        for pen, r in per_pen.items():
            if r["scope"] != "national":
                continue
            toggle(pg, r["n"])
            check(has_layer(pg, r["n"]), f"{pen}: #{r['n']} {r['label']} draws")

        nyc_row = next(r for r in mapped if r["scope"] == "nyc")
        pg.click(f'.ex-row[data-n="{nyc_row["n"]}"] .ex-tog')
        pg.wait_for_selector("#ex-toast:not([hidden])", timeout=3000)
        check("New York City only" in pg.inner_text("#ex-toast"), "NYC-only toast from national view")
        settle(pg)
        pg.wait_for_timeout(2500)  # the fly-to
        check(pg.evaluate("window.__map.getZoom()") > 9, "flew to New York")
        check(has_layer(pg, nyc_row["n"]), f"#{nyc_row['n']} draws")
        for pen, r in per_pen.items():
            if r["scope"] == "nyc" and not has_layer(pg, r["n"]):
                toggle(pg, r["n"])
                check(has_layer(pg, r["n"]), f"{pen}: #{r['n']} {r['label']} draws")

        m = missing[0]
        pg.click(f'.ex-row[data-n="{m["n"]}"] .ex-row-main')
        drawer = pg.inner_text("#ex-drawer")
        check("missing" in drawer.lower() and m["label"].lower() in drawer.lower(), f"missing #{m['n']} drawer opens")
        check(not has_layer(pg, m["n"]), f"missing #{m['n']} has no map layer")
        pg.screenshot(path=str(SHOTS / "desktop-light.png"), full_page=False)

        if args.all_layers:
            print("every mapped layer, one at a time")
            pg.click("#ex-clear")
            for r in mapped:
                toggle(pg, r["n"])
                check(has_layer(pg, r["n"]), f"#{r['n']} {r['layer']} loads")
                toggle(pg, r["n"])
        check(not bad, f"no failed data requests {bad[:3]}")
        check(not errors, f"no console errors {errors[:3]}")
        pg.close()

        # ── deep link ──────────────────────────────────────────────────────────────
        print("deep link")
        pg, errors, bad = page(1440, 900, "on=census_tract,fedadmin_time_zone&sel=61&group=chapter&theme=light")
        settle(pg)
        st = pg.evaluate("({on: [...window.__explore.state.on].sort((a,b)=>a-b), "
                         "sel: window.__explore.state.sel, group: window.__explore.state.group})")
        check(st == {"on": [6, 61], "sel": 61, "group": "chapter"}, f"state restored {st}")
        check(has_layer(pg, 6) and has_layer(pg, 61), "deep-linked layers draw")
        check(pg.get_attribute('[data-group="chapter"]', "aria-pressed") == "true", "chapter view pressed")
        check("Time zone" in pg.inner_text("#ex-drawer"), "drawer shows #61")
        check(not errors, f"no console errors {errors[:3]}")
        pg.close()

        # ── screenshots ────────────────────────────────────────────────────────────
        print("screenshots")
        shots = [("desktop", 1440, 900), ("phone", 390, 844)]
        for theme in ("light", "dark"):
            for name, w, h in shots:
                pg, errors, _ = page(w, h, f"on=nyc_zoning_district,census_tract&sel=75&theme={theme}")
                settle(pg)
                pg.screenshot(path=str(SHOTS / f"{name}-{theme}.png"))
                pg.screenshot(path=str(SHOTS / f"{name}-{theme}-full.png"), full_page=True)
                check(pg.evaluate("document.documentElement.scrollWidth <= innerWidth"),
                      f"{name} {theme}: no horizontal page scroll")
                check(not errors, f"{name} {theme}: no console errors {errors[:3]}")
                pg.close()
        b.close()

    print(f"\n{len(fails)} failures" if fails else "\nall checks passed")
    print(f"screenshots in {SHOTS.relative_to(ROOT)}/")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
