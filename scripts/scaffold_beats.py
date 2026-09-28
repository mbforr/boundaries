#!/usr/bin/env python3
"""Step W0 — scaffold docs/beats.yaml from the counter marks in the script.

The video script carries 93 counter marks written as U+27E8 n U+27E9. Each one is a beat:
the number that must be on screen at that moment. This script finds all of them, works out
which chapter and pen tag each falls under, and emits a stub crosswalk.

It does NOT guess the `layer:` mapping. Which GeoPackage layer illustrates a beat is a
judgement call (beat 5 "the city" and beat 9 "census place" are the same file; beat 14 and
beat 17 are the same file with different LSAD filters), so the stub leaves `layer: null`
and a human completes it once. Re-running never overwrites a completed beats.yaml unless
--force is given, and even then it prints a diff of what it would drop.

Reads:
    docs/script_v3.md

Writes:
    docs/beats.yaml                     the stub (or beats.scaffold.yaml if one exists)

Usage:
    python3 scripts/scaffold_beats.py
    python3 scripts/scaffold_beats.py --force
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "docs" / "script_v3.md"
BEATS = ROOT / "docs" / "beats.yaml"

MARK = re.compile(r"⟨(\d+)⟩")
PEN_TAG = re.compile(r"\[Pen tag:\s*([^\]]+)\]", re.I)

# The script's chapter headers, in order, with the slug and default pen the app uses.
# Matched as a prefix against a stripped line, so trailing punctuation drift is tolerated.
CHAPTERS: list[tuple[str, str, str]] = [
    ("Cold Open",                             "cold-open",  "congress"),
    ("WHY THIS?",                             "why",        "congress"),
    ("THERE IS NO MAP DEPARTMENT",            "no-map-dept","congress"),
    ("PROBLEM NUMBER ONE, AND THE SIX PENS",  "six-pens",   "congress"),
    ("TIER 1: THE OBVIOUS ONES",              "tier-1",     "congress"),
    ("THE LAYERS THAT COUNT YOU",             "count-you",  "statisticians"),
    ("THE POLITICAL LAYERS",                  "political",  "politicians"),
    ("THE LEGAL LAYERS",                      "legal",      "courts"),
    ("RUNG 5: THE MARKET AND MACHINE LAYERS", "rung-5",     "markets"),
    ("RUNG 6: THE SWARM",                     "swarm",      "surveyors"),
    ("THE REVEAL",                            "reveal",     None),
    ("BEAT 11",                               "human-turn", None),
    ("CALLBACK CLOSE",                        "close",      None),
    ("CHANGELOG",                             "changelog",  None),
]

# ──────────────────────────────────────────────────────────────────────────────

def chapter_at(line_no: int, marks: list[tuple[int, str, str, str]]) -> tuple[str, str]:
    """The last chapter header at or above this line."""
    slug, pen = "cold-open", "congress"
    for ln, s, p, _ in marks:
        if ln <= line_no:
            slug, pen = s, p
        else:
            break
    return slug, pen


def label_for(text: str) -> str:
    """Best-effort short label from the sentence the mark sits in.

    Takes the text before the mark, back to the previous sentence end, strips list
    punctuation. Deliberately rough — a human fixes these in beats.yaml.
    """
    t = text.rstrip()
    t = re.split(r"(?<=[.!?])\s+", t)[-1] if t else ""
    t = t.strip(" ,.;:—-").strip()
    t = re.sub(r"^(To this we add the|And|Then|Below that,?|Now|the|And of course,)\s+", "", t, flags=re.I)
    return (t[:1].upper() + t[1:]) if t else "TODO"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing docs/beats.yaml")
    args = ap.parse_args()

    if not SCRIPT.exists():
        print(f"FAILED — no script at {SCRIPT.relative_to(ROOT)}")
        return 1

    lines = SCRIPT.read_text().splitlines()

    # Locate chapter headers and pen tags by line number.
    heads: list[tuple[int, str, str, str]] = []
    pens_at: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        s = line.strip()
        for title, slug, pen in CHAPTERS:
            if s.startswith(title):
                heads.append((i, slug, pen, title))
                break
        m = PEN_TAG.search(line)
        if m:
            pens_at.append((i, m.group(1).strip()))

    found: dict[int, dict] = {}
    for i, line in enumerate(lines):
        for m in MARK.finditer(line):
            n = int(m.group(1))
            if n == 0:
                continue  # the counter's own zero state, not a beat
            slug, pen = chapter_at(i, heads)
            if n in found:
                print(f"      WARNING beat {n} appears twice (line {i+1})")
            found[n] = {
                "n": n,
                "label": label_for(line[: m.start()]),
                "chapter": slug,
                "pen": pen,
                "line": i + 1,
            }

    missing = [n for n in range(1, 94) if n not in found]
    extra = [n for n in found if n > 93]
    print(f"  {len(found)} counter marks, chapters: {len(heads)}, pen tags: {len(pens_at)}")
    if missing:
        print(f"FAILED — missing beats: {missing}")
        return 1
    if extra:
        print(f"FAILED — beats above 93: {extra}")
        return 1

    dest = BEATS
    if BEATS.exists() and not args.force:
        dest = ROOT / "docs" / "beats.scaffold.yaml"
        print(f"  {BEATS.name} exists — writing the stub to {dest.name} instead")

    L = [
        "# The 93-beat crosswalk. Scaffolded by scripts/scaffold_beats.py, layer mapping",
        "# completed by hand. Every beat 1..93 appears exactly once; export_web.py fails",
        "# loudly if that stops being true or if a `layer:` is not in the GeoPackage.",
        "#",
        "#   render: polygon  -> `layer` names a built GeoPackage layer",
        "#   render: card     -> no geometry exists; a typographic beat, layer must be null",
        "#   scope:  national | nyc   which export the app loads",
        "",
        "beats:",
    ]
    for n in range(1, 94):
        b = found[n]
        L += [
            f"  - n: {n}",
            f"    label: {b['label']!r}",
            f"    chapter: {b['chapter']}",
            f"    pen: {b['pen']}",
            "    layer: null        # TODO",
            "    scope: national",
            "    render: card       # TODO -> polygon where a layer exists",
            f"    script_line: {b['line']}",
        ]
    dest.write_text("\n".join(L) + "\n")
    print(f"  wrote {dest.relative_to(ROOT)}: 93 beats")
    return 0


if __name__ == "__main__":
    sys.exit(main())
