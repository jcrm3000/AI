-- Seed approach for grid_tiles
-- Format: one CSV row per tile
-- Columns:
--   tile_key,min_lng,min_lat,max_lng,max_lat,is_active

create temporary table if not exists tmp_grid_tiles_seed (
  tile_key text,
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  is_active boolean
);

-- Example rows (replace with your full dataset)
insert into tmp_grid_tiles_seed (tile_key, min_lng, min_lat, max_lng, max_lat, is_active)
values
  ('tile_0001', -74.0200, 40.7000, -73.9800, 40.7300, true),
  ('tile_0002', -84.1400, 9.9200, -84.1200, 9.9400, true);

-- Preferred bulk load (psql):
-- \copy tmp_grid_tiles_seed(tile_key,min_lng,min_lat,max_lng,max_lat,is_active)
--   from 'supabase/seed/grid_tiles.csv' with (format csv, header true)

insert into public.grid_tiles (tile_key, min_lng, min_lat, max_lng, max_lat, is_active)
select
  tile_key,
  min_lng,
  min_lat,
  max_lng,
  max_lat,
  coalesce(is_active, true)
from tmp_grid_tiles_seed
on conflict (tile_key)
do update set
  min_lng = excluded.min_lng,
  min_lat = excluded.min_lat,
  max_lng = excluded.max_lng,
  max_lat = excluded.max_lat,
  is_active = excluded.is_active,
  updated_at = now();
