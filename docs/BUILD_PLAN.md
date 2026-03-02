# LeadHeat — Executable Build Plan (PRD v11)
**Orchestrator:** LeadHeat Build PM  
**Date:** 2026-03-01  
**Scope lock:** PRD v11 — Nearby Search only. No Place Details, no enrichment, no SaaS features.

---

## Artifact Status (Baseline)

| Artifact | File | Status |
|---|---|---|
| PostGIS schema migration | `supabase/migrations/202603010001_leadheat_prd_v11.sql` | ✅ Done |
| Grid tile seed template | `supabase/seed/grid_tiles_seed.sql` | ✅ Done (template only — needs real CSV) |
| Weekly crawl Edge Function | `supabase/functions/weekly-crawl/index.ts` | ✅ Done — needs smoke test |
| Real grid tile CSV | `supabase/seed/grid_tiles.csv` | ❌ Not started |
| Supabase cron schedule | project dashboard | ❌ Not started |
| UI layer | — | ❌ Not started |
| Observability / alerting | — | ❌ Not started |

---

## Milestones & Build Order

```
M1 Tile Validation
      ↓
M2 DB & Schema Lock
      ↓
M3 Crawl Smoke Test
      ↓
M4 UI Layer
      ↓
M5 Observability
```

No milestone may begin until all tasks in the prior milestone reach **Done**.

---

## M1 — Tile Validation & Grid Setup

**Goal:** Produce a validated `grid_tiles.csv` that covers the target geography with non-overlapping ~2 km tiles. Nothing else is deployed until tiles pass validation.

| ID | Task | Agent | Output | Definition of Done |
|---|---|---|---|---|
| M1-T1 | Define target geography bounding box (city / region) | **Architect** | `docs/GEOGRAPHY.md` with `min_lng, min_lat, max_lng, max_lat` constants | Doc committed; bounding box confirmed by PM |
| M1-T2 | Generate tile grid CSV (~2 km × 2 km cells, WGS-84) | **Backend** | `supabase/seed/grid_tiles.csv` | File exists; `tile_key` values are unique; every row passes `min_lng < max_lng` and `min_lat < max_lat` checks; tile count ≤ 200 |
| M1-T3 | Validate CSV geometry in isolation | **QA** | Validation script `scripts/validate_tiles.py` | Script runs with zero errors; prints tile count, bbox coverage area, centroid spot-checks for 5 tiles |
| M1-T4 | Architect sign-off on tile density | **Architect** | Comment in PR | Tile spacing ≥ 1.5 km and ≤ 2.5 km confirmed; no tiles outside target bbox |

**Scope guard:** No enrichment of tiles. No POI data attached to tiles.

---

## M2 — DB & Schema Lock

**Goal:** Migration deployed, tiles seeded, schema frozen before any crawl runs.

| ID | Task | Agent | Output | Definition of Done |
|---|---|---|---|---|
| M2-T1 | Link Supabase project and push migration | **Backend** | `supabase db push` succeeds | All 3 tables exist in Supabase; PostGIS extension active; all indexes present; `supabase db diff` shows no drift |
| M2-T2 | Bulk-load `grid_tiles.csv` via seed script | **Backend** | Rows in `public.grid_tiles` | `select count(*) from grid_tiles where is_active = true` matches CSV row count; generated columns (`bbox`, `centroid_lat`, `centroid_lng`) are non-null for all rows |
| M2-T3 | Set all three Supabase secrets | **Backend** | Secrets confirmed in dashboard | `supabase secrets list` shows `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_PLACES_API_KEY`; no keys committed to repo |
| M2-T4 | Schema audit — constraints & RLS | **Auditor** | Audit note in PR | `website_type` check constraint verified; `main_category` check constraint verified; `crawl_runs.status` check constraint verified; RLS disabled on all tables (internal-only, no public client access confirmed) |
| M2-T5 | Freeze schema version | **Architect** | `docs/BACKEND_SETUP.md` updated with "Schema: LOCKED v11" banner | No new migrations allowed without PM approval and new milestone |

**Scope guard:** No additional columns. No new tables. Schema is closed.

---

## M3 — Crawl Smoke Test & Cron

**Goal:** One real crawl run completes successfully end-to-end, metrics recorded, cron scheduled.

| ID | Task | Agent | Output | Definition of Done |
|---|---|---|---|---|
| M3-T1 | Deploy Edge Function | **Backend** | `supabase functions deploy weekly-crawl` | Function visible in Supabase dashboard; no build errors |
| M3-T2 | Smoke test — dry invoke (1-tile override) | **QA** | Invoke with `{"tile_limit": 1}` or env-patched slice of 1 | Response `ok: true`; `crawl_runs` row with `status = 'SUCCESS'`; `api_calls = 3` (one tile × 3 categories); `businesses` has new rows; no `FAILED` or `STOPPED_CAP` |
| M3-T3 | Smoke test — cap enforcement | **QA** | Invoke with a mocked run that hits `MAX_API_CALLS` | Run ends with `status = 'STOPPED_CAP'`; `api_calls ≤ 400`; no unhandled exception |
| M3-T4 | Verify idempotent upsert | **QA** | Run same tile twice | `businesses` row count unchanged on second run for same `place_id`; `last_seen` updated; no duplicate rows |
| M3-T5 | Verify retention lifecycle | **QA** | SQL: set `last_seen` to 91 days ago on test row; invoke crawl | Test row's `is_active` flips to `false` after run |
| M3-T6 | Verify score formula | **Auditor** | Code review of `scoreBusinessByCategory` | Formula uses `Math.log(n+1)*40 + r*10 - websitePenalty + categoryBonus`; `website_type` is always `NO_WEBSITE` (correct — no Place Details); no negative scores for valid inputs; precision is 4 decimal places |
| M3-T7 | Set up weekly cron in Supabase | **Backend** | Scheduled function configured | Cron set to `0 3 * * 1` (Monday 03:00 UTC); confirmed in Supabase dashboard; does **not** run more than once per week |
| M3-T8 | Post-smoke cost check | **Auditor** | `crawl_runs` query | `estimated_cost` for smoke test is `api_calls × $0.032`; projected full weekly run (99 calls) ≤ $3.17 |

**Scope guard:** Do not add pagination beyond 3 pages. Do not add Place Details calls. Do not add new categories.

---

## M4 — UI Layer

**Goal:** Read-only web UI showing business list and crawl run history. No write operations from UI.

| ID | Task | Agent | Output | Definition of Done |
|---|---|---|---|---|
| M4-T1 | Architect UI contract | **Architect** | `docs/UI_CONTRACT.md` — defines pages, queries, column display list | Doc committed; queries use only `anon` Supabase key (read-only); no service role key in client |
| M4-T2 | Scaffold frontend project | **Frontend** | `/app` directory with framework (Next.js App Router) | `npm run dev` starts; no build errors; `.env.local` template committed (no secrets) |
| M4-T3 | Business list page `/businesses` | **Frontend** | Paginated table — `name`, `main_category`, `rating`, `reviews_count`, `score`, `is_active` | Page loads ≤ 2 s (local); sort by `score desc` default; filter by `main_category`; filter by `is_active` |
| M4-T4 | Crawl history page `/crawl-runs` | **Frontend** | Table — `run_month`, `status`, `tiles_processed`, `api_calls`, `estimated_cost`, `completed_at` | Rows ordered by `created_at desc`; `STOPPED_CAP` and `FAILED` rows highlighted in amber/red |
| M4-T5 | Map view (optional, gated) | **Frontend** | `/map` page with dot markers for `is_active = true` businesses | Only built if M4-T3 and M4-T4 are both Done; uses Mapbox GL or Leaflet; no new API keys except Mapbox public token |
| M4-T6 | UI security audit | **Auditor** | PR review | `SUPABASE_ANON_KEY` only; RLS verified for anon read; no `service_role` key in client bundle; no user auth required (internal tool) |
| M4-T7 | QA UI smoke | **QA** | Manual checklist | Business list renders ≥ 1 row; category filter works; crawl history page shows last run; no console errors; mobile viewport not broken |

**Scope guard:** No business edit/delete from UI. No score override. No user accounts. No SaaS features.

---

## M5 — Observability

**Goal:** Automated alerting when crawl fails or cost spikes; cost dashboard queryable.

| ID | Task | Agent | Output | Definition of Done |
|---|---|---|---|---|
| M5-T1 | Crawl failure alert | **Backend** | Supabase Database Webhook or pg_cron alert function | Alert fires (email or Slack webhook) within 10 min when `crawl_runs.status` is `FAILED` or `STOPPED_CAP` |
| M5-T2 | Weekly cost summary view | **Backend** | SQL view `public.v_weekly_cost_summary` | View returns `run_month`, `total_api_calls`, `total_estimated_cost`, `run_count`; queryable from UI |
| M5-T3 | Cost spike guard | **Backend** | SQL check or Edge Function pre-flight | If `sum(estimated_cost) for current month > $15`, crawl refuses to start and returns `STOPPED_CAP` with reason `MONTHLY_BUDGET_EXCEEDED` |
| M5-T4 | Crawl run dashboard widget | **Frontend** | Banner on `/crawl-runs` page | Shows current-month total cost from `v_weekly_cost_summary`; green ≤ $10, amber $10–$15, red > $15 |
| M5-T5 | Observability audit | **Auditor** | Final review | Alert tested end-to-end; cost view returns correct numbers; monthly guard triggers at correct threshold; no new external services introduced |

**Scope guard:** No third-party APM. No Datadog, Sentry, or similar SaaS. Postgres-native observability only.

---

## Agent Responsibility Matrix

| Agent | Milestones | Cannot Touch |
|---|---|---|
| **Architect** | M1-T1, M1-T4, M2-T5, M4-T1 | No code production |
| **Backend** | M2-T1–T3, M3-T1, M3-T7, M5-T1–T3 | No UI code; no Place Details calls |
| **Frontend** | M4-T2–T5 | No service-role key; no write ops |
| **Auditor** | M2-T4, M3-T6, M3-T8, M4-T6, M5-T5 | Read-only review role |
| **QA** | M1-T3, M3-T2–T5, M4-T7 | No production deploys |

---

## Hard Scope Boundaries (PRD v11 Freeze)

The following are **permanently out of scope** for this build. Any agent that introduces these triggers an immediate PR rejection:

- ❌ Google Place Details API calls
- ❌ Review text, photos, or opening hours
- ❌ Web scraping or third-party data enrichment
- ❌ User authentication or multi-tenant SaaS
- ❌ Payment processing
- ❌ New database tables beyond `grid_tiles`, `businesses`, `crawl_runs`
- ❌ New crawl categories beyond `RESTAURANT`, `HAIR`, `HOME_SERVICES`
- ❌ `WEEKLY_TILE_SLICE > 33` or `MAX_API_CALLS > 400`
- ❌ Third-party APM/monitoring SaaS

---

## Config Constants Reference (Frozen)

All constants live in [`supabase/functions/weekly-crawl/index.ts`](../supabase/functions/weekly-crawl/index.ts). Do not change without PM sign-off.

| Constant | Value | Purpose |
|---|---|---|
| `WEEKLY_TILE_SLICE` | 33 | Max tiles per weekly run |
| `SEARCH_RADIUS_METERS` | 2000 | Nearby Search radius |
| `MAX_API_CALLS` | 400 | Hard cap per invocation |
| `MAX_RETRIES` | 3 | HTTP retry attempts |
| `INACTIVE_AFTER_DAYS` | 90 | Mark businesses inactive |
| `PURGE_AFTER_DAYS` | 180 | Hard delete (gate: `ENABLE_PURGE = false`) |
| `SCORE_VERSION` | 1 | Bumped only on formula change |

---

## Task Handoff Protocol

1. Agent marks task **In Progress** by opening a PR with the task ID in the title (e.g., `[M2-T1] Push migration`).
2. PR must include: artifact produced, manual test evidence (screenshot or query result), and self-checklist against the Definition of Done.
3. **Auditor** reviews any task touching secrets, costs, or schema.
4. **PM** merges after DoD is met. No partial merges.
5. Next-milestone tasks do not start until the current milestone PR is merged to `main`.
