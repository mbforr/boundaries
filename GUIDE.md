# Guide

Every page, every URL, every option, and how to get it onto Vercel.

Replace `localhost:5173` with your deployment host and every URL below works unchanged.

- [Deploying](#deploying)
- [The deck](#the-deck)
- [Every scene, with its script](SCENES.md)
- [The strobe](#the-strobe----flashhtml)
- [The drawing pen](#the-drawing-pen----drawhtml)
- [The composite plates](#the-composite-plates----mattehtml-and-keyhtml)
- [Recording](#recording)
- [Regenerating the data](#regenerating-the-data)
- [Checking it still works](#checking-it-still-works)

---

## Deploying

### 1. Push to GitHub

The repo is ready to commit as-is. Two things are committed that a normal repo would not
commit, and both are deliberate — see `app/.gitignore` for the reasoning:

- `app/public/data/` — 94 MB of exported GeoJSON, 60 files, largest 17 MB
- `app/src/layers.generated.ts` and `app/src/beats.generated.ts`

They are generated from a GeoPackage that is not in this repo, so a build machine cannot
produce them. Without the two `.ts` files the build fails at `tsc`; without `public/data/`
every layer 404s at runtime.

The repo is already initialised and committed on `main`, so all that is left is the
remote:

```sh
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

94 MB of GeoJSON is comfortable for GitHub — the hard per-file limit is 100 MB and the
largest file here is 17 MB — and it packs down to a 28 MB clone. It is still a large repo. If that becomes a problem the fix is to
serve `public/data/` from object storage and point the app at a base URL, not Git LFS,
whose free bandwidth allowance one full run of `/flash.html` would eat into.

### 2. Import into Vercel

The app lives in `app/`, not at the repo root, and that is the one thing to get right.

**Set Root Directory to `app`.** Vercel → Settings → Build and Deployment → Root Directory.
That is the only manual setting; everything else comes from `vercel.json`:

| setting | value |
|---|---|
| Root Directory | `app` |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

Every path there is relative to `app/`, because that is the directory Vercel runs in once
the Root Directory is set. The same file sits at the repo root **and** in `app/` — they are
byte-identical, and both exist because Vercel resolves `vercel.json` from the repository
root while executing commands in the Root Directory, so whichever it picks up says the
same thing.

**Leave the dashboard's Build & Output overrides empty.** If Install Command, Build Command
or Output Directory were ever typed in by hand, they can disagree with `vercel.json` and
with the Root Directory — an Output Directory of `app/dist` combined with a Root Directory
of `app` resolves to `app/app/dist`, which does not exist, and the deployment serves
nothing.

> **Failure signatures, all three of which this repo hit:**
>
> - `sh: line 1: cd: app: No such file or directory` — a command is changing into `app/`
>   when it is already there. Root Directory is `app`; the command assumes the repo root.
> - A wall of npm usage text ending in `Run "npm help ci" for more info` — npm's `EUSAGE`.
>   `npm ci` found no `package-lock.json` where it looked. Same cause, other direction.
> - **`404 NOT_FOUND` on every path, with a build that reports success** — the build ran but
>   Vercel is serving a directory with no `index.html` in it. The Output Directory does not
>   point at the `dist/` the build actually produced. Open the deployment and use the
>   **Source** tab to see the files it published: if `index.html` is not at the top of that
>   listing, this is the problem.
>
> All three are the same underlying mistake — a path that assumes a different working
> directory than the one Vercel uses.

### 3. Set the Mapbox token

Vercel → Settings → Environment Variables. Add it for **Production** (and Preview, if you
want branch deploys to work):

```
VITE_MAPBOX_TOKEN = pk.your_token_here
```

**Then redeploy.** This is the step that catches everyone. Anything prefixed `VITE_` is
read *when the site is built* and inlined into the JavaScript — adding the variable does
nothing to a deployment that already exists. Deployments → the latest one → Redeploy.

**Then allow the domain on the token.** A Vercel project answers on several hostnames — the
production domain, a `-git-branch-` one, and a new per-deployment one every time — so a
token restricted to a single URL will work on one of them and 401 on the rest. At
<https://account.mapbox.com/access-tokens/>, open the token and either clear its URL
restrictions or list all of them:

```
https://*.vercel.app/*
https://your-custom-domain.com/*
```

It must be a public `pk.` token. A secret `sk.` token cannot be used by a browser, and
because `VITE_` variables end up in the published bundle, putting one there would publish
it. That is also why the URL restriction matters: the token is readable by anyone who
views source, and the restriction is what stops it being used elsewhere.

#### If the map still does not draw

The app now says which of the two problems it is, full-screen, rather than leaving a blank
stage:

| on screen | meaning | fix |
|---|---|---|
| **No Mapbox token in this build** | the variable was not set when the build ran | set it, then **redeploy** — an existing deployment cannot pick it up |
| **Mapbox rejected this token (HTTP 401)** | the token is in the build and Mapbox refused it | almost always a URL restriction that does not cover this hostname |

Before this, a rejected token drew an empty stage and reported nothing at all, which is
indistinguishable from a broken build.

### 4. Check the deploy

Open each of the five pages once. If the map draws but every boundary is missing, the data
did not ship — confirm `app/public/data/` is in the repo, not ignored.

---

## The deck

**<http://localhost:5173/>**

114 scenes: a two-part cold open, the 93 counter beats, and 14 choreographed sequences
spliced in at their script positions. Step it by hand while recording.

| key | |
|---|---|
| → / space | next scene (plays its choreography) |
| ← | previous scene (always instant, always the exact end state) |
| Home / End | first / last scene |
| `H` | hide the HUD, for clean b-roll |
| `I` | scene index readout |
| `P` | preload every layer, for an uninterrupted recording pass |
| `R` | reset the cue clock, at the top of a take |
| `C` | dump the cue track as CSV (console + clipboard) for the edit |
| mouse | pan and zoom, for framing a shot by hand (off in record mode) |

Pressing → during a choreography lands the current scene immediately; the next press
advances. A half-finished animation never survives a keypress.

**Deep-link a scene:** `?scene=beat-42`, `?scene=arizona-clocks`, `?scene=ys-sliver`.

**[SCENES.md](SCENES.md) is the full list** — all 114, in order, each with its counter
number, title, deep link, pen, layers, on-screen caption and the paragraph of
`docs/script_v3.md` its counter mark sits in. The table below is just the sequences worth
jumping to directly.

**The cue track.** Every counter tick and scene change is stamped with milliseconds since
the last `R`, along with the scene, beat, pen and caption, so the audio pass can be cut
against what actually happened rather than by eye. `C` dumps it as CSV to the console and
the clipboard. Each cue is also dispatched as a `bs:cue` CustomEvent.

### Sequences worth deep-linking

| URL | |
|---|---|
| `/?scene=cold-flyout` | the lot at pitch 60 pulling back to the country |
| `/?scene=census-nesting` | block → block group → tract → county, GEOID digits falling off |
| `/?scene=five-cities` | five official definitions of "city" |
| `/?scene=ys-sliver` | the Idaho strip inside the District of Wyoming |
| `/?scene=arizona-clocks` | a dot driving AZ-264, the clock changing five times |
| `/?scene=zip-zcta` | ZCTA 10001 dissolving to leave one building |
| `/?scene=watershed-nesting` | HUC2 → HUC8 → HUC12 |
| `/?scene=reveal-stack` | 49 polygons in pen order, the counter to 68 |
| `/?scene=manhattan-twice` | Manhattan drawn twice |
| `/?scene=ok-osage` | Osage struck out of the McGirt reservations |
| `/?scene=gerry-il4` | Illinois 4th, the earmuffs |
| `/?scene=texas-grid` | ERCOT, El Paso Electric and the panhandle |
| `/?scene=dma-locked` | the locked layer: hatched country, no DMA polygon |
| `/?scene=paradise-nv` | Paradise, the CDP with no government |

---

## The strobe — `/flash.html`

**<http://localhost:5173/flash.html>**

The camera stands in one place and pulls back continuously for the whole run while the
layers swap underneath it every few hundred milliseconds. No text on it at all.

| option | default | |
|---|---|---|
| `?at=lng,lat` | 350 Fifth Avenue | where to stand |
| `?ms=` | `400` | how long each layer holds; 300–500 is the range that reads |
| `?from=` `?to=` | `13.5` `3.6` | the zoom to pull back through, across the whole run |
| `?pan=` | `0.125` | how far the anchor drifts, as a fraction of the frame |
| `?order=` | `nest` | `nest` (finest first) or `registry` (alphabetical) |
| `?scope=` | — | `nyc` or `national` |
| `?pen=` | — | one pen only: `courts`, `markets`, … |
| `?loop=0` | loops | stop at the end |

SPACE pauses, `R` restarts. Nothing on screen says so.

```
/flash.html                                  the default run, ~21s
/flash.html?ms=300&from=15&to=5              faster, tighter
/flash.html?at=-87.6298,41.8781              stand in Chicago
/flash.html?pen=courts&ms=700                one pen, slower
```

Standing outside New York plays only the layers that cover that place — Chicago gets the
24 national layers and skips the 30 NYC-extent ones.

---

## The drawing pen — `/draw.html`

**<http://localhost:5173/draw.html>**

One layer, exploded into the individual rings a pen would actually draw, sorted west to
east, with a nib walking them in order and leaving the line behind it.

| option | default | |
|---|---|---|
| `?layer=` | `census_state` | the registry key — `census_bg@nyc`, `courts_fed_circuit`, … |
| `?ms=` | `14000` | total duration of the run, whatever the layer's size |
| `?order=` | `lon` | `lon`, `lat`, `area` or `file` |
| `?ghost=0` | shown | hide the faint preview of the undrawn part |
| `?loop=1` | off | restart when it finishes |
| `?frame=full` | trimmed | frame to the true extent, outlying islands included |

Arrows change layer, SPACE pauses, `R` redraws. There is a layer picker in the corner.

```
/draw.html?layer=census_state&ms=10000        51 states, traced one at a time
/draw.html?layer=census_county&ms=20000       3,412 rings sweeping across the country
/draw.html?layer=census_bg@nyc&ms=8000        7,609 rings as a wave across the city
/draw.html?layer=esb_stack@nyc                the 49-polygon reveal stack
```

The run is a fixed duration, so the pen's speed is set by how much geometry the layer
holds. That is deliberate — see [NOTES.md](NOTES.md).

---

## The composite plates — `/matte.html` and `/key.html`

**<http://localhost:5173/matte.html>** — land at 50% grey, place names pure white.
**<http://localhost:5173/key.html>** — the same, with every non-land pixel flat `#00FF00`.

Neither is a new animation. Each runs one of the three pieces with the map restyled and
every readout taken off.

| option | default | |
|---|---|---|
| `?show=` | `flash` | `flash`, `draw` or `deck` |
| `?land=` | `#808080` | land colour |
| `?water=` | `#22262B` / `#00FF00` | non-land colour |
| `?ink=` | `#FFFFFF` | place names |
| `?halo=0` | on | drop the dark halo behind the names |
| `?waterways=1` | off | keep the basemap's hairline river lines |
| `?clip=0` | on for key | stop drawing water above the boundaries |

Every option of the piece you are showing still applies on top of these.

```
/matte.html                                        grey plate, strobe
/matte.html?show=deck&scene=beat-08                grey plate, step the deck by hand
/key.html?show=draw&layer=census_county&ms=20000   green plate, the pen
/key.html?show=deck&scene=arizona-clocks           green plate, the Arizona drive
```

**Measured on the rendered frame:** land exactly `#808080`, key green exactly `#00FF00`,
and on a typical frame 53.5% of pixels are pure key green and 42.9% pure grey. The rest is
coastline antialiasing, the boundary layer and the text.

Two things to know before you key:

- **Boundaries stop at the coastline on the key plate.** The water is drawn above them so
  the sea stays exactly the key colour — without it a semi-transparent county fill over the
  bay turned the green to `#13EE33`, a different tint under every pen. `?clip=0` restores
  the literal stacking, at the cost of a contaminated key.
- **Wide rivers key out as green threads across the land.** They are non-land, so it is
  literally correct, but it means a composite gets thin holes inland. There is no clean
  lever: the basemap draws inland water and the ocean in one layer.

---

## Recording

`?record=1` locks the stage to exactly 1920×1080, hides the cursor, and disables
interaction and Mapbox chrome. Works on all five pages.

```
/?record=1                                 the deck at 1080p
/?record=1&res=4k                          3840×2160
/key.html?show=deck&record=1               a 1080p key plate of the deck
/flash.html?record=1&ms=300
```

The map canvas backing store is exactly the target resolution, and that is worth caring
about: an earlier version scaled the stage to fit the window, which made Mapbox size the
canvas 1921×1081 inside a 1920×1080 box and resample every frame. In a film made of thin
lines that softens everything.

The consequence is that **the stage overflows a window smaller than the target**, which is
the honest situation — you cannot screen-record 1920×1080 on a display that cannot show
it. `&fit=1` scales it down to look at and logs a warning. Don't record that.

Before a take, press `P` on the deck to preload every layer, then `R` to zero the cue
clock.

---

## Regenerating the data

Only needed if the boundary stack changes. Requires the 5.1 GB GeoPackage in `../boundaries`,
which is not part of this repo.

```sh
python3 scripts/export_web.py              # GeoPackage → app/public/data + the .ts files
python3 scripts/export_web.py --dry-run    # what it would write, and how big
python3 scripts/export_web.py --ts-only    # just the .ts, from the GeoJSON already on disk
```

The export fails loudly rather than shipping something wrong: every output is asserted
against a size budget, `docs/beats.yaml` must carry beats 1–93 exactly once with every
layer present in the GeoPackage, and the reveal stack is checked feature by feature against
the locked ESB count.

The scene props are fetched separately, from public sources, with provenance recorded in
`qa/scene_props.md`:

```sh
python3 scripts/fetch_scene_props.py                   # everything
python3 scripts/fetch_scene_props.py --only az264      # just AZ-264
python3 scripts/fetch_scene_props.py --skip-gerrymander  # skips a 39 MB download
```

`--only az264` depends on `app/public/data/fedadmin_time_zone.geojson` already existing,
because it classifies the road against it. Run `export_web.py` first; the script says so
if you don't.

Commit whatever changes, since the build machine cannot regenerate any of it.

### Regenerating SCENES.md

`SCENES.md` is generated from the deck itself, so it needs the dev server up:

```sh
cd app && npm run dev &
python3 scripts/scene_index.py
```

It reads `window.__deck()` from the running app rather than re-deriving the deck order in
Python. The splice of the 14 choreographed sequences into the 93 beats lives in
`scenes.ts`, and a second implementation of it is a second thing to be wrong — an index
that quietly disagrees with the deck is worse than no index. It also reports any beat whose
counter mark it could not find in the script.

---

## Checking it still works

```sh
cd app && npm run build        # tsc --noEmit && vite build — all five pages
```

With the dev server running:

```sh
python3 scripts/smoke.py beat-08 ys-district        # screenshot into qa/shots/
python3 scripts/smoke.py --determinism beat-35      # reach it from both directions, diff
```

The determinism check is the one that matters. It walks away from a scene and back to it,
then asserts the two frames are byte-identical — that is the guarantee the whole engine is
built around. It cannot see mid-transition faults, though, because both frames it compares
are end states; see [NOTES.md](NOTES.md#who-owns-the-hud) for one that slipped through.
