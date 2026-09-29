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

const LEAD_WORDS = new Set(['collects', 'collecting', 'collected', 'collection', 'includes', 'including', 'featuring', 'from', 'in', 'and', 'plus', 'with', 'of', 'the', 'these', 'this', 'stories', 'story', 'tales', 'issues', 'issue', 'reprints', 'reprinting', 'presents', 'plus:']);

/** "THE FLASH" → "The Flash"; laat gewone schrijfwijze staan. */
function niceName(s) {
  // Jaartal in de naam eraf: "ULTIMATE COMICS SPIDER-MAN (2011)" → "Ultimate Comics Spider-Man"
  const t = s.trim().replace(/[\s:,;.!]+$/, '').replace(/\s*\(?\b(19|20)\d{2}\)?$/, '').replace(/[\s:,;.!]+$/, '');
  return t === t.toUpperCase() ? titleCase(t) : t;
}

/**
 * Zoekt de serienaam vlak vóór een "#": de reeks woorden met hoofdletters direct ervoor
 * ("THE FLASH ANNUAL", "Ultimate Comics X-Men"), zonder aanloopwoorden als "Collects" of "issues".
 */
function seriesBefore(text) {
  const words = text.trim().split(/\s+/);
  const picked = [];
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const w = words[i];
    const bare = w.replace(/^[("'“]+|[)"'”:,]+$/g, '');
    if (!bare) break;
    const lower = bare.toLowerCase();
    // Een woord met een hoofdletter (of cijfer, of "&"), of een klein verbindingswoord binnen een ALL-CAPS naam
    const capital = /^[A-Z0-9&]/.test(bare) || (/^(of|the|and|vs\.?)$/.test(lower) && picked.length && picked[0] === picked[0].toUpperCase());
    if (!capital) break;
    if (/[.!?]$/.test(w) && picked.length) break; // einde van de vorige zin
    picked.unshift(bare);
  }
  // Aanloopwoorden vooraan eraf ("Collects The Flash" → "The Flash"; "Plus THE FLASH" → "THE FLASH")
  while (picked.length && LEAD_WORDS.has(picked[0].toLowerCase()) && !(picked[0] === 'THE' || picked[0] === 'The' ? picked.length > 1 && picked[1] === picked[1].toUpperCase() && picked[0] === 'THE' : false)) {
    // "The" mag blijven als hij bij een ALL-CAPS naam hoort ("THE FLASH")
    if ((picked[0] === 'The' || picked[0] === 'the') && picked.length > 1 && /^[A-Z]/.test(picked[1]) && picked[1] !== picked[1].toUpperCase()) break;
    picked.shift();
  }
  // Mengvorm "Collects THE FLASH": neem alleen het ALL-CAPS stuk
  const capsStart = picked.findIndex((w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (capsStart > 0 && picked.slice(capsStart).every((w) => w === w.toUpperCase())) picked.splice(0, capsStart);
  return picked.join(' ');
}

/**
 * Haalt uit een omschrijving welke nummers erin zitten, bijv.
 * "Collects issues #1-8", "collecting issues #0, 9-12 and THE FLASH ANNUAL #1",
 * "from THE FLASH #20-25, and #23.2: REVERSE FLASH!", "THE FLASH #36-40 and SECRET ORIGINS #7".
 * `defaultSeries` is de naam als er alleen "issues #1-8" staat.
 * Geeft reprints terug in dezelfde vorm als Metron: [{ issue: "The Flash #1" }, …]. Beste poging.
 */
export function collectedFromDescription(html, defaultSeries = '') {
  const text = stripHtml(html).replace(/[–—]/g, '-');
  const base = niceName(String(defaultSeries || '').replace(/\s*\(.*?\)\s*$/, ''));
  const out = [];
  const seen = new Set();
  const add = (series, n) => {
    const key = `${series.toLowerCase()}|${n}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ id: out.length + 1, issue: `${series} #${n}` });
    }
  };
  const addRange = (series, from, to) => {
    if (to && /^\d+$/.test(from) && /^\d+$/.test(to) && Number(to) >= Number(from) && Number(to) - Number(from) <= 200) {
      for (let n = Number(from); n <= Number(to); n += 1) add(series, String(n));
    } else add(series, from);
  };
  // Een "#"-verwijzing met eventueel een reeks vervolgnummers: "#0, 9-12", "#20-25, and #23.2"
  const re = /#\s*(\d+(?:\.\d+)?)(?:\s*-\s*#?\s*(\d+(?:\.\d+)?))?((?:\s*(?:,|and|&)\s*(?:and\s+)?#?\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?(?![\w.]*\s*[A-Za-z]{2,}\s*#))*)/g;
  let last = base;
  let prevEnd = 0;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(prevEnd, m.index);
    let series = niceName(seriesBefore(before));
    if (!series) series = last || base;
    if (!series) {
      prevEnd = re.lastIndex;
      continue;
    }
    // "FLASH ANNUAL" bij "The Flash" → "The Flash Annual"
    if (base && /^the\s/i.test(base) && series.toLowerCase().startsWith(base.slice(4).toLowerCase()) && !/^the\s/i.test(series)) series = `The ${series}`;
    addRange(series, m[1], m[2]);
    for (const part of (m[3] || '').split(/,|&|\band\b/)) {
      const pm = part.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/);
      if (pm) addRange(series, pm[1], pm[2]);
    }
    last = series;
    prevEnd = re.lastIndex;
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
    reprints: collectedFromDescription(i.description, volumeName || i.volume?.name || ''),
  };
}

// ---------------------------------------------------------------- publieke functies

const VOLUME_FIELDS = 'id,name,start_year,publisher,count_of_issues,image';
const ISSUE_FIELDS = 'id,name,issue_number,cover_date,store_date,image,description,volume';

/**
 * Zoekt reeksen op Comic Vine. De zoekfunctie van Comic Vine sorteert op relevantie; we nemen de
 * eerste 30. Vindt die niets, dan zoeken we nog op naam.
 */
export async function searchVolumes(q) {
  return cached(`fc:cv:search2:${q.toLowerCase()}`, 86400, async () => {
    const seen = new Map();
    for (let page = 1; page <= 3; page += 1) {
      const d = await cvGet('search/', { query: q, resources: 'volume', field_list: VOLUME_FIELDS, limit: 10, page });
      for (const v of d.results || []) seen.set(v.id, simplifyVolume(v));
      if ((d.results || []).length < 10 || seen.size >= (d.number_of_total_results || 0)) break;
    }
    if (!seen.size) {
      const d = await cvGet('volumes/', { filter: `name:${q}`, field_list: VOLUME_FIELDS, limit: 100 });
      for (const v of d.results || []) seen.set(v.id, simplifyVolume(v));
    }
    return [...seen.values()];
  });
}

export async function getVolume(id) {
  const v = await cached(`fc:cv:volume:${Number(id)}`, 86400, async () => (await cvGet(`volume/4050-${Number(id)}/`, { field_list: VOLUME_FIELDS })).results);
  const s = simplifyVolume(v);
  return { id: s.id, name: s.name, year: s.year, yearEnd: null, type: 'Comic Vine', publisher: s.publisher, imprint: '', status: '', issueCount: s.issueCount, source: 'comicvine' };
}

/** Alle nummers van een Comic Vine-volume, meteen met details (cover, titel, datum, inhoud). Max. 500. */
export async function listVolumeIssues(id, { fresh = false } = {}) {
  const key = `fc:cv:volume-issues3:${Number(id)}`;
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

// ---------------------------------------------------------------- aanraders koppelen

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&amp;|&/g, ' and ')
    .replace(/\b(the|a|an|vol|volume)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Hoe goed een Comic Vine-reeks past bij een aanrader (hoger is beter). Voorkeur voor verzamelde edities. */
export function matchScore(item, v) {
  const a = norm(item.series);
  const b = norm(v.name);
  if (!a || !b) return 0;
  let score = 0;
  if (a === b) score += 5;
  else if (b.startsWith(a) || a.startsWith(b)) score += 3;
  const wa = new Set(a.split(' '));
  const wb = b.split(' ');
  const overlap = wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length);
  score += overlap * 2;
  const pub = norm(v.publisher?.name || v.publisher);
  if (item.publisher && pub && (pub.includes(norm(item.publisher)) || norm(item.publisher).includes(pub))) score += 1;
  const start = Number(v.start_year ?? v.year);
  if (item.year && start) {
    const diff = start - item.year;
    if (diff >= 0 && diff <= 2) score += 2;
    else if (diff === -1) score += 1;
    else if (Math.abs(diff) > 5) score -= 2;
  }
  const count = Number(v.count_of_issues ?? v.issueCount);
  if (count && count <= 25) score += 1.5;
  else if (count > 60) score -= 1;
  return score;
}

/** Zoekt de Comic Vine-reeks bij een aanrader: id, naam, jaar en cover. Null als niets goed genoeg past. */
export async function findRecommendation(item) {
  const q = item.series;
  const results = await cached(`fc:cv:rec:${q.toLowerCase()}`, 7 * 86400, async () => {
    const d = await cvGet('search/', { query: q, resources: 'volume', field_list: VOLUME_FIELDS, limit: 10 });
    return (d.results || []).map((v) => ({
      id: v.id,
      name: v.name || '',
      start_year: Number(v.start_year) || null,
      publisher: v.publisher?.name || '',
      count_of_issues: v.count_of_issues ?? null,
      image: v.image?.medium_url || v.image?.small_url || v.image?.super_url || null,
    }));
  });
  let best = null;
  for (const v of results) {
    const s = matchScore(item, v);
    if (s >= 4 && (!best || s > best.score)) best = { ...v, score: s };
  }
  return best;
}
