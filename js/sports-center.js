const LEAGUES = [
  { id: 'eng.1', name: 'Premier League' },
  { id: 'esp.1', name: 'La Liga' },
  { id: 'ita.1', name: 'Serie A' },
  { id: 'ger.1', name: 'Bundesliga' },
  { id: 'fra.1', name: 'Ligue 1' },
  { id: 'uefa.champions', name: 'Champions League' }
];
const SCORE_URL = id => `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(id)}/scoreboard?limit=12`;
const safe = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const timeLabel = date => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return 'Time TBC';
  return new Intl.DateTimeFormat(undefined, {weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}).format(value);
};
const matchStatus = status => {
  const type = status?.type || {};
  if (type.state === 'in') return { label: type.shortDetail || 'LIVE', live: true, finished: false };
  if (type.completed) return { label: type.shortDetail || 'FT', live: false, finished: true };
  return { label: type.shortDetail || 'Upcoming', live: false, finished: false };
};
async function fetchLeague(league) {
  const response = await fetch(SCORE_URL(league.id), {headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error('Score feed unavailable');
  const payload = await response.json();
  return (payload.events || []).map(event => {
    const competition = event.competitions?.[0] || {};
    const competitors = competition.competitors || [];
    const home = competitors.find(team => team.homeAway === 'home') || competitors[0] || {};
    const away = competitors.find(team => team.homeAway === 'away') || competitors[1] || {};
    const status = matchStatus(competition.status || event.status);
    return {
      id: event.id, leagueId: league.id, league: league.name, date: event.date,
      name: event.name || `${away.team?.displayName || 'Away'} at ${home.team?.displayName || 'Home'}`,
      home: home.team?.displayName || 'Home', away: away.team?.displayName || 'Away',
      homeLogo: home.team?.logo || '', awayLogo: away.team?.logo || '',
      homeScore: home.score ?? '–', awayScore: away.score ?? '–',
      status, detail: competition.status?.type?.detail || event.status?.type?.detail || ''
    };
  });
}
function scoreCard(match) {
  const isScheduled = !match.status.live && !match.status.finished;
  const team = (name, logo, score) => `<div class="score-team"><span class="score-team__identity">${logo ? `<img src="${safe(logo)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<span class="score-team__crest"><i class="fa-solid fa-shield-halved"></i></span>'}<span>${safe(name)}</span></span><strong>${isScheduled ? '' : safe(score)}</strong></div>`;
  return `<article class="score-card ${match.status.live ? 'score-card--live' : ''}"><div class="score-card__top"><span>${safe(match.league)}</span><span class="score-status ${match.status.live ? 'score-status--live' : ''}">${match.status.live ? '<i></i>' : ''}${safe(match.status.label)}</span></div><div class="score-card__teams">${team(match.home,match.homeLogo,match.homeScore)}${team(match.away,match.awayLogo,match.awayScore)}</div><div class="score-card__bottom"><span>${isScheduled ? safe(timeLabel(match.date)) : safe(match.detail || match.status.label)}</span><a href="../pages/match-centre.html?league=${encodeURIComponent(match.leagueId)}&event=${encodeURIComponent(match.id)}" aria-label="Open full match centre">Match centre <i class="fa-solid fa-arrow-right"></i></a></div></article>`;
}
let allMatches = [];
let activeLeague = 'all';
let fetching = false;
function renderScores() {
  const full = document.querySelector('#sports-live-scores');
  const home = document.querySelector('#home-live-scores');
  const matches = (activeLeague === 'all' ? allMatches : allMatches.filter(match => match.leagueId === activeLeague))
    .sort((a,b) => Number(b.status.live)-Number(a.status.live) || new Date(a.date)-new Date(b.date));
  if (full) full.innerHTML = matches.length ? matches.map(scoreCard).join('') : '<p class="scores-empty">No matches found for this competition in the current fixture window.</p>';
  if (home) {
    const featured = [...allMatches].sort((a,b) => Number(b.status.live)-Number(a.status.live) || new Date(b.date)-new Date(a.date)).slice(0,4);
    home.innerHTML = featured.length ? featured.map(scoreCard).join('') : '<p class="scores-empty">No fixtures available right now. Check the full match centre for updates.</p>';
  }
}
async function refreshScores() {
  if (fetching || (!document.querySelector('#sports-live-scores') && !document.querySelector('#home-live-scores'))) return;
  fetching = true;
  try {
    const results = await Promise.allSettled(LEAGUES.map(fetchLeague));
    allMatches = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const updated = document.querySelector('#scores-updated');
    if (updated) updated.textContent = allMatches.length ? `Updated ${new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date())} · refreshes every minute` : 'Score feed temporarily unavailable';
    renderScores();
    if (!allMatches.length) {
      for (const el of [document.querySelector('#sports-live-scores'), document.querySelector('#home-live-scores')]) {
        if (el) el.innerHTML = '<p class="scores-empty">We could not connect to the score feed. Please refresh in a moment.</p>';
      }
    }
  } catch {
    for (const el of [document.querySelector('#sports-live-scores'), document.querySelector('#home-live-scores')]) {
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
window.setInterval(refreshScores, 60_000);
