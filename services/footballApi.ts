import express, { type Request, type Response } from 'express';

export const footballApiRouter = express.Router();
const API_BASE = 'https://api.sportsapi.app/v2';
type CacheEntry = { expiresAt: number; body: unknown };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function ttl(key: string) {
  return key.includes('/livescores') ? 45_000 : 5 * 60_000;
}
async function sportsGet(path: string): Promise<any> {
  const hit = cache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.body;
  const pending = inFlight.get(path);
  if (pending) return pending;
  const apiKey = process.env.SPORTSAPI_KEY;
  if (!apiKey) throw Object.assign(new Error('SportsAPI is not configured. Add SPORTSAPI_KEY to the server environment.'), { status: 503 });
  const request = (async () => {
    const response = await fetch(API_BASE + path, {
      headers: { Authorization: 'Bearer ' + apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(9000)
    });
    const payload = await response.json() as { data?: unknown; error?: { message?: string } };
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? 'SportsAPI rejected the key. Check that SPORTSAPI_KEY is correct and active.'
        : response.status === 429
          ? 'SportsAPI rate limit reached. Please try again shortly.'
          : payload.error?.message || 'SportsAPI returned an error.';
      throw Object.assign(new Error(message), { status: response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 502 : 502 });
    }
    const body = payload.data;
    cache.set(path, { body, expiresAt: Date.now() + ttl(path) });
    return body;
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
}
function sendError(res: Response, error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as {status:unknown}).status) : 502;
  const message = error instanceof Error ? error.message : 'Football data is temporarily unavailable.';
  res.status(status >= 400 && status < 600 ? status : 502).json({ error: message });
}
function toFixture(item: any) {
  const statusType = String(item.status?.type || 'scheduled').toLowerCase();
  const live = ['inprogress', 'live', 'halftime', 'period'].includes(statusType);
  const finished = ['finished', 'ended', 'complete'].includes(statusType);
  const statusShort = live ? (statusType === 'halftime' ? 'HT' : 'LIVE') : finished ? 'FT' : 'NS';
  const leagueName = String(item.league?.name || item.competition?.name || item.tournament?.name || 'Football');
  const homeScore = item.homeScore?.current ?? item.homeScore ?? null;
  const awayScore = item.awayScore?.current ?? item.awayScore ?? null;
  return {
    fixture: {
      id: item.id,
      date: item.startTime || item.start_time || item.date || null,
      status: { short: statusShort, long: live ? 'Live' : finished ? 'Full Time' : 'Not Started', elapsed: item.status?.minute ?? null },
      venue: item.venue || {}
    },
    league: { id: item.league?.id ?? item.competition?.id ?? item.tournament?.id ?? 0, name: leagueName },
    teams: {
      home: { id: item.home?.id, name: item.home?.name || 'Home', logo: item.home?.logo || '' },
      away: { id: item.away?.id, name: item.away?.name || 'Away', logo: item.away?.logo || '' }
    },
    goals: { home: homeScore, away: awayScore },
    events: [], statistics: [], lineups: [], players: []
  };
}
footballApiRouter.get('/fixtures', async (req: Request, res: Response) => {
  try {
    const live = String(req.query.live || '') === 'all';
    const date = String(req.query.date || '');
    if (!live && !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Provide live=all or a date in YYYY-MM-DD format.' });
    }
    // SportsAPI's documented free REST endpoint provides current live fixtures, not a date-based schedule.
    const rows = await sportsGet('/livescores?sport=football');
    const items = Array.isArray(rows) ? rows : [];
    const response = items.map(toFixture);
    res.set('Cache-Control', 'public, max-age=20, stale-while-revalidate=30');
    res.json({ get: '/livescores?sport=football', results: response.length, response });
  } catch (error) { sendError(res, error); }
});
footballApiRouter.get('/fixture/:id', async (req: Request, res: Response) => {
  if (!/^\\d{1,12}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid fixture ID.' });
  try {
    const item = await sportsGet('/fixtures/' + encodeURIComponent(req.params.id));
    if (!item || typeof item !== 'object') return res.status(404).json({ error: 'Fixture not found.' });
    const base = toFixture(item);
    const [events, statistics, lineups] = await Promise.all([
      sportsGet('/fixtures/' + encodeURIComponent(req.params.id) + '/events').catch(() => []),
      sportsGet('/fixtures/' + encodeURIComponent(req.params.id) + '/statistics').catch(() => ({})),
      sportsGet('/fixtures/' + encodeURIComponent(req.params.id) + '/lineups').catch(() => ({}))
    ]);
    base.events = Array.isArray(events) ? events.map((e: any) => ({
      time: { elapsed: e.time ?? null, extra: null },
      type: String(e.type || 'Event'),
      detail: String(e.detail || e.type || ''),
      team: { name: e.side === 'home' ? base.teams.home.name : e.side === 'away' ? base.teams.away.name : '' },
      player: { name: e.player?.name || '' },
      assist: { name: e.assist?.name || '' }
    })) : [];
    const periods = Array.isArray(statistics?.periods) ? statistics.periods : [];
    base.statistics = periods.flatMap((period: any) => (period.groups || []).map((group: any) => ({
      team: { id: group.team?.id ?? null, name: group.team?.name || group.name || '' },
      statistics: (group.statistics || group.items || []).map((s: any) => ({ type: s.name || s.type, value: s.value ?? null }))
    })));
    base.lineups = lineups?.home || lineups?.away ? [
      { team: { name: base.teams.home.name, logo: base.teams.home.logo }, formation: lineups.home?.formation, startXI: (lineups.home?.players || []).map((player: any) => ({ player: { name: player.name, number: player.number, pos: player.position } })), substitutes: [] },
      { team: { name: base.teams.away.name, logo: base.teams.away.logo }, formation: lineups.away?.formation, startXI: (lineups.away?.players || []).map((player: any) => ({ player: { name: player.name, number: player.number, pos: player.position } })), substitutes: [] }
    ] : [];
    res.set('Cache-Control', 'public, max-age=20, stale-while-revalidate=30');
    res.json({ get: '/fixtures/:id', results: 1, response: [base] });
  } catch (error) { sendError(res, error); }
});
