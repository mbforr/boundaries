# One Landmark. 68 Governments.

A Mapbox GL deck for the video, plus four other ways of looking at the same boundary
stack. Everything is stepped or driven by hand while screen recording; nothing here is a
finished video.

The geometry comes from a 5.1 GB GeoPackage that lives outside this repo. Nothing in here
re-derives a boundary or recomputes the at-pin count.

## The five pages

| page | what it is |
|---|---|
| [`/`](app/index.html) | **the deck** — 109 scenes, stepped with the arrow keys |
| [`/flash.html`](app/flash.html) | one place, every boundary over it, strobing past |
| [`/draw.html`](app/draw.html) | one layer, drawn by a moving pen |
| [`/matte.html`](app/matte.html) | any of the above, grey land and white names |
| [`/key.html`](app/key.html) | any of the above, non-land in chroma green |

The last two are composite plates: the same pieces with the map restyled and every readout
taken off, for footage that gets keyed or laid under something else.

**[GUIDE.md](GUIDE.md) has the URL for each one, every option it takes, and how to record
it.** [NOTES.md](NOTES.md) has why it is built this way.

## Run it

```sh
cp app/.env.example app/.env      # add a Mapbox public token
cd app && npm install && npm run dev
```

Then <http://localhost:5173/>.

The data is committed, so that is all it takes. Regenerating it needs the GeoPackage —
see [GUIDE.md](GUIDE.md#regenerating-the-data).

## Layout

| path | |
|---|---|
| `app/` | the Vite app — all five pages |
| `app/src/scenes/` | the choreographed sequences |
| `app/src/gallery/` | flash, draw, and the plates |
| `app/src/engine/` | scene state, steps, layers, the AZ-264 drive |
| `app/public/data/` | 94 MB of exported GeoJSON, committed |
| `scripts/` | export, scene props, smoke tests |
| `docs/beats.yaml` | the crosswalk from the script's 93 counter marks to layers |
| `qa/` | provenance and export receipts |

## Attribution owed in the video description

- Mapbox (basemap; the app suppresses the on-map attribution for recording).
- ODbL — timezone-boundary-builder, for `fedadmin_time_zone`.
- USDA-ARS and Oregon State University, for `usda_hardiness_zone`.
- US Census Bureau TIGER, for AZ-264 and the out-of-state scene props.
