const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FAZERCARDS_BASE = "https://api.fzr.cards/api/v2";

function authHeaders(): Record<string, string> {
  const apiKey = Deno.env.get("SUPPLIER_FAZERCARDS_API_KEY");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  return headers;
}

async function timedFetch(url: string, init: RequestInit): Promise<{ status: number; data: unknown; latencyMs: number }> {
  const start = Date.now();
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  return { status: res.status, data, latencyMs: Date.now() - start };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/fazercards-test", "");
    const apiKey = Deno.env.get("SUPPLIER_FAZERCARDS_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "SUPPLIER_FAZERCARDS_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // GET /balance
    if (path === "/balance") {
      const { status, data, latencyMs } = await timedFetch(`${FAZERCARDS_BASE}/balance`, {
        method: "GET", headers: authHeaders(),
      });
      return new Response(JSON.stringify({ httpStatus: status, latencyMs, success: status === 200, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /categories?cursor=<optional>&limit=<optional>
    if (path === "/categories") {
      const cursor = url.searchParams.get("cursor");
      const limit = url.searchParams.get("limit") || "200";
      let fetchUrl = `${FAZERCARDS_BASE}/topups?limit=${limit}`;
      if (cursor) fetchUrl += `&cursor=${encodeURIComponent(cursor)}`;
      const { status, data, latencyMs } = await timedFetch(fetchUrl, {
        method: "GET", headers: authHeaders(),
      });
      return new Response(JSON.stringify({ httpStatus: status, latencyMs, success: status === 200, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /offers?category_id=<id>
    if (path === "/offers") {
      const categoryId = url.searchParams.get("category_id");
      if (!categoryId) {
        return new Response(JSON.stringify({ error: "category_id is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { status, data, latencyMs } = await timedFetch(
        `${FAZERCARDS_BASE}/topups/offers?category_id=${encodeURIComponent(categoryId)}`,
        { method: "GET", headers: authHeaders() },
      );
      return new Response(JSON.stringify({ httpStatus: status, latencyMs, success: status === 200, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET / (run all tests at once)
    if (path === "/" || path === "") {
      const results: Record<string, unknown> = {};

      const bal = await timedFetch(`${FAZERCARDS_BASE}/balance`, { method: "GET", headers: authHeaders() });
      results.balance = { httpStatus: bal.status, latencyMs: bal.latencyMs, success: bal.status === 200, data: bal.data };

      const topups = await timedFetch(`${FAZERCARDS_BASE}/topups`, { method: "GET", headers: authHeaders() });
      results.topups = { httpStatus: topups.status, latencyMs: topups.latencyMs, success: topups.status === 200, data: topups.data };

      const topupsData = topups.data as Record<string, unknown> | null;
      const items = topupsData?.items as unknown[] | undefined;
      const firstCat = items?.[0] as Record<string, unknown> | undefined;
      const firstCatId = firstCat ? String(firstCat.category_id ?? firstCat.id ?? "") : "";

      if (firstCatId) {
        const offers = await timedFetch(
          `${FAZERCARDS_BASE}/topups/offers?category_id=${encodeURIComponent(firstCatId)}`,
          { method: "GET", headers: authHeaders() },
        );
        results.offers = { httpStatus: offers.status, latencyMs: offers.latencyMs, success: offers.status === 200, categoryId: firstCatId, data: offers.data };
      }

      return new Response(JSON.stringify(results, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /order — create a real supplier order
    // Body: { category_id, offer_id, fields, idempotency_key }
    if (path === "/order" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || !body.category_id || !body.offer_id || !body.fields || !body.idempotency_key) {
        return new Response(JSON.stringify({ error: "Missing required fields: category_id, offer_id, fields, idempotency_key" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const orderBody = JSON.stringify({
        category_id: body.category_id,
        offer_id: body.offer_id,
        fields: body.fields,
      });
      const headers = {
        ...authHeaders(),
        "Idempotency-Key": String(body.idempotency_key),
      };
      const { status, data, latencyMs } = await timedFetch(`${FAZERCARDS_BASE}/topups/order`, {
        method: "POST", headers, body: orderBody,
      });
      return new Response(JSON.stringify({ httpStatus: status, latencyMs, success: status === 200, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /order-status?supplier_ref=<id> — query supplier order status
    if (path === "/order-status") {
      const supplierRef = url.searchParams.get("supplier_ref");
      if (!supplierRef) {
        return new Response(JSON.stringify({ error: "supplier_ref is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { status, data, latencyMs } = await timedFetch(
        `${FAZERCARDS_BASE}/orders/${encodeURIComponent(supplierRef)}`,
        { method: "GET", headers: authHeaders() },
      );
      return new Response(JSON.stringify({ httpStatus: status, latencyMs, success: status === 200, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown path" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
