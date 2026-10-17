const API_ROOT = () => String(window.LK_AGGREGATOR_API_URL || location.origin).replace(/\/$/, "");
const PUBLIC_MEDIA_BASE = () => String(window.LK_R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
const SESSION_KEY = "lk-newsroom-admin-session";
function readStoredSession() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const value = store.getItem(SESSION_KEY);
      if (!value) continue;
      const parsed = JSON.parse(value);
      if (parsed?.access_token && parsed?.user) return parsed;
    } catch {}
  }
  return null;
}
export function storeSession(session, remember = false) {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch {}
  const store = remember ? localStorage : sessionStorage;
  try { store.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch {}
}
async function apiRequest(path, options = {}) {
  const session = readStoredSession();
  const headers = { ...(options.headers || {}) };
  if (session?.access_token) headers.Authorization = "Bearer " + session.access_token;
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!isForm && options.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(API_ROOT() + path, { ...options, headers });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return { response, payload };
}
function errorObject(message, status = 400) {
  const error = new Error(message || "The Cloudflare admin request failed.");
  error.status = status;
  return error;
}
function mediaPath(bucket, path) {
  return [String(bucket || "").replace(/^\/+|\/+$/g, ""), String(path || "").replace(/^\/+/, "")]
    .filter(Boolean).map(part => part.split("/").map(encodeURIComponent).join("/")).join("/");
}
class QueryBuilder {
  constructor(table) {
    this.table = String(table || "");
    this.action = "select";
    this.selectSpec = "*";
    this.values = null;
    this.filters = [];
    this.orders = [];
    this.maxRows = 100;
    this.offset = 0;
    this.countMode = null;
    this.head = false;
    this.returning = false;
    this.conflict = "";
    this.singleMode = false;
    this.maybeSingleMode = false;
  }
  select(fields = "*", options = {}) {
    this.selectSpec = String(fields || "*");
    if (this.action !== "select") this.returning = true;
    if (options && typeof options === "object") {
      if (options.count) this.countMode = String(options.count);
      if (options.head) this.head = true;
    }
    return this;
  }
  insert(values) { this.action = "insert"; this.values = values; return this; }
  upsert(values, options = {}) { this.action = "upsert"; this.values = values; this.conflict = String(options?.onConflict || ""); return this; }
  update(values) { this.action = "update"; this.values = values; return this; }
  delete() { this.action = "delete"; return this; }
  eq(column, value) { this.filters.push({ column: String(column), op: "eq", value }); return this; }
  neq(column, value) { this.filters.push({ column: String(column), op: "neq", value }); return this; }
  is(column, value) { this.filters.push({ column: String(column), op: "is", value }); return this; }
  gt(column, value) { this.filters.push({ column: String(column), op: "gt", value }); return this; }
  gte(column, value) { this.filters.push({ column: String(column), op: "gte", value }); return this; }
  lt(column, value) { this.filters.push({ column: String(column), op: "lt", value }); return this; }
  lte(column, value) { this.filters.push({ column: String(column), op: "lte", value }); return this; }
  like(column, value) { this.filters.push({ column: String(column), op: "like", value }); return this; }
  ilike(column, value) { this.filters.push({ column: String(column), op: "ilike", value }); return this; }
  in(column, values) { this.filters.push({ column: String(column), op: "in", value: Array.isArray(values) ? values : [] }); return this; }
  order(column, options = {}) { this.orders.push({ column: String(column), ascending: options?.ascending !== false }); return this; }
  limit(value) { this.maxRows = Math.max(1, Math.min(5000, Number(value) || 100)); return this; }
  range(from, to) {
    const start = Math.max(0, Number(from) || 0);
    const end = Math.max(start, Number(to) || start);
    this.offset = start;
    this.maxRows = Math.max(1, Math.min(5000, end - start + 1));
    return this;
  }
  single() { this.singleMode = true; this.maybeSingleMode = false; return this; }
  maybeSingle() { this.maybeSingleMode = true; this.singleMode = false; return this; }
  async execute() {
    try {
      const body = {
        table: this.table, action: this.action, select: this.selectSpec, values: this.values,
        filters: this.filters, orders: this.orders, limit: this.maxRows, offset: this.offset,
        count: this.countMode, head: this.head, returning: this.returning,
        onConflict: this.conflict, single: this.singleMode, maybeSingle: this.maybeSingleMode
      };
      const { response, payload } = await apiRequest("/v1/admin/query", { method: "POST", body: JSON.stringify(body) });
      if (!response.ok || payload.error) {
        const err = errorObject(payload.error?.message || payload.error || "Admin database request failed.", response.status);
        return { data: null, error: err, count: payload.count ?? null, status: response.status };
      }
      return { data: payload.data ?? (this.action === "select" ? [] : null), error: null, count: payload.count ?? null, status: response.status };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : errorObject(String(error)), count: null };
    }
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }
}
function storageClient(bucket) {
  const bucketName = String(bucket || "news-images");
  return {
    async upload(path, file, options = {}) {
      try {
        const form = new FormData();
        form.append("bucket", bucketName);
        form.append("path", String(path || ""));
        form.append("upsert", String(Boolean(options.upsert)));
        form.append("contentType", String(options.contentType || file?.type || "application/octet-stream"));
        form.append("file", file, String(file?.name || "upload.bin"));
        const { response, payload } = await apiRequest("/v1/admin/media", { method: "POST", body: form });
        if (!response.ok) return { data: null, error: errorObject(payload.error || "Media upload failed.", response.status) };
        return { data: payload.data || null, error: null };
      } catch (error) { return { data: null, error: error instanceof Error ? error : errorObject(String(error)) }; }
    },
    async remove(paths) {
      try {
        const { response, payload } = await apiRequest("/v1/admin/media", {
          method: "DELETE", body: JSON.stringify({ bucket: bucketName, paths: Array.isArray(paths) ? paths : [] })
        });
        if (!response.ok) return { data: null, error: errorObject(payload.error || "Could not remove media.", response.status) };
        return { data: payload.data || [], error: null };
      } catch (error) { return { data: null, error: error instanceof Error ? error : errorObject(String(error)) }; }
    },
    async list(path = "", options = {}) {
      try {
        const params = new URLSearchParams({ bucket: bucketName, prefix: String(path || ""), limit: String(options.limit || 100) });
        const { response, payload } = await apiRequest("/v1/admin/media?" + params.toString());
        if (!response.ok) return { data: null, error: errorObject(payload.error || "Could not list media.", response.status) };
        return { data: payload.data || [], error: null };
      } catch (error) { return { data: null, error: error instanceof Error ? error : errorObject(String(error)) }; }
    },
    getPublicUrl(path) {
      return { data: { publicUrl: PUBLIC_MEDIA_BASE() + "/" + mediaPath(bucketName, path) } };
    }
  };
}
const auth = {
  async signInWithPassword({ email, password, remember = false }) {
    try {
      const { response, payload } = await apiRequest("/v1/admin/login", { method: "POST", body: JSON.stringify({ email, password, remember }) });
      if (!response.ok || payload.error) return { data: { user: null, session: null }, error: errorObject(payload.error || "Unable to sign in.", response.status) };
      storeSession(payload.session, Boolean(remember));
      return { data: { user: payload.user, session: payload.session }, error: null };
    } catch (error) { return { data: { user: null, session: null }, error: error instanceof Error ? error : errorObject(String(error)) }; }
  },
  async getSession() {
    const session = readStoredSession();
    if (session?.expires_at && Number(session.expires_at) * 1000 <= Date.now()) { clearSession(); return { data: { session: null }, error: null }; }
    return { data: { session }, error: null };
  },
  async getUser() {
    const { data: { session } } = await this.getSession();
    return { data: { user: session?.user || null }, error: null };
  },
  async signOut() {
    try { await apiRequest("/v1/admin/logout", { method: "POST", body: "{}" }); } finally { clearSession(); }
    return { error: null };
  },
  async resetPasswordForEmail() {
    return { error: errorObject("Email password resets are not enabled yet. Ask a super admin to provide a new staff password.", 501) };
  },
  async updateUser({ password }) {
    const { data: { session } } = await this.getSession();
    if (!session) return { data: null, error: errorObject("Your admin session has expired.", 401) };
    const { response, payload } = await apiRequest("/v1/admin/password", { method: "POST", body: JSON.stringify({ currentPassword: password?.current, newPassword: password?.new }) });
    if (!response.ok) return { data: null, error: errorObject(payload.error, response.status) };
    const remembered = (() => { try { return Boolean(localStorage.getItem(SESSION_KEY)); } catch { return false; } })();
    const updated = { ...session, user: { ...session.user, must_change_password: false } };
    storeSession(updated, remembered);
    return { data: { user: updated.user }, error: null };
  }
};
export const configured = true;
export const supabase = {
  auth,
  from(table) { return new QueryBuilder(table); },
  storage: { from(bucket) { return storageClient(bucket); } },
  async rpc(fn, args = {}) {
    const map = { increment_article_views: "view", record_ad_click: "click", record_ad_impression: "impression" };
    if (fn === "increment_article_views") {
      const id = args.article_uuid || args.article_id || args.id;
      const { response, payload } = await apiRequest("/v1/news/" + encodeURIComponent(String(id || "")) + "/view", { method: "POST", body: "{}" });
      return { data: payload.ok ?? null, error: response.ok ? null : errorObject(payload.error, response.status) };
    }
    if (fn === "record_ad_click" || fn === "record_ad_impression") {
      const id = args.ad_uuid || args.advertisement_id || args.id;
      const { response, payload } = await apiRequest("/v1/analytics/advertisements/" + encodeURIComponent(String(id || "")) + "/" + map[fn], { method: "POST", body: "{}" });
      return { data: payload.ok ?? null, error: response.ok ? null : errorObject(payload.error, response.status) };
    }
    return { data: null, error: errorObject("This database function has not been ported to Cloudflare.", 501) };
  }
};
export async function subscribe(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) throw new Error("Enter an email address.");
  const { response, payload } = await apiRequest("/v1/newsletter", { method: "POST", body: JSON.stringify({ email: value }) });
  if (!response.ok) throw new Error(payload.error || "Unable to subscribe.");
  return true;
}
export async function subscribeRealtime() { return null; }
