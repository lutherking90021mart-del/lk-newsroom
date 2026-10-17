const apiBase = () => String(window.LK_AGGREGATOR_API_URL || location.origin).replace(/\/$/, "");
async function request(path, options = {}) {
  const response = await fetch(apiBase() + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || ("Request failed with " + response.status));
  return body;
}
export const configured = false;
export const supabase = null;
export const newsApi = {
  async published({ category, limit = 12, from = 0 } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(from) });
    if (category) params.set("category", category);
    const payload = await request("/v1/news?" + params.toString());
    return Array.isArray(payload.data) ? payload.data : [];
  },
  async advertisements(limit = 5) {
    try {
      const payload = await request("/v1/advertisements?limit=" + encodeURIComponent(String(limit)));
      return Array.isArray(payload.data) ? payload.data : [];
    } catch { return []; }
  },
  async trackAdvertisement(id, event) {
    if (!id) return;
    try {
      await request("/v1/analytics/advertisements/" + encodeURIComponent(id) + "/" + encodeURIComponent(event), { method: "POST", body: JSON.stringify({}) });
    } catch {}
  },
  async article(identifier) {
    return request("/v1/news/" + encodeURIComponent(identifier));
  },
  async comment(articleId, displayName, body) {
    await request("/v1/news/" + encodeURIComponent(articleId) + "/comments", {
      method: "POST",
      body: JSON.stringify({ displayName, body })
    });
  },
  async incrementView(articleId) {
    if (!articleId) return;
    try { await request("/v1/news/" + encodeURIComponent(articleId) + "/view", { method: "POST", body: "{}" }); } catch {}
  },
  async upload() {
    throw new Error("Newsroom media uploads are being moved to Cloudflare R2 and will return after the admin migration.");
  }
};
export async function subscribe(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) throw new Error("Enter an email address.");
  await request("/v1/newsletter", { method: "POST", body: JSON.stringify({ email: value }) });
  return true;
}
export async function subscribeRealtime() {
  // Cloudflare D1 currently serves API reads; real-time subscriptions are not enabled in this migration stage.
  return null;
}
