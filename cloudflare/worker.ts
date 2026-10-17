import { XMLParser } from "fast-xml-parser";

type Env = {
  DB: any;
  MEDIA: any;
  ASSETS: any;
  CRON_SECRET?: string;
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
function imageOf(item: Record<string, any>): string | null {
  const candidates = [item.thumbnail, item.image, item.enclosure, item.content, item.group, item.description, item.summary];
  for (const candidate of candidates) {
    for (const value of asList(candidate)) {
      if (typeof value === "string") {
        const found = value.match(/<img\b[^>]*\b(?:src|data-src|data-original)=["']([^"']+)["']/i);
        if (found && /^https?:\/\//i.test(found[1])) return found[1];
      } else if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        const url = text(v["@_url"] || v["@_href"] || v["@_src"] || v.url || v.href).trim();
        if (/^https?:\/\//i.test(url)) return url;
      }
    }
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
  delete article.source_name; delete article.source_slug; delete article.author_name;
  delete article.author_slug; delete article.author_avatar;
  article.categories = row.category_name ? { name: row.category_name, slug: row.category_slug } : null;
  article.news_sources = row.source_name ? { name: row.source_name, slug: row.source_slug } : null;
  article.authors = row.author_name ? { name: row.author_name, slug: row.author_slug, avatar_url: row.author_avatar } : null;
  article.auto_tags = autoTags(row.auto_tags);
  return article;
}
const articleSelect = "a.id,a.slug,a.title,a.excerpt,a.content,a.content_markdown,a.ai_summary,a.featured_image_url,a.original_url,a.status,a.featured,a.breaking,a.allow_comments,a.scheduled_at,a.published_at,a.created_at,a.updated_at,a.meta_title,a.meta_description,a.canonical_url,a.view_count,a.category_id,a.author_id,a.source_id,a.external_id,a.external_author_id,a.country,a.source_updated_at,a.content_hash,a.auto_tags,a.is_aggregated,a.duplicate_of,c.name AS category_name,c.slug AS category_slug,s.name AS source_name,s.slug AS source_slug,au.name AS author_name,au.slug AS author_slug,au.avatar_url AS author_avatar";
const articleJoin = " FROM articles a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN news_sources s ON s.id=a.source_id LEFT JOIN authors au ON au.id=a.author_id ";
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
  const rows = await env.DB.prepare("SELECT " + articleSelect + articleJoin + where + " ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT ?" + (args.length + 1) + " OFFSET ?" + (args.length + 2))
    .bind(...args, limit, offset).all();
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM articles a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN news_sources s ON s.id=a.source_id" + where)
    .bind(...args).first();
  return json({ data: (rows.results || []).map((r: any) => packArticle(r)), total: Number(count?.total || 0), offset, limit, updatedAt: new Date().toISOString() });
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
    return { url, title, summary, content, published, external, image: imageOf(item) };
  }).filter((item: any) => item.title && item.url);
}

async function fetchApiSource(source: any, env: Env): Promise<any[]> {
  const secretName = String(source.api_secret_name || "").toUpperCase();
  if (secretName === "NEWS_API_KEY" && env.NEWS_API_KEY) {
    const endpoint = String(source.api_endpoint || "https://newsapi.org/v2/top-headlines");
    const url = new URL(endpoint);
    url.searchParams.set("pageSize", "50");
    const countryCodes: Record<string, string> = {
      "United States": "us", "United Kingdom": "gb", "Nigeria": "ng",
      "South Africa": "za", "Canada": "ca", "India": "in", "Australia": "au"
    };
    const countryCode = countryCodes[String(source.country || "")];
    const category = String(source.default_category || "").toLowerCase();
    const categories = new Set(["business", "entertainment", "general", "health", "science", "sports", "technology"]);
    if (endpoint.includes("top-headlines") && countryCode) {
      url.searchParams.set("country", countryCode);
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

async function runFeedSync(env: Env) {
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
    const sources = await env.DB.prepare("SELECT * FROM news_sources WHERE enabled=1 AND ((source_type='rss' AND feed_url IS NOT NULL) OR (source_type='api' AND ((api_secret_name='NEWS_API_KEY' AND ?1=1) OR (api_secret_name='GUARDIAN_API_KEY' AND ?2=1)))) ORDER BY CASE WHEN last_synced_at IS NULL THEN 0 ELSE 1 END, last_synced_at ASC, name LIMIT 6").bind(env.NEWS_API_KEY ? 1 : 0, env.GUARDIAN_API_KEY ? 1 : 0).all();
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

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = env.PUBLIC_ORIGIN || url.origin;
  if (path === "/admin" || path.startsWith("/admin/")) {
    return env.ASSETS.fetch(new Request(new URL("/admin-migration.html", url.origin).toString(), { method: "GET", headers: { accept: "text/html" } }));
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "Content-Type,Authorization", "access-control-max-age": "86400" } });
  if (path === "/v1/webhooks/paystack" && request.method === "POST") return handlePaystackWebhook(request, env, origin);
  if (path === "/health" || path === "/v1/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      const last = await env.DB.prepare("SELECT status,started_at,completed_at FROM worker_runs ORDER BY started_at DESC LIMIT 1").first();
      return json({ status: "ok", service: "lk-newsroom-cloudflare", updatedAt: new Date().toISOString(), worker: last || null }, 200, origin);
    } catch (e) {
      return json({ status: "error", error: String(e) }, 503, origin);
    }
  }
  if (path === "/v1/football/fixtures" && request.method === "GET") return footballFixtures(url);
  const footballDetailMatch = path.match(/^\/v1\/football\/fixture\/([^/]+)$/);
  if (footballDetailMatch && request.method === "GET") {
    return footballFixtureDetail(decodeURIComponent(footballDetailMatch[1]), url.searchParams.get("league") || "");
  }
  if (path === "/api/news/update" || path === "/v1/admin/sync") {
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
    const limit = Math.min(20, safeLimit(url.searchParams.get("limit")));
    const rows = await env.DB.prepare("SELECT id,name,image_url,target_url,html_content,placement FROM advertisements WHERE active=1 AND (starts_at IS NULL OR starts_at<=datetime('now')) AND (ends_at IS NULL OR ends_at>datetime('now')) ORDER BY created_at DESC LIMIT ?1").bind(limit).all();
    return json({ data: rows.results || [] }, 200, origin);
  }
  if (path === "/v1/news" && request.method === "GET") return publicNews(request, env);
  if (path === "/v1/breaking" && request.method === "GET") return publicBreaking(env);
  if (path === "/v1/videos" && request.method === "GET") return publicVideos(env, url);
  if (path.startsWith("/v1/categories/") && request.method === "GET") return publicCategories(path.slice("/v1/categories/".length), env);
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
  if (newsMatch && request.method === "GET") return publicArticle(newsMatch[1], env);
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
