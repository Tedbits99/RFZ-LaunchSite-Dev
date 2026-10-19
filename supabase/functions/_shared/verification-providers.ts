// Per-game player verification providers. Each game maps to its own provider
// so different games can use different APIs/endpoints/field codes.

export interface VerifyInput {
  user_id: string;
  zone_id?: string;
}

export interface VerifyResult {
  username: string;
  country?: string;
  source: string;
}

export interface VerificationProvider {
  // Short label stored in the DB as verification_source (e.g. "moogold_api")
  source: string;
  // Validate input before hitting the API (returns error message or null)
  validate(input: VerifyInput): string | null;
  // Call the real API; resolve null when the player is not found.
  verify(input: VerifyInput): Promise<VerifyResult | null>;
}

const NUMERIC_RE = /^[0-9]+$/;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

// ---------------------------------------------------------------------------
// Mobile Legends: Bang Bang — MooGold ID validation endpoint
// ---------------------------------------------------------------------------
const mlbbProvider: VerificationProvider = {
  source: "moogold_api",

  validate({ user_id, zone_id }) {
    if (!user_id || !zone_id) return "User ID and Zone ID are required.";
    if (!NUMERIC_RE.test(user_id) || !NUMERIC_RE.test(zone_id)) {
      return "User ID and Zone ID must be numbers only.";
    }
    return null;
  },

  async verify({ user_id, zone_id }) {
    const payload = new URLSearchParams({
      attribute_amount: "Weekly Pass",
      "text-5f6f144f8ffee": user_id,
      "text-1601115253775": zone_id ?? "",
      quantity: "1",
      "add-to-cart": "15145",
      product_id: "15145",
      variation_id: "4690783",
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(
        "https://moogold.com/wp-content/plugins/id-validation-new/id-validation-ajax.php",
        {
          method: "POST",
          body: payload,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: "https://moogold.com/product/mobile-legends/",
            Origin: "https://moogold.com",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        },
        8000,
      );
    } catch {
      throw new Error("TIMEOUT");
    }

    if (!response.ok) {
      throw new Error(`UPSTREAM_${response.status}`);
    }

    const result = await response.json().catch(() => null);
    const message: string | undefined = result?.message;
    if (!message) return null;

    const nicknameMatch = message.match(/In-Game Nickname:\s*(.+)/i);
    const nickname = nicknameMatch?.[1]?.trim();
    if (!nickname) return null;

    return { username: nickname, country: "PH", source: "moogold_api" };
  },
};

// ---------------------------------------------------------------------------
// Registry — add new games here (pubg, free-fire, hok, genshin, valorant…)
// Each game maps to its own provider with its own API credentials/endpoints.
// ---------------------------------------------------------------------------
const providers: Record<string, VerificationProvider> = {
  "mobile-legends": mlbbProvider,
  mlbb: mlbbProvider,
};

export function getProvider(gameId: string): VerificationProvider | null {
  return providers[gameId?.toLowerCase?.() ?? ""] ?? null;
}
