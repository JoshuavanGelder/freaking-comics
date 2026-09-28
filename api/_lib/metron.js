// Metron-client: token-authenticatie, nette omgang met de limieten (20/min, 5000/dag) en cache.
import { HttpError } from './http.js';
import { getJson, setJson, storageConfigured, KEYS } from './store.js';

const BASE = (process.env.METRON_BASE_URL || 'https://metron.cloud/api').replace(/\/$/, '');
const UA = 'FreakingComics/0.2 (+https://github.com/JoshuavanGelder/freaking-comics)';

export function metronConfigured() {
  return !!authHeader();
}

/** Voorkeur: API-token. Anders gebruikersnaam + wachtwoord (Basic Auth, wordt door Metron uitgefaseerd). */
function authHeader() {
  if (process.env.METRON_TOKEN) return `Bearer ${process.env.METRON_TOKEN.trim()}`;
  const user = process.env.METRON_USERNAME;
  const pass = process.env.METRON_PASSWORD;
  if (user && pass) return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Houdt bij hoeveel verzoeken er deze minuut nog mogen. */
const budget = { remaining: null, reset: 0 };

async function waitForBudget(deadline) {
  if (budget.remaining !== null && budget.remaining <= 1) {
    const waitMs = Math.max(0, budget.reset * 1000 - Date.now()) + 500;
    if (deadline && Date.now() + waitMs > deadline) throw new HttpError(429, 'Metron-limiet bereikt, probeer het zo nog eens.');
    await sleep(Math.min(waitMs, 61_000));
    budget.remaining = null;
  }
}

export async function metronGet(path, params = {}, { deadline } = {}) {
  const auth = authHeader();
  if (!auth) throw new HttpError(503, 'Metron is nog niet ingesteld: zet METRON_TOKEN (of METRON_USERNAME en METRON_PASSWORD) in Vercel.');
  const url = new URL(`${BASE}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitForBudget(deadline);
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': UA } });
    const rem = res.headers.get('x-ratelimit-burst-remaining');
    if (rem !== null) {
      budget.remaining = Number(rem);
      budget.reset = Number(res.headers.get('x-ratelimit-burst-reset') || 0);
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 30);
      if (attempt === 0 && (!deadline || Date.now() + retry * 1000 < deadline)) {
        await sleep(Math.min(retry, 61) * 1000);
        continue;
      }
      throw new HttpError(429, 'Metron-limiet bereikt, probeer het zo nog eens.');
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Metron weigert de inloggegevens. Kijk METRON_TOKEN (of gebruikersnaam/wachtwoord) na.');
    if (res.status === 404) throw new HttpError(404, 'Niet gevonden op Metron.');
    if (!res.ok) throw new HttpError(502, `Metron gaf een fout (${res.status}).`);
    return res.json();
  }
  throw new HttpError(429, 'Metron-limiet bereikt.');
}

async function cached(key, ttl, load) {
  if (storageConfigured()) {
    const hit = await getJson(key).catch(() => null);
    if (hit) return hit;
  }
  const value = await load();
  if (storageConfigured()) await setJson(key, value, ttl).catch(() => {});
  return value;
}

// ---------------------------------------------------------------- vertalingen naar eenvoudige vormen

export function simplifySeries(s) {
  return {
    id: s.id,
    name: s.series || s.name || '',
    year: s.year_began || null,
    yearEnd: s.year_end || null,
    volume: s.volume || null,
    type: s.series_type?.name || '',
    publisher: s.publisher?.name || '',
    issueCount: s.issue_count ?? null,
  };
}

export function simplifyIssue(i) {
  return {
    id: i.id,
    number: String(i.number ?? ''),
    issue: i.issue || '',
    title: i.title || i.collection_title || '',
    name: Array.isArray(i.name) ? i.name : Array.isArray(i.story_titles) ? i.story_titles : [],
    image: i.image || null,
    store_date: i.store_date || null,
    cover_date: i.cover_date || null,
    reprints: Array.isArray(i.reprints) ? i.reprints.map((r) => ({ id: r.id, issue: r.issue })) : undefined,
    series: i.series ? { id: i.series.id, name: i.series.name, type: i.series.series_type?.name || '' } : undefined,
  };
}

// ---------------------------------------------------------------- publieke functies

export async function searchSeries(q) {
  const data = await metronGet('series/', { name: q });
  return (data.results || []).map(simplifySeries);
}

export async function getSeries(id) {
  const s = await metronGet(`series/${Number(id)}/`);
  return {
    id: s.id,
    name: s.name,
    year: s.year_began || null,
    yearEnd: s.year_end || null,
    type: s.series_type?.name || '',
    publisher: s.publisher?.name || '',
    imprint: s.imprint?.name || '',
    status: s.status || '',
    issueCount: s.issue_count ?? null,
  };
}

/** Alle issues (bij een TPB-serie: alle volumes) van een serie, max. 500. */
export async function listSeriesItems(id, { fresh = false, deadline } = {}) {
  const load = async () => {
    const items = [];
    let page = 1;
    while (page <= 5) {
      const data = await metronGet('issue/', { series_id: Number(id), page }, { deadline });
      items.push(...(data.results || []).map(simplifyIssue));
      if (!data.next) break;
      page += 1;
    }
    return items;
  };
  if (fresh) {
    const items = await load();
    if (storageConfigured()) await setJson(KEYS.metronSeriesItems(id), items, 3600).catch(() => {});
    return items;
  }
  return cached(KEYS.metronSeriesItems(id), 3600, load);
}

/** Details van één issue/volume (titel, verzamelde issues, cover). Een week in de cache. */
export async function getIssue(id, { deadline } = {}) {
  return cached(KEYS.metronIssue(id), 7 * 86400, async () => simplifyIssue(await metronGet(`issue/${Number(id)}/`, {}, { deadline })));
}
