import express, { type Request, type Response } from 'express';

export const footballApiRouter = express.Router();
const API_BASE = 'https://v3.football.api-sports.io';
const allowedLeagues = new Set(['39','140','135','78','61','2']);
type CacheEntry = { expiresAt: number; body: unknown };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function cacheTtl(path: string, params: URLSearchParams) {
  if (path === '/fixtures' && params.has('live')) return 60_000;
  if (path === '/fixtures' && params.has('id')) return 5 * 60_000;
  if (path === '/fixtures' && params.has('date')) return 10 * 60_000;
  return 10 * 60_000;
}
async function apiGet(path: string, params: URLSearchParams): Promise<unknown> {
  const key = path + '?' + params.toString();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.body;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw Object.assign(new Error('Football data is not configured on the server.'), { status: 503 });
  const request = (async () => {
    const response = await fetch(API_BASE + key, {
      headers: { 'x-apisports-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(9000)
    });
    const payload = await response.json() as { errors?: unknown; response?: unknown; results?: number };
    if (!response.ok) throw Object.assign(new Error('Football data provider returned an error.'), { status: response.status === 429 ? 429 : 502 });
    if (payload.errors && (Array.isArray(payload.errors) ? payload.errors.length : Object.keys(payload.errors as object).length)) {
      console.error('API-Football provider reported an API error.');
      throw Object.assign(new Error('Football data provider rejected the request. Check the API key and plan.'), { status: 502 });
    }
    const ttl = cacheTtl(path, params);
    cache.set(key, { body: payload, expiresAt: Date.now() + ttl });
    return payload;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
function sendError(res: Response, error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as {status:unknown}).status) : 502;
  const message = error instanceof Error ? error.message : 'Football data is temporarily unavailable.';
  res.status(status >= 400 && status < 600 ? status : 502).json({ error: message });
}

// One request supplies the selected day or all live fixtures; restrict optional league filters.
footballApiRouter.get('/fixtures', async (req: Request, res: Response) => {
  try {
    const params = new URLSearchParams();
    const live = String(req.query.live || '');
    const date = String(req.query.date || '');
    const league = String(req.query.league || '');
    if (live === 'all') params.set('live', 'all');
    else if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      params.set('date', date);
      params.set('timezone', 'Africa/Accra');
    } else {
      return res.status(400).json({ error: 'Provide live=all or a date in YYYY-MM-DD format.' });
    }
    if (league) {
      if (!allowedLeagues.has(league)) return res.status(400).json({ error: 'Unsupported competition.' });
      params.set('league', league);
      params.set('season', String(new Date().getUTCFullYear()));
    }
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(await apiGet('/fixtures', params));
  } catch (error) { sendError(res, error); }
});

// Fixture ID is numeric and the provider key is never sent to the browser.
footballApiRouter.get('/fixture/:id', async (req: Request, res: Response) => {
  if (!/^\d{1,12}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid fixture ID.' });
  try {
    const params = new URLSearchParams({ id: req.params.id });
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(await apiGet('/fixtures', params));
  } catch (error) { sendError(res, error); }
});
