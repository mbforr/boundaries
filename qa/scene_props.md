# Scene props

Geometry fetched for individual scenes rather than added to the boundary stack.
census_place is a state-36 subset by CLAUDE.md rule 6 and the locked ESB count is
computed from it, so out-of-state city limits are kept out of it deliberately.
AZ-264 is here for a different reason: it is a road, not a boundary, so it has no
pen and belongs in no manifest — but it is a real road, downloaded like the rest,
because the alternative was drawing an invented one.

| prop | source | retrieved | bytes | sha256 |
|---|---|---|---:|---|
| `az_roads` | https://www2.census.gov/geo/tiger/TIGER2025/PRISECROADS/tl_2025_04_prisecroads.zip | 2026-09-18 | 2,585,481 | `cbcea97b375b…` |
