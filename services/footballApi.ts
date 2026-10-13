import express, { type Request, type Response } from 'express';

export const footballApiRouter = express.Router();
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUES = [
  { id: 'eng.1', name: 'Premier League' },
  { id: 'esp.1', name: 'La Liga' },
  { id: 'ita.1', name: 'Serie A' },
  { id: 'ger.1', name: 'Bundesliga' },
  { id: 'fra.1', name: 'Ligue 1' },
  { id: 'uefa.champions', name: 'Champions League' }
];
type CacheEntry = { expiresAt: number; body: unknown };
const cache = new Map<string, CacheEntry>();
async function espnGet(path: string): Promise<any> {
  const hit = cache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.body;
  const response = await fetch(ESPN_BASE + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Object.assign(new Error('Football scoreboard feed temporarily unavailable.'), { status: 502 });
  const body = await response.json();
  cache.set(path, { body, expiresAt: Date.now() + 20_000 });
  return body;
}
function sendError(res: Response, error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as {status:unknown}).status) : 502;
  res.status(status >= 400 && status < 600 ? status : 502).json({ error: error instanceof Error ? error.message : 'Football data is temporarily unavailable.' });
}
function toFixture(event: any, league: {id:string;name:string}) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find((team: any) => team.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find((team: any) => team.homeAway === 'away') || competitors[1] || {};
  const state = String(event.status?.type?.state || '').toLowerCase();
  const short = state === 'in' ? (event.status?.type?.name === 'STATUS_HALFTIME' ? 'HT' : 'LIVE') : state === 'post' ? 'FT' : 'NS';
  return {
    fixture: {
      id: event.id,
      date: event.date || null,
      status: { short, long: event.status?.type?.detail || event.status?.type?.description || 'Scheduled', elapsed: event.status?.displayClock ? Number.parseInt(event.status.displayClock, 10) || null : null },
      venue: { name: competition.venue?.fullName || '' }
    },
    league: { id: league.id, name: league.name },
    teams: {
      home: { id: home.id || null, name: home.team?.displayName || home.team?.name || 'Home', logo: home.team?.logo || home.team?.logos?.[0]?.href || '' },
      away: { id: away.id || null, name: away.team?.displayName || away.team?.name || 'Away', logo: away.team?.logo || away.team?.logos?.[0]?.href || '' }
    },
    goals: { home: home.score === undefined || home.score === '' ? null : Number(home.score), away: away.score === undefined || away.score === '' ? null : Number(away.score) },
    events: [], statistics: [], lineups: [], players: []
  };
}
footballApiRouter.get('/fixtures', async (req: Request, res: Response) => {
  try {
    const liveOnly = String(req.query.live || '') === 'all';
    const date = String(req.query.date || '');
    if (!liveOnly && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Provide live=all or a date in YYYY-MM-DD format.' });
    const dates = liveOnly ? [new Date().toISOString().slice(0,10)] : [date];
    const scoreboards = await Promise.allSettled(dates.flatMap(d => LEAGUES.map(async league => {
      const compactDate = d.replaceAll('-', '');
      const data = await espnGet('/' + league.id + '/scoreboard?dates=' + compactDate);
      return (data.events || []).map((event: any) => toFixture(event, league));
    })));
    let response = scoreboards.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    if (liveOnly) response = response.filter(item => ['LIVE','HT'].includes(item.fixture.status.short));
    response.sort((a,b) => new Date(a.fixture.date || 0).getTime() - new Date(b.fixture.date || 0).getTime());
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ get: liveOnly ? '/scoreboard?live=all' : '/scoreboard?date=' + date, results: response.length, response });
  } catch (error) { sendError(res, error); }
});
footballApiRouter.get('/fixture/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  const requestedLeague = String(req.query.league || '');
  if (!/^\\d{1,20}$/.test(id)) return res.status(400).json({ error: 'Invalid match ID.' });
  const leagues = requestedLeague ? LEAGUES.filter(league => league.id === requestedLeague) : LEAGUES;
  if (!leagues.length) return res.status(400).json({ error: 'Unknown football competition.' });
  try {
    const summaries = await Promise.allSettled(leagues.map(async league => {
      const data = await espnGet('/' + league.id + '/summary?event=' + encodeURIComponent(id));
      const header = data.header || {};
      const event = header.competitions?.[0] ? header : data.events?.[0] || data.gameInfo?.event;
      if (!event || (event.id && String(event.id) !== id)) return null;
      const competition = event.competitions?.[0] || {};
      // ESPN's summary endpoint places live status inside competitions[0].status,
      // while the scoreboard endpoint exposes it at the event level.
      const normalizedEvent = {
        ...event,
        id: event.id || id,
        date: event.date || competition.date || null,
        status: event.status || competition.status || {}
      };
      const fixture = toFixture(normalizedEvent, league);
      const plays = data.plays || [];
      fixture.events = plays.map((play: any) => {
        const displayClock = play.clock?.displayValue || play.clock?.displayClock || '';
        const clockMinute = displayClock ? Number.parseInt(String(displayClock), 10) : null;
        return {
          time: { elapsed: Number.isFinite(clockMinute) ? clockMinute : (play.period?.number != null ? play.period.number : null), extra: null },
          type: play.type?.text || play.type?.name || 'Match event',
          detail: play.text || play.shortText || '',
          team: { name: play.team?.displayName || '' },
          player: { name: play.participants?.[0]?.athlete?.displayName || '' },
          assist: { name: '' }
        };
      });
      const box = data.boxscore || {};
      fixture.statistics = (box.teams || []).map((team: any) => ({
        team: { id: team.team?.id || null, name: team.team?.displayName || '' },
        statistics: (team.statistics || []).map((stat: any) => ({ type: stat.name || stat.label, value: stat.displayValue ?? stat.value ?? null }))
      }));
      const lineups = (box.players || []).flatMap((group: any) => (group.statistics || []).map((category: any) => ({
        team: { name: group.team?.displayName || '' },
        formation: '',
        startXI: (category.athletes || []).map((entry: any) => ({ player: { name: entry.athlete?.displayName || entry.athlete?.fullName || 'Player', number: entry.athlete?.jersey || '', pos: entry.athlete?.position?.abbreviation || '' } })),
        substitutes: []
      })));
      fixture.lineups = lineups;
      return fixture;
    }));
    const match = summaries.find(result => result.status === 'fulfilled' && result.value);
    const fixture = match && match.status === 'fulfilled' ? match.value : null;
    if (!fixture) return res.status(404).json({ error: 'Match details were not found in the selected competition.' });
    res.set('Cache-Control', 'no-store');
    res.json({ get: '/summary?event=' + id, results: 1, response: [fixture] });
  } catch (error) { sendError(res, error); }
});
