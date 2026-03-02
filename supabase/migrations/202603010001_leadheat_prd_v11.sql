-- LeadHeat PRD v11 schema
-- Requires: Supabase Postgres + PostGIS

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- Shared updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.grid_tiles (
  id uuid primary key default gen_random_uuid(),
  tile_key text not null unique,
  min_lng double precision not null,
  min_lat double precision not null,
  max_lng double precision not null,
  max_lat double precision not null,
  bbox geometry(Polygon, 4326) generated always as (st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)) stored,
  centroid_lat double precision generated always as (st_y(st_centroid(bbox))) stored,
  centroid_lng double precision generated always as (st_x(st_centroid(bbox))) stored,
  is_active boolean not null default true,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (st_srid(bbox) = 4326),
  check (min_lng < max_lng),
  check (min_lat < max_lat)
);

create index if not exists idx_grid_tiles_bbox_gist on public.grid_tiles using gist (bbox);
create index if not exists idx_grid_tiles_active_last
  on public.grid_tiles (is_active, last_crawled_at);

drop trigger if exists trg_grid_tiles_updated_at on public.grid_tiles;
create trigger trg_grid_tiles_updated_at
before update on public.grid_tiles
for each row execute function public.set_updated_at();

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  place_id text not null unique,
  name text not null,
  geom geography(Point, 4326) not null,
  rating numeric,
  reviews_count integer,
  website text,
  website_type text not null default 'NO_WEBSITE' check (website_type in ('PROFESSIONAL', 'SOCIAL_ONLY', 'NO_WEBSITE')),
  main_category text not null check (main_category in ('RESTAURANT', 'HAIR', 'HOME_SERVICES')),
  score numeric(10, 4) not null default 0,
  score_version integer not null default 1,
  last_seen timestamptz not null default now(),
  is_active boolean not null default true,
  last_refreshed timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_payload jsonb
);

create index if not exists idx_businesses_geom_gist on public.businesses using gist (geom);
create index if not exists idx_businesses_main_category_active on public.businesses (main_category, is_active);
create index if not exists idx_businesses_last_seen on public.businesses (last_seen);
create index if not exists idx_businesses_score on public.businesses (score desc);

drop trigger if exists trg_businesses_updated_at on public.businesses;
create trigger trg_businesses_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

create table if not exists public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  run_month text not null,
  status text not null check (status in ('RUNNING', 'SUCCESS', 'STOPPED_CAP', 'FAILED')),
  tiles_processed integer not null default 0,
  api_calls integer not null default 0,
  estimated_cost numeric(10, 4) not null default 0,
  avg_results_per_tile numeric(10, 4) not null default 0,
  tiles_hit_60_limit integer not null default 0,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crawl_runs_status_created on public.crawl_runs (status, created_at desc);
create index if not exists idx_crawl_runs_run_month on public.crawl_runs (run_month, created_at desc);

drop trigger if exists trg_crawl_runs_updated_at on public.crawl_runs;
create trigger trg_crawl_runs_updated_at
before update on public.crawl_runs
for each row execute function public.set_updated_at();
