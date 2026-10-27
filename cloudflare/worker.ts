import { XMLParser } from "fast-xml-parser";

type Env = {
  DB: any;
  MEDIA: any;
  ASSETS: any;
  CRON_SECRET?: string;
  ADMIN_BOOTSTRAP_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  R2_PUBLIC_BASE_URL?: string;
  GUARDIAN_API_KEY?: string;
  NEWS_API_KEY?: string;
  PAYSTACK_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  htmlEntities: true
});

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const breakingTerms = /\b(breaking|just in|developing|urgent|emergency|alert|dies|dead|resigns?)\b/i;

function json(data: unknown, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type,Authorization",
      "cache-control": "no-store"
    }
  });
}
function cachedClientResponse(response: Response, cacheState: "fresh" | "stale") {
  const headers = new Headers(response.headers);
  // Keep the browser from pinning a stale API response; only the Worker edge
  // cache should retain it between requests.
  headers.set("cache-control", "no-store");
  headers.set("x-lk-news-cache", cacheState);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function withPublicCache(
  request: Request,
  freshSeconds: number,
  staleSeconds: number,
  loader: () => Promise<Response>
): Promise<Response> {
  let cache: Cache;
  try { cache = caches.default; } catch { return loader(); }
  const makeKey = (kind: "fresh" | "stale") => {
    const keyUrl = new URL(request.url);
    keyUrl.searchParams.set("__lk_edge_cache", kind);
    return new Request(keyUrl.toString(), { method: "GET" });
  };
  const freshKey = makeKey("fresh");
  const staleKey = makeKey("stale");
  try {
    const fresh = await cache.match(freshKey);
    if (fresh) return cachedClientResponse(fresh, "fresh");
  } catch {}
  let stale: Response | undefined;
  try { stale = (await cache.match(staleKey)) || undefined; } catch {}
  try {
    const response = await loader();
    if (response.ok) {
      const body = await response.clone().arrayBuffer();
      const baseHeaders = new Headers(response.headers);
      baseHeaders.delete("set-cookie");
      const freshHeaders = new Headers(baseHeaders);
      freshHeaders.set("cache-control", `public, max-age=${Math.max(1, freshSeconds)}`);
      const staleHeaders = new Headers(baseHeaders);
      staleHeaders.set("cache-control", `public, max-age=${Math.max(freshSeconds, staleSeconds)}`);
      try {
        await Promise.all([
          cache.put(freshKey, new Response(body.slice(0), { status: response.status, statusText: response.statusText, headers: freshHeaders })),
          cache.put(staleKey, new Response(body.slice(0), { status: response.status, statusText: response.statusText, headers: staleHeaders }))
        ]);
      } catch (error) {
        console.warn("LK Newsroom edge cache write skipped:", error instanceof Error ? error.message : String(error));
      }
    } else if (stale) {
      return cachedClientResponse(stale, "stale");
    }
    return response;
  } catch (error) {
    // D1 Free-plan limits or a temporary query failure should not blank the
    // newsroom when a recent successful response is available at this edge.
    if (stale) return cachedClientResponse(stale, "stale");
    throw error;
  }
}

function slugify(value: unknown) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 120) || "general";
}
function asList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return String(obj["#text"] || obj["@_href"] || obj["@_url"] || "");
  }
  return "";
}
function cleanHtml(value: unknown): string {
  return text(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function safeDate(value: unknown): string {
  const d = new Date(text(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function pickLink(value: unknown): string {
  for (const entry of asList(value as any)) {
    const possible = typeof entry === "object" && entry ? (entry as any)["@_href"] || (entry as any)["#text"] : entry;
    const url = text(possible).trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}
function imageOf(item: Record<string, any>, baseUrl?: string): string | null {
  const imageKeys = [
    "thumbnail", "image", "enclosure", "content", "group", "description", "summary",
    "image_url", "imageUrl", "urlToImage", "image_href", "srcset", "poster",
    "content:encoded", "media:thumbnail", "media:content", "itunes:image"
  ];
  const urlKeys = ["@_url", "@_href", "@_src", "url", "href", "src", "image_url", "imageUrl", "urlToImage", "poster"];

  const normalize = (rawValue: unknown): string | null => {
    let raw = text(rawValue).trim();
    if (!raw) return null;
    raw = raw.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
    // Some feeds provide srcset rather than src; use the first candidate.
    raw = raw.split(",")[0].trim().split(/\s+/)[0];
    if (raw.startsWith("//")) raw = "https:" + raw;
    try {
      const resolved = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") return null;
      return resolved.href;
    } catch {
      return null;
    }
  };

  const fromHtml = (rawValue: string): string | null => {
    const raw = rawValue
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
    const tags = raw.match(/<(?:img|source|video)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const attr = tag.match(/\b(?:src|data-src|data-lazy-src|data-original|data-original-src|poster|srcset)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
      const candidate = attr ? (attr[1] || attr[2] || attr[3]) : "";
      const url = normalize(candidate);
      if (url) return url;
    }
    return null;
  };

  const inspect = (value: unknown, depth = 0): string | null => {
    if (depth > 5 || value === null || value === undefined) return null;
    if (typeof value === "string") {
      const direct = normalize(value);
      if (direct && /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(direct)) return direct;
      return fromHtml(value);
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = inspect(child, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of urlKeys) {
        const candidate = obj[key];
        if (candidate !== undefined && candidate !== null) {
          const url = normalize(candidate);
          if (url) return url;
        }
      }
      if (typeof obj["#text"] === "string") {
        const found = fromHtml(String(obj["#text"]));
        if (found) return found;
      }
      for (const key of imageKeys) {
        if (obj[key] !== undefined) {
          const found = inspect(obj[key], depth + 1);
          if (found) return found;
        }
      }
    }
    return null;
  };

  for (const key of imageKeys) {
    if (item[key] !== undefined) {
      const found = inspect(item[key]);
      if (found) return found;
    }
  }
  // Final fallback for embedded image markup in publisher-provided text.
  for (const key of ["content:encoded", "description", "summary", "content"]) {
    const found = inspect(item[key]);
    if (found) return found;
  }
  return null;
}
function hashHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha(value: string): Promise<string> {
  return hashHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function safeLimit(value: string | null) {
  const n = Number(value || DEFAULT_LIMIT);
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n))) : DEFAULT_LIMIT;
}
function autoTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return value.replace(/^\{|\}$/g, "").split(",").map(s => s.replace(/^"|"$/g, "").trim()).filter(Boolean);
}
function packArticle(row: Record<string, any>) {
  const article: Record<string, any> = { ...row };
  delete article.category_name; delete article.category_slug;
  delete article.source_name; delete article.source_slug;
  delete article.author_name; delete article.author_slug; delete article.author_avatar;
  delete article.profile_author_name; delete article.profile_author_avatar;
  article.categories = row.category_name ? { name: row.category_name, slug: row.category_slug } : null;
  article.news_sources = row.source_name ? { name: row.source_name, slug: row.source_slug } : null;
  article.profiles = row.profile_author_name ? { full_name: row.profile_author_name, avatar_url: row.profile_author_avatar } : null;
  article.authors = row.author_name ? { name: row.author_name, slug: row.author_slug, avatar_url: row.author_avatar } :
    (row.profile_author_name ? { name: row.profile_author_name, avatar_url: row.profile_author_avatar } : null);
  article.auto_tags = autoTags(row.auto_tags);
  return article;
}
const articleSelect = "a.id,a.slug,a.title,a.excerpt,a.content,a.content_markdown,a.ai_summary,a.featured_image_url,a.original_url,a.status,a.featured,a.breaking,a.allow_comments,a.scheduled_at,a.published_at,a.created_at,a.updated_at,a.meta_title,a.meta_description,a.canonical_url,a.view_count,a.category_id,a.author_id,a.source_id,a.external_id,a.external_author_id,a.country,a.source_updated_at,a.content_hash,a.auto_tags,a.is_aggregated,a.duplicate_of,c.name AS category_name,c.slug AS category_slug,s.name AS source_name,s.slug AS source_slug,au.name AS author_name,au.slug AS author_slug,au.avatar_url AS author_avatar,p.full_name AS profile_author_name,p.avatar_url AS profile_author_avatar";
const articleJoin = " FROM articles a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN news_sources s ON s.id=a.source_id LEFT JOIN authors au ON au.id=a.external_author_id LEFT JOIN profiles p ON p.id=a.author_id ";
function articleQuery(env: Env, where: string) {
  return env.DB.prepare("SELECT " + articleSelect + articleJoin + where);
}
async function sourceIdFor(env: Env, source: string) {
  const row = await env.DB.prepare("SELECT id FROM news_sources WHERE slug=?1").bind(source).first();
  return row ? String(row.id) : source;
}

async function publicNews(request: Request, env: Env) {
  const u = new URL(request.url);
  const limit = safeLimit(u.searchParams.get("limit"));
  const offset = Math.max(0, Math.min(1000000, Number(u.searchParams.get("offset") || 0) || 0));
  const filters: string[] = ["a.status='published'", "a.duplicate_of IS NULL"];
  const view = String(u.searchParams.get("view") || "latest").toLowerCase();
  if (view === "today") filters.push("COALESCE(a.published_at,a.created_at) >= datetime('now','start of day')");
  if (view === "week") filters.push("COALESCE(a.published_at,a.created_at) >= datetime('now','-6 days')");
  const args: any[] = [];
  const category = u.searchParams.get("category") || "";
  const source = u.searchParams.get("source") || "";
  const query = (u.searchParams.get("q") || u.searchParams.get("search") || "").trim().slice(0, 160);
  if (category) {
    filters.push("(lower(c.slug)=lower(?"+(args.length+1)+") OR lower(c.name)=lower(?"+(args.length+1)+"))");
    args.push(category);
  }
  if (source) {
    filters.push("(lower(s.slug)=lower(?"+(args.length+1)+") OR lower(s.name)=lower(?"+(args.length+1)+"))");
    args.push(source);
  }
  if (query) {
    const p = "%" + query.replace(/[%_]/g, "") + "%";
    const n = args.length + 1;
    filters.push("(a.title LIKE ?" + n + " OR a.excerpt LIKE ?" + n + " OR a.ai_summary LIKE ?" + n + ")");
    args.push(p);
  }
  const where = " WHERE " + filters.join(" AND ");
  const sortOrder = view === "trending" || view === "most-read" ? "a.view_count DESC, COALESCE(a.published_at,a.created_at) DESC" : "COALESCE(a.published_at,a.created_at) DESC";
  const rows = await env.DB.prepare("SELECT " + articleSelect + articleJoin + where + " ORDER BY " + sortOrder + " LIMIT ?" + (args.length + 1) + " OFFSET ?" + (args.length + 2))
    .bind(...args, limit, offset).all();
  const data = (rows.results || []).map((r: any) => packArticle(r));
  // Avoid a full COUNT(*) scan of ~25k+ articles on every page view. The
  // existing Load More UI only needs a forward-pagination signal here.
  const hasMore = data.length >= limit;
  const paginationTotal = offset + data.length + (hasMore ? 1 : 0);
  return json({ data, total: paginationTotal, totalExact: false, hasMore, offset, limit, updatedAt: new Date().toISOString() });
}

async function publicArticle(identifier: string, env: Env) {
  const id = decodeURIComponent(identifier);
  const by = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? "a.id=?1" : "a.slug=?1";
  const row = await articleQuery(env, " WHERE " + by + " AND a.status='published' AND a.duplicate_of IS NULL").bind(id).first();
  if (!row) return json({ error: "Article not found" }, 404);
  const article = packArticle(row);
  const tags = await env.DB.prepare("SELECT t.id,t.name,t.slug FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=?1").bind(row.id).all();
  article.article_tags = (tags.results || []).map((t: any) => ({ tags: t }));
  const related = await env.DB.prepare("SELECT " + articleSelect + articleJoin + " WHERE a.status='published' AND a.duplicate_of IS NULL AND a.category_id=?1 AND a.id<>?2 ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT 6").bind(row.category_id, row.id).all();
  const more = row.source_id ? await env.DB.prepare("SELECT " + articleSelect + articleJoin + " WHERE a.status='published' AND a.duplicate_of IS NULL AND a.source_id=?1 AND a.id<>?2 ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT 5").bind(row.source_id, row.id).all() : { results: [] };
  const previous = await env.DB.prepare("SELECT " + articleSelect + articleJoin + " WHERE a.status='published' AND a.duplicate_of IS NULL AND COALESCE(a.published_at,a.created_at)<?1 ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT 1").bind(row.published_at || row.created_at).first();
  const next = await env.DB.prepare("SELECT " + articleSelect + articleJoin + " WHERE a.status='published' AND a.duplicate_of IS NULL AND COALESCE(a.published_at,a.created_at)>?1 ORDER BY COALESCE(a.published_at,a.created_at) ASC LIMIT 1").bind(row.published_at || row.created_at).first();
  const [gallery, videos, comments] = await Promise.all([
    env.DB.prepare("SELECT id,title,caption,image_url,alt_text FROM gallery WHERE article_id=?1 AND status='published' ORDER BY sort_order LIMIT 12").bind(row.id).all(),
    env.DB.prepare("SELECT id,title,description,video_url,youtube_url,thumbnail_url,duration_seconds,published_at FROM videos WHERE article_id=?1 AND status='published' ORDER BY published_at DESC LIMIT 6").bind(row.id).all(),
    env.DB.prepare("SELECT id,display_name,body,created_at FROM comments WHERE article_id=?1 AND status='approved' ORDER BY created_at DESC LIMIT 50").bind(row.id).all()
  ]);
  return json({
    data: article,
    related: (related.results || []).map((r: any) => packArticle(r)),
    moreFromSource: (more.results || []).map((r: any) => packArticle(r)),
    previous: previous ? packArticle(previous as any) : null,
    next: next ? packArticle(next as any) : null,
    gallery: gallery.results || [],
    videos: videos.results || [],
    comments: comments.results || []
  });
}

async function publicCategories(slug: string, env: Env) {
  const cat = await env.DB.prepare("SELECT id,name,slug,description,colour FROM categories WHERE lower(slug)=lower(?1) OR lower(name)=lower(?1) LIMIT 1").bind(decodeURIComponent(slug)).first();
  if (!cat && slug !== "ghana") return json({ error: "Category not found" }, 404);
  const count = cat
    ? await env.DB.prepare("SELECT COUNT(*) AS total FROM articles WHERE status='published' AND duplicate_of IS NULL AND category_id=?1").bind(cat.id).first()
    : await env.DB.prepare("SELECT COUNT(*) AS total FROM articles WHERE status='published' AND duplicate_of IS NULL AND country='Ghana'").first();
  return json({ data: cat || { name: "Ghana", slug: "ghana", description: "Latest news from Ghana." }, liveStoryCount: Number(count?.total || 0), updatedAt: new Date().toISOString() });
}

async function publicVideos(env: Env, url: URL) {
  const limit = Math.min(48, safeLimit(url.searchParams.get("limit")));
  const rows = await env.DB.prepare("SELECT v.id,v.title,v.description,v.video_url,v.youtube_url,v.thumbnail_url,v.duration_seconds,v.published_at,v.created_at,s.name AS source_name,s.slug AS source_slug FROM videos v LEFT JOIN articles a ON a.id=v.article_id LEFT JOIN news_sources s ON s.id=a.source_id WHERE v.status='published' ORDER BY COALESCE(v.published_at,v.created_at) DESC LIMIT ?1").bind(limit).all();
  return json({ data: rows.results || [], updatedAt: new Date().toISOString() });
}
async function publicBreaking(env: Env) {
  const rows = await env.DB.prepare("SELECT b.id,b.headline,b.link_url,b.starts_at,b.pinned,a.id AS article_id,a.original_url FROM breaking_news b LEFT JOIN articles a ON a.id=b.article_id WHERE b.active=1 AND (b.ends_at IS NULL OR b.ends_at>datetime('now')) ORDER BY b.pinned DESC,b.starts_at DESC LIMIT 8").all();
  return json({ data: (rows.results || []).map((r: any) => ({ ...r, articles: r.article_id ? { id: r.article_id, original_url: r.original_url } : null })), updatedAt: new Date().toISOString() });
}

function articleShellPath(url: URL, path: string) {
  const next = new URL(path, url.origin);
  return new Request(next.toString(), { method: "GET", headers: { accept: "text/html" } });
}
async function serveAssets(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    console.error("LK Newsroom static asset binding ASSETS is missing; check wrangler.jsonc assets.binding.");
    return new Response("LK Newsroom static assets are not configured. Redeploy with assets.binding set to ASSETS.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }
  if (url.pathname === "/news" || url.pathname.startsWith("/news/")) return env.ASSETS.fetch(articleShellPath(url, "/pages/article.html"));
  if (url.pathname.startsWith("/category/")) return env.ASSETS.fetch(articleShellPath(url, "/pages/category.html"));
  return env.ASSETS.fetch(request);
}

function toText(item: any, ...keys: string[]): string {
  for (const key of keys) {
    const value = item?.[key];
    const result = text(value).trim();
    if (result) return result;
  }
  return "";
}
async function resolveCategory(env: Env, name: string, cache: Map<string, string>) {
  const label = name || "World";
  const slug = slugify(label);
  const cached = cache.get(slug);
  if (cached) return { id: cached, createStatement: null };
  const existing = await env.DB.prepare("SELECT id FROM categories WHERE slug=?1").bind(slug).first();
  if (existing) {
    const id = String(existing.id);
    cache.set(slug, id);
    return { id, createStatement: null };
  }
  const id = crypto.randomUUID();
  cache.set(slug, id);
  return {
    id,
    createStatement: env.DB.prepare("INSERT OR IGNORE INTO categories(id,name,slug,created_at) VALUES (?1,?2,?3,?4)")
      .bind(id, label, slug, new Date().toISOString())
  };
}

async function parseFeed(source: any): Promise<any[]> {
  const response = await fetch(String(source.feed_url), {
    headers: { "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "LK-Newsroom-Global/2.0" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Feed returned HTTP " + response.status);
  const document = parser.parse(await response.text()) as any;
  const channel = document.rss?.channel || document.feed || document.channel || document;
  const entries = asList(channel.item || channel.entry);
  return entries.map((item: any) => {
    const url = pickLink(item.link || item.guid || item.id);
    const title = cleanHtml(item.title);
    const summary = cleanHtml(item.description || item.summary || item.subtitle || item.content);
    const content = cleanHtml(item["content:encoded"] || item.encoded || item.content || item.description);
    const published = safeDate(item.pubDate || item.published || item.updated || item.date);
    const external = text(item.guid || item.id || url).trim() || url || (title + "|" + published);
    return { url, title, summary, content, published, external, image: imageOf(item, url) };
  }).filter((item: any) => item.title && item.url);
}

async function fetchApiSource(source: any, env: Env): Promise<any[]> {
  const secretName = String(source.api_secret_name || "").toUpperCase();
  if (secretName === "NEWS_API_KEY" && env.NEWS_API_KEY) {
    const endpoint = String(source.api_endpoint || "https://newsapi.org/v2/top-headlines");
    const countryCodes: Record<string, string> = {
      "United States": "us", "United Kingdom": "gb", "Nigeria": "ng",
      "South Africa": "za", "Canada": "ca", "India": "in", "Australia": "au"
    };
    const countryCode = countryCodes[String(source.country || "")];
    const useTopHeadlines = endpoint.includes("top-headlines") && Boolean(countryCode);
    const url = new URL(useTopHeadlines ? endpoint : (endpoint.includes("top-headlines") ? "https://newsapi.org/v2/everything" : endpoint));
    url.searchParams.set("pageSize", "50");
    const category = String(source.default_category || "").toLowerCase();
    const categories = new Set(["business", "entertainment", "general", "health", "science", "sports", "technology"]);
    if (useTopHeadlines) {
      url.searchParams.set("country", countryCode!);
      if (categories.has(category)) url.searchParams.set("category", category);
    } else {
      url.searchParams.set("language", "en");
      url.searchParams.set("sortBy", "publishedAt");
      url.searchParams.set("q", String(source.country || "").toLowerCase() === "ghana" ? "Ghana OR Ghanaian" : (source.default_category || source.name || "World"));
    }
    const response = await fetch(url, {
      headers: { "X-Api-Key": env.NEWS_API_KEY, "accept": "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("News API returned HTTP " + response.status);
    const body = await response.json() as any;
    if (body.status !== "ok") throw new Error(String(body.message || "News API returned an invalid response"));
    return asList(body.articles).map((item: any) => {
      const urlValue = String(item.url || "");
      return {
        url: urlValue,
        title: cleanHtml(item.title),
        summary: cleanHtml(item.description || ""),
        content: cleanHtml(item.content || item.description || ""),
        published: safeDate(item.publishedAt),
        external: String(item.url || item.urlToImage || item.title || ""),
        image: String(item.urlToImage || "") || null
      };
    }).filter((item: any) => item.title && item.url);
  }
  if (secretName === "GUARDIAN_API_KEY" && env.GUARDIAN_API_KEY) {
    const url = new URL(source.api_endpoint || "https://content.guardianapis.com/search");
    url.searchParams.set("api-key", env.GUARDIAN_API_KEY);
    url.searchParams.set("page-size", "50");
    url.searchParams.set("order-by", "newest");
    url.searchParams.set("show-fields", "trailText,bodyText,thumbnail,byline");
    const response = await fetch(url, { headers: { "accept": "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Guardian API returned HTTP " + response.status);
    const body = await response.json() as any;
    if (body.response?.status !== "ok") throw new Error("Guardian API returned an invalid response");
    return asList(body.response.results).map((item: any) => {
      const fields = item.fields || {};
      const urlValue = String(item.webUrl || "");
      return {
        url: urlValue,
        title: cleanHtml(item.webTitle),
        summary: cleanHtml(fields.trailText || ""),
        content: cleanHtml(fields.bodyText || fields.trailText || ""),
        published: safeDate(item.webPublicationDate),
        external: String(item.id || urlValue),
        image: String(fields.thumbnail || "") || null
      };
    }).filter((item: any) => item.title && item.url);
  }
  throw new Error("This API source is not configured. Add its server-side API key in Cloudflare Secrets before enabling it.");
}

async function fetchSourceEntries(source: any, env: Env): Promise<any[]> {
  if (String(source.source_type || "rss").toLowerCase() === "rss") return parseFeed(source);
  if (String(source.source_type || "").toLowerCase() === "api") return fetchApiSource(source, env);
  throw new Error("Unsupported source type: " + String(source.source_type || "unknown"));
}

async function upsertFeedArticles(env: Env, source: any, entries: any[], categoryId: string, categoryStatement: any) {
  if (!entries.length) {
    if (categoryStatement) await env.DB.batch([categoryStatement]);
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  const externalIds = Array.from(new Set(entries.map(item => String(item.external).slice(0, 1000))));
  const externalPlaceholders = externalIds.map((_value, index) => "?" + (index + 2)).join(",");
  const existingRows = await env.DB.prepare("SELECT id,external_id FROM articles WHERE source_id=?1 AND external_id IN (" + externalPlaceholders + ")")
    .bind(source.id, ...externalIds).all();
  const existingByExternal = new Map<string, string>();
  for (const row of (existingRows.results || []) as any[]) existingByExternal.set(String(row.external_id), String(row.id));

  const hashesByExternal = new Map<string, string>();
  for (const item of entries) hashesByExternal.set(String(item.external).slice(0, 1000), await sha((item.title + " " + item.summary).toLowerCase().replace(/\s+/g, " ").trim()));
  const hashes = Array.from(new Set(Array.from(hashesByExternal.values())));
  const externalHashes = hashes.length ? await env.DB.prepare("SELECT content_hash,source_id FROM articles WHERE content_hash IN (" + hashes.map((_value, index) => "?" + (index + 1)).join(",") + ")")
    .bind(...hashes).all() : { results: [] };
  const crossSourceHashes = new Set<string>();
  for (const row of (externalHashes.results || []) as any[]) {
    if (String(row.source_id) !== String(source.id) && row.content_hash) crossSourceHashes.add(String(row.content_hash));
  }

  const statements: any[] = [];
  if (categoryStatement) statements.push(categoryStatement);
  let inserted = 0, updated = 0, skipped = 0;
  const seenThisRun = new Set<string>();
  for (const item of entries) {
    const external = String(item.external).slice(0, 1000);
    const hash = hashesByExternal.get(external) || await sha((item.title + " " + item.summary).toLowerCase().replace(/\s+/g, " ").trim());
    if (crossSourceHashes.has(hash) || seenThisRun.has(source.slug + "|" + external)) {
      skipped++;
      continue;
    }
    seenThisRun.add(source.slug + "|" + external);
    const existingId = existingByExternal.get(external);
    const id = existingId || crypto.randomUUID();
    const slug = slugify(source.slug + "-" + item.title + "-" + (await sha(external)).slice(0, 8));
    const now = new Date().toISOString();
    const isBreaking = breakingTerms.test(item.title + " " + item.summary) ? 1 : 0;
    statements.push(
      env.DB.prepare("INSERT INTO articles (id,slug,title,excerpt,content,featured_image_url,original_url,status,breaking,allow_comments,published_at,created_at,updated_at,category_id,source_id,external_id,country,source_updated_at,content_hash,auto_tags,is_aggregated) VALUES (?1,?2,?3,?4,?5,?6,?7,'published',?8,0,?9,?10,?10,?11,?12,?13,?14,?9,?15,'[]',1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,excerpt=excluded.excerpt,content=excluded.content,featured_image_url=COALESCE(excluded.featured_image_url,articles.featured_image_url),original_url=excluded.original_url,published_at=excluded.published_at,source_updated_at=excluded.source_updated_at,content_hash=excluded.content_hash,updated_at=excluded.updated_at")
        .bind(id, slug, item.title.slice(0, 800), item.summary.slice(0, 5000), item.content.slice(0, 20000), item.image, item.url, isBreaking, item.published, now, categoryId, source.id, external, source.country, hash),
      env.DB.prepare("INSERT INTO live_updates(id,article_id,title,body,kind,pinned,published_at,created_at) VALUES (?1,?2,?3,?4,?5,0,?6,?7) ON CONFLICT(article_id) DO UPDATE SET title=excluded.title,body=excluded.body,kind=excluded.kind,published_at=excluded.published_at")
        .bind(crypto.randomUUID(), id, item.title.slice(0, 800), item.summary.slice(0, 5000), isBreaking ? "breaking" : "news", item.published, now)
    );
    if (isBreaking) {
      statements.push(env.DB.prepare("INSERT INTO breaking_news(id,article_id,source_id,headline,link_url,active,pinned,starts_at,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,1,0,?6,?7,?7) ON CONFLICT(article_id) DO UPDATE SET headline=excluded.headline,link_url=excluded.link_url,active=1,starts_at=excluded.starts_at")
        .bind(crypto.randomUUID(), id, source.id, item.title.slice(0, 800), item.url, item.published, now));
    }
    if (existingId) updated++; else inserted++;
  }
  if (statements.length) await env.DB.batch(statements);
  return { inserted, updated, skipped };
}

async function runFeedSync(env: Env, requestedSourceSlug?: string) {
  const started = new Date().toISOString();
  const lockName = "news-ingestion";
  const lockUntil = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  const lock = await env.DB.prepare("INSERT INTO worker_locks(lock_name,locked_until) VALUES (?1,?2) ON CONFLICT(lock_name) DO UPDATE SET locked_until=excluded.locked_until WHERE worker_locks.locked_until<?3")
    .bind(lockName, lockUntil, started).run();
  if (Number(lock?.meta?.changes || 0) !== 1) {
    return { status: "skipped", reason: "An ingestion job is already running.", startedAt: started };
  }

  const runId = crypto.randomUUID();
  let runCreated = false;
  try {
    await env.DB.prepare("INSERT INTO worker_runs(id,trigger,status,started_at) VALUES (?1,'cron','running',?2)").bind(runId, started).run();
    runCreated = true;
    const sourceFilter = " WHERE enabled=1 AND ((source_type='rss' AND feed_url IS NOT NULL) OR (source_type='api' AND ((api_secret_name='NEWS_API_KEY' AND ?1=1) OR (api_secret_name='GUARDIAN_API_KEY' AND ?2=1))))";
    const sourceStatement = requestedSourceSlug
      // Explicit source sync should include the selected enabled row even when
      // its feed/API configuration is broken, so the source error is recorded.
      ? env.DB.prepare("SELECT * FROM news_sources WHERE enabled=1 AND slug=?1 ORDER BY name").bind(requestedSourceSlug)
      : env.DB.prepare("SELECT * FROM news_sources" + sourceFilter + " ORDER BY CASE WHEN last_synced_at IS NULL THEN 0 ELSE 1 END, last_synced_at ASC, name LIMIT 6").bind(env.NEWS_API_KEY ? 1 : 0, env.GUARDIAN_API_KEY ? 1 : 0);
    const sources = await sourceStatement.all();
    let fetched = 0, added = 0, updated = 0, skipped = 0, errors = 0;
    const categoryCache = new Map<string, string>();
    for (const source of (sources.results || []) as any[]) {
      const began = Date.now();
      try {
        const entries = (await fetchSourceEntries(source, env)).slice(0, 12);
        fetched += entries.length;
        const category = await resolveCategory(env, String(source.default_category || "World"), categoryCache);
        const counts = await upsertFeedArticles(env, source, entries, category.id, category.createStatement);
        added += counts.inserted;
        updated += counts.updated;
        skipped += counts.skipped;
        const ended = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare("UPDATE news_sources SET last_synced_at=?1,last_status='success',last_error=NULL,consecutive_failures=0,updated_at=?1 WHERE id=?2").bind(ended, source.id),
          env.DB.prepare("INSERT INTO feed_logs(id,source_id,level,event,details,duration_ms,created_at) VALUES (?1,?2,'info','sync_completed',?3,?4,?5)").bind(crypto.randomUUID(), source.id, JSON.stringify({ fetched: entries.length, inserted: counts.inserted, updated: counts.updated, skipped: counts.skipped }), Date.now() - began, ended)
        ]);
      } catch (error) {
        errors++;
        const ended = new Date().toISOString();
        const message = error instanceof Error ? error.message : String(error);
        await env.DB.batch([
          env.DB.prepare("UPDATE news_sources SET last_synced_at=?1,last_status='error',last_error=?2,consecutive_failures=consecutive_failures+1,updated_at=?1 WHERE id=?3").bind(ended, message.slice(0, 1000), source.id),
          env.DB.prepare("INSERT INTO feed_logs(id,source_id,level,event,details,duration_ms,created_at) VALUES (?1,?2,'error','sync_failed',?3,?4,?5)").bind(crypto.randomUUID(), source.id, JSON.stringify({ error: message.slice(0, 500) }), Date.now() - began, ended)
        ]);
      }
    }
    const completed = new Date().toISOString();
    await env.DB.prepare("UPDATE worker_runs SET status='completed',completed_at=?1,fetched=?2,added=?3,updated=?4,skipped=?5,errors=?6 WHERE id=?7")
      .bind(completed, fetched, added, updated, skipped, errors, runId).run();
    return { status: "completed", runId, startedAt: started, completedAt: completed, fetched, added, updated, skipped, errors };
  } catch (error) {
    if (runCreated) {
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare("UPDATE worker_runs SET status='failed',completed_at=?1,error=?2 WHERE id=?3")
        .bind(new Date().toISOString(), message.slice(0, 1000), runId).run().catch(() => undefined);
    }
    throw error;
  } finally {
    await env.DB.prepare("DELETE FROM worker_locks WHERE lock_name=?1 AND locked_until=?2").bind(lockName, lockUntil).run().catch(() => undefined);
  }
}

const FOOTBALL_LEAGUES = [
  { id: "eng.1", name: "Premier League" },
  { id: "esp.1", name: "La Liga" },
  { id: "ita.1", name: "Serie A" },
  { id: "ger.1", name: "Bundesliga" },
  { id: "fra.1", name: "Ligue 1" },
  { id: "uefa.champions", name: "Champions League" }
];
function footballFixture(event: any, league: { id: string; name: string }) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find((team: any) => team.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((team: any) => team.homeAway === "away") || competitors[1] || {};
  const state = String(event.status?.type?.state || competition.status?.type?.state || "").toLowerCase();
  const statusName = String(event.status?.type?.name || competition.status?.type?.name || "");
  const short = state === "in" ? (statusName === "STATUS_HALFTIME" ? "HT" : "LIVE") : state === "post" ? "FT" : "NS";
  return {
    fixture: {
      id: String(event.id || ""),
      date: event.date || competition.date || null,
      status: {
        short,
        long: event.status?.type?.detail || competition.status?.type?.detail || event.status?.type?.description || "Scheduled",
        elapsed: event.status?.displayClock ? Number.parseInt(String(event.status.displayClock), 10) || null : null
      },
      venue: { name: competition.venue?.fullName || "" }
    },
    league: { id: league.id, name: league.name },
    teams: {
      home: { id: home.id || home.team?.id || null, name: home.team?.displayName || home.team?.name || "Home", logo: home.team?.logo || home.team?.logos?.[0]?.href || "" },
      away: { id: away.id || away.team?.id || null, name: away.team?.displayName || away.team?.name || "Away", logo: away.team?.logo || away.team?.logos?.[0]?.href || "" }
    },
    goals: { home: home.score === undefined || home.score === "" ? null : Number(home.score), away: away.score === undefined || away.score === "" ? null : Number(away.score) },
    events: [], statistics: [], lineups: [], players: []
  };
}
async function footballFixtures(url: URL) {
  const liveOnly = url.searchParams.get("live") === "all";
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  if (!liveOnly && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Provide live=all or a date in YYYY-MM-DD format." }, 400);
  const compactDate = date.replace(/-/g, "");
  const results = await Promise.allSettled(FOOTBALL_LEAGUES.map(async league => {
    const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/" + league.id + "/scoreboard?dates=" + compactDate, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Football scoreboard feed temporarily unavailable.");
    const body = await response.json() as any;
    return (body.events || []).map((event: any) => footballFixture(event, league));
  }));
  let fixtures = results.flatMap(item => item.status === "fulfilled" ? item.value : []);
  if (liveOnly) fixtures = fixtures.filter(item => ["LIVE", "HT"].includes(item.fixture.status.short));
  fixtures.sort((a, b) => new Date(a.fixture.date || 0).getTime() - new Date(b.fixture.date || 0).getTime());
  return json({ get: liveOnly ? "/scoreboard?live=all" : "/scoreboard?date=" + date, results: fixtures.length, response: fixtures }, 200, "*");
}
async function footballFixtureDetail(id: string, leagueSlug: string) {
  if (!/^\d{1,20}$/.test(id)) return json({ error: "Invalid match ID." }, 400);
  const preferred = FOOTBALL_LEAGUES.find(item => item.id === leagueSlug);
  const leagues = preferred ? [preferred, ...FOOTBALL_LEAGUES.filter(item => item.id !== preferred.id)] : FOOTBALL_LEAGUES;
  const summaries = await Promise.allSettled(leagues.map(async league => {
    const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/" + league.id + "/summary?event=" + encodeURIComponent(id), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const data = await response.json() as any;
    const header = data.header || {};
    const event = header.competitions?.[0] ? header : data.events?.[0] || data.gameInfo?.event;
    if (!event || (event.id && String(event.id) !== id)) return null;
    const competition = event.competitions?.[0] || {};
    const normalized = { ...event, id: event.id || id, date: event.date || competition.date || null, status: event.status || competition.status || {} };
    const fixture = footballFixture(normalized, league);
    fixture.events = (data.plays || []).map((play: any) => {
      const displayClock = play.clock?.displayValue || play.clock?.displayClock || "";
      const minute = displayClock ? Number.parseInt(String(displayClock), 10) : null;
      return {
        time: { elapsed: Number.isFinite(minute) ? minute : (play.period?.number ?? null), extra: null },
        type: play.type?.text || play.type?.name || "Match event",
        detail: play.text || play.shortText || "",
        team: { name: play.team?.displayName || "" },
        player: { name: play.participants?.[0]?.athlete?.displayName || "" },
        assist: { name: "" }
      };
    });
    fixture.statistics = (data.boxscore?.teams || []).map((team: any) => ({
      team: { id: team.team?.id || null, name: team.team?.displayName || "" },
      statistics: (team.statistics || []).map((stat: any) => ({ type: stat.name || stat.label, value: stat.displayValue ?? stat.value ?? null }))
    }));
    fixture.lineups = (data.boxscore?.players || []).flatMap((group: any) => (group.statistics || []).map((category: any) => ({
      team: { name: group.team?.displayName || "" },
      formation: "",
      startXI: (category.athletes || []).map((entry: any) => ({ player: { name: entry.athlete?.displayName || entry.athlete?.fullName || "Player", number: entry.athlete?.jersey || "", pos: entry.athlete?.position?.abbreviation || "" } })),
      substitutes: []
    })));
    return fixture;
  }));
  const found = summaries.find(item => item.status === "fulfilled" && item.value);
  if (!found || found.status !== "fulfilled" || !found.value) return json({ error: "This match could not be found in the supported football feeds." }, 404);
  return json({ get: "/summary?event=" + id, results: 1, response: [found.value] }, 200, "*");
}

function addPlanEndDate(startIso: string, interval: string) {
  const date = new Date(startIso);
  const normalized = String(interval || "monthly").toLowerCase();
  if (normalized === "year" || normalized === "yearly" || normalized === "annual") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else if (normalized === "week" || normalized === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (normalized === "day" || normalized === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

async function beginCheckout(request: Request, env: Env, origin: string) {
  try {
    const body = await request.json() as any;
    const kind = String(body.kind || "").toLowerCase();
    const provider = String(body.provider || "").toLowerCase();
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    if (!["donation", "subscription"].includes(kind)) return json({ error: "Choose a donation or membership checkout." }, 400, origin);
    if (!["paystack", "stripe"].includes(provider)) return json({ error: "Choose Paystack or Stripe." }, 400, origin);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400, origin);
    if (provider === "paystack" && !env.PAYSTACK_SECRET_KEY) return json({ error: "Paystack checkout has not been configured for this Cloudflare deployment yet." }, 503, origin);
    if (provider === "stripe" && !env.STRIPE_SECRET_KEY) return json({ error: "Stripe checkout has not been configured for this Cloudflare deployment yet." }, 503, origin);

    let amount = 0;
    let currency = String(body.currency || "GHS").trim().toUpperCase();
    let plan: any = null;
    let planInterval = "monthly";
    if (kind === "subscription") {
      const planId = String(body.planId || "").trim().slice(0, 100);
      if (!planId) return json({ error: "Choose a membership plan." }, 400, origin);
      plan = await env.DB.prepare("SELECT id,name,slug,amount,currency,interval,paystack_plan_code,stripe_price_id,active FROM membership_plans WHERE id=?1 AND active=1 LIMIT 1").bind(planId).first();
      if (!plan) return json({ error: "This membership plan is unavailable." }, 404, origin);
      amount = Number(plan.amount);
      currency = String(plan.currency || "GHS").toUpperCase();
      planInterval = String(plan.interval || "monthly").toLowerCase();
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: "This membership plan does not have a valid price." }, 400, origin);
      if (provider === "paystack" && !String(plan.paystack_plan_code || "").trim()) {
        return json({ error: "This plan needs a Paystack recurring-plan code before Paystack membership checkout can be enabled. No payment was attempted." }, 503, origin);
      }
    } else {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) return json({ error: "Donation amount must be between 1 and 1,000,000." }, 400, origin);
      if (!["GHS", "USD", "GBP", "EUR", "NGN", "ZAR"].includes(currency)) return json({ error: "That currency is not supported by the checkout form." }, 400, origin);
    }

    const now = new Date().toISOString();
    const transactionId = crypto.randomUUID();
    const donationId = kind === "donation" ? crypto.randomUUID() : null;
    const subscriptionId = kind === "subscription" ? crypto.randomUUID() : null;
    const reference = "LK" + crypto.randomUUID().replace(/-/g, "").toUpperCase();
    const name = String(body.name || "").trim().slice(0, 120);
    const message = String(body.message || "").trim().slice(0, 500);
    const insertStatements: any[] = [];
    if (donationId) {
      insertStatements.push(env.DB.prepare("INSERT INTO donations(id,donor_name,donor_email,amount,currency,provider,provider_reference,message,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9,?9)")
        .bind(donationId, name || null, email, amount, currency, provider, reference, message || null, now));
    }
    if (subscriptionId && plan) {
      insertStatements.push(env.DB.prepare("INSERT INTO subscriptions(id,plan_id,plan,provider,provider_reference,amount,currency,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',?8,?8)")
        .bind(subscriptionId, plan.id, String(plan.name), provider, reference, amount, currency, now));
    }
    insertStatements.push(env.DB.prepare("INSERT INTO payment_transactions(id,kind,provider,reference,email,amount,currency,donation_id,subscription_id,status,provider_response,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'initiated','{}',?10,?10)")
      .bind(transactionId, kind, provider, reference, email, amount, currency, donationId, subscriptionId, now));
    await env.DB.batch(insertStatements);

    let checkoutUrl = "";
    let providerResponse: any = {};
    try {
      if (provider === "paystack") {
        const callback = origin + "/pages/support.html?payment=" + encodeURIComponent(reference);
        const payload: Record<string, any> = {
          email,
          currency,
          reference,
          callback_url: callback,
          metadata: { reference, transaction_id: transactionId, kind, plan_id: plan?.id || null, donor_name: name || null }
        };
        if (kind === "subscription" && plan?.paystack_plan_code) payload.plan = String(plan.paystack_plan_code);
        else payload.amount = String(Math.round(amount * 100));
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
          method: "POST",
          headers: { authorization: "Bearer " + env.PAYSTACK_SECRET_KEY, "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000)
        });
        const data = await response.json() as any;
        if (!response.ok || !data.status || !data.data?.authorization_url || data.data.reference !== reference) {
          throw new Error(String(data.message || "Paystack could not initialize this payment."));
        }
        checkoutUrl = String(data.data.authorization_url);
        providerResponse = { provider: "paystack", reference, accessCode: data.data.access_code || null };
      } else {
        const session = new URLSearchParams();
        session.set("mode", kind === "subscription" ? "subscription" : "payment");
        session.set("customer_email", email);
        session.set("client_reference_id", reference);
        session.set("success_url", origin + "/pages/support.html?payment=" + encodeURIComponent(reference));
        session.set("cancel_url", origin + "/pages/support.html?payment_cancelled=1");
        session.set("metadata[reference]", reference);
        session.set("metadata[transaction_id]", transactionId);
        session.set("metadata[kind]", kind);
        if (kind === "subscription" && plan?.stripe_price_id) {
          session.set("line_items[0][price]", String(plan.stripe_price_id));
          session.set("line_items[0][quantity]", "1");
        } else {
          session.set("line_items[0][quantity]", "1");
          session.set("line_items[0][price_data][currency]", currency.toLowerCase());
          session.set("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
          session.set("line_items[0][price_data][product_data][name]", kind === "subscription" ? String(plan.name) : "LK Newsroom donation");
          if (kind === "subscription") {
            const interval = planInterval === "year" || planInterval === "yearly" || planInterval === "annual" ? "year" : "month";
            session.set("line_items[0][price_data][recurring][interval]", interval);
          }
        }
        if (kind === "subscription") {
          session.set("subscription_data[metadata][reference]", reference);
          session.set("subscription_data[metadata][transaction_id]", transactionId);
        } else {
          session.set("payment_intent_data[metadata][reference]", reference);
          session.set("payment_intent_data[metadata][transaction_id]", transactionId);
        }
        const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" },
          body: session.toString(),
          signal: AbortSignal.timeout(15000)
        });
        const data = await response.json() as any;
        if (!response.ok || !data.url || !data.id) {
          throw new Error(String(data.error?.message || "Stripe could not initialize this payment."));
        }
        checkoutUrl = String(data.url);
        providerResponse = { provider: "stripe", sessionId: String(data.id), reference };
      }
      await env.DB.prepare("UPDATE payment_transactions SET provider_response=?1,updated_at=?2 WHERE id=?3")
        .bind(JSON.stringify(providerResponse), new Date().toISOString(), transactionId).run();
      return json({ checkoutUrl, reference, kind }, 200, origin);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Checkout initialization failed.";
      await env.DB.batch([
        env.DB.prepare("UPDATE payment_transactions SET status='failed',provider_response=?1,updated_at=?2 WHERE id=?3").bind(JSON.stringify({ error: reason.slice(0, 250) }), new Date().toISOString(), transactionId),
        ...(donationId ? [env.DB.prepare("UPDATE donations SET status='failed',updated_at=?1 WHERE id=?2").bind(new Date().toISOString(), donationId)] : []),
        ...(subscriptionId ? [env.DB.prepare("UPDATE subscriptions SET status='failed',updated_at=?1 WHERE id=?2").bind(new Date().toISOString(), subscriptionId)] : [])
      ]);
      return json({ error: "Secure checkout could not be started. No payment was taken. " + reason.slice(0, 160) }, 502, origin);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Checkout request is invalid." }, 400, origin);
  }
}

async function verifyPayment(reference: string, env: Env, origin: string) {
  if (!/^[A-Za-z0-9.=+-]{8,150}$/.test(reference)) return json({ error: "Invalid payment reference." }, 400, origin);
  const row = await env.DB.prepare("SELECT id,kind,provider,reference,email,amount,currency,donation_id,subscription_id,status,provider_response FROM payment_transactions WHERE reference=?1 LIMIT 1").bind(reference).first() as any;
  if (!row) return json({ error: "Payment reference not found." }, 404, origin);
  if (row.status === "paid") return json({ data: { reference: row.reference, status: "paid" } }, 200, origin);

  let successful = false;
  let paidAmount: number | null = null;
  let paidCurrency = "";
  let providerSubscriptionId: string | null = null;
  let verifiedResponse: any = {};
  const now = new Date().toISOString();
  try {
    if (row.provider === "paystack" && env.PAYSTACK_SECRET_KEY) {
      const response = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
        headers: { authorization: "Bearer " + env.PAYSTACK_SECRET_KEY },
        signal: AbortSignal.timeout(12000)
      });
      const data = await response.json() as any;
      const transaction = data.data || {};
      paidAmount = Number(transaction.amount);
      paidCurrency = String(transaction.currency || "").toUpperCase();
      successful = Boolean(response.ok && data.status && transaction.status === "success" && transaction.reference === reference && paidAmount === Math.round(Number(row.amount) * 100) && paidCurrency === String(row.currency).toUpperCase());
      providerSubscriptionId = transaction.subscription?.subscription_code || transaction.subscription_code || null;
      verifiedResponse = { provider: "paystack", reference, status: transaction.status || "pending", verified: successful };
    } else if (row.provider === "stripe" && env.STRIPE_SECRET_KEY) {
      let saved: any = {};
      try { saved = JSON.parse(String(row.provider_response || "{}")); } catch {}
      const sessionId = String(saved.sessionId || "");
      if (!sessionId) return json({ data: { reference: row.reference, status: row.status } }, 200, origin);
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
        headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY },
        signal: AbortSignal.timeout(12000)
      });
      const session = await response.json() as any;
      paidAmount = Number(session.amount_total);
      paidCurrency = String(session.currency || "").toUpperCase();
      const metadataRef = String(session.metadata?.reference || session.client_reference_id || "");
      successful = Boolean(response.ok && session.payment_status === "paid" && metadataRef === reference && paidAmount === Math.round(Number(row.amount) * 100) && paidCurrency === String(row.currency).toUpperCase());
      providerSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
      verifiedResponse = { provider: "stripe", sessionId, status: session.payment_status || "pending", verified: successful };
    } else {
      return json({ error: "Payment verification is not configured for this provider." }, 503, origin);
    }
  } catch {
    return json({ error: "Unable to verify this payment yet. Please try again." }, 503, origin);
  }

  if (successful) {
    await env.DB.prepare("UPDATE payment_transactions SET status='paid',provider_response=?1,updated_at=?2 WHERE id=?3 AND status<>'paid'")
      .bind(JSON.stringify(verifiedResponse), now, row.id).run();
    if (row.donation_id) {
      await env.DB.prepare("UPDATE donations SET status='paid',updated_at=?1 WHERE id=?2").bind(now, row.donation_id).run();
    }
    if (row.subscription_id) {
      const sub = await env.DB.prepare("SELECT id,plan_id FROM subscriptions WHERE id=?1").bind(row.subscription_id).first() as any;
      const plan = sub?.plan_id ? await env.DB.prepare("SELECT interval FROM membership_plans WHERE id=?1").bind(sub.plan_id).first() as any : null;
      const end = addPlanEndDate(now, String(plan?.interval || "monthly"));
      await env.DB.prepare("UPDATE subscriptions SET status='active',provider_subscription_id=COALESCE(?1,provider_subscription_id),start_date=COALESCE(start_date,?2),end_date=?3,updated_at=?2 WHERE id=?4")
        .bind(providerSubscriptionId, now, end, row.subscription_id).run();
    }
    return json({ data: { reference: row.reference, status: "paid" } }, 200, origin);
  }
  return json({ data: { reference: row.reference, status: row.status === "failed" ? "failed" : "initiated" } }, 200, origin);
}

function fixedTimeEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function handlePaystackWebhook(request: Request, env: Env, origin: string) {
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "Paystack webhook is not configured." }, 503, origin);
  const signature = request.headers.get("x-paystack-signature") || "";
  if (!signature || signature.length > 256) return json({ error: "Missing Paystack signature." }, 401, origin);
  const raw = await request.text();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PAYSTACK_SECRET_KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("");
  if (!fixedTimeEquals(signature.toLowerCase(), expected)) return json({ error: "Invalid Paystack signature." }, 401, origin);
  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "Invalid webhook body." }, 400, origin); }
  if (event.event === "charge.success" && event.data?.reference) {
    const verified = await verifyPayment(String(event.data.reference), env, origin);
    if (verified.status >= 500) return json({ error: "Payment verification will be retried." }, 503, origin);
  }
  return json({ received: true }, 200, origin);
}

const ADMIN_PASSWORD_ITERATIONS = 150000;
const ADMIN_ROLES = new Set(["super_admin", "admin", "editor", "journalist", "moderator"]);
const ADMIN_TABLES = new Set([
  "articles", "article_tags", "authors", "categories", "tags", "news_sources",
  "breaking_news", "live_updates", "featured_news", "trending_news", "videos",
  "gallery", "comments", "newsletter", "profiles", "users_roles", "settings",
  "advertisements", "advertisers", "advertiser_requests", "advertising_packages",
  "sponsored_article_details", "affiliate_campaigns", "affiliate_links", "affiliate_events",
  "membership_plans", "subscriptions", "donations", "payment_transactions", "revenue",
  "social_templates", "social_graphics", "social_accounts", "social_posts", "social_logs",
  "notifications", "notification_subscriptions", "notification_deliveries", "notification_campaigns",
  "daily_briefs", "worker_runs", "feed_logs", "analytics_events", "page_views",
  "company_enquiries", "company_staff_profiles"
]);
const ADMIN_TABLE_ROLE_ALLOWLIST: Record<string, string[]> = {
  editor: ["articles", "article_tags", "authors", "categories", "tags", "news_sources", "breaking_news", "live_updates", "featured_news", "trending_news", "videos", "gallery", "comments", "newsletter", "profiles", "users_roles", "feed_logs"],
  journalist: ["articles", "article_tags", "authors", "categories", "tags", "news_sources", "breaking_news", "live_updates", "featured_news", "trending_news", "videos", "gallery", "profiles", "users_roles"],
  moderator: ["comments", "profiles", "users_roles", "notifications", "notification_subscriptions", "notification_deliveries", "newsletter"]
};
function adminBytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
function adminHexToBytes(value: string) {
  const bytes = new Uint8Array(Math.floor(value.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function newAdminToken() {
  return adminBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}
async function deriveAdminPassword(password: string, saltHex: string, iterations = ADMIN_PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: adminHexToBytes(saltHex), iterations, hash: "SHA-256" }, material, 256);
  return adminBytesToHex(new Uint8Array(bits));
}
function safeAdminUser(row: any) {
  return {
    id: String(row.id),
    email: String(row.email),
    full_name: String(row.full_name || ""),
    role: String(row.role || "journalist"),
    active: Number(row.active ?? 1) === 1,
    must_change_password: Number(row.must_change_password ?? 0) === 1,
    created_at: row.created_at || null,
    last_login_at: row.last_login_at || null
  };
}
async function createAdminAccount(env: Env, values: { email: string; fullName: string; password: string; role: string; mustChangePassword?: boolean }) {
  const email = values.email.trim().toLowerCase().slice(0, 254);
  const fullName = values.fullName.trim().slice(0, 120);
  const role = values.role;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid staff email address.");
  if (fullName.length < 2) throw new Error("Enter the staff member's full name.");
  if (values.password.length < 12 || values.password.length > 256) throw new Error("Password must be at least 12 characters long.");
  if (!ADMIN_ROLES.has(role)) throw new Error("Choose a valid newsroom role.");
  const id = crypto.randomUUID();
  const salt = adminBytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await deriveAdminPassword(values.password, salt);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO admin_users(id,email,full_name,password_salt,password_hash,password_iterations,role,active,must_change_password,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8,?9,?9)")
    .bind(id, email, fullName, salt, hash, ADMIN_PASSWORD_ITERATIONS, role, values.mustChangePassword === false ? 0 : 1, now).run();
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO profiles(id,full_name,created_at,updated_at) VALUES (?1,?2,?3,?3)").bind(id, fullName, now),
    env.DB.prepare("INSERT OR REPLACE INTO users_roles(user_id,role,assigned_at) VALUES (?1,?2,?3)").bind(id, role, now)
  ]);
  return safeAdminUser({ id, email, full_name: fullName, role, active: 1, must_change_password: values.mustChangePassword === false ? 0 : 1, created_at: now });
}
async function createAdminSession(request: Request, env: Env, user: any, remember = false) {
  const token = newAdminToken();
  const now = new Date();
  const expiry = new Date(now.getTime() + (remember ? 7 * 24 : 12) * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 250);
  await env.DB.prepare("INSERT INTO admin_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at,user_agent) VALUES (?1,?2,?3,?4,?5,?4,?6)")
    .bind(id, user.id, await sha(token), now.toISOString(), expiry, userAgent).run();
  return {
    access_token: token,
    token_type: "bearer",
    expires_at: Math.floor(new Date(expiry).getTime() / 1000),
    user: safeAdminUser(user)
  };
}
async function getAdminSession(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!/^([a-f0-9]{64})$/i.test(token)) return null;
  const tokenHash = await sha(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare("SELECT s.id AS session_id,s.user_id,s.expires_at,u.email,u.full_name,u.role,u.active,u.must_change_password,u.created_at,u.last_login_at FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND u.active=1 LIMIT 1")
    .bind(tokenHash, now).first() as any;
  if (!row) return null;
  const seenAt = now;
  await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=?1 WHERE id=?2").bind(seenAt, row.session_id).run();
  return {
    session_id: String(row.session_id),
    user_id: String(row.user_id),
    user: safeAdminUser({ ...row, id: row.user_id }),
    role: String(row.role || "journalist")
  };
}
async function handleAdminBootstrap(request: Request, env: Env, origin: string) {
  const expectedSecret = String(env.ADMIN_BOOTSTRAP_SECRET || "");
  const suppliedSecret = String(request.headers.get("x-admin-bootstrap-secret") || "");
  if (!expectedSecret) return json({ error: "First-admin setup is not enabled. Set ADMIN_BOOTSTRAP_SECRET as a Worker secret before bootstrapping." }, 503, origin);
  if (!suppliedSecret || !fixedTimeEquals(suppliedSecret, expectedSecret)) return json({ error: "Invalid setup token." }, 401, origin);
  const count = await env.DB.prepare("SELECT COUNT(*) AS active_count FROM admin_users WHERE active=1").first() as any;
  if (Number(count?.active_count || 0) > 0) return json({ error: "The first admin account has already been created." }, 409, origin);
  const lock = await env.DB.prepare("INSERT OR IGNORE INTO admin_bootstrap_lock(id,created_at) VALUES ('initial',?1)").bind(new Date().toISOString()).run();
  if (Number(lock?.meta?.changes || 0) !== 1) return json({ error: "Admin setup has already been started. Sign in with the first admin account." }, 409, origin);
  try {
    const body = await request.json() as any;
    const user = await createAdminAccount(env, {
      email: String(body.email || ""),
      fullName: String(body.fullName || body.name || ""),
      password: String(body.password || ""),
      role: "super_admin",
      mustChangePassword: false
    });
    const session = await createAdminSession(request, env, user, true);
    return json({ user, session }, 201, origin);
  } catch (error) {
    await env.DB.prepare("DELETE FROM admin_bootstrap_lock WHERE id='initial'").run().catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unable to set up the first admin account.";
    const status = /valid staff email|full name|at least 12 characters|valid newsroom role/.test(message) ? 400 : /UNIQUE|unique/i.test(message) ? 409 : 400;
    return json({ error: message }, status, origin);
  }
}
async function handleAdminLogin(request: Request, env: Env, origin: string) {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "Invalid sign-in request." }, 400, origin); }
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  const password = String(body.password || "");
  if (!email || password.length > 256) return json({ error: "Email or password is incorrect." }, 401, origin);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS failures FROM admin_login_attempts WHERE email=?1 AND successful=0 AND attempted_at>=datetime('now','-15 minutes')")
    .bind(email).first() as any;
  if (Number(recent?.failures || 0) >= 10) return json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." }, 429, origin);
  const user = await env.DB.prepare("SELECT id,email,full_name,password_salt,password_hash,password_iterations,role,active,must_change_password,created_at,last_login_at FROM admin_users WHERE email=?1 COLLATE NOCASE LIMIT 1")
    .bind(email).first() as any;
  let valid = false;
  if (user && Number(user.active) === 1 && password.length >= 1) {
    const derived = await deriveAdminPassword(password, String(user.password_salt), Number(user.password_iterations || ADMIN_PASSWORD_ITERATIONS));
    valid = fixedTimeEquals(derived, String(user.password_hash || ""));
  }
  const attemptNow = new Date().toISOString();
  await env.DB.prepare("INSERT INTO admin_login_attempts(id,email,successful,attempted_at) VALUES (?1,?2,?3,?4)")
    .bind(crypto.randomUUID(), email, valid ? 1 : 0, attemptNow).run();
  if (!valid) return json({ error: "Email or password is incorrect." }, 401, origin);
  await env.DB.prepare("UPDATE admin_users SET last_login_at=?1,updated_at=?1 WHERE id=?2").bind(attemptNow, user.id).run();
  const refreshed = { ...user, last_login_at: attemptNow };
  const session = await createAdminSession(request, env, refreshed, Boolean(body.remember));
  return json({ user: safeAdminUser(refreshed), session }, 200, origin);
}
async function handleAdminLogout(request: Request, env: Env, origin: string) {
  const session = await getAdminSession(request, env);
  if (session) await env.DB.prepare("UPDATE admin_sessions SET revoked_at=?1 WHERE id=?2").bind(new Date().toISOString(), session.session_id).run();
  return json({ ok: true }, 200, origin);
}
async function handleAdminChangePassword(request: Request, env: Env, origin: string) {
  const session = await getAdminSession(request, env);
  if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "Invalid password-change request." }, 400, origin); }
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  const row = await env.DB.prepare("SELECT password_salt,password_hash,password_iterations FROM admin_users WHERE id=?1 AND active=1").bind(session.user_id).first() as any;
  if (!row) return json({ error: "Admin account not found." }, 404, origin);
  const currentHash = await deriveAdminPassword(currentPassword, String(row.password_salt), Number(row.password_iterations || ADMIN_PASSWORD_ITERATIONS));
  if (!fixedTimeEquals(currentHash, String(row.password_hash || ""))) return json({ error: "Current password is incorrect." }, 401, origin);
  if (newPassword.length < 12 || newPassword.length > 256) return json({ error: "New password must be at least 12 characters long." }, 400, origin);
  const salt = adminBytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await deriveAdminPassword(newPassword, salt);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE admin_users SET password_salt=?1,password_hash=?2,password_iterations=?3,must_change_password=0,updated_at=?4 WHERE id=?5")
    .bind(salt, hash, ADMIN_PASSWORD_ITERATIONS, now, session.user_id).run();
  await env.DB.prepare("UPDATE admin_sessions SET revoked_at=?1 WHERE user_id=?2 AND id<>?3 AND revoked_at IS NULL")
    .bind(now, session.user_id, session.session_id).run();
  return json({ ok: true }, 200, origin);
}
async function handleAdminCreateStaff(request: Request, env: Env, origin: string) {
  const session = await getAdminSession(request, env);
  if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
  if (session.role !== "super_admin") return json({ error: "Only a super admin can create staff accounts." }, 403, origin);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "Invalid staff account request." }, 400, origin); }
  try {
    const role = String(body.role || "journalist");
    if (role === "super_admin" && session.role !== "super_admin") return json({ error: "Only a super admin may assign this role." }, 403, origin);
    const user = await createAdminAccount(env, {
      email: String(body.email || ""),
      fullName: String(body.fullName || body.full_name || ""),
      password: String(body.password || ""),
      role
    });
    return json({ data: user }, 201, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the staff account.";
    const status = /valid staff email|full name|at least 12 characters|valid newsroom role/.test(message) ? 400 : /UNIQUE|unique/i.test(message) ? 409 : 400;
    return json({ error: message }, status, origin);
  }
}
function adminQuoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Invalid column name.");
  return '"' + value + '"';
}
async function adminTableInfo(env: Env, table: string) {
  if (!ADMIN_TABLES.has(table)) throw new Error("This table is not available through the admin API.");
  const result = await env.DB.prepare("PRAGMA table_info(" + adminQuoteIdentifier(table) + ")").all();
  const rows = (result.results || []) as any[];
  if (!rows.length) throw new Error("The requested table does not exist in this D1 database.");
  return {
    columns: new Set(rows.map(row => String(row.name))),
    primaryKeys: rows.filter(row => Number(row.pk || 0) > 0).sort((a,b) => Number(a.pk)-Number(b.pk)).map(row => String(row.name))
  };
}
function adminRoleCanRead(role: string, table: string) {
  if (!ADMIN_TABLES.has(table)) return false;
  if (role === "super_admin" || role === "admin") return true;
  return (ADMIN_TABLE_ROLE_ALLOWLIST[role] || []).includes(table);
}
function adminRoleCanWrite(role: string, table: string) {
  if (role === "super_admin") return true;
  if (table === "users_roles" || table === "settings" || ["payment_transactions", "donations", "subscriptions", "revenue"].includes(table)) return false;
  if (role === "admin") return ADMIN_TABLES.has(table) && !["admin_login_attempts", "admin_users", "admin_sessions"].includes(table);
  if (role === "editor") return ["articles", "article_tags", "authors", "categories", "tags", "news_sources", "breaking_news", "live_updates", "featured_news", "trending_news", "videos", "gallery", "comments", "newsletter"].includes(table);
  if (role === "journalist") return ["articles", "article_tags", "tags"].includes(table);
  if (role === "moderator") return ["comments", "notifications", "notification_subscriptions", "notification_deliveries", "newsletter"].includes(table);
  return false;
}
function adminBuildWhere(
  filters: any[],
  columns: Set<string>,
  table: string,
  startIndex = 0,
  forceAuthorId: string | null = null
) {
  const predicates: string[] = [];
  const args: any[] = [];
  const qualifier = table === "articles" ? "a." : "";
  for (const filter of filters) {
    if (!filter || typeof filter !== "object") continue;
    const column = String(filter.column || "");
    const op = String(filter.op || "eq").toLowerCase();
    if (!columns.has(column)) throw new Error("Unsupported filter column: " + column);
    const name = qualifier + adminQuoteIdentifier(column);
    const value = filter.value;
    if ((op === "eq" || op === "is") && value === null) {
      predicates.push(name + " IS NULL");
    } else if (op === "neq" && value === null) {
      predicates.push(name + " IS NOT NULL");
    } else if (["eq", "neq", "gt", "gte", "lt", "lte"].includes(op)) {
      const operator = ({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as Record<string,string>)[op];
      args.push(value);
      predicates.push(name + " " + operator + " ?" + (startIndex + args.length));
    } else if (op === "is") {
      if (typeof value === "boolean") {
        args.push(value ? 1 : 0);
        predicates.push(name + " = ?" + (startIndex + args.length));
      } else {
        args.push(value);
        predicates.push(name + " = ?" + (startIndex + args.length));
      }
    } else if (op === "in") {
      if (!Array.isArray(value)) throw new Error("The IN filter must contain a list.");
      if (!value.length) { predicates.push("1=0"); continue; }
      if (value.length > 100) throw new Error("An IN filter can include at most 100 values.");
      const placeholders = value.map(item => { args.push(item); return "?" + (startIndex + args.length); });
      predicates.push(name + " IN (" + placeholders.join(",") + ")");
    } else if (op === "like" || op === "ilike") {
      args.push(String(value ?? ""));
      predicates.push(name + (op === "ilike" ? " LIKE ?" : " LIKE ?") + (op === "ilike" ? " COLLATE NOCASE" : ""));
      predicates[predicates.length - 1] = name + (op === "ilike" ? " LIKE ?" + (startIndex + args.length) + " COLLATE NOCASE" : " LIKE ?" + (startIndex + args.length));
    } else {
      throw new Error("Unsupported filter operator: " + op);
    }
  }
  if (forceAuthorId && table === "articles") {
    args.push(forceAuthorId);
    predicates.push(qualifier + '"author_id"=?' + (startIndex + args.length));
  }
  return { sql: predicates.length ? " WHERE " + predicates.join(" AND ") : "", args };
}
async function adminQueryRows(env: Env, table: string, selectSpec: string, whereSql: string, args: any[], orders: any[], limit: number, offset: number) {
  const orderSql: string[] = [];
  const info = await adminTableInfo(env, table);
  for (const order of orders) {
    const column = String(order?.column || "");
    if (!info.columns.has(column)) throw new Error("Unsupported order column: " + column);
    orderSql.push((table === "articles" ? "a." : "") + adminQuoteIdentifier(column) + (order?.ascending === false ? " DESC" : " ASC"));
  }
  const ordering = orderSql.length ? " ORDER BY " + orderSql.join(", ") : (table === "articles" ? " ORDER BY COALESCE(a.published_at,a.created_at) DESC" : "");
  const limitOffset = " LIMIT ?" + (args.length + 1) + " OFFSET ?" + (args.length + 2);
  const query = table === "articles"
    ? "SELECT " + articleSelect + articleJoin + whereSql + ordering + limitOffset
    : "SELECT * FROM " + adminQuoteIdentifier(table) + whereSql + ordering + limitOffset;
  const result = await env.DB.prepare(query).bind(...args, limit, offset).all();
  const rows = (result.results || []) as Record<string, any>[];
  if (table === "articles") {
    const packed = rows.map(row => packArticle(row));
    if (String(selectSpec || "").includes("article_tags(") && packed.length) {
      const ids = packed.map(row => String(row.id || "")).filter(Boolean);
      const tagsByArticle = new Map<string, any[]>();
      for (let at = 0; at < ids.length; at += 80) {
        const part = ids.slice(at, at + 80);
        const links = await env.DB.prepare("SELECT article_id,tag_id FROM article_tags WHERE article_id IN (" + part.map((_v,i)=>"?" + (i+1)).join(",") + ")").bind(...part).all();
        const tagIds = [...new Set(((links.results || []) as any[]).map(row=>String(row.tag_id || "")).filter(Boolean))];
        const tagMap = new Map<string,any>();
        for (let ti = 0; ti < tagIds.length; ti += 80) {
          const tagPart=tagIds.slice(ti,ti+80);
          const tags=await env.DB.prepare("SELECT id,name,slug FROM tags WHERE id IN ("+tagPart.map((_v,i)=>"?" + (i+1)).join(",")+")").bind(...tagPart).all();
          for(const tag of (tags.results||[]) as any[])tagMap.set(String(tag.id),tag);
        }
        for (const link of (links.results || []) as any[]) {
          const list = tagsByArticle.get(String(link.article_id)) || [];
          list.push({ tag_id: String(link.tag_id), tags: tagMap.get(String(link.tag_id)) || null });
          tagsByArticle.set(String(link.article_id),list);
        }
      }
      for (const row of packed) row.article_tags = tagsByArticle.get(String(row.id)) || [];
    }
    return packed;
  }

  if (table === "users_roles" && rows.length) {
    const ids = [...new Set(rows.map(row => String(row.user_id || "")).filter(Boolean))];
    const profileMap = new Map<string, any>();
    for (let at = 0; at < ids.length; at += 80) {
      const part = ids.slice(at, at + 80);
      if (!part.length) continue;
      const profiles = await env.DB.prepare("SELECT id,full_name,avatar_url FROM profiles WHERE id IN (" + part.map((_v,i)=>"?" + (i+1)).join(",") + ")").bind(...part).all();
      for (const profile of (profiles.results || []) as any[]) profileMap.set(String(profile.id), profile);
    }
    return rows.map(row => ({ ...row, profiles: profileMap.get(String(row.user_id)) || null }));
  }
  if (table === "article_tags" && rows.length) {
    const ids = [...new Set(rows.map(row => String(row.tag_id || "")).filter(Boolean))];
    const tagMap = new Map<string, any>();
    for (let at = 0; at < ids.length; at += 80) {
      const part = ids.slice(at, at + 80);
      const tags = await env.DB.prepare("SELECT id,name,slug FROM tags WHERE id IN (" + part.map((_v,i)=>"?" + (i+1)).join(",") + ")").bind(...part).all();
      for (const tag of (tags.results || []) as any[]) tagMap.set(String(tag.id), tag);
    }
    return rows.map(row => ({ ...row, tags: tagMap.get(String(row.tag_id)) || null }));
  }
  if (table === "comments" && rows.length) {
    const ids = [...new Set(rows.map(row => String(row.article_id || "")).filter(Boolean))];
    const articleMap = new Map<string, any>();
    for (let at = 0; at < ids.length; at += 80) {
      const part = ids.slice(at, at + 80);
      const articles = await env.DB.prepare("SELECT id,title,slug FROM articles WHERE id IN (" + part.map((_v,i)=>"?" + (i+1)).join(",") + ")").bind(...part).all();
      for (const article of (articles.results || []) as any[]) articleMap.set(String(article.id), article);
    }
    return rows.map(row => ({ ...row, articles: articleMap.get(String(row.article_id)) || null }));
  }
  if (table === "advertisements" && rows.length) {
    const ids = [...new Set(rows.map(row => String(row.advertiser_id || "")).filter(Boolean))];
    const advertiserMap = new Map<string, any>();
    for (let at = 0; at < ids.length; at += 80) {
      const part = ids.slice(at, at + 80);
      const advertisers = await env.DB.prepare("SELECT id,company_name,contact_name,email FROM advertisers WHERE id IN (" + part.map((_v,i)=>"?" + (i+1)).join(",") + ")").bind(...part).all();
      for (const advertiser of (advertisers.results || []) as any[]) advertiserMap.set(String(advertiser.id), advertiser);
    }
    return rows.map(row => ({ ...row, advertisers: advertiserMap.get(String(row.advertiser_id)) || null }));
  }
  return rows;
}
async function handleAdminQuery(request: Request, env: Env, origin: string) {
  const session = await getAdminSession(request, env);
  if (!session) return json({ data: null, error: { message: "Your admin session has expired. Sign in again." } }, 401, origin);
  let body: any;
  try { body = await request.json(); } catch { return json({ data: null, error: { message: "Invalid admin query." } }, 400, origin); }
  const table = String(body.table || "");
  const action = String(body.action || "select").toLowerCase();
  if (!ADMIN_TABLES.has(table)) return json({ data: null, error: { message: "This table is not available through the Cloudflare admin API." } }, 403, origin);
  if (action === "select" && !adminRoleCanRead(session.role, table)) return json({ data: null, error: { message: "Your role cannot read this table." } }, 403, origin);
  if (action !== "select" && !adminRoleCanWrite(session.role, table)) return json({ data: null, error: { message: "Your role cannot modify this table." } }, 403, origin);
  if (table === "users_roles" && action !== "select" && session.role !== "super_admin") return json({ data: null, error: { message: "Only a super admin can assign staff roles." } }, 403, origin);
  try {
    const info = await adminTableInfo(env, table);
    const forceAuthorId = session.role === "journalist" && table === "articles" ? session.user_id : null;
    const filters = Array.isArray(body.filters) ? body.filters : [];
    if (action === "select") {
      const where = adminBuildWhere(filters, info.columns, table, 0, forceAuthorId);
      const limit = Math.max(1, Math.min(5000, Number(body.limit || 100) || 100));
      const offset = Math.max(0, Math.min(1000000, Number(body.offset || 0) || 0));
      let count: number | null = null;
      if (body.count === "exact" || body.head === true) {
        const countQuery = table === "articles"
          ? "SELECT COUNT(*) AS count FROM articles a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN news_sources s ON s.id=a.source_id LEFT JOIN authors au ON au.id=a.external_author_id LEFT JOIN profiles p ON p.id=a.author_id" + where.sql
          : "SELECT COUNT(*) AS count FROM " + adminQuoteIdentifier(table) + where.sql;
        const result = await env.DB.prepare(countQuery).bind(...where.args).first() as any;
        count = Number(result?.count || 0);
      }
      if (body.head === true) return json({ data: [], count }, 200, origin);
      const rows = await adminQueryRows(env, table, String(body.select || "*"), where.sql, where.args, Array.isArray(body.orders) ? body.orders : [], limit, offset);
      if (body.single && rows.length !== 1) return json({ data: null, error: { message: "Expected exactly one row." }, count }, 406, origin);
      if (body.maybeSingle) return json({ data: rows[0] || null, error: null, count }, 200, origin);
      return json({ data: body.single ? rows[0] : rows, error: null, count }, 200, origin);
    }
    const values = Array.isArray(body.values) ? body.values : body.values && typeof body.values === "object" ? [body.values] : [];
    if (action === "insert" || action === "upsert") {
      if (!values.length || values.length > 100) throw new Error("Provide between 1 and 100 row objects.");
      const returned: any[] = [];
      const conflicts = typeof body.onConflict === "string" ? body.onConflict.split(",").map((value: string) => value.trim()).filter(Boolean) : [];
      for (const original of values) {
        const row: Record<string, any> = { ...original };
        if (session.role === "journalist" && table === "articles") {
          row.author_id = session.user_id;
          row.status = "draft";
          row.featured = 0;
          row.breaking = 0;
        }
        for (const key of Object.keys(row)) if (!info.columns.has(key)) throw new Error("Unsupported column: " + key);
        if (info.columns.has("id") && !row.id) row.id = crypto.randomUUID();
        const now = new Date().toISOString();
        if (info.columns.has("created_at") && !row.created_at) row.created_at = now;
        if (info.columns.has("updated_at") && !row.updated_at) row.updated_at = now;
        const insertColumns = Object.keys(row);
        if (!insertColumns.length) throw new Error("No values provided.");
        const placeholders = insertColumns.map((_key,index)=>"?" + (index+1));
        let statement = "INSERT INTO " + adminQuoteIdentifier(table) + " (" + insertColumns.map(adminQuoteIdentifier).join(",") + ") VALUES (" + placeholders.join(",") + ")";
        if (action === "upsert") {
          const conflictColumns = conflicts.length ? conflicts : info.primaryKeys;
          if (!conflictColumns.length || conflictColumns.some((key: string)=>!info.columns.has(key))) throw new Error("The upsert conflict key is invalid.");
          const updates = insertColumns.filter(key=>!conflictColumns.includes(key) && !info.primaryKeys.includes(key));
          if (updates.length) statement += " ON CONFLICT (" + conflictColumns.map(adminQuoteIdentifier).join(",") + ") DO UPDATE SET " + updates.map(key=>adminQuoteIdentifier(key)+"=excluded."+adminQuoteIdentifier(key)).join(",");
          else statement += " ON CONFLICT (" + conflictColumns.map(adminQuoteIdentifier).join(",") + ") DO NOTHING";
        }
        statement += ";";
        await env.DB.prepare(statement).bind(...insertColumns.map(key=>row[key] === undefined ? null : row[key])).run();
        if (body.returning) {
          const lookupColumns = action === "upsert" && conflicts.length ? conflicts : info.primaryKeys;
          const lookupValues = lookupColumns.map(key=>row[key]);
          if (lookupColumns.length && lookupValues.every(value=>value !== undefined)) {
            const lookupFilters = lookupColumns.map((column: string,index: number)=>({column,op:"eq",value:lookupValues[index]}));
            const where = adminBuildWhere(lookupFilters,info.columns,table);
            const found=await adminQueryRows(env,table,String(body.select||"*"),where.sql,where.args,[],2,0);
            returned.push(...found);
          }
        }
      }
      return json({ data: body.returning ? (body.single ? returned[0] || null : returned) : null, error: null }, 200, origin);
    }
    const where = adminBuildWhere(filters, info.columns, table, 0, forceAuthorId);
    if (!where.sql) throw new Error("Updates and deletes require a filter.");
    if (action === "update") {
      const row: Record<string, any> = { ...(body.values || {}) };
      if (session.role === "journalist" && table === "articles") {
        delete row.status; delete row.featured; delete row.breaking; delete row.scheduled_at; delete row.author_id; delete row.duplicate_of;
      }
      for (const key of Object.keys(row)) if (!info.columns.has(key)) throw new Error("Unsupported column: " + key);
      const setColumns = Object.keys(row);
      if (!setColumns.length) throw new Error("No update values were provided.");
      const set = setColumns.map((key,index)=>adminQuoteIdentifier(key)+"=?"+(index+1)).join(",");
      const offset = setColumns.length;
      const predicates = adminBuildWhere(filters,info.columns,table,offset,forceAuthorId);
      const updateWhere = table === "articles" ? predicates.sql.replace(/\ba\./g, "") : predicates.sql;
      await env.DB.prepare("UPDATE " + adminQuoteIdentifier(table) + " SET " + set + updateWhere).bind(...setColumns.map(key=>row[key] === undefined ? null : row[key]),...predicates.args).run();
      let returned: any[] = [];
      if (body.returning) returned = await adminQueryRows(env,table,String(body.select||"*"),where.sql,where.args,[],Math.min(500,Number(body.limit||100) || 100),0);
      if (table === "users_roles") {
        const roles = await env.DB.prepare("SELECT user_id,role FROM users_roles").all();
        for (const role of (roles.results || []) as any[]) {
          await env.DB.prepare("UPDATE admin_users SET role=?1,updated_at=?2 WHERE id=?3").bind(role.role,new Date().toISOString(),role.user_id).run();
        }
      }
      return json({ data: body.returning ? (body.single ? returned[0] || null : returned) : null, error: null }, 200, origin);
    }
    if (action === "delete") {
      const predicates = adminBuildWhere(filters,info.columns,table,0,forceAuthorId);
      const deleteWhere = table === "articles" ? predicates.sql.replace(/\ba\./g, "") : predicates.sql;
      if (!deleteWhere) throw new Error("Deletes require a filter.");
      await env.DB.prepare("DELETE FROM " + adminQuoteIdentifier(table) + deleteWhere).bind(...predicates.args).run();
      return json({ data: null, error: null }, 200, origin);
    }
    throw new Error("Unsupported admin operation: " + action);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run this query.";
    return json({ data: null, error: { message } }, 400, origin);
  }
}

function encodeKey(key: string) {
  return key.split("/").map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase())).join("/");
}
const ADMIN_MEDIA_BUCKETS = new Set(["news-images", "social-graphics"]);
function cleanObjectPath(value: unknown) {
  const path = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid media path.");
  return path;
}
function publicMediaUrl(key: string, env: Env) {
  const base = String(env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? base + "/" + encodeKey(key) : "";
}
async function handleAdminMedia(request: Request, env: Env, origin: string) {
  const session = await getAdminSession(request, env);
  if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
  if (!["super_admin", "admin", "editor", "journalist"].includes(session.role)) return json({ error: "Your role cannot manage media." }, 403, origin);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const bucket = String(url.searchParams.get("bucket") || "news-images");
    if (!ADMIN_MEDIA_BUCKETS.has(bucket)) return json({ error: "Unsupported media bucket." }, 400, origin);
    const prefix = url.searchParams.get("prefix") ? cleanObjectPath(url.searchParams.get("prefix")) : "";
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100) || 100));
    const listed = await env.MEDIA.list({ prefix: bucket + "/" + prefix, limit });
    const data = (listed.objects || []).map((object: any) => {
      const key = String(object.key || "");
      return {
        name: key.startsWith(bucket + "/") ? key.slice(bucket.length + 1) : key,
        id: object.etag || key,
        metadata: object.customMetadata || {},
        created_at: object.uploaded || null,
        updated_at: object.uploaded || null,
        last_accessed_at: null,
        size: object.size || 0
      };
    });
    return json({ data, hasMore: Boolean(listed.truncated), nextCursor: listed.cursor || null }, 200, origin);
  }
  if (request.method === "POST") {
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: "Use multipart form data to upload media." }, 400, origin); }
    const bucket = String(form.get("bucket") || "news-images");
    if (!ADMIN_MEDIA_BUCKETS.has(bucket)) return json({ error: "Unsupported media bucket." }, 400, origin);
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Choose a file to upload." }, 400, origin);
    const contentType = String(form.get("contentType") || file.type || "application/octet-stream").toLowerCase();
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/svg+xml", "video/mp4", "video/webm"]);
    if (!allowed.has(contentType)) return json({ error: "Unsupported media file type." }, 415, origin);
    const maxBytes = contentType.startsWith("video/") ? 25 * 1024 * 1024 : 12 * 1024 * 1024;
    if (file.size <= 0 || file.size > maxBytes) return json({ error: contentType.startsWith("video/") ? "Videos must be no larger than 25 MB on this preview." : "Images must be no larger than 12 MB." }, 413, origin);
    let path = "";
    try {
      const givenPath = String(form.get("path") || "").trim();
      path = givenPath ? cleanObjectPath(givenPath) : crypto.randomUUID() + "-" + file.name.replace(/[^\w.\-]/g, "_");
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid media path." }, 400, origin); }
    const key = bucket + "/" + path;
    const buffer = await file.arrayBuffer();
    await env.MEDIA.put(key, buffer, { httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { uploaded_by: session.user_id, uploaded_at: new Date().toISOString() } });
    return json({ data: { path, id: key, fullPath: key }, publicUrl: publicMediaUrl(key, env) }, 200, origin);
  }
  if (request.method === "DELETE") {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: "Invalid media delete request." }, 400, origin); }
    const bucket = String(body.bucket || "news-images");
    if (!ADMIN_MEDIA_BUCKETS.has(bucket)) return json({ error: "Unsupported media bucket." }, 400, origin);
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 100) : [];
    const keys = paths.map((value: unknown) => bucket + "/" + cleanObjectPath(value));
    if (!keys.length) return json({ data: [] }, 200, origin);
    await env.MEDIA.delete(keys);
    return json({ data: paths.map((name: unknown) => ({ name: String(name) })) }, 200, origin);
  }
  return json({ error: "Method not allowed." }, 405, origin);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.hostname.endsWith(".workers.dev") ? url.origin : (env.PUBLIC_ORIGIN || url.origin);
  if (/^\/v1\/monetization\/(packages|advertiser-requests|checkout|payments\/|paystack\/webhook|stripe\/webhook)/.test(path) ||
      /^\/v1\/admin\/monetization\/requests\/[^/]+\/payment-link$/.test(path)) {
    return json({ error: "Payments are disabled. LK Newsroom public content is free." }, 410, origin);
  }
  if (path === "/admin" || path === "/admin/") {
    return Response.redirect(new URL("/admin/index.html", url.origin).toString(), 302);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "Content-Type,Authorization", "access-control-max-age": "86400" } });
  if (path === "/v1/admin/bootstrap" && request.method === "POST") return handleAdminBootstrap(request, env, origin);
  if (path === "/v1/admin/login" && request.method === "POST") return handleAdminLogin(request, env, origin);
  if (path === "/v1/admin/logout" && request.method === "POST") return handleAdminLogout(request, env, origin);
  if (path === "/v1/admin/password" && request.method === "POST") return handleAdminChangePassword(request, env, origin);
  if (path === "/v1/admin/me" && request.method === "GET") {
    const session = await getAdminSession(request, env);
    return session ? json({ user: session.user }, 200, origin) : json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
  }
  if (path === "/v1/admin/staff" && request.method === "POST") return handleAdminCreateStaff(request, env, origin);
  if (path === "/v1/admin/staff" && request.method === "GET") {
    const session = await getAdminSession(request, env);
    if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
    if (session.role !== "super_admin") return json({ error: "Only a super admin can list staff accounts." }, 403, origin);
    const rows = await env.DB.prepare("SELECT id,email,full_name,role,active,must_change_password,created_at,last_login_at FROM admin_users ORDER BY created_at DESC LIMIT 500").all();
    return json({ data: rows.results || [] }, 200, origin);
  }
  if (path === "/v1/admin/query" && request.method === "POST") return handleAdminQuery(request, env, origin);
  if (path === "/v1/admin/sources" && request.method === "GET") {
    const session = await getAdminSession(request, env);
    if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
    if (!adminRoleCanRead(session.role, "news_sources")) return json({ error: "Your role cannot view news sources." }, 403, origin);
    try {
      const rows = await env.DB.prepare("SELECT id,slug,name,source_type,feed_url,api_endpoint,api_secret_name,country,default_category,enabled,last_synced_at,last_status,last_error,consecutive_failures FROM news_sources ORDER BY CASE WHEN last_synced_at IS NULL THEN 0 ELSE 1 END,last_synced_at ASC,name ASC").all();
      return json({ data: (rows.results || []).map((row: any) => ({ ...row, enabled: Number(row.enabled) === 1 })) }, 200, origin);
    } catch (error) {
      console.error("Unable to load news sources:", error);
      return json({ error: "News source status is temporarily unavailable." }, 503, origin);
    }
  }
  const adminSourceMatch = path.match(/^\/v1\/admin\/sources\/([^/]+)$/);
  if (adminSourceMatch && request.method === "PATCH") {
    const session = await getAdminSession(request, env);
    if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
    if (!adminRoleCanWrite(session.role, "news_sources")) return json({ error: "Your role cannot change news sources." }, 403, origin);
    let body: any;
    try { body = await request.json(); } catch { return json({ error: "Invalid source update." }, 400, origin); }
    if (typeof body.enabled !== "boolean") return json({ error: "The enabled value must be true or false." }, 400, origin);
    let slug = "";
    try { slug = decodeURIComponent(adminSourceMatch[1]); } catch { return json({ error: "Invalid source identifier." }, 400, origin); }
    try {
      const result = await env.DB.prepare("UPDATE news_sources SET enabled=?1,updated_at=?2 WHERE slug=?3")
        .bind(body.enabled ? 1 : 0, new Date().toISOString(), slug).run();
      if (Number(result?.meta?.changes || 0) !== 1) return json({ error: "News source not found." }, 404, origin);
      const row = await env.DB.prepare("SELECT id,slug,name,source_type,country,default_category,enabled,last_synced_at,last_status,last_error,consecutive_failures FROM news_sources WHERE slug=?1 LIMIT 1").bind(slug).first() as any;
      return json({ data: row ? { ...row, enabled: Number(row.enabled) === 1 } : null }, 200, origin);
    } catch (error) {
      console.error("Unable to update news source:", error);
      return json({ error: "Unable to update this news source." }, 503, origin);
    }
  }
  if (path === "/v1/admin/worker-status" && request.method === "GET") {
    const session = await getAdminSession(request, env);
    if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
    if (!adminRoleCanRead(session.role, "news_sources")) return json({ error: "Your role cannot view worker status." }, 403, origin);
    try {
      const [lastRun, today, sourceRows] = await Promise.all([
        env.DB.prepare("SELECT id,trigger,status,started_at,completed_at,fetched,added,updated,skipped,errors,error,details FROM worker_runs ORDER BY started_at DESC LIMIT 1").first(),
        env.DB.prepare("SELECT COALESCE(SUM(fetched),0) AS fetched,COALESCE(SUM(added),0) AS added,COALESCE(SUM(updated),0) AS updated,COALESCE(SUM(skipped),0) AS skipped,COALESCE(SUM(errors),0) AS errors FROM worker_runs WHERE started_at>=datetime('now','start of day')").first(),
        env.DB.prepare("SELECT id,slug,name,enabled,last_status,last_error,last_synced_at,consecutive_failures FROM news_sources ORDER BY name ASC").all()
      ]);
      const nextScheduledAt = new Date((Math.floor(Date.now() / 300000) + 1) * 300000).toISOString();
      return json({
        worker: lastRun || null,
        today: today || { fetched: 0, added: 0, updated: 0, skipped: 0, errors: 0 },
        sources: (sourceRows.results || []).map((row: any) => ({ ...row, enabled: Number(row.enabled) === 1 })),
        nextScheduledAt
      }, 200, origin);
    } catch (error) {
      console.error("Unable to load worker status:", error);
      return json({ error: "News worker status is temporarily unavailable." }, 503, origin);
    }
  }
  if (path === "/v1/admin/logs" && request.method === "GET") {
    const session = await getAdminSession(request, env);
    if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
    if (!adminRoleCanRead(session.role, "feed_logs")) return json({ error: "Your role cannot view feed logs." }, 403, origin);
    try {
      const rows = await env.DB.prepare("SELECT l.id,l.source_id,l.level,l.event,l.details,l.duration_ms,l.created_at,s.name AS source_name FROM feed_logs l LEFT JOIN news_sources s ON s.id=l.source_id ORDER BY l.created_at DESC LIMIT 150").all();
      return json({ data: (rows.results || []).map((row: any) => {
        const { source_name, ...log } = row;
        return { ...log, news_sources: source_name ? { name: source_name } : null };
      }) }, 200, origin);
    } catch (error) {
      console.error("Unable to load feed logs:", error);
      return json({ error: "Feed logs are temporarily unavailable." }, 503, origin);
    }
  }
  if (path === "/v1/admin/sync" && request.method === "POST") {
    const session = await getAdminSession(request, env);
    if (!session) return json({ error: "Your admin session has expired. Sign in again." }, 401, origin);
    if (!adminRoleCanWrite(session.role, "news_sources")) return json({ error: "Your role cannot run feed sync." }, 403, origin);
    let body: any = {};
    try { body = await request.json(); } catch {}
    const sourceSlug = typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 120) : undefined;
    try {
      const result = await runFeedSync(env, sourceSlug);
      return json({ data: result, worker: result }, result.status === "failed" ? 503 : 200, origin);
    } catch (error) {
      console.error("Manual feed sync failed:", error);
      return json({ error: "Manual feed sync failed. Check the feed logs for source errors." }, 503, origin);
    }
  }
  if (path === "/v1/admin/media" && ["GET", "POST", "DELETE"].includes(request.method)) return handleAdminMedia(request, env, origin);
  if (path === "/v1/admin/forgot-password" && request.method === "POST") {
    return json({ error: "Email password resets are not configured on this Cloudflare deployment. Ask a super admin to issue a new staff login password." }, 501, origin);
  }
  if (path === "/v1/webhooks/paystack" && request.method === "POST") return handlePaystackWebhook(request, env, origin);
  if (path === "/health" || path === "/v1/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      const [last, sourceCount] = await Promise.all([
        env.DB.prepare("SELECT status,started_at,completed_at,fetched,added,updated,skipped,errors,error FROM worker_runs ORDER BY started_at DESC LIMIT 1").first(),
        env.DB.prepare("SELECT COUNT(*) AS enabled FROM news_sources WHERE enabled=1").first()
      ]);
      return json({
        status: "ok",
        service: "lk-newsroom-cloudflare",
        updatedAt: new Date().toISOString(),
        enabledSources: Number(sourceCount?.enabled || 0),
        worker: last || null
      }, 200, origin);
    } catch (e) {
      return json({ status: "error", error: String(e) }, 503, origin);
    }
  }
  if (path === "/v1/football/fixtures" && request.method === "GET") return footballFixtures(url);
  const footballDetailMatch = path.match(/^\/v1\/football\/fixture\/([^/]+)$/);
  if (footballDetailMatch && request.method === "GET") {
    return footballFixtureDetail(decodeURIComponent(footballDetailMatch[1]), url.searchParams.get("league") || "");
  }
  if (path === "/api/news/update") {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!env.CRON_SECRET || token !== env.CRON_SECRET) return json({ error: "Unauthorized" }, 401, origin);
    return json({ data: await runFeedSync(env) }, 200, origin);
  }
  if (path === "/v1/monetization/packages" && request.method === "GET") {
    try {
      const [packageRows, planRows] = await Promise.all([
        env.DB.prepare("SELECT id,title,slug,description,placement,price,currency,duration_days,features,active,sort_order FROM advertising_packages WHERE active=1 ORDER BY sort_order ASC,title ASC").all(),
        env.DB.prepare("SELECT id,name,slug,description,features,amount,currency,interval,active,sort_order FROM membership_plans WHERE active=1 ORDER BY sort_order ASC,name ASC").all()
      ]);
      const unpackFeatures = (value: unknown) => {
        if (Array.isArray(value)) return value;
        if (typeof value !== "string") return [];
        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
      };
      return json({
        packages: (packageRows.results || []).map((item: any) => ({ ...item, features: unpackFeatures(item.features) })),
        plans: (planRows.results || []).map((item: any) => ({ ...item, features: unpackFeatures(item.features) }))
      }, 200, origin);
    } catch {
      return json({ error: "Advertising and membership packages are temporarily unavailable." }, 503, origin);
    }
  }
  if (path === "/v1/monetization/advertiser-requests" && request.method === "POST") {
    try {
      const body = await request.json() as any;
      const companyName = String(body.companyName || "").trim().slice(0, 160);
      const contactName = String(body.contactName || "").trim().slice(0, 100);
      const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
      const phone = String(body.phone || "").trim().slice(0, 60);
      const website = String(body.website || "").trim().slice(0, 500);
      const packageId = String(body.packageId || "").trim().slice(0, 100) || null;
      const advertisementType = String(body.advertisementType || body.advertiseType || "display").trim().slice(0, 60);
      const placement = String(body.placement || "").trim().slice(0, 100) || null;
      const budgetValue = Number(body.budget);
      const durationValue = Number(body.durationDays);
      const budget = body.budget !== undefined && body.budget !== "" && Number.isFinite(budgetValue) && budgetValue >= 0 ? budgetValue : null;
      const duration = body.durationDays !== undefined && body.durationDays !== "" && Number.isInteger(durationValue) && durationValue >= 1 && durationValue <= 366 ? durationValue : null;
      const goal = String(body.goal || "").trim().slice(0, 600);
      const message = String(body.message || "").trim().slice(0, 3000);
      const currency = String(body.currency || "GHS").toUpperCase();
      if (companyName.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: "Enter a company name and a valid email address." }, 400, origin);
      }
      if (website && !/^https?:\/\//i.test(website)) return json({ error: "Website must begin with https:// or http://." }, 400, origin);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO advertiser_requests(id,package_id,company_name,contact_name,email,phone,website,advertisement_type,requested_placement,budget,currency,campaign_duration_days,campaign_goal,message,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'pending',?15,?15)")
        .bind(id, packageId, companyName, contactName || null, email, phone || null, website || null, advertisementType, placement, budget, currency, duration, goal || null, message || null, now).run();
      return json({ ok: true, id, status: "pending", message: "Your advertising request was sent for review. No payment has been taken." }, 201, origin);
    } catch {
      return json({ error: "Unable to submit the advertising request." }, 503, origin);
    }
  }
  if (path === "/v1/monetization/checkout" && request.method === "POST") return beginCheckout(request, env, origin);
  const paymentMatch = path.match(/^\/v1\/monetization\/payments\/([^/]+)$/);
  if (paymentMatch && request.method === "GET") return verifyPayment(decodeURIComponent(paymentMatch[1]), env, origin);
  if (path === "/v1/advertisements" && request.method === "GET") {
    return withPublicCache(request, 300, 86400, async () => {
      const limit = Math.min(20, safeLimit(url.searchParams.get("limit")));
      const rows = await env.DB.prepare("SELECT id,name,image_url,target_url,html_content,placement FROM advertisements WHERE active=1 AND (starts_at IS NULL OR datetime(starts_at)<=datetime('now')) AND (ends_at IS NULL OR datetime(ends_at)>datetime('now')) ORDER BY created_at DESC LIMIT ?1").bind(limit).all();
      return json({ data: rows.results || [] }, 200, origin);
    });
  }
  if (path === "/v1/news" && request.method === "GET") return withPublicCache(request, 90, 86400, () => publicNews(request, env));
  if (path === "/v1/breaking" && request.method === "GET") return withPublicCache(request, 60, 86400, () => publicBreaking(env));
  if (path === "/v1/videos" && request.method === "GET") return withPublicCache(request, 300, 86400, () => publicVideos(env, url));
  if (path.startsWith("/v1/categories/") && request.method === "GET") return withPublicCache(request, 900, 86400, () => publicCategories(path.slice("/v1/categories/".length), env));
  const commentMatch = path.match(/^\/v1\/news\/([^/]+)\/comments$/);
  if (commentMatch && request.method === "POST") {
    try {
      const articleId = decodeURIComponent(commentMatch[1]);
      const article = await env.DB.prepare("SELECT id FROM articles WHERE (id=?1 OR slug=?1) AND status='published' AND duplicate_of IS NULL LIMIT 1").bind(articleId).first();
      if (!article) return json({ error: "Article not found" }, 404, origin);
      const body = await request.json() as any;
      const name = String(body.displayName || "").trim().slice(0, 80);
      const message = String(body.body || "").trim().slice(0, 5000);
      if (name.length < 2 || !message) return json({ error: "Enter a name and a comment." }, 400, origin);
      await env.DB.prepare("INSERT INTO comments(id,article_id,display_name,body,status,created_at) VALUES (?1,?2,?3,?4,'pending',?5)")
        .bind(crypto.randomUUID(), article.id, name, message, new Date().toISOString()).run();
      return json({ message: "Comment submitted for moderation." }, 201, origin);
    } catch (e) {
      return json({ error: "Unable to submit comment" }, 503, origin);
    }
  }
  const viewMatch = path.match(/^\/v1\/news\/([^/]+)\/view$/);
  if (viewMatch && request.method === "POST") {
    const identifier = decodeURIComponent(viewMatch[1]);
    const result = await env.DB.prepare("UPDATE articles SET view_count=COALESCE(view_count,0)+1 WHERE (id=?1 OR slug=?1) AND status='published'").bind(identifier).run();
    const changes = Number(result?.meta?.changes || 0);
    return json({ ok: changes > 0 }, changes > 0 ? 202 : 404, origin);
  }
  const adEventMatch = path.match(/^\/v1\/analytics\/advertisements\/([^/]+)\/(impression|click)$/);
  if (adEventMatch && request.method === "POST") {
    const column = adEventMatch[2] === "click" ? "clicks" : "impressions";
    const result = await env.DB.prepare("UPDATE advertisements SET " + column + "=COALESCE(" + column + ",0)+1 WHERE id=?1 AND active=1").bind(decodeURIComponent(adEventMatch[1])).run();
    const changes = Number(result?.meta?.changes || 0);
    return json({ ok: changes > 0 }, 202, origin);
  }
  const newsMatch = path.match(/^\/v1\/news\/([^/]+)$/);
  if (newsMatch && request.method === "GET") return withPublicCache(request, 120, 86400, () => publicArticle(newsMatch[1], env));
  if (path === "/v1/newsletter" && request.method === "POST") {
    try {
      const body = await request.json() as any;
      const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400, origin);
      await env.DB.prepare("INSERT OR IGNORE INTO newsletter(id,email,status,source,created_at) VALUES (?1,?2,'subscribed','website',?3)")
        .bind(crypto.randomUUID(), email, new Date().toISOString()).run();
      return json({ ok: true }, 201, origin);
    } catch {
      return json({ error: "Unable to save subscription." }, 503, origin);
    }
  }
  if (path === "/v1/analytics/events" && request.method === "POST") {
    try {
      const body = await request.json() as any;
      const eventName = String(body.eventName || "").slice(0, 40);
      const sessionId = String(body.sessionId || "").slice(0, 120);
      if (!eventName || !sessionId) return json({ error: "A valid event and session are required." }, 400, origin);
      await env.DB.prepare("INSERT INTO analytics_events(id,event_name,session_id,visitor_id,page_url,page_title,article_id,category_id,country,city,device,browser,operating_system,source,search_keyword,scroll_depth,duration_seconds,metadata,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)")
        .bind(crypto.randomUUID(), eventName, sessionId, String(body.visitorId || "").slice(0, 120), String(body.pageUrl || "").slice(0, 500), String(body.pageTitle || "").slice(0, 180), body.articleId || null, body.categoryId || null, String(body.country || "").slice(0, 80), String(body.city || "").slice(0, 80), String(body.device || "").slice(0, 40), String(body.browser || "").slice(0, 50), String(body.operatingSystem || "").slice(0, 60), String(body.source || "direct").slice(0, 160), String(body.searchKeyword || "").slice(0, 140), Number.isFinite(Number(body.scrollDepth)) ? Number(body.scrollDepth) : null, Number.isFinite(Number(body.durationSeconds)) ? Number(body.durationSeconds) : null, JSON.stringify(body.metadata || {}), new Date().toISOString()).run();
      return json({ ok: true }, 202, origin);
    } catch {
      return json({ error: "Analytics is temporarily unavailable." }, 503, origin);
    }
  }
  if (path === "/v1/analytics/advertisements" && request.method === "POST") {
    return json({ ok: false, error: "Advertisement analytics migration is pending." }, 501, origin);
  }
  return serveAssets(request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error("LK Newsroom Cloudflare request failed:", error instanceof Error ? error.stack || error.message : String(error));
      return json({ error: "LK Newsroom is temporarily unavailable." }, 503, env.PUBLIC_ORIGIN || new URL(request.url).origin);
    }
  },
  async scheduled(_event: any, env: Env, ctx: any) {
    ctx.waitUntil(runFeedSync(env));
  }
};
