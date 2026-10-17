// Compatibility bridge: existing hosting continues to use Supabase until the Cloudflare
// Worker build replaces this file with cloudflare/admin-client.js in dist/js.
const client = window.LK_CLOUDFLARE_MODE
  ? await import("../cloudflare/admin-client.js")
  : await import("./supabase-client.js");

export const supabase = client.supabase;
export const configured = client.configured;
