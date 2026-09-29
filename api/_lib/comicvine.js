// Comic Vine-client: tweede bron naast Metron, vooral voor trades die Metron (nog) niet heeft.
// Limiet: 200 verzoeken per uur per soort; we cachen daarom ruim.
import { HttpError } from './http.js';
import { getJson, setJson, storageConfigured } from './store.js';

const BASE = (process.env.COMICVINE_BASE_URL || 'https://comicvine.gamespot.com/api').replace(/\/$/, '');
const UA = 'FreakingComics/0.3 (+https://github.com/JoshuavanGelder/freaking-comics)';

export function comicVineConfigured() {
  return !!process.env.COMICVINE_API_KEY;
}

export async function cvGet(path, params = {}) {
  const key = process.env.COMICVINE_API_KEY;
  if (!key) throw new HttpError(503, 'Comic Vine is nog niet ingesteld: zet COMICVINE_API_KEY in Vercel.');
  const url = new URL(`${BASE}/${path.replace(/^\//, '')}`);
  url.searchParams.set('api_key', key.trim());
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 420 || res.status === 429) throw new HttpError(429, 'Comic Vine-limiet bereikt, probeer het over een tijdje nog eens.');
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Comic Vine weigert de sleutel. Kijk COMICVINE_API_KEY na.');
  const body = await res.json().catch(() => null);
  if (!body) throw new HttpError(502, `Comic Vine gaf een fout (${res.status}).`);
  if (body.status_code === 100) throw new HttpError(502, 'Comic Vine weigert de sleutel. Kijk COMICVINE_API_KEY na.');
  if (body.status_code === 107) throw new HttpError(429, 'Comic Vine-limiet bereikt, probeer het over een tijdje nog eens.');
  if (body.status_code === 101) throw new HttpError(404, 'Niet gevonden op Comic Vine.');
  if (body.status_code !== 1) throw new HttpError(502, `Comic Vine: ${body.error || 'onbekende fout'}`);
  return body;
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

// ---------------------------------------------------------------- tekst → issue-lijst

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s:(-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
}

/**
 * Haalt "Collects The Flash #1-8 and The Flash Annual #1" uit een omschrijving.
 * Geeft reprints terug in dezelfde vorm als Metron: [{ issue: "The Flash #1" }, …]. Beste poging.
 */
export function collectedFromDescription(html) {
  const text = stripHtml(html);
  const m = text.match(/\bcollect(?:s|ing|ed)?\b[:\s]+(?:the\s+(?:issues|stories)\s+)?(.{3,400}?)(?:\.\s|\.$|$)/i);
  if (!m) return [];
  const out = [];
  const seen = new Set();
  let lastSeries = '';
  for (const raw of m[1].split(/,|;|\band\b|&/i)) {
    const part = raw.trim();
    const mm = part.match(/^(.*?)#\s*([\w.]+)\s*(?:[-–—]\s*#?\s*([\w.]+))?/) ||
      (lastSeries ? part.match(/^()(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+))?$/) : null);
    if (!mm) continue;
    let series = titleCase(mm[1].replace(/\b(issues?|nos?\.?)\b/gi, '').replace(/[\s:]+$/, '').trim()) || lastSeries;
    if (!series) continue;
    lastSeries = series;
    const from = mm[2];
    const to = mm[3];
    const add = (n) => {
      const key = `${series}|${n}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ id: out.length + 1, issue: `${series} #${n}` });
      }
    };
    if (to && /^\d+$/.test(from) && /^\d+$/.test(to) && Number(to) >= Number(from) && Number(to) - Number(from) <= 200) {
      for (let n = Number(from); n <= Number(to); n += 1) add(n);
    } else {
      add(from);
    }
  }
  return out;
}

// ---------------------------------------------------------------- vertalingen

function simplifyVolume(v) {
  return {
    id: v.id,
    name: v.name || '',
    year: Number(v.start_year) || null,
    yearEnd: null,
    volume: null,
    type: '',
    publisher: v.publisher?.name || '',
    issueCount: v.count_of_issues ?? null,
    source: 'comicvine',
    image: v.image?.thumb_url || v.image?.small_url || null,
  };
}

function simplifyIssue(i, volumeName) {
  return {
    id: i.id,
    number: String(i.issue_number ?? ''),
    issue: `${volumeName || i.volume?.name || ''} #${i.issue_number ?? ''}`,
    title: i.name || '',
    name: [],
    image: i.image?.super_url || i.image?.medium_url || i.image?.original_url || null,
    store_date: i.store_date || null,
    cover_date: i.cover_date || null,
    reprints: collectedFromDescription(i.description),
  };
}

// ---------------------------------------------------------------- publieke functies

const VOLUME_FIELDS = 'id,name,start_year,publisher,count_of_issues,image';
const ISSUE_FIELDS = 'id,name,issue_number,cover_date,store_date,image,description,volume';

export async function searchVolumes(q) {
  const variants = [q];
  const bare = q.replace(/^(the|a|an|de|het)\s+/i, '').trim();
  if (bare && bare.toLowerCase() !== q.toLowerCase()) variants.push(bare);
  const seen = new Map();
  for (const name of variants) {
    // Populaire namen ("The Flash") hebben honderden reeksen; we halen er max. 300 op en sorteren in de app.
    const data = await cached(`fc:cv:search:${name.toLowerCase()}`, 86400, async () => {
      const all = [];
      for (let offset = 0; offset < 300; offset += 100) {
        const d = await cvGet('volumes/', { filter: `name:${name}`, field_list: VOLUME_FIELDS, limit: 100, offset, sort: 'start_year:asc' });
        all.push(...(d.results || []));
        if (all.length >= (d.number_of_total_results || 0) || !(d.results || []).length) break;
      }
      return all;
    });
    for (const v of data) seen.set(v.id, simplifyVolume(v));
  }
  return [...seen.values()];
}

export async function getVolume(id) {
  const v = await cached(`fc:cv:volume:${Number(id)}`, 86400, async () => (await cvGet(`volume/4050-${Number(id)}/`, { field_list: VOLUME_FIELDS })).results);
  const s = simplifyVolume(v);
  return { id: s.id, name: s.name, year: s.year, yearEnd: null, type: 'Comic Vine', publisher: s.publisher, imprint: '', status: '', issueCount: s.issueCount, source: 'comicvine' };
}

/** Alle nummers van een Comic Vine-volume, meteen met details (cover, titel, datum, inhoud). Max. 500. */
export async function listVolumeIssues(id, { fresh = false } = {}) {
  const key = `fc:cv:volume-issues:${Number(id)}`;
  const load = async () => {
    const vol = await getVolume(id);
    const items = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const data = await cvGet('issues/', { filter: `volume:${Number(id)}`, field_list: ISSUE_FIELDS, sort: 'cover_date:asc', limit: 100, offset });
      items.push(...(data.results || []).map((i) => simplifyIssue(i, vol.name)));
      if (items.length >= (data.number_of_total_results || 0) || !(data.results || []).length) break;
    }
    return items;
  };
  if (fresh) {
    const items = await load();
    if (storageConfigured()) await setJson(key, items, 6 * 3600).catch(() => {});
    return items;
  }
  return cached(key, 6 * 3600, load);
}
