import { supabase } from './supabase-client.js';
import { toast } from './components.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const iso = value => value ? new Date(value).toISOString() : null;
const local = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
const placementOptions = ['header-banner','homepage-hero','homepage-sidebar','article-inline','article-sidebar','footer-banner','sticky-bottom','popup-ad','sponsored-news','video-ad'];

function formatNumber(value) { return Number(value || 0).toLocaleString(); }
function ctr(ad) { return Number(ad.impressions || 0) ? ((Number(ad.clicks || 0) / Number(ad.impressions)) * 100).toFixed(2) : '0.00'; }
function statusLabel(value) { return `<span class="status status-${esc(value || 'draft')}">${esc(value || 'draft')}</span>`; }
function managerNote() { return '<p class="form-help">Run <code>supabase/monetization-upgrade.sql</code> in Supabase before using advertiser, AdSense and detailed analytics features.</p>'; }

async function fetchRevenueData() {
  const [ads, advertisers] = await Promise.all([
    supabase.from('advertisements').select('*,advertisers(company_name)').order('created_at', { ascending: false }),
    supabase.from('advertisers').select('*').order('company_name')
  ]);
  if (ads.error || advertisers.error) throw ads.error || advertisers.error;
  return { ads: ads.data || [], advertisers: advertisers.data || [] };
}

function campaignForm(advertisers) {
  return `<section class="panel revenue-panel"><div class="section-heading"><div><h3>Revenue campaign</h3><p class="text-muted">Use this for direct banners, sponsored campaigns, or AdSense slots.</p></div><button class="btn btn-outline" type="button" id="campaign-clear">New campaign</button></div><form id="revenue-campaign-form" class="editor-grid"><input type="hidden" name="id"><div><div class="form-group"><label>Advertisement title</label><input class="form-control" name="title" required maxlength="160"></div><div class="form-group"><label>Advertiser</label><select class="form-control" name="advertiserId"><option value="">LK Newsroom / no advertiser</option>${advertisers.map(item => `<option value="${item.id}">${esc(item.company_name)}</option>`).join('')}</select></div><div class="form-group"><label>Format</label><select class="form-control" name="type"><option value="direct">Direct banner</option><option value="sponsored">Sponsored news</option><option value="adsense">Google AdSense</option></select></div><div class="form-group"><label>Placement</label><select class="form-control" name="placement">${placementOptions.map(item => `<option value="${item}">${item.replace(/-/g, ' ')}</option>`).join('')}</select></div><div class="form-group"><label>Image URL</label><input class="form-control" name="imageUrl" type="url" placeholder="https://…"></div></div><div><div class="form-group"><label>Description / sponsored label</label><textarea class="form-control" name="description" rows="3" maxlength="600"></textarea></div><div class="form-group"><label>Destination URL</label><input class="form-control" name="targetUrl" type="url" placeholder="https://…"></div><div class="form-group"><label>AdSense slot ID</label><input class="form-control" name="adsenseSlot" placeholder="1234567890"></div><div class="form-group"><label>Start and end</label><div class="date-pair"><input class="form-control" name="startsAt" type="datetime-local"><input class="form-control" name="endsAt" type="datetime-local"></div></div><div class="form-group"><label>Popup delay (seconds)</label><input class="form-control" name="popupDelay" type="number" min="0" max="120" value="8"></div><label><input name="active" type="checkbox" checked> Campaign is active</label><button class="btn btn-primary" type="submit" style="margin:16px 0 0 12px">Save campaign</button></div></form></section>`;
}

function advertiserForm() {
  return `<section class="panel revenue-panel"><h3>Advertisers</h3><form id="advertiser-form" class="compact-form"><input class="form-control" name="company" required placeholder="Company name"><input class="form-control" name="contact" placeholder="Contact name"><input class="form-control" name="email" type="email" placeholder="Email"><input class="form-control" name="website" type="url" placeholder="Website"><button class="btn btn-outline" type="submit">Add advertiser</button></form></section>`;
}

function campaignTable(ads) {
  return `<section class="panel revenue-panel"><h3>Campaign performance</h3><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Campaign</th><th>Format / placement</th><th>Schedule</th><th>Views</th><th>Clicks</th><th>CTR</th><th>Status</th><th></th></tr></thead><tbody>${ads.length ? ads.map(ad => `<tr><td><strong>${esc(ad.title || ad.name)}</strong><br><span class="meta">${esc(ad.advertisers?.company_name || 'LK Newsroom')}</span></td><td>${esc(ad.ad_type || 'direct')}<br><span class="meta">${esc(ad.placement)}</span></td><td>${ad.starts_at ? new Date(ad.starts_at).toLocaleDateString() : 'Now'} – ${ad.ends_at ? new Date(ad.ends_at).toLocaleDateString() : 'No end'}</td><td>${formatNumber(ad.impressions)}</td><td>${formatNumber(ad.clicks)}</td><td>${ctr(ad)}%</td><td>${statusLabel(ad.status || (ad.active ? 'active' : 'paused'))}</td><td><button class="edit-revenue-ad" data-id="${ad.id}" aria-label="Edit campaign"><i class="fa-solid fa-pen"></i></button> <button class="delete-revenue-ad" data-id="${ad.id}" aria-label="Delete campaign"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') : '<tr><td colspan="8" class="text-muted">No revenue campaigns yet.</td></tr>'}</tbody></table></div></section>`;
}

function clearCampaign(form) {
  form.reset(); form.elements.id.value = ''; form.elements.active.checked = true; form.elements.popupDelay.value = '8';
}

function loadCampaign(form, ad) {
  form.elements.id.value = ad.id; form.elements.title.value = ad.title || ad.name || ''; form.elements.advertiserId.value = ad.advertiser_id || '';
  form.elements.type.value = ad.ad_type || 'direct'; form.elements.placement.value = ad.placement || 'homepage-sidebar'; form.elements.imageUrl.value = ad.image_url || '';
  form.elements.description.value = ad.description || ad.html_content || ''; form.elements.targetUrl.value = ad.target_url || ''; form.elements.adsenseSlot.value = ad.adsense_slot || '';
  form.elements.startsAt.value = local(ad.starts_at); form.elements.endsAt.value = local(ad.ends_at); form.elements.popupDelay.value = ad.popup_delay_seconds ?? 8; form.elements.active.checked = (ad.status || (ad.active ? 'active' : 'paused')) === 'active';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function mountAdvertisements() {
  const view = $('#admin-view'); if (!view || !supabase) return;
  let data;
  try { data = await fetchRevenueData(); } catch { view.insertAdjacentHTML('beforeend', `<section class="panel revenue-panel"><h3>Revenue upgrade required</h3>${managerNote()}</section>`); return; }
  const root = document.createElement('div'); root.className = 'revenue-admin'; root.innerHTML = `${campaignForm(data.advertisers)}${advertiserForm()}${campaignTable(data.ads)}`;
  view.prepend(root);
  const form = $('#revenue-campaign-form', root);
  $('#campaign-clear', root).addEventListener('click', () => clearCampaign(form));
  $('#advertiser-form', root).addEventListener('submit', async event => {
    event.preventDefault(); const fields = event.currentTarget.elements;
    try { await supabase.from('advertisers').insert({ company_name: fields.company.value.trim(), contact_name: fields.contact.value.trim() || null, email: fields.email.value.trim() || null, website: fields.website.value.trim() || null }); toast('Advertiser saved.'); await mountRevenueTools('advertisements'); }
    catch (error) { toast(error.message || 'Could not save advertiser.'); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const fields = form.elements; const active = fields.active.checked;
    const payload = { name: fields.title.value.trim(), title: fields.title.value.trim(), advertiser_id: fields.advertiserId.value || null, ad_type: fields.type.value, placement: fields.placement.value, image_url: fields.imageUrl.value.trim() || null, description: fields.description.value.trim() || null, target_url: fields.targetUrl.value.trim() || null, adsense_slot: fields.adsenseSlot.value.trim() || null, starts_at: iso(fields.startsAt.value), ends_at: iso(fields.endsAt.value), popup_delay_seconds: Number(fields.popupDelay.value || 8), active, status: active ? 'active' : 'paused' };
    try { if (fields.id.value) await supabase.from('advertisements').update(payload).eq('id', fields.id.value); else await supabase.from('advertisements').insert(payload); toast('Campaign saved.'); await mountRevenueTools('advertisements'); }
    catch (error) { toast(error.message || 'Could not save campaign.'); }
  });
  root.querySelectorAll('.edit-revenue-ad').forEach(button => button.addEventListener('click', () => { const ad = data.ads.find(item => item.id === button.dataset.id); if (ad) loadCampaign(form, ad); }));
  root.querySelectorAll('.delete-revenue-ad').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Delete this campaign?')) return;
    try { await supabase.from('advertisements').delete().eq('id', button.dataset.id); toast('Campaign deleted.'); await mountRevenueTools('advertisements'); } catch (error) { toast(error.message || 'Could not delete campaign.'); }
  }));
}

async function mountSettings() {
  const view = $('#admin-view'); if (!view || !supabase) return;
  const keys = ['site_name','site_logo_url','theme_colours','social_links','google_analytics_id','google_adsense_id','newsletter_settings','news_update_interval'];
  const { data, error } = await supabase.from('settings').select('key,value').in('key', keys);
  if (error) return;
  const values = Object.fromEntries((data || []).map(item => [item.key, item.value?.value ?? item.value]));
  const panel = document.createElement('section'); panel.className = 'panel revenue-panel';
  panel.innerHTML = `<h3>Publication, revenue and integrations</h3><p class="text-muted">Public IDs are used only where needed in the browser. Never paste service-role keys here.</p><form id="publication-settings-form" class="editor-grid"><div><div class="form-group"><label>Website name</label><input class="form-control" name="siteName" value="${esc(values.site_name || 'LK Newsroom')}"></div><div class="form-group"><label>Logo URL</label><input class="form-control" name="logoUrl" type="url" value="${esc(values.site_logo_url || '')}"></div><div class="form-group"><label>Google Analytics measurement ID</label><input class="form-control" name="gaId" placeholder="G-XXXXXXXXXX" value="${esc(values.google_analytics_id || '')}"></div><div class="form-group"><label>Google AdSense publisher ID</label><input class="form-control" name="adsenseId" placeholder="ca-pub-XXXXXXXXXXXXXXXX" value="${esc(values.google_adsense_id || '')}"></div></div><div><div class="form-group"><label>Social links (JSON)</label><textarea class="form-control" name="social" rows="3">${esc(JSON.stringify(values.social_links || {}))}</textarea></div><div class="form-group"><label>Theme colours (JSON)</label><textarea class="form-control" name="theme" rows="3">${esc(JSON.stringify(values.theme_colours || { primary:'#003366', secondary:'#0057B8', accent:'#E31E24' }))}</textarea></div><div class="form-group"><label>Newsletter settings (JSON)</label><textarea class="form-control" name="newsletter" rows="3">${esc(JSON.stringify(values.newsletter_settings || {}))}</textarea></div><div class="form-group"><label>News update interval (minutes)</label><input class="form-control" name="interval" type="number" min="5" value="${esc(values.news_update_interval || 5)}"></div><button class="btn btn-primary" type="submit">Save publication settings</button></div></form>`;
  view.prepend(panel);
  $('#publication-settings-form', panel).addEventListener('submit', async event => {
    event.preventDefault(); const f = event.currentTarget.elements;
    try {
      const records = [
        ['site_name', f.siteName.value.trim(), true], ['site_logo_url', f.logoUrl.value.trim(), true], ['google_analytics_id', f.gaId.value.trim(), true], ['google_adsense_id', f.adsenseId.value.trim(), true], ['social_links', JSON.parse(f.social.value || '{}'), true], ['theme_colours', JSON.parse(f.theme.value || '{}'), true], ['newsletter_settings', JSON.parse(f.newsletter.value || '{}'), false], ['news_update_interval', Math.max(5, Number(f.interval.value || 5)), false]
      ].map(([key, value, is_public]) => ({ key, value: { value }, is_public }));
      const { error: saveError } = await supabase.from('settings').upsert(records, { onConflict: 'key' }); if (saveError) throw saveError; toast('Publication settings saved.');
    } catch (error) { toast(error.message || 'Use valid JSON in the JSON fields.'); }
  });
}

function bucket(rows, field) { return rows.reduce((map, row) => { const key = row[field] || 'Unknown'; map[key] = (map[key] || 0) + 1; return map; }, {}); }
function listRows(map) { return Object.entries(map).sort((a,b) => b[1] - a[1]).slice(0,8).map(([name,count]) => `<li><span>${esc(name)}</span><strong>${formatNumber(count)}</strong></li>`).join('') || '<li><span>No data yet</span></li>'; }

async function mountAnalytics() {
  const view = $('#admin-view'); if (!view || !supabase) return;
  const since = new Date(); since.setDate(since.getDate() - 30);
  const [events, articles] = await Promise.all([
    supabase.from('page_views').select('path,visitor_hash,country,device,browser,traffic_source,viewed_at').gte('viewed_at', since.toISOString()).order('viewed_at', { ascending: false }).limit(5000),
    supabase.from('articles').select('id,title,view_count,categories(name)').eq('status', 'published').order('view_count', { ascending: false }).limit(10)
  ]);
  if (events.error) { view.insertAdjacentHTML('beforeend', `<section class="panel revenue-panel"><h3>Detailed analytics upgrade required</h3>${managerNote()}</section>`); return; }
  const rows = events.data || []; const today = new Date().toDateString(); const todayRows = rows.filter(row => new Date(row.viewed_at).toDateString() === today); const unique = new Set(rows.map(row => row.visitor_hash).filter(Boolean)).size;
  const panel = document.createElement('section'); panel.className = 'panel revenue-panel';
  panel.innerHTML = `<h3>Audience details — last 30 days</h3><div class="stat-grid">${[['Visitors',unique,'Unique browser IDs'],['Today',todayRows.length,'Page events'],['Monthly',rows.length,'Page events'],['Returning',Math.max(0, rows.length - unique),'Repeat events']].map(([label,value,note]) => `<article class="stat-card"><strong>${formatNumber(value)}</strong><span>${label}</span><small>${note}</small></article>`).join('')}</div><div class="analytics-grid"><section><h4>Traffic sources</h4><ul class="metric-list">${listRows(bucket(rows,'traffic_source'))}</ul></section><section><h4>Regional settings</h4><ul class="metric-list">${listRows(bucket(rows,'country'))}</ul></section><section><h4>Devices</h4><ul class="metric-list">${listRows(bucket(rows,'device'))}</ul></section><section><h4>Browsers</h4><ul class="metric-list">${listRows(bucket(rows,'browser'))}</ul></section><section class="analytics-grid__wide"><h4>Most viewed articles</h4><ol class="metric-list">${(articles.data || []).map(article => `<li><span>${esc(article.title)}</span><strong>${formatNumber(article.view_count)}</strong></li>`).join('') || '<li><span>No articles yet</span></li>'}</ol></section></div><canvas id="revenue-traffic-chart" height="100" aria-label="Traffic by device"></canvas>`;
  view.append(panel);
  if (window.Chart) { const devices = bucket(rows, 'device'); new window.Chart($('#revenue-traffic-chart', panel), { type:'bar', data:{ labels:Object.keys(devices), datasets:[{ label:'Page views', data:Object.values(devices), backgroundColor:'#0057B8' }] }, options:{ responsive:true, plugins:{ legend:{ display:false } } } }); }
}

export async function mountRevenueTools(page) {
  document.querySelectorAll('.revenue-admin,.revenue-panel').forEach(node => node.remove());
  if (page === 'advertisements') return mountAdvertisements();
  if (page === 'settings') return mountSettings();
  if (page === 'analytics') return mountAnalytics();
}
