const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export function disabledFazerCardsDiagnosticResponse(): Response {
  return new Response(JSON.stringify({
    error: "FazerCards diagnostics are disabled; no provider request was made.",
  }), { status: 503, headers });
}
