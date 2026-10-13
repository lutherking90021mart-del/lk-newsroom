const LEAGUES = [
  { id: '39', slug: 'eng.1', name: 'Premier League' },
  { id: '140', slug: 'esp.1', name: 'La Liga' },
  { id: '135', slug: 'ita.1', name: 'Serie A' },
  { id: '78', slug: 'ger.1', name: 'Bundesliga' },
  { id: '61', slug: 'fra.1', name: 'Ligue 1' },
  { id: '2', slug: 'uefa.champions', name: 'Champions League' }
];
const API_URL = '/v1/football/fixtures?date=';
const safe = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const localDate = date => {
  const d = new Date(date);
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Accra',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
};
const timeLabel = date => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return 'Time TBC';
  return new Intl.DateTimeFormat(undefined, {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(value);
};
function statusFor(fixture) {
  const s = fixture.status || {};
  const liveCodes = ['1H','2H','HT','ET','BT','P','LIVE'];
  const doneCodes = ['FT','AET','PEN'];
  return {
    label: s.elapsed != null && liveCodes.includes(s.short) ? (s.elapsed + "'") : (s.long || s.short || 'Scheduled'),
    live: liveCodes.includes(s.short),
    finished: doneCodes.includes(s.short)
  };
}
function normalize(item) {
  const rawName = String(item.league?.name || 'Football');
  const key = rawName.toLowerCase();
  const aliases = [
    { match: /premier league|english premier/, slug: 'eng.1', name: 'Premier League' },
    { match: /la liga|primera division/, slug: 'esp.1', name: 'La Liga' },
    { match: /serie a/, slug: 'ita.1', name: 'Serie A' },
    { match: /bundesliga/, slug: 'ger.1', name: 'Bundesliga' },
    { match: /ligue 1/, slug: 'fra.1', name: 'Ligue 1' },
    { match: /champions league/, slug: 'uefa.champions', name: 'Champions League' }
  ];
  const league = aliases.find(x => x.match.test(key)) || { slug: 'other', name: rawName };
  const status = statusFor(item.fixture || {});
  return {
    id: String(item.fixture?.id || ''),
    leagueId: league.slug,
    league: league.name,
    date: item.fixture?.date,
    home: item.teams?.home?.name || 'Home',
    away: item.teams?.away?.name || 'Away',
    homeLogo: item.teams?.home?.logo || '',
    awayLogo: item.teams?.away?.logo || '',
    homeScore: item.goals?.home,
    awayScore: item.goals?.away,
    status,
    detail: item.fixture?.status?.long || status.label
  };
}
function scoreCard(match) {
  const scheduled = !match.status.live && !match.status.finished;
  const team = (name, logo, score) => `<div class="score-team"><span class="score-team__identity">${logo ? `<img src="${safe(logo)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<span class="score-team__crest"><i class="fa-solid fa-shield-halved"></i></span>'}<span>${safe(name)}</span></span><strong>${score == null ? (scheduled ? '' : '0') : safe(score)}</strong></div>`;
  return `<article class="score-card ${match.status.live ? 'score-card--live' : ''}"><div class="score-card__top"><span>${safe(match.league)}</span><span class="score-status ${match.status.live ? 'score-status--live' : ''}">${match.status.live ? '<i></i>' : ''}${safe(match.status.label)}</span></div><div class="score-card__teams">${team(match.home,match.homeLogo,match.homeScore)}${team(match.away,match.awayLogo,match.awayScore)}</div><div class="score-card__bottom"><span>${scheduled ? safe(timeLabel(match.date)) : safe(match.detail || match.status.label)}</span><a href="../pages/match-centre.html?league=${encodeURIComponent(match.leagueId)}&event=${encodeURIComponent(match.id)}&provider=sportsapi" aria-label="Open full match centre">Match centre <i class="fa-solid fa-arrow-right"></i></a></div></article>`;
}
let allMatches = [];
let activeLeague = 'all';
let fetching = false;

async function refreshTransferNews() {
  const grid = document.querySelector('#transfer-news-feed');
  if (!grid) return;
  const escapeHtml = value => safe(value);
  try {
    const response = await fetch('/v1/news?category=sports&limit=12', {headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('Transfer stories unavailable');
    const payload = await response.json();
    const rows = (payload.data || []).filter(article => article && article.title);
    const transferRows = rows.filter(article => {
      const text = String(article.title || '') + ' ' + String(article.excerpt || article.ai_summary || '');
      const source = String(article.news_sources?.slug || article.source_slug || '');
      return /transfer|signs? for|signed|signing|loan deal|agreed deal|here we go|contract extension|joins? the club|set to join|bid accepted/i.test(text) || source === 'fabrizio-romano-x';
    });
    const selected = (transferRows.length ? transferRows : rows).slice(0,6);
    grid.innerHTML = selected.length ? selected.map(article => {
      const title = escapeHtml(article.title);
      const summary = escapeHtml(article.excerpt || article.ai_summary || article.content || '');
      const source = escapeHtml(article.news_sources?.name || article.source || 'LK Newsroom');
      const image = article.featured_image_url || article.image_url || '';
      const link = '/news/' + encodeURIComponent(article.id || article.slug || '');
      return '<article class="news-card"><a class="news-card__image" href="' + link + '">' + (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</a><div class="news-card__body"><span class="eyebrow">' + source + '</span><h3 class="headline"><a href="' + link + '">' + title + '</a></h3><p>' + summary.slice(0,190) + (summary.length>190?'…':'') + '</p></div></article>';
    }).join('') : '<p class="scores-empty">Transfer stories will appear here as they are published by our news sources.</p>';
  } catch {
    grid.innerHTML = '<p class="scores-empty">Transfer stories are temporarily unavailable. Please check back shortly.</p>';
  }
}

function renderScores() {
  const full = document.querySelector('#sports-live-scores');
  const home = document.querySelector('#home-live-scores');
  const matches = (activeLeague === 'all' ? allMatches : allMatches.filter(match => match.leagueId === activeLeague))
    .sort((a,b) => Number(b.status.live)-Number(a.status.live) || new Date(a.date)-new Date(b.date));
  if (full) full.innerHTML = matches.length ? matches.map(scoreCard).join('') : '<p class="scores-empty">No football fixtures found for yesterday, today or tomorrow. Please try again shortly.</p>';
  if (home) {
    const featured = [...allMatches].sort((a,b) => Number(b.status.live)-Number(a.status.live) || new Date(a.date)-new Date(b.date)).slice(0,4);
    home.innerHTML = featured.length ? featured.map(scoreCard).join('') : '<p class="scores-empty">No fixtures found for yesterday, today or tomorrow.</p>';
  }
}
async function fetchDate(date) {
  const response = await fetch(API_URL + encodeURIComponent(date), {headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error('Football data service unavailable');
  const payload = await response.json();
  return (payload.response || []).map(normalize).filter(Boolean);
}
async function refreshScores() {
  if (fetching || (!document.querySelector('#sports-live-scores') && !document.querySelector('#home-live-scores'))) return;
  fetching = true;
  try {
    const today = localDate(new Date());
    const yesterdayDate = new Date(Date.now() - 86400000);
    const tomorrowDate = new Date(Date.now() + 86400000);
    const dates = [localDate(yesterdayDate), today, localDate(tomorrowDate)];
    const results = await Promise.allSettled(dates.map(fetchDate));
    allMatches = [...new Map(results.flatMap(r => r.status === 'fulfilled' ? r.value : []).map(m => [m.id,m])).values()];
    const updated = document.querySelector('#scores-updated');
    if (updated) updated.textContent = allMatches.length ? `Updated ${new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date())} · data refreshes automatically` : 'Fixtures updated';
    renderScores();

  } catch {
    for (const el of [document.querySelector('#sports-live-scores'),document.querySelector('#home-live-scores')]) {
      if (el) el.innerHTML = '<p class="scores-empty">Live scores are temporarily unavailable. Please try again shortly.</p>';
    }
  } finally { fetching = false; }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-league]');
  if (!button) return;
  activeLeague = button.dataset.league || 'all';
  document.querySelectorAll('.league-filter__button').forEach(item => {
    const active = item === button;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  renderScores();
});
refreshScores();
  refreshTransferNews();
window.setInterval(refreshScores, 60000);
