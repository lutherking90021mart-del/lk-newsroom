import { configured, supabase } from './supabase-client.js';

let googleAnalyticsLoaded = false;

/** Loads Google Analytics only when the administrator has saved a valid public measurement ID. */
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

function visitorId() {
  const key = 'lk-visitor-id';
  try {
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  } catch { return null; }
}

function deviceFor(userAgent) {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobi|android|iphone/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function browserFor(userAgent) {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/chrome\//i.test(userAgent)) return 'Chrome';
  if (/safari\//i.test(userAgent)) return 'Safari';
  return 'Other';
}

function regionalSetting() {
  const locale = navigator.language || '';
  const match = locale.match(/-([A-Z]{2})$/i);
  return match ? match[1].toUpperCase() : null;
}

/** Stores one privacy-friendly page event. No IP address or advertising fingerprint is collected. */
export async function trackPageView(articleId = null) {
  if (!configured || !supabase) return;
  void loadGoogleAnalytics();
  const userAgent = navigator.userAgent || '';
  const referrer = document.referrer || null;
  let trafficSource = 'direct';
  try { if (referrer) trafficSource = new URL(referrer).hostname.replace(/^www\./, ''); } catch {}
  await supabase.from('page_views').insert({
    article_id: articleId, path: location.pathname, visitor_hash: visitorId(), referrer,
    traffic_source: trafficSource, country: regionalSetting(), device: deviceFor(userAgent),
    browser: browserFor(userAgent), user_agent: userAgent.slice(0, 320)
  });
}
