# Engineering notes

Why the deck is built the way it is: the decisions that are not obvious from the code, the
approaches that were tried and abandoned, and the measurements behind the numbers.

For what to run and where to click, see [GUIDE.md](GUIDE.md). For the short version, see
[README.md](README.md).

---

## The gallery — four more pages

Separate URLs, separate maps, not part of the deck. All reuse the deck's pen palette, type
and record mode, so a frame from any of them sits beside a deck frame unchanged.

| | |
|---|---|
| `/flash.html` | one place, every boundary over it, strobing |
| `/draw.html` | one layer, drawn by a moving pen |
| `/matte.html` | grey land and white names — over the deck or either gallery piece |
| `/key.html` | non-land in chroma green — over the deck or either gallery piece |

They are separate Vite entry points rather than routes inside the deck on purpose: the deck
guarantees that navigation is a pure function of the scene index, and a second engine
mutating the same map is exactly the shared state that guarantee exists to rule out. Both
are listed in `vite.config.ts` — without that, `vite build` emits only `index.html` and the
two pages 404 in production while working perfectly in dev.

```sh
open http://localhost:5173/flash.html
open 'http://localhost:5173/flash.html?ms=300&from=15&to=5'
open 'http://localhost:5173/draw.html?layer=census_county&ms=20000'
```

**flash** — no text on it at all. The camera stands in one place and pulls back
continuously for the whole run while the layers swap underneath it every few hundred
milliseconds. `?at=lng,lat` (default: 350 Fifth Avenue), `?ms=` the hold per layer, `?from=`
and `?to=` the zoom to travel through, `?pan=` how far the anchor drifts across the frame,
`?order=nest|registry`, `?scope=`, `?pen=`, `?loop=0`. SPACE pauses and `R` restarts; there
is nothing on screen to say so.

Three things about it are less obvious than they look.

**The order is the pull-back.** The reel is sorted finest-first — NYC-extent layers ahead of
national ones, more features ahead of fewer — so the sequence of layers pulls back with the
camera. In registry order, which is alphabetical, `census_block` and `nyc_landmark_lot`
played near the end, at state scale, where a city block is half a pixel, while
`census_nation` played at the start as a flat wash over the whole frame. Every layer was on
screen; half were unreadable at the moment they got.

**The clock owns the rhythm, never the loader.** At a 400 ms hold there is no time to fetch
an 18 MB layer on demand, so loading runs eight layers ahead and a layer that is not ready
is passed over without consuming its beat. An irregular beat is far more visible in a
50-layer strobe than a missing layer.

**A layer that is not over this place never gets a beat.** Six of the derived layers are
registered as national but are regional in fact — the District of Wyoming, the McGirt
reservations, Navajo and Hopi, the two gerrymanders, the Tulsa and Las Vegas scene props —
and standing in New York each would take a beat holding an empty screen. They are dropped
on a bbox test the first time they load. The run is then as long as there are layers to
show, which is why it ends on `census_nation` and the arc rather than wrapping round and
replaying census blocks at zoom 4.

The pan is a **bounded excursion, not a rate**. Accumulating drift at a fixed fraction of
the viewport per second keeps the apparent speed constant, but the viewport grows by a
factor of about 900 during the pull-back, so nearly all the distance is covered in the last
few seconds — the first version ended 24° out in the Atlantic with the country against the
frame edge. Expressed as a fraction of the frame it drifts an eighth of the way across and
stops, at every zoom.

Standing anywhere else works — `?at=-87.6298,41.8781` for Chicago plays the 24 national
layers and skips the 30 NYC-extent ones — and that case is the reason the cursor retires
layers it has ruled out rather than only advancing when something is shown. The warm window
is anchored to the cursor, so a cursor that moved only on success parked forever on the NYC
layers at the head of the reel and never requested the national ones below them: a full
pass, blank.

### The composite plates

`/matte.html` and `/key.html` are not new animations. Each runs one of the three pieces —
the deck included — with the map restyled and every readout taken off, because what they
produce goes into an edit rather than being read on screen. `?show=flash` (the default),
`?show=draw` or `?show=deck`, and every option that piece already understands still
applies — `?at=`, `?ms=`, `?layer=`, `?order=`, `?scene=`, `?record=1`.

```sh
open http://localhost:5173/matte.html
open 'http://localhost:5173/key.html?show=draw&layer=census_county&ms=20000'
open 'http://localhost:5173/matte.html?show=deck&scene=beat-08'   # step it with the arrows
```

`?show=deck` is the whole 109-scene walkthrough, stepped by hand exactly as at
`/index.html`. What comes off is the counter, the caption, the pen swatch, the cards, the
index readout and the overlays — the map and its boundaries, nothing else.

**matte** — land at 50% grey, place names pure white. dark-v11 is built to sit behind
saturated fills on a near-black ground, which is right for the deck and wrong for a plate:
the land is nearly the value of the sea and the names are `#e8ecf1`. Measured on the
rendered frame, the land comes out exactly `#808080` and the sea `#22262B`.

**key** — the same land and names, with every non-land pixel flat `#00FF00`. Measured:
53.5% of the frame exactly `#00FF00`, 42.9% exactly `#808080`, the remainder coastline
antialiasing, the boundary layer and the text.

The key colour is the one decision worth spelling out. The markets pen is `#009E73` — also
a green — so a keyer working on hue would have to separate 164° from 142° if this used the
broadcast standard `#00B140`. Pure `#00FF00` sits at 120°, a clear 44° away, and since
these frames are synthetic there are no soft edges to spill, so the purest key is also the
safest. `?land=`, `?water=`, `?ink=`, `?halo=0` override any of it.

Three things had to be forced that are not obvious:

**The deck repaints its own labels on every scene change.** `setLabels` runs per scene and
was putting `#e8ecf1` back over the pure white the plate had just set, so the look survived
exactly until the next arrow press. `styleLabel` now defers to the plate when one is in
force. The same call is where `text-opacity` gets pinned.

**Label opacity, not just colour.** dark-v11 fades `state-label` in and out on a zoom
expression, so setting the colour to pure white changed nothing visible at mid zooms — the
state names still read mid-grey on grey land, which is the exact blending this look exists
to prevent. The plates set `text-opacity` to 1: a name is shown or it is not.

**On the key plate, the water is drawn above the boundaries.** The deck's fills are
semi-transparent and cover water as readily as land — a census county includes the bay — so
over the sea the key came out tinted: measured `#13EE33` under a statisticians fill, and a
different tint under every pen. Raising the water above them makes the sea exactly the key
colour and stops the boundaries at the coastline. That last part is a real cost and worth
stating: on this plate a boundary that extends over water is cut off at the shore. It is
what you want when the sea is about to be keyed out anyway, and `?clip=0` turns it off. The
matte plate keeps the literal stacking, since nothing there gets keyed.

**River lines come off.** They are non-land and so would take the key colour, but a
waterway line is a hairline, and a hairline in the key colour composites as a hairline hole
with a green fringe down both sides. `?waterways=1` puts them back. Water *polygons* — every
lake, bay and the sea — are keyed either way, which does mean wide rivers key out as green
threads across the land. That is literally correct and may not be what you want; there is no
clean lever for it, because dark-v11 draws inland water and the ocean in the same layer.

The basemap's own admin lines are hidden on both plates. They are drawn in a pale grey that
survives into the keyed area along coastal borders, and on a plate whose whole point is that
the non-land is one flat value, a stray line is a hole in the key.

**draw** — `?layer=<id>` (the registry key, so `census_bg@nyc`, and there is a picker),
`?ms=` total duration, `?order=lon|lat|area|file`, `?ghost=0`, `?loop=1`. Arrows change
layer, SPACE pauses, `R` redraws.

The layer is exploded into the individual rings a pen would actually draw — a county with an
island is two strokes, a state with a lake is an exterior and a hole — the rings are sorted
west to east, and a nib walks them in order leaving the line behind it. The run is a **fixed
duration**, so the pen's speed is set by how much geometry the layer holds: 56 states are
151 rings and trace visibly one at a time; 7,518 block groups are 7,609 rings and become a
wave crossing the city. Both are the truth about the layer.

The drawn bulk and the nib are on **two different clocks**, and that is load-bearing. The
reveal is a data-driven paint expression, and changing one makes mapbox re-evaluate the
property for every feature in every loaded tile — far too much to do 60 times a second on a
3,235-feature layer. So the nib and its trail move every frame from a tiny source of their
own while the bulk catches up 20 times a second. Measured at 59-60 fps on `census_county`.

### Framing a layer that has no camera

`gallery/bounds.ts`. This is `/draw.html`'s problem only — flash stands in one place and
never frames anything — and the comment there is longer than the code for a reason: two
earlier approaches are recorded as dead ends.

The antimeridian comes first: every national layer with Alaska has Aleutian geometry either
side of 180°, so a naive min/max fits the whole globe. Longitudes are shifted negative when
the span exceeds 180°, which puts the Aleutians at the country's western end.

Then outliers. `census_state` runs from Guam at 145°E to Maine — 151° of longitude — and
framing to that makes the United States a smudge in an ocean. A 1% percentile trim did
nothing (Guam and American Samoa are together more than 1% of the layer's 35,124
coordinates). A 2% trim accepted whenever it shrank the frame by a third then cropped
layers with no outliers at all — New York's 14 congressional districts were losing real
geometry to fix a problem they do not have.

What actually marks an outlying island is a **gap**. Each axis's tail is searched for an
empty run wider than a tenth of its span, and cut there if one exists. `census_state` has
two — Guam to the Aleutians, American Samoa to Hawaii — and loses both territories while
keeping Alaska and Hawaii; New York has none and is untouched. A layer is only ever cut
where the data itself is empty, and when a cut happens the **draw page says "frame
trimmed"** on screen, because a frame that silently drops part of a layer would defeat the
point of looking at it. `?frame=full` forces the true extent.

A second, much cheaper extent — a plain min/max, no shifting and no cutting — answers a
different question for flash: is this place inside this layer at all. That is the bbox test
that keeps the District of Wyoming from taking a beat while the camera stands in Manhattan.

## The scripts

| script | what it does |
|---|---|
| `scripts/scaffold_beats.py` | one-shot: parses the 93 counter marks out of the script into `docs/beats.yaml` |
| `scripts/export_web.py` | GeoPackage → `app/public/data/` + the generated TypeScript |
| `scripts/fetch_scene_props.py` | the out-of-state polygons three scenes need (see below) |
| `scripts/smoke.py` | drives the running deck headlessly, screenshots scenes, checks determinism |

`smoke.py` needs the dev server up and drives system Chrome via Playwright:

```sh
python3 scripts/smoke.py beat-08 ys-district        # screenshot into qa/shots/
python3 scripts/smoke.py --determinism beat-35      # reach it from both directions, diff
```

The determinism check is the one that matters. It walks away from a scene and back to it,
then asserts the two frames are byte-identical. That is the guarantee the engine is built
around, and it has already caught a real bug: `.hud-card { display: grid }` outranks the
browser's `[hidden]` rule, so cards were never hiding and one stayed pasted over the map
when you stepped backward.

The map's own keyboard handling is **disabled everywhere**, not just in record mode.
Mapbox pans on arrow keys by default and its handler fires while the event is still
bubbling toward the deck's listener, so the map slid sideways at the same moment the scene
advanced. Arrows drive the deck; the map does not get a vote.

## Look and motion

**Typography is Vignelli's**: Helvetica, two weights, no italics. Helvetica Neue is local on
macOS — the machine the deck is recorded on — and Inter Regular/Bold is the fallback face
elsewhere; nothing else is loaded, so no third cut can creep in. Display sizes (counter,
card title, clock) carry `--track-display` and small caps carry `--track-caps`; body text is
untracked. Everything secondary — the pen label, the card subtitle, the locked caption — is
bold uppercase at wide tracking, which is the only hierarchy device in use besides size.
The index chip lost its rounded corner.

The **Mapbox basemap labels are still the style's own face**, not Helvetica: Mapbox serves
glyphs only for fonts in its own stack, so asking for Helvetica there would silently drop
the labels. They keep the light face and dark halo described below.


Layers **cross-fade**: when a scene departs, its layers dissolve out over `TIMING.crossfade`
while the incoming scene's fade in, so the two overlap instead of one cutting to the other.
All the beat timings live in `app/src/config.ts` — change them in one place and the whole
deck retimes.

Basemap **labels draw on top of the boundary fills**, not under them. Boundary layers are
inserted beneath the first symbol layer in the style, and the enabled labels get a light
face and a dark halo so they read over a saturated fill as well as over the dark ground.
Which labels appear is chosen by how far out the camera sits: states below zoom 5, states
and cities to zoom 8, cities above that. Neighbourhood labels are never on by default.

### Who owns the HUD

A scene owns the card and the overlay it declares, and `runSteps` clears both for any scene
that declares neither — at the top, before the layer warm-up await, so they go on the
keypress rather than when the first fetch lands. Previously only the `applyEndState` at the
*end* of a transition took them down, so a card beat followed by a choreography left its
card pasted over the whole sequence: beat 36, the Alaska Native regional corporations,
straight into the McGirt flying. The GEOID readout had the same fault after the census
nesting sequence.

This is the class of bug the determinism check cannot see — both frames it compares are end
states, and the end states were always right. The fault lived only in the middle of the
transition.

## The deck

109 scenes: a two-part cold open, the 93 counter beats, and 14 choreographed scenes spliced
in at their script positions.

| sequence | after beat | what it does |
|---|---|---|
| cold open | — | the lot at pitch 60 pulling back to the country, then the 1,893-mile arc |
| census nesting | 8 | block → block group → tract → county, GEOID digits falling off |
| five definitions of "city" | 17 | city limits → urban area → metro division → MSA → CSA |
| Oklahoma / McGirt | 30, 36 | the affirmed nations fade in, Tulsa, then Osage struck out |
| Yellowstone | 40 | the District of Wyoming bulging out to swallow the park |
| Arizona clocks | 61 | a dot driving AZ-264 while the clock changes under it, five times |
| ZIP vs ZCTA | 65 | ZCTA 10001 dissolves, one building is left |
| watershed nesting | 82 | HUC2 → HUC8 → HUC12 |
| the reveal | 93 | 49 polygons in pen order, counter to 68, then Manhattan drawn twice |
| Paradise, Nevada | 9 | the CDP with no government, beside the city it isn't part of |
| gerrymander gallery | 20 | IL-4's earmuffs, then NC-12 as drawn for the 113th |
| Texas and the grid | 43 | ERCOT, El Paso Electric, and the panhandle |
| the locked layer | 63 | hatched country, a lock, and no DMA polygon |

**There is no Federal Reserve district scene.** `fedadmin_frb_district` is still unbuilt —
kansascityfed.org blocks automated access and the only ArcGIS copies are third-party, which
fails the repo's sourcing rule. CLAUDE.md is explicit that hand-typing the ~3,143 county
assignments is not acceptable, so beat 49 stays a card. Better a card than a map nobody can
stand behind.

**The Texas scene is not "three interconnections".** The balancing-authority layer carries
no interconnection field, and assigning one would mean hand-typing 71 authorities from
memory — the same objection. What the data actually supports is better anyway: ERCOT covers
73% of Texas, El Paso Electric 18.6%, and SPP and MISO take the panhandle and the east. The
script's point survives and gains a detail — Texas is not wholly on the Texas grid.

The ZIP beat deliberately draws **less** than the plan called for: no stylised delivery
routes, because inventing USPS route lines would be fabricated geometry in a video about
real lines. The honest version is also the better shot — the ZIP polygon dissolving to
leave one building *is* the point.

**The Arizona beat used to draw less for the same reason, and no longer has to.** It drew no
road at all, on the grounds that a stylised AZ-264 would be the one invented line in the
film, and flew between four named towns with the clock retyped beside them instead. The
reasoning was right; the conclusion was avoidable. TIGER publishes AZ-264. It is now fetched
like any other prop and a dot drives it — see **The Arizona drive** below.

## The Arizona drive

Beat 61 is the one scene that draws something which is not a boundary. The road is real —
TIGER's Arizona primary and secondary roads, `FULLNAME = "State Hwy 264"`, 265 km and 3,042
vertices from the US-160 junction near Tuba City to Window Rock — and it stays out of the
layer registry on purpose: a road has no pen, no authority and no vintage, and listing it
beside the boundary layers would make it look like one of the 68. It lives in
`app/src/engine/drive.ts` instead.

**The clock is not scripted.** `fetch_scene_props.py` classifies every vertex of the
centreline against `fedadmin_time_zone` — the same file the scene paints underneath — and
writes the road out pre-split into runs of constant zone, each carrying the nation under it
(from the reservation polygons) and the hour there. The overlay changes because the dot
crossed a polygon. If the polygon moves, the crossing moves with it, and the two can never
disagree.

Raw classification gives nine runs. Three are artefacts of where a polygon edge cuts the
centreline — one a single vertex at the western terminus, one 70 m near Moenkopi — and the
script folds runs under 500 m into their neighbours, printing both counts either way. Six
remain, between 8.8 and 110 km: **Hopi, Navajo, Hopi, Navajo, Hopi, Navajo**, west to east.
Five changes of clock in 165 miles without crossing a state line.

**This corrected a factual error on screen.** The old scene captioned Keams Canyon
`Navajo · MDT`. The time zone file puts it in `America/Phoenix` — the opposite hour. It was
one of four towns whose zone had been asserted rather than checked; the file's own comment
only ever claimed to have verified the other three and Flagstaff.

Two things are stylised, and only two. The dot **pauses at each crossing**: at constant
speed the first two runs are 15.8 km and 12.6 km of a 265 km road, so three of the five
changes landed inside 1.3 seconds and flicked past unread. Every clock reading now holds
for at least a second. And the zone fills lift from 0.12 to 0.26 for the drive — measured,
the two colours differ by about 15/255 per channel at 0.12 and by 35–53 at 0.26, which is
the difference between a brown wash and two legible zones at corridor zoom. Neither moves a
line.

Captions throughout the scene now hold for `TIMING.caption` each, rather than being
replaced while the map was still moving.

## Scene props

Three scenes need shapes from outside New York — Tulsa for the McGirt beat, Paradise and
Las Vegas for the CDP beat, IL-4 and NC-12 for the gerrymander gallery. They are fetched by
`scripts/fetch_scene_props.py` rather than added to the boundary stack: `census_place` is
deliberately a state-36 subset under CLAUDE.md rule 6, and the locked ESB count is computed
from it. Provenance (URL, sha256, date) lands in `qa/scene_props.md`.

Worth knowing: TIGER 2025 publishes congressional districts **per state only** — there is
no `tl_2025_us_cd119.zip` (404 as of 2026-09-08, 112 per-state files present). The 113th
Congress is the reverse, national only.

## Regenerating

`app/public/data/`, `app/src/layers.generated.ts` and `app/src/beats.generated.ts` are all
generated. Regenerate rather than edit:

```sh
python3 scripts/export_web.py            # everything
python3 scripts/export_web.py --dry-run  # what it would write, and how big
python3 scripts/export_web.py --ts-only  # just the .ts, from the GeoJSON already on disk
```

The export fails loudly rather than shipping something wrong: every output is asserted
against a size budget, `docs/beats.yaml` must carry beats 1–93 exactly once with every
layer present in the GeoPackage, and the reveal stack is checked feature by feature
against `../boundaries/qa/esb_final_count.md`.

## docs/beats.yaml

The crosswalk from the script's 93 counter marks to layers. Scaffolded once by
`scripts/scaffold_beats.py`, the `layer:` column completed by hand.

- **52 beats have a polygon**, over 50 distinct layers — `census_place` serves beats 5 and
  9, `census_cbsa` serves 14 and 17 via an `LSAD` filter. `nyc_borough` is used only by the
  reveal's "Manhattan drawn twice" beat and owns no counter mark.
- **41 beats have no geometry in the stack** and render as typographic cards. The counter
  still ticks and the pen still flashes; no polygon is ever faked.

A beat's **pen is the layer's own**, from the GeoPackage manifest, not the chapter's — the
script tags whole chapters "mixed — markets and congress" and "mixed — politicians and
surveyors", so the chapter pen is a default for cards only. 19 of the polygon beats
disagree with their chapter, and in every case the layer is right: the national park is
Congress's pen, not the courts'; the police precinct is the politicians', not the
surveyors'. Without this the counter would tick yellow while the polygon drew blue.

## Attribution owed in the video description

- Mapbox (basemap; the app suppresses the on-map attribution for recording).
- ODbL — timezone-boundary-builder, for `fedadmin_time_zone`.
- USDA-ARS and Oregon State University, for `usda_hardiness_zone`.
