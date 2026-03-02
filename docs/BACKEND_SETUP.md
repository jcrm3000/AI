# LeadHeat backend setup (PRD v11)

## 1) What is implemented

- Supabase Postgres + PostGIS schema
- Required tables:
  - `businesses`
  - `grid_tiles`
  - `crawl_runs`
- Edge Function: weekly crawl using Nearby Search only
- Cost safety:
  - hard stop when `api_calls >= 400`
   - weekly tile slice max `33` tiles
   - fixed 3 categories per tile (`33 × 3 = 99` calls target/week)
- Retention lifecycle:
  - mark inactive after 90 days
  - optional purge after 180 days

## 2) Migrations

Run migration:

- [supabase/migrations/202603010001_leadheat_prd_v11.sql](supabase/migrations/202603010001_leadheat_prd_v11.sql)

This migration creates PostGIS, required tables, checks, and indexes.

## 3) Seed approach for `grid_tiles`

Use file:

- [supabase/seed/grid_tiles_seed.sql](supabase/seed/grid_tiles_seed.sql)

Seed format (CSV):

- `tile_key,min_lng,min_lat,max_lng,max_lat,is_active`

Insert method:

1. Load rows into temporary staging table.
2. Convert bounds to bbox with `st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)`.
3. Upsert into `grid_tiles` by `tile_key`.

## 4) Edge Function

Function entry:

- [supabase/functions/weekly-crawl/index.ts](supabase/functions/weekly-crawl/index.ts)

Behavior:

- Selects next tile slice (`<= 33`) across fixed categories:
  - `RESTAURANT`
  - `HAIR`
  - `HOME_SERVICES`
- Enforces weekly hard rule: if `weekly_tiles × 3 > 100`, it auto-reduces tile slice
- Uses tile centroid + radius `2000m` Nearby Search
- Tracks metrics into `crawl_runs`
- Upserts businesses idempotently by `place_id`
- Enforces cap and exits as `STOPPED_CAP` when needed
- No Place Details, no review text, no images, no scraping

## 5) Required secrets (server-side only)

Set in Supabase project secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_PLACES_API_KEY`

Never expose `GOOGLE_PLACES_API_KEY` client-side.

## 6) Deploy steps

1. Link project:
   - `supabase link --project-ref <your-project-ref>`
2. Push migration:
   - `supabase db push`
3. Deploy function:
   - `supabase functions deploy weekly-crawl`
4. Set secrets:
   - `supabase secrets set SUPABASE_URL=...`
   - `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...`
   - `supabase secrets set GOOGLE_PLACES_API_KEY=...`
5. Invoke once (smoke test):
   - `supabase functions invoke weekly-crawl --no-verify-jwt`
6. Schedule weekly trigger using Supabase Scheduled Functions (cron) once per week.

## 7) Config constants

In [supabase/functions/weekly-crawl/index.ts](supabase/functions/weekly-crawl/index.ts):

- `WEEKLY_TILE_SLICE = 33`
- `SEARCH_RADIUS_METERS = 2000`
- `MAX_API_CALLS = 400`
- `MAX_RETRIES = 3`
- `INACTIVE_AFTER_DAYS = 90`
- `PURGE_AFTER_DAYS = 180`
- `ENABLE_PURGE = false` (safe default)
