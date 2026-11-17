#!/usr/bin/env python3
"""
Check the explorer's pen colours against the grounds they draw on.

    python3 scripts/check_contrast.py           check, print ratios, exit 1 on a failure
    python3 scripts/check_contrast.py --derive  print a suggested light variant per pen

The six video colours (app/src/pens.ts) are kept as-is on the dark map. On the light
map, yellow #F0E442 and light blue #56B4E9 all but vanish against pale land, so
app/src/explore/colors.ts holds a light-ground variant of each: the same hue, darkened
in HLS lightness until a line stroke reaches 3:1 (WCAG 1.4.11, non-text contrast)
against the land colour. Swatches next to text keep the original colour with a 1px
border, so they are not checked here.
"""
from __future__ import annotations

import colorsys
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PENS_TS = ROOT / "app" / "src" / "pens.ts"
COLORS_TS = ROOT / "app" / "src" / "explore" / "colors.ts"

LAND = "#ecebe7"   # --land, the light basemap's land
PAGE = "#ffffff"   # --bg, the page behind the list swatches
DARK_LAND = "#1c1c1c"  # roughly dark-v11 land, for the originals
MIN = 3.0


def lum(hex_: str) -> float:
    r, g, b = (int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a: str, b: str) -> float:
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def darken_until(hex_: str, ground: str, target: float) -> str:
    r, g, b = (int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    while l > 0:
        rr, gg, bb = colorsys.hls_to_rgb(h, l, s)
        out = "#{:02X}{:02X}{:02X}".format(*(round(c * 255) for c in (rr, gg, bb)))
        if ratio(out, ground) >= target:
            return out
        l -= 0.005
    return "#000000"


def pens() -> dict[str, str]:
    src = PENS_TS.read_text()
    # Each entry is `pen: {` then, perhaps after comment lines, `color: '#RRGGBB'`.
    return dict(re.findall(r"(\w+): \{(?:\s*//[^\n]*)*\s*color: '(#[0-9A-Fa-f]{6})'", src))


def light_variants() -> dict[str, str]:
    src = COLORS_TS.read_text()
    block = src.split("LIGHT_INK", 1)[1]
    return dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block))


def main() -> None:
    base = pens()
    if len(base) != 6:
        sys.exit(f"expected six pens in {PENS_TS}, found {base}")
    if "--derive" in sys.argv:
        for p, c in base.items():
            print(f"  {p}: '{darken_until(c, LAND, MIN + 0.05)}',   // from {c}")
        return
    light = light_variants()
    ok = True
    print(f"{'pen':14} {'video':8} {'on dark':>8}   {'light':8} {'on land':>8} {'on page':>8}")
    for p, c in base.items():
        lv = light.get(p)
        if lv is None:
            print(f"{p:14} missing from {COLORS_TS.relative_to(ROOT)}")
            ok = False
            continue
        rl, rp = ratio(lv, LAND), ratio(lv, PAGE)
        flag = "" if rl >= MIN else "  FAIL"
        ok &= rl >= MIN
        print(f"{p:14} {c:8} {ratio(c, DARK_LAND):8.2f}   {lv:8} {rl:8.2f} {rp:8.2f}{flag}")
    print(f"line strokes need {MIN}:1 against land {LAND}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
