#!/usr/bin/env python3
"""
LeadHeat QA — grid_tiles.csv validator (M1-T3)

Runs 8 checks against supabase/seed/grid_tiles.csv:
  1. Header check
  2. Row count (120–180)
  3. Unique tile_keys
  4. Bounds ordering
  5. GAM outer bounding-box containment (centroid)
  6. Tile size (0.015°–0.022° per axis)
  7. is_active all true
  8. Spot-check 5 centroids

Exit 0 + "VALIDATION PASSED" when all checks pass.
Exit 1 + "VALIDATION FAILED" otherwise.

Zero external dependencies — Python 3 stdlib only.
"""

import csv
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
EXPECTED_HEADER = ["tile_key", "min_lng", "min_lat", "max_lng", "max_lat", "is_active"]

ROW_COUNT_MIN = 120
ROW_COUNT_MAX = 180  # PRD hard cap

GAM_LAT_MIN = 9.840
GAM_LAT_MAX = 10.060
GAM_LNG_MIN = -84.260
GAM_LNG_MAX = -83.850

TILE_SPAN_MIN = 0.015  # degrees
TILE_SPAN_MAX = 0.022  # degrees

SPOT_CHECK_INDICES = [0, 35, 71, 107, 143]  # rows 1, 36, 72, 108, 144 (0-based)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def resolve_csv_path() -> Path:
    """Resolve supabase/seed/grid_tiles.csv relative to repo root."""
    # Script lives in <repo>/scripts/  →  repo root is one level up
    repo_root = Path(__file__).resolve().parent.parent
    csv_path = repo_root / "supabase" / "seed" / "grid_tiles.csv"
    if not csv_path.is_file():
        # Fallback: caller might be running from repo root already
        csv_path = Path("supabase/seed/grid_tiles.csv")
    return csv_path


def centroid(min_val: float, max_val: float) -> float:
    return (min_val + max_val) / 2.0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    failures: list[str] = []
    csv_path = resolve_csv_path()

    if not csv_path.is_file():
        print(f"❌  CSV not found at {csv_path}")
        return 1

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        raw_header = next(reader)
        rows = list(reader)

    # ------------------------------------------------------------------
    # CHECK 1 — Header
    # ------------------------------------------------------------------
    header = [h.strip() for h in raw_header]
    print("CHECK 1 — Header")
    if header == EXPECTED_HEADER:
        print("  ✅  Header matches expected columns")
    else:
        msg = f"  Header mismatch: got {header}"
        print(f"  ❌  {msg}")
        failures.append(msg)

    # ------------------------------------------------------------------
    # CHECK 2 — Row count (120–180)
    # ------------------------------------------------------------------
    n = len(rows)
    print(f"\nCHECK 2 — Row count: {n}")
    if ROW_COUNT_MIN <= n <= ROW_COUNT_MAX:
        print(f"  ✅  {n} rows within [{ROW_COUNT_MIN}, {ROW_COUNT_MAX}]")
    else:
        msg = f"Row count {n} outside [{ROW_COUNT_MIN}, {ROW_COUNT_MAX}]"
        print(f"  ❌  {msg}")
        failures.append(msg)

    # Parse rows into dicts for remaining checks
    parsed: list[dict] = []
    for i, row in enumerate(rows, start=2):  # line 2 = first data row
        try:
            parsed.append({
                "line": i,
                "tile_key": row[0].strip(),
                "min_lng": float(row[1]),
                "min_lat": float(row[2]),
                "max_lng": float(row[3]),
                "max_lat": float(row[4]),
                "is_active": row[5].strip().lower(),
            })
        except (IndexError, ValueError) as exc:
            failures.append(f"Parse error on CSV line {i}: {exc}")

    # ------------------------------------------------------------------
    # CHECK 3 — Unique tile_keys
    # ------------------------------------------------------------------
    print("\nCHECK 3 — Unique tile_keys")
    keys = [r["tile_key"] for r in parsed]
    seen: dict[str, int] = {}
    dupes: list[str] = []
    for k in keys:
        seen[k] = seen.get(k, 0) + 1
    for k, cnt in seen.items():
        if cnt > 1:
            dupes.append(f"{k} (×{cnt})")
    if not dupes:
        print(f"  ✅  {len(keys)} tile_keys, zero duplicates")
    else:
        msg = f"Duplicate tile_keys: {', '.join(dupes)}"
        print(f"  ❌  {msg}")
        failures.append(msg)

    # ------------------------------------------------------------------
    # CHECK 4 — Bounds ordering
    # ------------------------------------------------------------------
    print("\nCHECK 4 — Bounds ordering (min < max)")
    bad_bounds: list[str] = []
    for r in parsed:
        issues = []
        if r["min_lng"] >= r["max_lng"]:
            issues.append("min_lng >= max_lng")
        if r["min_lat"] >= r["max_lat"]:
            issues.append("min_lat >= max_lat")
        if issues:
            bad_bounds.append(f"  line {r['line']} ({r['tile_key']}): {', '.join(issues)}")
    if not bad_bounds:
        print("  ✅  All rows have min < max for both axes")
    else:
        msg = f"{len(bad_bounds)} row(s) with bad bounds"
        print(f"  ❌  {msg}")
        for b in bad_bounds[:10]:
            print(b)
        failures.append(msg)

    # ------------------------------------------------------------------
    # CHECK 5 — Outer bounding-box (GAM containment)
    # ------------------------------------------------------------------
    print("\nCHECK 5 — GAM outer bounding-box containment (centroid)")
    outside: list[str] = []
    for r in parsed:
        clat = centroid(r["min_lat"], r["max_lat"])
        clng = centroid(r["min_lng"], r["max_lng"])
        if not (GAM_LAT_MIN <= clat <= GAM_LAT_MAX):
            outside.append(f"  line {r['line']} ({r['tile_key']}): centroid_lat={clat:.6f} outside [{GAM_LAT_MIN}, {GAM_LAT_MAX}]")
        if not (GAM_LNG_MIN <= clng <= GAM_LNG_MAX):
            outside.append(f"  line {r['line']} ({r['tile_key']}): centroid_lng={clng:.6f} outside [{GAM_LNG_MIN}, {GAM_LNG_MAX}]")
    if not outside:
        print(f"  ✅  All {len(parsed)} centroids within GAM box")
    else:
        msg = f"{len(outside)} centroid violation(s)"
        print(f"  ❌  {msg}")
        for o in outside[:10]:
            print(o)
        failures.append(msg)

    # ------------------------------------------------------------------
    # CHECK 6 — Tile size (0.015°–0.022° per axis)
    # ------------------------------------------------------------------
    print("\nCHECK 6 — Tile size (lat/lng span in [0.015°, 0.022°])")
    bad_size: list[str] = []
    for r in parsed:
        lat_span = round(r["max_lat"] - r["min_lat"], 6)
        lng_span = round(r["max_lng"] - r["min_lng"], 6)
        issues = []
        if not (TILE_SPAN_MIN <= lat_span <= TILE_SPAN_MAX):
            issues.append(f"lat_span={lat_span:.6f}")
        if not (TILE_SPAN_MIN <= lng_span <= TILE_SPAN_MAX):
            issues.append(f"lng_span={lng_span:.6f}")
        if issues:
            bad_size.append(f"  line {r['line']} ({r['tile_key']}): {', '.join(issues)}")
    if not bad_size:
        print(f"  ✅  All tiles within [{TILE_SPAN_MIN}°, {TILE_SPAN_MAX}°] on both axes")
    else:
        msg = f"{len(bad_size)} tile(s) with out-of-range span"
        print(f"  ❌  {msg}")
        for b in bad_size[:10]:
            print(b)
        failures.append(msg)

    # ------------------------------------------------------------------
    # CHECK 7 — is_active column (all must be true)
    # ------------------------------------------------------------------
    print("\nCHECK 7 — is_active column")
    not_true = [r for r in parsed if r["is_active"] != "true"]
    if not not_true:
        print("  ✅  All rows have is_active = true")
    else:
        msg = f"{len(not_true)} row(s) where is_active ≠ true"
        print(f"  ❌  {msg}")
        for r in not_true[:10]:
            print(f"  line {r['line']} ({r['tile_key']}): is_active={r['is_active']}")
        failures.append(msg)

    # ------------------------------------------------------------------
    # CHECK 8 — Spot-check 5 centroids
    # ------------------------------------------------------------------
    print("\nCHECK 8 — Spot-check centroids (rows 1, 36, 72, 108, 144)")
    print(f"  {'row':>4}  {'tile_key':<12}  {'centroid_lat':>13}  {'centroid_lng':>13}")
    print(f"  {'----':>4}  {'------------':<12}  {'-------------':>13}  {'-------------':>13}")
    spot_ok = True
    for idx in SPOT_CHECK_INDICES:
        if idx < len(parsed):
            r = parsed[idx]
            clat = centroid(r["min_lat"], r["max_lat"])
            clng = centroid(r["min_lng"], r["max_lng"])
            print(f"  {idx + 1:>4}  {r['tile_key']:<12}  {clat:>13.6f}  {clng:>13.6f}")
        else:
            print(f"  {idx + 1:>4}  — row does not exist (only {len(parsed)} data rows)")
            spot_ok = False
    if spot_ok:
        print("  ✅  Spot-check rows printed")
    else:
        msg = "Spot-check failed — not enough rows for requested indices"
        print(f"  ❌  {msg}")
        failures.append(msg)

    # ------------------------------------------------------------------
    # Final verdict
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    if not failures:
        print(f"✅ VALIDATION PASSED — {n} tiles, all checks OK")
        return 0
    else:
        print("❌ VALIDATION FAILED")
        for i, f in enumerate(failures, 1):
            print(f"   {i}. {f}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
