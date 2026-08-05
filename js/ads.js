import { configured, supabase } from './supabase-client.js';
import { analyticsSessionId } from './analytics.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const storageKey = id => `lk-ad-shown-${id}`;
function wasShown(ad) {
  if (ad.display_frequency === 'always') return false;
  if (ad.display_frequency === 'session') return Boolean(sessionStorage.getItem(storageKey(ad.id)));
  const savedAt = Number(localStorage.getItem(storageKey(ad.id)) || 0);
  return Boolean(savedAt && Date.now() - savedAt < 86_400_000);
}
function markShown(ad) {
  if (ad.display_frequency === 'session') sessionStorage.setItem(storageKey(ad.id), '1');
  else if (ad.display_frequency !== 'always') localStorage.setItem(storageKey(ad.id), String(Date.now()));
}

function loadStyles() {
  if ($('#lk-monetization-css')) return;
  const link = document.createElement('link');
  link.id = 'lk-monetization-css'; link.rel = 'stylesheet'; link.href = '/styles/monetization.css';
  document.head.append(link);
}

function campaignIsLive(ad) {
  const now = Date.now();
  return ad.active !== false && (!ad.status || ad.status === 'active') &&
    (!ad.starts_at || new Date(ad.starts_at).getTime() <= now) &&
    (!ad.ends_at || new Date(ad.ends_at).getTime() >= now);
}

async function fetchCampaigns() {
  if (!configured || !supabase) return [];
  const modern = 'id,name,title,description,placement,image_url,target_url,html_content,ad_type,adsense_slot,popup_delay_seconds,display_frequency,status,active,starts_at,ends_at,impressions,clicks,advertisers(company_name)';
  let response = await supabase.from('advertisements').select(modern).order('created_at', { ascending: false });
  if (response.error) response = await supabase.from('advertisements').select('id,name,placement,image_url,target_url,html_content,active,starts_at,ends_at,impressions,clicks').order('created_at', { ascending: false });
  if (response.error) { console.warn('Advertisements unavailable:', response.error.message); return []; }
  return (response.data || []).filter(campaignIsLive);
}

async function publicSetting(key) {
  if (!configured || !supabase) return null;
  const { data } = await supabase.from('settings').select('value').eq('key', key).eq('is_public', true).maybeSingle();
  return data?.value?.value || data?.value || null;
}

function markEvent(ad, event) {
  if (!supabase || !ad?.id) return;
  const fn = event === 'click' ? 'record_ad_click' : 'record_ad_impression';
  void supabase.rpc(fn, { ad_uuid: ad.id });
  const base = String(window.LK_AGGREGATOR_API_URL || location.origin).replace(/\/$/, '');
  void fetch(`${base}/v1/analytics/advertisements/${encodeURIComponent(ad.id)}/${event}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ sessionId: analyticsSessionId(), pageUrl: `${location.pathname}${location.search}`, source: document.referrer || 'direct' })
  });
}

function directCreative(ad) {
  const title = ad.title || ad.name || 'Sponsored';
  const advertiser = ad.advertisers?.company_name ? `<span class="ad-by">Sponsored by ${escapeHtml(ad.advertisers.company_name)}</span>` : '<span class="ad-by">Advertisement</span>';
  const image = ad.image_url ? `<img src="${escapeHtml(ad.image_url)}" alt="${escapeHtml(title)}" loading="lazy">` : '';
  const description = ad.description || ad.html_content;
  const content = `${advertiser}${image}<strong>${escapeHtml(title)}</strong>${description ? `<span>${escapeHtml(description)}</span>` : ''}`;
  const target = ad.target_url;
  return target ? `<a class="managed-ad__creative" href="${escapeHtml(target)}" target="_blank" rel="sponsored noopener">${content}</a>` : `<div class="managed-ad__creative">${content}</div>`;
}

function ensureAdSense(clientId) {
  if (!clientId || $('#lk-adsense-script')) return;
  const script = document.createElement('script');
  script.id = 'lk-adsense-script'; script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
  script.crossOrigin = 'anonymous'; document.head.append(script);
}

function adsenseCreative(ad, clientId) {
  if (!clientId || !ad.adsense_slot) return `<div class="managed-ad__notice">AdSense needs a public Google AdSense publisher ID and this campaign's slot ID.</div>`;
  ensureAdSense(clientId);
  window.setTimeout(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {} }, 0);
  return `<ins class="adsbygoogle" style="display:block" data-ad-client="${escapeHtml(clientId)}" data-ad-slot="${escapeHtml(ad.adsense_slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
}

function renderCampaign(slot, ad, clientId) {
  slot.classList.add('managed-ad');
  slot.innerHTML = ad.ad_type === 'adsense' ? adsenseCreative(ad, clientId) : directCreative(ad);
  markEvent(ad, 'impression');
  slot.querySelector('a')?.addEventListener('click', () => markEvent(ad, 'click'));
}

function appendPlacement(parent, placement, position = 'beforeend') {
  if (!parent || document.querySelector(`[data-ad-placement="${placement}"]`)) return null;
  const slot = document.createElement('div'); slot.className = `ad-slot ad-slot--${placement}`; slot.dataset.adPlacement = placement;
  parent.insertAdjacentElement(position, slot); return slot;
}

function createOptionalSlots(campaigns) {
  const has = placement => campaigns.some(ad => ad.placement === placement);
  const header = $('.site-header'); const main = $('main'); const footer = $('footer');
  if (has('header-banner')) appendPlacement(header, 'header-banner', 'afterend');
  if (has('homepage-hero') && document.body.dataset.template === 'home') appendPlacement(main, 'homepage-hero', 'afterbegin');
  if (has('footer-banner')) appendPlacement(footer, 'footer-banner', 'beforebegin');
  if (has('sponsored-news')) appendPlacement($('#featured-articles')?.parentElement, 'sponsored-news');
  if (has('video-ad')) appendPlacement($('#videos')?.parentElement, 'video-ad');
  if (has('article-inline')) appendPlacement($('.article-body') || $('article'), 'article-inline');
  if (has('sticky-bottom')) { const slot = appendPlacement(document.body, 'sticky-bottom'); if (slot) slot.classList.add('ad-slot--sticky'); }
}

function maybePopup(campaigns, clientId) {
  const ad = campaigns.find(item => item.placement === 'popup-ad');
  if (!ad) return;
  if (wasShown(ad)) return;
  window.setTimeout(() => {
    const dialog = document.createElement('div'); dialog.className = 'managed-ad-popup';
    dialog.innerHTML = `<div class="managed-ad-popup__backdrop"></div><section class="managed-ad-popup__card" role="dialog" aria-modal="true" aria-label="Sponsored message"><button type="button" aria-label="Close advertisement" class="managed-ad-popup__close">×</button><div class="ad-slot" data-ad-placement="popup-ad"></div></section>`;
    document.body.append(dialog); renderCampaign($('[data-ad-placement="popup-ad"]', dialog), ad, clientId);
    markShown(ad);
    const close = () => dialog.remove();
    $('.managed-ad-popup__close', dialog).addEventListener('click', close); $('.managed-ad-popup__backdrop', dialog).addEventListener('click', close);
  }, Math.max(0, Number(ad.popup_delay_seconds || 8)) * 1000);
}

/** Renders safe direct, sponsored, or AdSense campaigns from the Supabase ads table. */
export async function hydrateAdSlots() {
  loadStyles();
  const campaigns = await fetchCampaigns();
  if (!campaigns.length) return;
  createOptionalSlots(campaigns);
  const clientId = await publicSetting('google_adsense_id');
  document.querySelectorAll('[data-ad-placement]').forEach(slot => {
    const candidate = campaigns.find(ad => ad.placement === slot.dataset.adPlacement);
    if (candidate) renderCampaign(slot, candidate, clientId);
  });
  maybePopup(campaigns, clientId);
}
