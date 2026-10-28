import { disabledFazerCardsDiagnosticResponse } from "./disabledResponse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * Live FazerCards diagnostics were removed because this function previously
 * exposed a real order-creation route. Return a fixed response without reading
 * credentials, touching the database, or making provider requests.
 */
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  return disabledFazerCardsDiagnosticResponse();
});
