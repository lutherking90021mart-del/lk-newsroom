import { configured, supabase } from './supabase-client.js';

let googleAnalyticsLoaded = false;
let activeArticleId = null;
let pageOpenedAt = Date.now();
let highestScrollDepth = 0;
let lastReportedDepth = 0;
let exitRecorded = false;

const apiBase = () => String(window.LK_AGGREGATOR_API_URL || location.origin).replace(/\/$/, '');

/** Loads Google Analytics only when the administrator has explicitly saved a public measurement ID. */
async function loadGoogleAnalytics() {
  if (googleAnalyticsLoaded || !configured || !supabase) return;
  const { data } = await supabase.from('settings').select('value').eq('key', 'google_analytics_id').eq('is_public', true).maybeSingle();
  const measurementId = String(data?.value?.value || data?.value || '').trim();
  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) return;
  googleAnalyticsLoaded = true;
  const script = document.createElement('script');
  script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { anonymize_ip: true });
}

function storageId(key, persistent = false) {
  const store = persistent ? localStorage : sessionStorage;
  try {
    let id = store.getItem(key);
    if (!id) { id = crypto.randomUUID(); store.setItem(key, id); }
    return id;
  } catch { return null; }
}
function visitorId() { return storageId('lk-visitor-id', true); }
function sessionId() { return storageId('lk-session-id'); }
export function analyticsSessionId() { return sessionId(); }
function deviceFor(userAgent) { if (/ipad|tablet/i.test(userAgent)) return 'Tablet'; if (/mobi|android|iphone/i.test(userAgent)) return 'Mobile'; return 'Desktop'; }
function browserFor(userAgent) { if (/edg\//i.test(userAgent)) return 'Edge'; if (/firefox\//i.test(userAgent)) return 'Firefox'; if (/chrome\//i.test(userAgent)) return 'Chrome'; if (/safari\//i.test(userAgent)) return 'Safari'; return 'Other'; }
function operatingSystemFor(userAgent) { if (/windows nt/i.test(userAgent)) return 'Windows'; if (/android/i.test(userAgent)) return 'Android'; if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS'; if (/mac os x/i.test(userAgent)) return 'macOS'; if (/linux/i.test(userAgent)) return 'Linux'; return 'Other'; }
function trafficSource() {
  const params = new URLSearchParams(location.search); const campaign = params.get('utm_source');
  if (campaign) return campaign.slice(0, 160);
  if (!document.referrer) return 'direct';
  try { return new URL(document.referrer).hostname.replace(/^www\./, '').slice(0, 160); } catch { return 'direct'; }
}
function searchKeyword() { const params = new URLSearchParams(location.search); return (params.get('q') || params.get('query') || params.get('utm_term') || '').slice(0, 140) || null; }

/** Sends a small anonymous event to LK Newsroom's server-side analytics endpoint. */
export async function trackEvent(eventName, options = {}) {
  const userAgent = navigator.userAgent || '';
  const payload = {
    eventName, visitorId: visitorId(), sessionId: sessionId(), pageUrl: `${location.pathname}${location.search}`,
    pageTitle: document.title, articleId: options.articleId || activeArticleId, categoryId: options.categoryId || null,
    device: deviceFor(userAgent), browser: browserFor(userAgent), operatingSystem: operatingSystemFor(userAgent),
    source: trafficSource(), searchKeyword: searchKeyword(), scrollDepth: options.scrollDepth ?? null,
    durationSeconds: options.durationSeconds ?? null, metadata: options.metadata || {}
  };
  try {
    const response = await fetch(`${apiBase()}/v1/analytics/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true });
    if (!response.ok) throw new Error('Analytics endpoint unavailable');
  } catch {
    // Preserve basic legacy counters during a migration or a temporary server outage.
    if (eventName !== 'page_view' || !configured || !supabase) return;
    void supabase.from('page_views').insert({ article_id: options.articleId || null, path: payload.pageUrl, visitor_hash: payload.visitorId, referrer: document.referrer || null, traffic_source: payload.source, device: payload.device, browser: payload.browser, user_agent: userAgent.slice(0, 320) });
  }
}

/** Starts one page session. A later article-open event attaches the real article ID. */
export function trackPageView(articleId = null) {
  void loadGoogleAnalytics();
  void trackEvent('page_view', { articleId });
}

export function trackArticleOpen(articleId) {
  activeArticleId = articleId || null; pageOpenedAt = Date.now(); highestScrollDepth = 0; lastReportedDepth = 0; exitRecorded = false;
  if (activeArticleId) void trackEvent('article_open', { articleId: activeArticleId });
}
export function trackSocialShare(articleId = activeArticleId, platform = 'native') { if (articleId) void trackEvent('social_share', { articleId, metadata: { platform } }); }

function reportScrollDepth() {
  if (!activeArticleId) return;
  const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const available = Math.max(1, documentHeight - window.innerHeight);
  highestScrollDepth = Math.max(highestScrollDepth, Math.min(100, Math.round((window.scrollY / available) * 100)));
  const checkpoint = [100, 75, 50, 25].find(value => highestScrollDepth >= value && value > lastReportedDepth);
  if (checkpoint) { lastReportedDepth = checkpoint; void trackEvent('scroll_depth', { articleId: activeArticleId, scrollDepth: checkpoint }); }
}
function reportExit() {
  if (exitRecorded || !activeArticleId) return;
  exitRecorded = true; reportScrollDepth();
  void trackEvent('page_exit', { articleId: activeArticleId, durationSeconds: Math.max(1, Math.round((Date.now() - pageOpenedAt) / 1000)), scrollDepth: highestScrollDepth });
}

window.addEventListener('scroll', reportScrollDepth, { passive: true });
window.addEventListener('pagehide', reportExit);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reportExit(); });
