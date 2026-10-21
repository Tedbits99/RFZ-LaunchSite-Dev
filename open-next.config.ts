import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Preview-safe default: no R2 or production service binding is required.
// Add an approved R2 incremental-cache binding before deploying a production worker.
export default defineCloudflareConfig();
