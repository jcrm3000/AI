import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type LeadCategory = "RESTAURANT" | "HAIR" | "HOME_SERVICES";
type WebsiteType = "PROFESSIONAL" | "SOCIAL_ONLY" | "NO_WEBSITE";
type RunStatus = "RUNNING" | "SUCCESS" | "STOPPED_CAP" | "FAILED";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";

const CATEGORIES: LeadCategory[] = ["RESTAURANT", "HAIR", "HOME_SERVICES"];
const WEEKLY_TILE_SLICE = 33;
const WEEKLY_CALL_LIMIT_FROM_TILE_RULE = 100; // weekly_tiles * 3 must be <= 100
const TILE_BATCH_SIZE = 5;
const SEARCH_RADIUS_METERS = 2000;
const MAX_API_CALLS = 400;
const MAX_RETRIES = 3;
const NEARBY_SEARCH_CALL_COST_USD = 0.032;
const RETRY_BASE_DELAY_MS = 400;
const PLACE_NEXT_PAGE_DELAY_MS = 2200;
const INACTIVE_AFTER_DAYS = 90;
const PURGE_AFTER_DAYS = 180;
const ENABLE_PURGE = false;
const SCORE_VERSION = 1;

const CATEGORY_TO_NEARBY_TYPE: Record<LeadCategory, string> = {
  RESTAURANT: "restaurant",
  HAIR: "hair_salon",
  HOME_SERVICES: "general_contractor",
};

interface TileRow {
  id: string;
  centroid_lat: number;
  centroid_lng: number;
}

interface NearbyLocation {
  lat: number;
  lng: number;
}

interface NearbyResult {
  place_id: string;
  name?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  geometry?: {
    location?: NearbyLocation;
  };
}

interface NearbyResponse {
  status: string;
  results: NearbyResult[];
  next_page_token?: string;
}

class CapReachedError extends Error {
  constructor() {
    super("API call cap reached");
    this.name = "CapReachedError";
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function scoreBusinessByCategory(category: LeadCategory, rating?: number, reviewsCount?: number): number {
  const n = typeof reviewsCount === "number" ? Math.max(0, reviewsCount) : 0;
  const r = typeof rating === "number" ? Math.max(0, Math.min(5, rating)) : 0;
  const websiteType: WebsiteType = "NO_WEBSITE";
  const penaltyByWebsiteType: Record<WebsiteType, number> = {
    PROFESSIONAL: 30,
    SOCIAL_ONLY: 10,
    NO_WEBSITE: 0,
  };
  const bonusByCategory: Record<LeadCategory, number> = {
    RESTAURANT: 10,
    HAIR: 8,
    HOME_SERVICES: 12,
  };
  const base = Math.log(n + 1) * 40;
  const ratingComponent = r * 10;
  const score = base + ratingComponent - penaltyByWebsiteType[websiteType] + bonusByCategory[category];
  return Number(score.toFixed(4));
}

async function fetchWithRetry(url: string, maxRetries: number): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, { method: "GET" });

      if (response.ok) {
        return response;
      }

      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Transient HTTP error: ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      attempt += 1;

      if (attempt >= maxRetries) {
        break;
      }

      const backoff = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 200);
      await sleep(backoff + jitter);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Retry failed");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_PLACES_API_KEY) {
    return json({ error: "Missing required environment variables" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let runId: string | null = null;
  let status: RunStatus = "RUNNING";
  let tilesProcessed = 0;
  let apiCalls = 0;
  let monthlyApiCalls = 0;
  let tilesHit60Limit = 0;
  let totalResults = 0;
  let errorMessage: string | null = null;

  const consumeApiBudget = () => {
    if (monthlyApiCalls >= MAX_API_CALLS) {
      throw new CapReachedError();
    }
  };

  try {
    const runMonth = new Date().toISOString().slice(0, 7);

    // PRD §5.3: 400 calls/month hard cap — sum prior runs this month
    const { data: priorRuns } = await supabase
      .from("crawl_runs")
      .select("api_calls")
      .eq("run_month", runMonth)
      .in("status", ["SUCCESS", "STOPPED_CAP"]);

    monthlyApiCalls = priorRuns?.reduce(
      (sum: number, r: { api_calls: number }) => sum + (r.api_calls ?? 0),
      0,
    ) ?? 0;

    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase
      .from("crawl_runs")
      .update({
        status: "FAILED",
        error_message: "Orphaned: function timeout",
        completed_at: new Date().toISOString(),
      })
      .eq("status", "RUNNING")
      .lt("created_at", staleThreshold);

    const runInsert = await supabase
      .from("crawl_runs")
      .insert({
        run_month: runMonth,
        status: "RUNNING",
      })
      .select("id")
      .single();

    if (runInsert.error || !runInsert.data) {
      throw new Error(`Could not create crawl run: ${runInsert.error?.message ?? "unknown"}`);
    }

    runId = runInsert.data.id;

    const effectiveWeeklyTileSlice = Math.min(
      WEEKLY_TILE_SLICE,
      Math.floor(WEEKLY_CALL_LIMIT_FROM_TILE_RULE / CATEGORIES.length),
    );

    const tileQuery = await supabase
      .from("grid_tiles")
      .select("id, centroid_lat, centroid_lng")
      .eq("is_active", true)
      .order("last_crawled_at", { ascending: true, nullsFirst: true })
      .order("tile_key", { ascending: true })
      .limit(effectiveWeeklyTileSlice);

    if (tileQuery.error) {
      throw new Error(`Tile selection failed: ${tileQuery.error.message}`);
    }

    const selectedTiles = (tileQuery.data ?? []) as TileRow[];

    for (let i = 0; i < selectedTiles.length; i += TILE_BATCH_SIZE) {
      const batch = selectedTiles.slice(i, i + TILE_BATCH_SIZE);

      await Promise.all(batch.map(async (tile) => {
        for (const category of CATEGORIES) {
          const nearbyType = CATEGORY_TO_NEARBY_TYPE[category];
          const allResults: NearbyResult[] = [];
          let nextPageToken: string | undefined;
          let page = 0;

          do {
            consumeApiBudget();

            const baseUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
            baseUrl.searchParams.set("key", GOOGLE_PLACES_API_KEY);

            if (nextPageToken) {
              await sleep(PLACE_NEXT_PAGE_DELAY_MS);
              baseUrl.searchParams.set("pagetoken", nextPageToken);
            } else {
              baseUrl.searchParams.set("location", `${tile.centroid_lat},${tile.centroid_lng}`);
              baseUrl.searchParams.set("radius", String(SEARCH_RADIUS_METERS));
              baseUrl.searchParams.set("type", nearbyType);
            }

            const response = await fetchWithRetry(baseUrl.toString(), MAX_RETRIES);
            apiCalls += 1;

            if (!response.ok) {
              throw new Error(`Nearby Search HTTP ${response.status}`);
            }

            const payload = (await response.json()) as NearbyResponse;

            if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
              throw new Error(`Nearby Search error status: ${payload.status}`);
            }

            if (payload.results?.length) {
              allResults.push(...payload.results);
            }

            nextPageToken = payload.next_page_token;
            page += 1;
          } while (nextPageToken && page < 3);

          const upserts = allResults
            .filter((r) => r.place_id && r.geometry?.location)
            .map((r) => {
              const lat = r.geometry!.location!.lat;
              const lng = r.geometry!.location!.lng;
              const reviewsCount = r.user_ratings_total ?? null;
              const rating = r.rating ?? null;

              return {
                place_id: r.place_id,
                name: r.name ?? "UNKNOWN",
                geom: `SRID=4326;POINT(${lng} ${lat})`,
                rating,
                reviews_count: reviewsCount,
                website: null,
                website_type: "NO_WEBSITE",
                main_category: category,
                score: scoreBusinessByCategory(category, rating ?? undefined, reviewsCount ?? undefined),
                score_version: SCORE_VERSION,
                last_seen: new Date().toISOString(),
                is_active: true,
                last_refreshed: new Date().toISOString(),
                source_payload: {
                  types: r.types ?? [],
                },
              };
            });

          if (upserts.length > 0) {
            const upsertResult = await supabase.from("businesses").upsert(upserts, {
              onConflict: "place_id",
              ignoreDuplicates: false,
            });

            if (upsertResult.error) {
              throw new Error(`Business upsert failed: ${upsertResult.error.message}`);
            }
          }

          totalResults += allResults.length;
          if (allResults.length >= 60) {
            tilesHit60Limit += 1;
          }
        }

        const touchTile = await supabase
          .from("grid_tiles")
          .update({ last_crawled_at: new Date().toISOString() })
          .eq("id", tile.id);

        if (touchTile.error) {
          throw new Error(`Tile update failed: ${touchTile.error.message}`);
        }

        tilesProcessed += 1;
      }));
    }

    const inactiveCutoff = new Date(Date.now() - INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const markInactive = await supabase
      .from("businesses")
      .update({ is_active: false })
      .lt("last_seen", inactiveCutoff)
      .eq("is_active", true);

    if (markInactive.error) {
      throw new Error(`Retention inactive step failed: ${markInactive.error.message}`);
    }

    if (ENABLE_PURGE) {
      const purgeCutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const purge = await supabase.from("businesses").delete().lt("last_seen", purgeCutoff);
      if (purge.error) {
        throw new Error(`Retention purge step failed: ${purge.error.message}`);
      }
    }

    status = "SUCCESS";
  } catch (error) {
    if (error instanceof CapReachedError) {
      status = "STOPPED_CAP";
      errorMessage = "Stopped cleanly after reaching api_calls cap";
    } else {
      status = "FAILED";
      errorMessage = error instanceof Error ? error.message : "Unknown error";
    }
  }

  const estimatedCost = Number((apiCalls * NEARBY_SEARCH_CALL_COST_USD).toFixed(4));
  const avgResultsPerTile = Number((tilesProcessed > 0 ? totalResults / tilesProcessed : 0).toFixed(4));

  if (runId !== null) {
    await supabase.from("crawl_runs").update({
      completed_at: new Date().toISOString(),
      status,
      tiles_processed: tilesProcessed,
      api_calls: apiCalls,
      estimated_cost: estimatedCost,
      avg_results_per_tile: avgResultsPerTile,
      tiles_hit_60_limit: tilesHit60Limit,
      error_message: errorMessage,
    }).eq("id", runId);
  }

  if (status === "FAILED") {
    return json(
      {
        ok: false,
        status,
        run_id: runId,
        error: errorMessage,
      },
      500,
    );
  }

  return json({
    ok: true,
    status,
    run_id: runId,
    metrics: {
      tiles_processed: tilesProcessed,
      api_calls: apiCalls,
      estimated_cost: estimatedCost,
      avg_results_per_tile: avgResultsPerTile,
      tiles_hit_60_limit: tilesHit60Limit,
    },
  });
});
