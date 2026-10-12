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
  const league = LEAGUES.find(x => String(x.id) === String(item.league?.id));
  if (!league) return null;
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
  return `<article class="score-card ${match.status.live ? 'score-card--live' : ''}"><div class="score-card__top"><span>${safe(match.league)}</span><span class="score-status ${match.status.live ? 'score-status--live' : ''}">${match.status.live ? '<i></i>' : ''}${safe(match.status.label)}</span></div><div class="score-card__teams">${team(match.home,match.homeLogo,match.homeScore)}${team(match.away,match.awayLogo,match.awayScore)}</div><div class="score-card__bottom"><span>${scheduled ? safe(timeLabel(match.date)) : safe(match.detail || match.status.label)}</span><a href="../pages/match-centre.html?league=${encodeURIComponent(match.leagueId)}&event=${encodeURIComponent(match.id)}&provider=api-football" aria-label="Open full match centre">Match centre <i class="fa-solid fa-arrow-right"></i></a></div></article>`;
}
let allMatches = [];
let activeLeague = 'all';
let fetching = false;
function renderScores() {
  const full = document.querySelector('#sports-live-scores');
  const home = document.querySelector('#home-live-scores');
  const matches = (activeLeague === 'all' ? allMatches : allMatches.filter(match => match.leagueId === activeLeague))
    .sort((a,b) => Number(b.status.live)-Number(a.status.live) || new Date(a.date)-new Date(b.date));
  if (full) full.innerHTML = matches.length ? matches.map(scoreCard).join('') : '<p class="scores-empty">No fixtures returned for these competitions today. Try again later.</p>';
  if (home) {
    const featured = [...allMatches].sort((a,b) => Number(b.status.live)-Number(a.status.live) || new Date(a.date)-new Date(b.date)).slice(0,4);
    home.innerHTML = featured.length ? featured.map(scoreCard).join('') : '<p class="scores-empty">No fixtures available right now. Check back for updates.</p>';
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
    const tomorrowDate = new Date(Date.now() + 86400000);
    const tomorrow = localDate(tomorrowDate);
    const results = await Promise.allSettled([fetchDate(today), fetchDate(tomorrow)]);
    allMatches = [...new Map(results.flatMap(r => r.status === 'fulfilled' ? r.value : []).map(m => [m.id,m])).values()];
    const updated = document.querySelector('#scores-updated');
    if (updated) updated.textContent = allMatches.length ? `Updated ${new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date())} · data refreshes automatically` : 'Football feed temporarily unavailable';
    renderScores();
    if (!allMatches.length) {
      for (const el of [document.querySelector('#sports-live-scores'),document.querySelector('#home-live-scores')]) {
        if (el) el.innerHTML = '<p class="scores-empty">We could not connect to the football feed. Please refresh in a moment.</p>';
      }
    }
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
window.setInterval(refreshScores, 60000);
