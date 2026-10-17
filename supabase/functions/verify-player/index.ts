import { createClient } from "npm:@supabase/supabase-js@2";
import { getProvider } from "../_shared/verification-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CACHE_TTL_HOURS = 1;
const VERIFIED_TTL_HOURS = 24;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }

    const { game_id: gameId, user_id, zone_id } = await req.json();
    if (!gameId) {
      return json(
        { success: false, error: "game_id is required" },
        400,
      );
    }

    const provider = getProvider(gameId);
    if (!provider) {
      return json(
        {
          success: false,
          error:
            "Verification is not available for this game yet. Please proceed without verification or contact support.",
        },
        501,
      );
    }

    const validateError = provider.validate({ user_id, zone_id });
    if (validateError) {
      return json({ success: false, error: validateError }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(
        { success: false, error: "Internal configuration error" },
        500,
      );
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const cacheKey = { game_id: gameId, user_id, zone_id: zone_id ?? "" };

    // 1. Fresh cache hit — skip the upstream API entirely.
    const { data: cached } = await supabase
      .from("player_cache")
      .select("username, country")
      .eq("game_id", gameId)
      .eq("user_id", user_id)
      .eq("zone_id", zone_id ?? "")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached?.username) {
      await logAttempt(supabase, gameId, user_id, zone_id, true, null, provider.source, 0);
      return json({
        success: true,
        data: {
          user_id,
          zone_id,
          username: cached.username,
          country: cached.country ?? null,
        },
        source: "cache",
        cached: true,
      }, 200);
    }

    // 2. Call the real provider API (server-side only — no keys in frontend).
    const startMs = Date.now();
    let result;
    try {
      result = await provider.verify({ user_id, zone_id });
    } catch (err) {
      const elapsed = Date.now() - startMs;
      const msg = String((err as Error)?.message ?? err);
      const friendly =
        msg === "TIMEOUT"
          ? "The verification service timed out. Please try again in a moment."
          : "The verification service is temporarily unavailable. Please try again shortly.";
      await logAttempt(supabase, gameId, user_id, zone_id, false, msg, provider.source, elapsed);
      return json({ success: false, error: friendly }, 502);
    }
    const elapsed = Date.now() - startMs;

    // 3. Player not found — invalid IDs.
    if (!result) {
      await logAttempt(supabase, gameId, user_id, zone_id, false, null, provider.source, elapsed);
      return json(
        {
          success: false,
          error: "Player not found. Please double-check your User ID and Zone ID.",
        },
        404,
      );
    }

    // 4. Success — cache and persist before responding.
    const now = new Date();
    const cacheExpires = new Date(now);
    cacheExpires.setHours(cacheExpires.getHours() + CACHE_TTL_HOURS);
    const verifiedExpires = new Date(now);
    verifiedExpires.setHours(verifiedExpires.getHours() + VERIFIED_TTL_HOURS);

    await supabase.from("player_cache").upsert(
      {
        ...cacheKey,
        username: result.username,
        country: result.country ?? null,
        cached_at: now.toISOString(),
        expires_at: cacheExpires.toISOString(),
        verification_source: provider.source,
        verification_confidence: 1.0,
      },
      { onConflict: "user_id,zone_id,game_id" },
    );

    await supabase.from("verified_users").upsert(
      {
        game_id: gameId,
        user_id,
        zone_id: zone_id ?? "",
        ign: result.username,
        verified_at: now.toISOString(),
        expires_at: verifiedExpires.toISOString(),
        verification_source: provider.source,
      },
      { onConflict: "user_id,zone_id,game_id" },
    );

    await logAttempt(supabase, gameId, user_id, zone_id, true, null, provider.source, elapsed);

    return json(
      {
        success: true,
        data: {
          user_id,
          zone_id,
          username: result.username,
          country: result.country ?? null,
        },
        source: provider.source,
        cached: false,
      },
      200,
    );
  } catch {
    return json(
      { success: false, error: "Internal server error" },
      500,
    );
  }
});

async function logAttempt(
  supabase: ReturnType<typeof createClient>,
  game_id: string,
  user_id: string,
  zone_id: string | undefined,
  success: boolean,
  error_message: string | null,
  verification_source: string,
  response_time_ms: number,
) {
  try {
    await supabase.from("verification_attempts").insert({
      game_id,
      user_id,
      zone_id: zone_id ?? "",
      success,
      player_name: success ? "Player verified" : null,
      error_message,
      verification_source,
      source: "edge_function",
      response_time_ms,
    });
  } catch {
    // Logging must never break the request.
  }
}

