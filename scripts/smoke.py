#!/usr/bin/env python3
"""Step W2 — headless smoke test of the running deck.

Drives the dev server with Playwright (system Chrome, so nothing needs downloading),
screenshots the scenes named on the command line, and reports the HUD state and any
console errors. This is how a scene gets checked without a human watching the screen.

The back-navigation check is the important one: it walks forward to a scene, then walks
back to it from further on, and asserts the two frames are byte-identical. That is the
determinism guarantee the whole engine is built around.

Usage:
    npm run dev &                              # in app/
    python3 scripts/smoke.py beat-01 beat-08 beat-24
    python3 scripts/smoke.py --determinism beat-05
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "qa" / "shots"
URL = "http://localhost:5173/"


def hud_state(pg) -> dict:
    return pg.evaluate("""() => ({
        counter: document.querySelector('#hud-counter')?.textContent,
        caption: document.querySelector('#hud-caption')?.textContent,
        pen:     document.querySelector('#hud-pen span')?.textContent,
        card:    document.querySelector('#hud-card').hidden
                   ? null : document.querySelector('.hud-card-title')?.textContent,
        layers:  window.__map.getStyle().layers
                   .filter(l => l.id.startsWith('bs:') &&
                                window.__map.getLayoutProperty(l.id,'visibility') === 'visible')
                   .map(l => l.id),
    })""")


def settle(pg, ms: int = 4000) -> None:
    """Wait for any choreography to finish, then for tiles to settle.

    Polling __navigating matters: a keypress during a choreography lands the current
    scene rather than advancing, so a fixed sleep silently loses presses.
    """
    pg.wait_for_function("() => !window.__navigating || !window.__navigating()",
                         timeout=30000)
    pg.wait_for_timeout(ms)


def press(pg, key: str) -> None:
    pg.keyboard.press(key)
    pg.wait_for_timeout(150)
    settle(pg, 1200)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scenes", nargs="*", default=["beat-01"])
    ap.add_argument("--determinism", action="store_true",
                    help="also reach each scene by stepping backward and compare frames")
    ap.add_argument("--sweep", action="store_true",
                    help="walk the whole deck forward then back, auditing every scene")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True,
                              args=["--use-gl=angle", "--use-angle=metal"])
        pg = b.new_page(viewport={"width": args.width, "height": args.height})
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        if args.sweep:
            pg.goto(URL, wait_until="networkidle")
            settle(pg, 2000)
            n = pg.evaluate("() => window.__deckLength()")
            print(f"  sweeping {n} scenes forward…")
            seen = []
            for i in range(n):
                errors.clear()
                a = pg.evaluate("() => window.__audit()")
                seen.append(a["scene"])
                if a["bad"]:
                    failures.append(f"{a['scene']}: " + "; ".join(a["bad"]))
                    print(f"    {a['scene']:16} {'; '.join(a['bad'])}")
                if errors:
                    failures.append(f"{a['scene']}: console {errors[:2]}")
                if i < n - 1:
                    press(pg, "ArrowRight")
            print(f"  sweeping {n} scenes backward…")
            for i in range(n - 1, -1, -1):
                a = pg.evaluate("() => window.__audit()")
                if a["scene"] != seen[i]:
                    failures.append(f"backward walk hit {a['scene']} where forward had {seen[i]}")
                if a["bad"]:
                    failures.append(f"{a['scene']} (backward): " + "; ".join(a["bad"]))
                    print(f"    {a['scene']:16} (back) {'; '.join(a['bad'])}")
                if i > 0:
                    press(pg, "ArrowLeft")
            print(f"  swept {n} scenes each way")
            b.close()
            if failures:
                print("\nFAILED:")
                for f in failures[:30]:
                    print(f"  - {f}")
            return 1 if failures else 0

        for scene in args.scenes:
            errors.clear()
            pg.goto(f"{URL}?scene={scene}", wait_until="networkidle")
            settle(pg)
            direct = SHOTS / f"{scene}.png"
            pg.screenshot(path=str(direct))
            st = hud_state(pg)
            print(f"  {scene:14} counter={st['counter']:>3}  pen={st['pen'] or '-':16} "
                  f"{'card=' + st['card'] if st['card'] else 'layers=' + str(len(st['layers']))}")
            if st["caption"]:
                print(f"                 caption: {st['caption']}")
            if errors:
                failures.append(f"{scene}: console errors {errors[:3]}")

            if args.determinism:
                # Leave the scene and come back to it, so the frame is reached from the
                # opposite direction. Near the end of the deck there is nothing ahead, so
                # step backward first instead — either way the scene is re-entered, which
                # is what the determinism guarantee is about.
                ahead = pg.evaluate(
                    "() => { const d = window.__deckLength(), i = window.__index();"
                    " return d - 1 - i; }")
                out, back = ("ArrowRight", "ArrowLeft") if ahead >= 2 else ("ArrowLeft", "ArrowRight")
                press(pg, out)
                press(pg, out)
                press(pg, back)
                press(pg, back)
                landed = pg.evaluate("() => window.__scene()")
                if landed != scene:
                    failures.append(
                        f"{scene}: walked back to {landed} instead — navigation lost a step")
                settle(pg)
                back = SHOTS / f"{scene}.back.png"
                pg.screenshot(path=str(back))
                a = hashlib.sha256(direct.read_bytes()).hexdigest()
                c = hashlib.sha256(back.read_bytes()).hexdigest()
                if a == c:
                    print(f"                 determinism: identical frame ✓")
                    back.unlink()
                else:
                    failures.append(f"{scene}: forward and backward frames differ")
                    print(f"                 determinism: FRAMES DIFFER "
                          f"(see {back.relative_to(ROOT)})")
        b.close()

    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  - {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
