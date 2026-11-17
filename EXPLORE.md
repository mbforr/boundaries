# The Geography of Invisible Lines: layer explorer

`app/explore.html` is a public page that ships with the video. It lists every boundary
type counted in the video (93), grouped by who drew the line. Viewers can switch on any
of the 52 mapped types, see where each came from, and see why the other 41 have no
geometry. It only reads the committed exports; it doesn't change the deck, the gallery
or the plates.

## URL

On any deploy of this repo, the page is at `/explore.html`.

| Parameter | Example | Meaning |
|---|---|---|
| `on` | `on=census_tract,nyc_zoning_district` | Types switched on. Use a layer id, or the video number for the four types that share a file (`5`, `9`, `14`, `17`). A shared layer id switches on both of its types. |
| `sel` | `sel=61` | The type open in the drawer, by video number. |
| `group` | `group=chapter` | Group by video chapter instead of who drew it. |
| `scope` | `scope=missing` | Show only `mapped` or `missing` types. |
| `q` | `q=school` | Search box. A bare number like `61` finds that type. |
| `theme` | `theme=dark` | Force a theme. By default the page follows the system setting. |

The page keeps the URL in sync as you click, so the address bar is always a shareable link.

## How the data gets there

```
docs/beats.yaml ──┐
docs/catalog.yaml ┼─ scripts/build_catalog.py ─┬─ app/src/catalog.generated.ts  (the page imports this)
layers.generated.ts┘                           └─ app/public/data/catalog.csv   (Download CSV)
```

- **`docs/catalog.yaml` is the file to edit.** It holds one row per type: pen, sources, licenses, missing reasons, the sentence the drawer shows.
- **Rows, labels, chapter pens and scope** must match `docs/beats.yaml`. The build fails if they drift.
- **Feature counts, extents and "at the Empire State Building"** are computed from the exported GeoJSON on every build.
- **The pin result is cross-checked** against `../boundaries/qa/esb_final_count.md` when the data repo is next to this one.

```sh
python3 scripts/build_catalog.py                 # validate + regenerate
python3 scripts/build_catalog.py --check-urls    # also re-fetch every URL; writes qa/catalog_url_check.md
python3 scripts/build_catalog.py --table qa/catalog_review.md   # the review table
python3 scripts/check_contrast.py                # light-map pen colours against the land colour
python3 scripts/smoke_explore.py [--all-layers] [--url …]       # needs `npm run dev`
```

No count on the page is hardcoded. Every number is computed from `CATALOG` when the page loads.

## Decisions (Gate 1, Nov 16 2026)

- **Pens.** Grouped by who drew the line. Mapped types take the data repo's registry pen, with two overrides:
  - #1 is Congress, not statisticians.
  - #9 is statisticians, not politicians.

  Missing types use the draft pens from the handoff. Four of them differ from `layers.yaml`, and the table marks each with "layers.yaml says …": #36, #59, #60 and #87.
- **#5 and #9 share `census_place`.**
  - #5 City limits draws incorporated places only: LSAD 25 and 47, cities and villages.
  - #9 Census place draws every place, including CDPs.
- **#14 and #17 share `census_cbsa`.** #14 draws LSAD M1, metropolitan. #17 draws M2, micropolitan.
- **#44 Pricing zone and #54 CBP field office are *no national file*.** Neither has a national file.
- **#49 stays *blocked*, to match the video's card.** The drawer says the Kansas City Fed file downloads fine now.
- **Light-map colours.** Each pen gets a darker variant of the same hue, reaching 3:1 on the land colour. The dark map uses the video's colours unchanged.

## Known gaps

- **8 URLs are not verified.** All of them are sites that block scripts: nycourts.gov (#31, #32), DataLumos (#42, #43, #45–47) and fcc.gov (#64). The page labels them "not verified". The DataLumos archive terms couldn't be read either.
- **Hardiness zones (#85).** The page credits USDA-ARS and the PRISM Group in text. The data repo's manifest says USDA-ARS and OSU logos are required on derived maps, and that still needs a decision.
- **The explorer has its own map module** (`src/explore/map.ts`) rather than the deck's `LayerManager`. That manager keys one style layer per file, and the four shared-file types each need their own colour or filter.
- **Weight.** Layers load the first time they're switched on.
  - The two largest are `usda_hardiness_zone` (17 MB raw, about 2.3 MB brotli) and `nws_forecast_zone` (12 MB raw, about 2.0 MB).
  - Both are under the 3 MB transfer budget, but parsing 17 MB of JSON is slow on a phone.
  - PMTiles is the fallback if the preview measures too slow. It needs the `pmtiles` npm package.
- **`vite.config.ts`.** This branch adds `explore` to the page list. It will conflict with the uncommitted `lines` page work on `main`. Keep both entries.
