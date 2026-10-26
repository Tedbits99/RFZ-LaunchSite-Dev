import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Reuse build-time, public SSG HTML/RSC assets instead of re-running the
// Node-compatible NextServer for every homepage / admin-login request.
// Dynamic admin, customer, API and checkout routes continue using the
// Next.js server and their existing Supabase authorization checks.
// This read-only cache cannot regenerate ISR content; only enable it while
// SSG routes use build-time data (as audited in the Next.js route inventory).
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
