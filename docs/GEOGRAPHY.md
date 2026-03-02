# LeadHeat — Target Geography Definition

> **Milestone:** M1 — Tile Validation
> **Task:** M1-T1 — Define Target Geography
> **PRD Version:** v11 (Locked)
> **Status:** DRAFT — Awaiting PM approval

---

## 1. Geographic Scope

**Region:** Gran Área Metropolitana (GAM), Costa Rica
**Strategy:** Curated commercial corridors only — no flood-fill
**Rural/mountain zones:** Excluded

The GAM spans portions of four provinces (San José, Alajuela, Cartago, Heredia)
across Costa Rica's Central Valley and Guarco Valley. LeadHeat targets **only the
commercially active corridors** within this area — not the full administrative
boundary.

---

## 2. Outer Bounding Box (WGS-84)

This box encompasses **all** curated corridors with margin. It is a governance
boundary, not a crawl geometry. No tile centroid may fall outside this box.

| Bound   | Value         |
|---------|---------------|
| min_lat | **9.840° N**  |
| max_lat | **10.060° N** |
| min_lng | **−84.260° W**|
| max_lng | **−83.850° W**|

**Validation:** min_lat (9.840) < max_lat (10.060) ✔ — min_lng (−84.260) < max_lng (−83.850) ✔

Approximate envelope: **~24 km (N–S) × 41 km (E–W)**

Reference center (GAM centroid): 9.933° N, 84.083° W

---

## 3. Commercial Corridors — Included

### Tier 1 — Provincial Capitals & Primary Commercial Cores

These are the highest-density commercial zones. They receive the largest tile
allocations and should be prioritized in weekly crawl slices.

| # | Corridor Name | Key Areas | Est. Tiles |
|---|--------------|-----------|------------|
| 1 | **San José Centro** | Catedral, Hospital, Merced, Carmen districts; Avenida Central/Segunda commercial strip | 14 |
| 2 | **Escazú – Santa Ana** | San Rafael de Escazú, San Miguel, Multiplaza corridor; Santa Ana Forum/City Place zone | 12 |
| 3 | **Heredia Centro** | Central market area, Avenida Central, surrounding commercial blocks | 10 |
| 4 | **Alajuela Centro** | Central market, cathedral zone, Ruta 1 commercial strip | 10 |
| 5 | **Cartago Centro** | Basílica zone, central market, Las Ruinas commercial area | 8 |

**Tier 1 subtotal: 54 tiles**

### Tier 2 — Major Commercial Arteries & Corridors

Secondary commercial concentrations along major road corridors and established
business zones.

| # | Corridor Name | Key Areas | Est. Tiles |
|---|--------------|-----------|------------|
| 6 | **Paseo Colón – La Sabana – Rohrmoser** | Paseo Colón strip, La Sabana business district, Rohrmoser commercial area | 8 |
| 7 | **Pavas – La Uruca** | Ruta 1 corridor, industrial/commercial zone, Pavas commercial centers | 8 |
| 8 | **San Pedro – Montes de Oca – Curridabat** | UCR perimeter, Mall San Pedro, Pinares, Curridabat commercial strip | 10 |
| 9 | **Guadalupe – Goicoechea – Moravia** | Guadalupe center, Lincoln Plaza, Moravia commercial strip | 8 |
| 10 | **Desamparados Centro** | Central market area, main commercial avenues | 6 |
| 11 | **Tibás – Cinco Esquinas** | Cinco Esquinas commercial node, surrounding service businesses | 5 |
| 12 | **Belén – Flores** | Airport corridor, commercial/industrial parks, San Antonio de Belén | 6 |
| 13 | **Tres Ríos – La Unión** | Tres Ríos center, Terramall area, Ruta 2 commercial strip | 6 |
| 14 | **Santo Domingo de Heredia** | Town center, Ruta 3 corridor to San José | 5 |

**Tier 2 subtotal: 62 tiles**

### Tier 3 — Secondary Commercial Centers

Smaller but identifiable commercial nodes worth covering for lead density.

| # | Corridor Name | Key Areas | Est. Tiles |
|---|--------------|-----------|------------|
| 15 | **Zapote – San Francisco de Dos Ríos** | Zapote roundabout area, San Francisco main road | 5 |
| 16 | **Coronado Centro (San Isidro)** | San Isidro de Coronado town center | 4 |
| 17 | **Barva – San Rafael de Heredia** | Barva center, San Rafael commercial zone | 4 |
| 18 | **San Pablo de Heredia** | Town center, connecting corridor to Heredia | 3 |
| 19 | **Alajuelita Centro** | Main commercial street and market area | 3 |
| 20 | **Paraíso de Cartago** | Town center, main commercial street | 3 |
| 21 | **Oreamuno – San Rafael de Cartago** | San Rafael center, Oreamuno commercial area | 3 |
| 22 | **San Rafael de Alajuela** | Town center, Ruta 1 adjacent commercial zone | 3 |

**Tier 3 subtotal: 28 tiles**

---

## 4. Tile Count Summary

| Tier | Corridors | Tiles |
|------|-----------|-------|
| Tier 1 — Primary cores | 5 | 54 |
| Tier 2 — Major arteries | 9 | 62 |
| Tier 3 — Secondary centers | 8 | 28 |
| **Total** | **22** | **144** |

**Hard cap:** 180 tiles (PRD v11)
**Headroom:** 36 tiles available for reallocation based on density analysis

> ✔ Total (144) is within the 120–180 range.
> Remaining headroom (36 tiles) is intentional — tiles may be reallocated from
> low-density corridors to high-density corridors after initial crawl data is
> analyzed. **Tiles are never added beyond 180; they are moved.**

---

## 5. Tile Spacing Constraint

All tiles must satisfy:

> **Center-to-center spacing: ≥ 1.5 km and ≤ 2.5 km**

This ensures:
- **Minimum overlap control** — adjacent tiles' 2,000 m crawl radii do not
  excessively duplicate results (spacing ≥ 1.5 km)
- **No coverage gaps** — no dead zones between tiles within a corridor
  (spacing ≤ 2.5 km)
- **Consistent density** — uniform crawl granularity across all corridors

The tile grid generator (downstream task) must enforce this constraint during
CSV generation.

---

## 6. Zones Explicitly Excluded

The following areas fall within or near the GAM administrative boundary but are
**excluded** from LeadHeat coverage due to low commercial density, rural
character, or mountain terrain.

| Excluded Zone | Reason |
|--------------|--------|
| **Aserrí** (rural districts) | Mountain terrain, sparse commercial activity |
| **Mora** (Ciudad Colón and west) | Rural/semi-rural, low business density |
| **Poás** | Volcanic slopes, agricultural, no commercial corridors |
| **Atenas** | Outside commercial GAM core, rural character |
| **Alvarado** (Pacayas) | Rural Cartago canton, agricultural |
| **Paraíso** (outer districts) | Rural eastern edge, only town center included |
| **Oreamuno** (outer districts) | Mountain slopes above town center excluded |
| **Santa Bárbara de Heredia** (outer districts) | Semi-rural, coffee farms |
| **San Isidro de Heredia** (outer districts) | Mountain slopes, residential only |
| **Northern Barva / Barva Volcano slopes** | Mountain terrain, no commercial activity |
| **Southern Desamparados / Aserrí slopes** | Mountain terrain descending to Río Candelaria |
| **El Guarco** (outer districts) | Rural Guarco Valley fringe |

**Rule:** If a zone is not listed in Section 3, it is excluded. The inclusion
list is exhaustive.

---

## 7. Downstream Usage

This document serves as the **authoritative input** for:

1. **`grid_tiles.csv` generation** — Backend will use corridor definitions and
   the outer bounding box to place 2 km × 2 km tile bounding boxes with
   centroids satisfying the 1.5–2.5 km spacing constraint.
2. **Coverage validation** — Tile count per corridor can be compared against
   this document to verify allocation.
3. **Reallocation decisions** — Post-crawl density analysis may shift tiles
   between corridors, but total must never exceed 180.

---

## 8. Acceptance Checklist

- [x] Outer bounding box present with valid WGS-84 coordinates
- [x] min_lat (9.840) < max_lat (10.060)
- [x] min_lng (−84.260) < max_lng (−83.850)
- [x] Named commercial corridors with tile estimates
- [x] Total estimated tiles (144) within 120–180 range
- [x] No rural or mountain zones included in corridor list
- [x] Tile spacing constraint documented (≥ 1.5 km, ≤ 2.5 km)
- [x] Exclusion list present and explicit
- [x] Document is ready as input for `grid_tiles.csv` generation
