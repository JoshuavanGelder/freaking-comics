// Freaking Comics – datamodel en pure logica.
// Alles hier is zonder DOM of opslag, zodat het met `node --test` te testen is.
// Reducers geven altijd een NIEUWE state terug en laten de oude ongemoeid.

export const SCHEMA_VERSION = 2;

export const READ_STATUS = /** @type {const} */ (['unread', 'reading', 'read']);
export const OWNERSHIP = /** @type {const} */ (['none', 'owned', 'wishlist']);

export const READ_LABELS = { unread: 'Nog niet', reading: 'Bezig', read: 'Gelezen' };
export const OWN_LABELS = { none: 'Niet in bezit', owned: 'In bezit', wishlist: 'Verlanglijst' };

export const FORMATS = {
  trade: 'Trade paperback',
  hardcover: 'Hardcover',
  omnibus: 'Omnibus',
  issue: 'Los nummer',
  overig: 'Anders',
};

export const COLORS = {
  red: '#C8102E',
  blue: '#1747C8',
  yellow: '#FFD23F',
  ink: '#141414',
};

export const PUBLISHERS = ['DC', 'Marvel', 'Image', 'Dark Horse', 'IDW', 'Boom!', 'Anders'];

/**
 * @typedef {{ id: string, series: string, number: string, read: boolean }} Issue
 * @typedef {{
 *   id: string, seriesId: string, title: string, number: string, position: number,
 *   format: keyof typeof FORMATS, isSide: boolean,
 *   readStatus: 'unread'|'reading'|'read', ownership: 'none'|'owned'|'wishlist',
 *   issues: Issue[], note: string, readAt: string|null, createdAt: string, updatedAt: string,
 *   cover: string|null, storeDate: string|null, isNew: boolean, metronId: number|null
 * }} Volume
 * @typedef {{
 *   id: string, title: string, publisher: string, line: string, years: string,
 *   color: keyof typeof COLORS, paused: boolean, createdAt: string, lastActivityAt: string,
 *   updatedAt: string, metron: { id: number, name: string, type: string } | null
 * }} Series
 * @typedef {{
 *   version: number, series: Series[], volumes: Volume[],
 *   deleted: Record<string, string>, releasesCheckedAt: string|null
 * }} State
 * `deleted` onthoudt wat je verwijderd hebt (id → tijdstip), zodat sync het niet terugzet.
 */

// ---------------------------------------------------------------- basis

/** @returns {State} */
export function emptyState() {
  return { version: SCHEMA_VERSION, series: [], volumes: [], deleted: {}, releasesCheckedAt: null };
}

let idCounter = 0;
export function makeId(prefix = 'id') {
  const c = globalThis.crypto;
  const rnd = c && typeof c.randomUUID === 'function'
    ? c.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rnd}`;
}

const nowIso = () => new Date().toISOString();

function isInt(s) {
  return /^\d+$/.test(String(s));
}

function issueKey(i) {
  return `${i.series.trim().toLowerCase()}|${String(i.number).trim().toLowerCase()}`;
}

// ---------------------------------------------------------------- lezen

export function getSeries(state, id) {
  return state.series.find((s) => s.id === id) || null;
}

export function getVolume(state, id) {
  return state.volumes.find((v) => v.id === id) || null;
}

export function sortVolumes(vols) {
  return [...vols].sort(
    (a, b) => a.position - b.position || String(a.createdAt).localeCompare(String(b.createdAt)),
  );
}

export function volumesOf(state, seriesId) {
  return sortVolumes(state.volumes.filter((v) => v.seriesId === seriesId));
}

export function volumeName(v) {
  return v.number ? `Vol. ${v.number}: ${v.title}` : v.title;
}

export function volumeShortName(v) {
  return v.number ? `Vol. ${v.number} · ${v.title}` : v.title;
}

/** Voortgang binnen één volume. Met issues telt per issue, anders het boek als geheel. */
export function volumeProgress(v) {
  if (v.issues && v.issues.length) {
    return { done: v.issues.filter((i) => i.read).length, total: v.issues.length, unit: 'issues' };
  }
  return { done: v.readStatus === 'read' ? 1 : 0, total: 1, unit: 'boek' };
}

export function nextIssue(v) {
  return (v.issues || []).find((i) => !i.read) || null;
}

/**
 * Het volgende deel van een serie (de bladwijzer).
 * 1. Een boek dat je nu leest ("bezig") gaat altijd voor.
 * 2. Anders het eerste ongelezen hoofddeel ná het laatst gelezen hoofddeel.
 * 3. Anders het eerste ongelezen hoofddeel (als je eerder iets oversloeg).
 * Zijverhalen ("tussendoor") tellen niet mee, tenzij je ze aan het lezen bent.
 */
export const KINDS = { main: 'Hoofdverhaal', side: 'Zijverhaal', event: 'Event' };

/**
 * Hoort dit deel bij jouw route? Hoofdverhaal en events altijd; zijverhalen alleen als je ze
 * gelezen hebt, leest, zelf toevoegde ("+ Toch lezen"), of als "Alleen hoofdverhaal" uit staat.
 */
export function inRoute(series, v) {
  if (!v.isSide) return true;
  if (series && series.mainOnly === false) return true;
  return v.inRoute || v.readStatus !== 'unread';
}

export function routeVolumes(state, seriesId) {
  const series = getSeries(state, seriesId);
  return volumesOf(state, seriesId).filter((v) => inRoute(series, v));
}

export function nextUp(state, seriesId) {
  const vols = volumesOf(state, seriesId);
  const reading = vols.find((v) => v.readStatus === 'reading');
  if (reading) return reading;
  const main = routeVolumes(state, seriesId);
  let lastRead = -1;
  main.forEach((v, i) => {
    if (v.readStatus === 'read') lastRead = i;
  });
  return (
    main.slice(lastRead + 1).find((v) => v.readStatus !== 'read') ||
    main.find((v) => v.readStatus !== 'read') ||
    null
  );
}

/** Het deel dat in de reeks direct na dit volume komt (op volgorde). */
export function followingVolume(state, volumeId) {
  const v = getVolume(state, volumeId);
  if (!v) return null;
  const vols = volumesOf(state, v.seriesId);
  const idx = vols.findIndex((x) => x.id === v.id);
  const rest = vols.slice(idx + 1);
  const series = getSeries(state, v.seriesId);
  return rest.find((x) => inRoute(series, x)) || rest[0] || null;
}

export function seriesStats(state, seriesId) {
  const vols = volumesOf(state, seriesId);
  const main = routeVolumes(state, seriesId);
  return {
    total: vols.length,
    main: main.length,
    readMain: main.filter((v) => v.readStatus === 'read').length,
    read: vols.filter((v) => v.readStatus === 'read').length,
    owned: vols.filter((v) => v.ownership === 'owned').length,
    wishlist: vols.filter((v) => v.ownership === 'wishlist').length,
    missing: vols.filter((v) => v.ownership !== 'owned' && v.readStatus !== 'read').length,
  };
}

/** 'paused' | 'done' | 'active' | 'new' */
export function seriesPhase(state, series) {
  if (series.paused) return 'paused';
  const vols = volumesOf(state, series.id);
  const main = routeVolumes(state, series.id);
  if (main.length && main.every((v) => v.readStatus === 'read')) return 'done';
  if (vols.some((v) => v.readStatus !== 'unread')) return 'active';
  return 'new';
}

export const PHASE_LABELS = { paused: 'Op pauze', done: 'Uitgelezen', active: 'Bezig', new: 'Op de stapel' };

function byActivity(a, b) {
  return String(b.lastActivityAt).localeCompare(String(a.lastActivityAt));
}

/** Series voor "Verder lezen": waar je mee bezig bent, laatst gelezen bovenaan. */
export function continueReading(state) {
  return state.series.filter((s) => seriesPhase(state, s) === 'active').sort(byActivity);
}

export function seriesByPhase(state, phase) {
  return state.series.filter((s) => seriesPhase(state, s) === phase).sort(byActivity);
}

export function wishlist(state) {
  return state.volumes.filter((v) => v.ownership === 'wishlist');
}

// ---------------------------------------------------------------- issues parsen

const SPECIAL = /^(annual|special|one-shot|giant-size)\b/i;

/**
 * Leest een issue-lijst zoals je hem op de achterkant van een trade ziet.
 * Voorbeelden:
 *   "#1–8"                                   → #1 t/m #8 van de standaardserie
 *   "#0, #9–12, Annual #1"                   → Annual wordt "<serie> Annual"
 *   "Ultimate Comics X-Men #13–18"           → eigen serienaam (per regel)
 *   "#30–35, Futures End #1"
 * Regels (of ;) mogen verschillende series hebben.
 * @returns {{ issues: Issue[], errors: string[] }}
 */
export function parseIssues(text, defaultSeries = '') {
  const issues = [];
  const errors = [];
  const seen = new Set();
  const add = (series, number) => {
    const issue = { id: makeId('i'), series: series.trim(), number: String(number), read: false };
    const key = issueKey(issue);
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  };

  for (const rawLine of String(text || '').split(/\n|;/)) {
    let lineSeries = defaultSeries.trim();
    const segs = rawLine.split(',').map((s) => s.trim()).filter(Boolean);
    segs.forEach((seg, i) => {
      let prefix;
      let from;
      let to;
      const m = seg.match(/^(.*?)#\s*([\w.]+)\s*(?:[-–—]\s*#?\s*([\w.]+))?$/);
      if (m) {
        [, prefix, from, to] = m;
      } else {
        const bare = seg.match(/^(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+(?:\.\d+)?))?$/);
        if (!bare) {
          errors.push(seg);
          return;
        }
        prefix = '';
        [, from, to] = bare;
      }
      prefix = prefix.trim().replace(/[:\s]+$/, '');
      let series;
      if (!prefix) series = lineSeries;
      else if (i === 0 && !SPECIAL.test(prefix)) {
        lineSeries = prefix;
        series = prefix;
      } else series = lineSeries ? `${lineSeries} ${prefix}` : prefix;

      if (!series) {
        errors.push(seg);
        return;
      }
      if (to !== undefined) {
        if (!isInt(from) || !isInt(to) || Number(to) < Number(from) || Number(to) - Number(from) > 500) {
          errors.push(seg);
          return;
        }
        for (let n = Number(from); n <= Number(to); n += 1) add(series, n);
      } else {
        add(series, from);
      }
    });
  }
  return { issues, errors };
}

/**
 * Compacte weergave, bijv. "#1–8, Annual #1" of "X-Men #13–18".
 * Serienamen die met `context` beginnen worden ingekort.
 */
export function formatIssues(issues, context = '') {
  if (!issues || !issues.length) return '';
  const groups = new Map();
  for (const i of issues) {
    if (!groups.has(i.series)) groups.set(i.series, []);
    groups.get(i.series).push(String(i.number));
  }
  const ctx = context.trim().toLowerCase();
  const parts = [];
  for (const [series, numbers] of groups) {
    let label = series;
    const low = series.toLowerCase();
    if (ctx && low === ctx) label = '';
    else if (ctx && low.startsWith(`${ctx} `)) label = series.slice(ctx.length + 1);
    const chunks = [];
    let runStart = null;
    let prev = null;
    const flush = () => {
      if (runStart === null) return;
      chunks.push(runStart === prev ? `#${runStart}` : `#${runStart}–${prev}`);
      runStart = null;
      prev = null;
    };
    for (const n of numbers) {
      if (isInt(n) && prev !== null && isInt(prev) && Number(n) === Number(prev) + 1) {
        prev = n;
      } else {
        flush();
        if (isInt(n)) {
          runStart = n;
          prev = n;
        } else chunks.push(`#${n}`);
      }
    }
    flush();
    parts.push(label ? `${label} ${chunks.join(', ')}` : chunks.join(', '));
  }
  return parts.join(', ');
}

/** Groepeert issues per serienaam, in de volgorde waarin ze voorkomen. */
export function groupIssues(issues) {
  const groups = [];
  const idx = new Map();
  for (const i of issues || []) {
    if (!idx.has(i.series)) {
      idx.set(i.series, groups.length);
      groups.push({ series: i.series, issues: [] });
    }
    groups[idx.get(i.series)].issues.push(i);
  }
  return groups;
}

/**
 * Tekst voor het invulveld bij "Bewerken": één regel per serie,
 * zo dat parseIssues(issuesToText(x, ctx), ctx) weer precies x oplevert.
 */
export function issuesToText(issues, context = '') {
  return groupIssues(issues)
    .map((g) => {
      const nums = formatIssues(g.issues.map((i) => ({ ...i, series: '' })), '');
      return g.series === context.trim() ? nums : `${g.series} ${nums}`;
    })
    .join('\n');
}

/** Nieuwe issue-lijst die de gelezen-vinkjes en ids van de oude overneemt. */
export function mergeIssues(oldIssues, freshIssues) {
  const old = new Map((oldIssues || []).map((i) => [issueKey(i), i]));
  return freshIssues.map((i) => {
    const prev = old.get(issueKey(i));
    return prev ? { ...i, id: prev.id, read: prev.read } : i;
  });
}

// ---------------------------------------------------------------- reducers

function touchSeries(state, seriesId, now, extra = {}) {
  return state.series.map((s) => (s.id === seriesId ? { ...s, lastActivityAt: now, updatedAt: now, ...extra } : s));
}

function withDeleted(state, ids, now) {
  const deleted = { ...(state.deleted || {}) };
  for (const id of ids) deleted[id] = now;
  return deleted;
}

function replaceVolume(state, v) {
  return { ...state, volumes: state.volumes.map((x) => (x.id === v.id ? v : x)) };
}

function cleanMetronSeries(m) {
  if (!m || !Number.isFinite(Number(m.id))) return null;
  return {
    id: Number(m.id),
    name: String(m.name || ''),
    type: String(m.type || ''),
    linkedAt: typeof m.linkedAt === 'string' ? m.linkedAt : null,
    source: m.source === 'comicvine' ? 'comicvine' : 'metron',
    // Bij een verzamelserie: korte reeksnaam voor de titels ("Ultimates Vol. 1: …").
    umbrella: typeof m.umbrella === 'string' ? m.umbrella : '',
  };
}

function cleanSeriesData(data) {
  const color = data.color in COLORS ? data.color : 'red';
  return {
    title: String(data.title || '').trim(),
    publisher: String(data.publisher || '').trim(),
    line: String(data.line || '').trim(),
    years: String(data.years || '').trim(),
    color,
    metron: cleanMetronSeries(data.metron),
    links: Array.isArray(data.links) ? data.links.map(cleanMetronSeries).filter(Boolean) : [],
    mainOnly: data.mainOnly !== false,
  };
}

export function addSeries(state, data, now = nowIso()) {
  const clean = cleanSeriesData(data);
  if (!clean.title) throw new Error('Een serie heeft een titel nodig.');
  const series = { id: makeId('s'), ...clean, paused: false, createdAt: now, lastActivityAt: now, updatedAt: now };
  return { state: { ...state, series: [...state.series, series] }, id: series.id };
}

export function updateSeries(state, id, data, now = nowIso()) {
  const current = getSeries(state, id);
  if (!current) return state;
  const clean = cleanSeriesData({ ...current, ...data });
  if (!clean.title) throw new Error('Een serie heeft een titel nodig.');
  return { ...state, series: state.series.map((s) => (s.id === id ? { ...s, ...clean, updatedAt: now } : s)) };
}

export function deleteSeries(state, id, now = nowIso()) {
  const volumeIds = state.volumes.filter((v) => v.seriesId === id).map((v) => v.id);
  return {
    ...state,
    series: state.series.filter((s) => s.id !== id),
    volumes: state.volumes.filter((v) => v.seriesId !== id),
    deleted: withDeleted(state, [id, ...volumeIds], now),
  };
}

export function setPaused(state, id, paused, now = nowIso()) {
  // Pauzeren is geen lezen: de volgorde op Home blijft gelijk.
  return {
    ...state,
    series: state.series.map((s) => (s.id === id ? { ...s, paused: !!paused, updatedAt: now } : s)),
  };
}

function cleanUrl(u) {
  return typeof u === 'string' && /^https:\/\//.test(u) ? u : null;
}

function cleanDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

function cleanVolumeData(data) {
  const position = Number(data.position);
  const metronId = Number(data.metronId);
  return {
    seriesId: data.seriesId,
    title: String(data.title || '').trim(),
    number: String(data.number ?? '').trim(),
    position: Number.isFinite(position) ? position : 0,
    format: data.format in FORMATS ? data.format : 'trade',
    kind: data.kind in KINDS ? data.kind : data.isSide ? 'side' : 'main',
    isSide: data.kind in KINDS ? data.kind === 'side' : !!data.isSide,
    inRoute: !!data.inRoute,
    linkKey: typeof data.linkKey === 'string' ? data.linkKey : null,
    ownership: OWNERSHIP.includes(data.ownership) ? data.ownership : 'none',
    note: String(data.note || '').trim(),
    cover: cleanUrl(data.cover),
    storeDate: cleanDate(data.storeDate),
    isNew: !!data.isNew,
    // Bewaard zodat een koppeling later netjes ongedaan kan worden.
    fromMetron: !!data.fromMetron,
    preMetron: data.preMetron && typeof data.preMetron === 'object'
      ? { format: data.preMetron.format in FORMATS ? data.preMetron.format : 'trade', cover: cleanUrl(data.preMetron.cover), storeDate: cleanDate(data.preMetron.storeDate) }
      : null,
    metronId: data.metronId != null && Number.isFinite(metronId) ? metronId : null,
  };
}

/** Plek voor een nieuw deel: achteraan de reeks. */
export function nextPosition(state, seriesId) {
  const vols = state.volumes.filter((v) => v.seriesId === seriesId);
  return vols.length ? Math.floor(Math.max(...vols.map((v) => v.position))) + 1 : 1;
}

export function addVolume(state, data, now = nowIso()) {
  const clean = cleanVolumeData(data);
  if (!clean.title) throw new Error('Een volume heeft een titel nodig.');
  if (!getSeries(state, clean.seriesId)) throw new Error('Kies een serie.');
  const volume = {
    id: makeId('v'),
    ...clean,
    readStatus: 'unread',
    issues: data.issues || [],
    readAt: null,
    createdAt: now,
    updatedAt: now,
  };
  let next = { ...state, volumes: [...state.volumes, volume] };
  const status = READ_STATUS.includes(data.readStatus) ? data.readStatus : 'unread';
  if (status !== 'unread') next = setReadStatus(next, volume.id, status, now);
  return { state: next, id: volume.id };
}

export function updateVolume(state, id, data, now = nowIso()) {
  const v = getVolume(state, id);
  if (!v) return state;
  const clean = cleanVolumeData({ ...v, ...data });
  if (!clean.title) throw new Error('Een volume heeft een titel nodig.');
  if (!getSeries(state, clean.seriesId)) throw new Error('Kies een serie.');
  const issues = data.issues ? mergeIssues(v.issues, data.issues) : v.issues;
  let next = replaceVolume(state, { ...v, ...clean, issues, updatedAt: now });
  if (data.issues) next = syncStatusFromIssues(next, id, now);
  if (data.readStatus && data.readStatus !== getVolume(next, id).readStatus) {
    next = setReadStatus(next, id, data.readStatus, now);
  }
  return next;
}

export function deleteVolume(state, id, now = nowIso()) {
  return { ...state, volumes: state.volumes.filter((v) => v.id !== id), deleted: withDeleted(state, [id], now) };
}

/** Haalt het "nieuw"-label weg (na bekijken). */
export function markSeen(state, id, now = nowIso()) {
  const v = getVolume(state, id);
  if (!v || !v.isNew) return state;
  return replaceVolume(state, { ...v, isNew: false, updatedAt: now });
}

export function setOwnership(state, id, ownership, now = nowIso()) {
  const v = getVolume(state, id);
  if (!v || !OWNERSHIP.includes(ownership)) return state;
  return replaceVolume(state, { ...v, ownership, updatedAt: now });
}

/** Zet de leesstatus van een heel boek. "Gelezen" vinkt alle issues aan, "Nog niet" alles uit. */
export function setReadStatus(state, id, status, now = nowIso()) {
  const v = getVolume(state, id);
  if (!v || !READ_STATUS.includes(status)) return state;
  let issues = v.issues;
  if (status === 'read') issues = issues.map((i) => ({ ...i, read: true }));
  if (status === 'unread') issues = issues.map((i) => ({ ...i, read: false }));
  const updated = {
    ...v,
    readStatus: status,
    issues,
    readAt: status === 'read' ? v.readAt || now : null,
    updatedAt: now,
  };
  const next = replaceVolume(state, updated);
  // Lezen in een serie op pauze = hervatten.
  const extra = status === 'unread' ? {} : { paused: false };
  return { ...next, series: touchSeries(next, v.seriesId, now, extra) };
}

function syncStatusFromIssues(state, id, now) {
  const v = getVolume(state, id);
  if (!v || !v.issues.length) return state;
  const done = v.issues.filter((i) => i.read).length;
  let status;
  if (done === v.issues.length) status = 'read';
  else if (done > 0) status = 'reading';
  else status = v.readStatus === 'read' ? 'unread' : v.readStatus;
  if (status === v.readStatus) return state;
  return replaceVolume(state, {
    ...v,
    readStatus: status,
    readAt: status === 'read' ? v.readAt || now : null,
  });
}

/** Vinkt één issue aan of uit; de status van het boek volgt automatisch. */
export function setIssueRead(state, volumeId, issueId, read, now = nowIso()) {
  const v = getVolume(state, volumeId);
  if (!v) return state;
  const issues = v.issues.map((i) => (i.id === issueId ? { ...i, read: !!read } : i));
  let next = replaceVolume(state, { ...v, issues, updatedAt: now });
  next = syncStatusFromIssues(next, volumeId, now);
  const extra = read ? { paused: false } : {};
  return { ...next, series: touchSeries(next, v.seriesId, now, extra) };
}

/** "Uit!" – markeert het volgende deel van een serie als gelezen. */
export function markNextRead(state, seriesId, now = nowIso()) {
  const v = nextUp(state, seriesId);
  if (!v) return { state, id: null };
  return { state: setReadStatus(state, v.id, 'read', now), id: v.id };
}

// ---------------------------------------------------------------- import / controle

/** Controleert en vult een (geïmporteerde) state aan. Gooit een fout bij onbruikbare data. */
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.series) || !Array.isArray(raw.volumes)) {
    throw new Error('Dit is geen Freaking Comics-back-up.');
  }
  if (typeof raw.version === 'number' && raw.version > SCHEMA_VERSION) {
    throw new Error('Deze back-up komt uit een nieuwere versie van de app.');
  }
  const now = nowIso();
  const series = raw.series
    .filter((s) => s && typeof s.id === 'string' && s.title)
    .map((s) => ({
      id: s.id,
      ...cleanSeriesData(s),
      paused: !!s.paused,
      createdAt: s.createdAt || now,
      lastActivityAt: s.lastActivityAt || s.createdAt || now,
      updatedAt: s.updatedAt || s.lastActivityAt || s.createdAt || now,
    }));
  const ids = new Set(series.map((s) => s.id));
  const volumes = raw.volumes
    .filter((v) => v && typeof v.id === 'string' && v.title && ids.has(v.seriesId))
    .map((v) => ({
      id: v.id,
      ...cleanVolumeData(v),
      readStatus: READ_STATUS.includes(v.readStatus) ? v.readStatus : 'unread',
      issues: Array.isArray(v.issues)
        ? v.issues
            .filter((i) => i && i.series && i.number !== undefined)
            .map((i) => ({ id: i.id || makeId('i'), series: String(i.series), number: String(i.number), read: !!i.read }))
        : [],
      readAt: v.readAt || null,
      createdAt: v.createdAt || now,
      updatedAt: v.updatedAt || now,
    }));
  const deleted = {};
  if (raw.deleted && typeof raw.deleted === 'object') {
    for (const [id, t] of Object.entries(raw.deleted)) if (typeof t === 'string') deleted[id] = t;
  }
  return {
    version: SCHEMA_VERSION,
    series,
    volumes,
    deleted,
    releasesCheckedAt: typeof raw.releasesCheckedAt === 'string' ? raw.releasesCheckedAt : null,
  };
}

// ---------------------------------------------------------------- sync

const TOMBSTONE_DAYS = 365;

function newer(a, b) {
  return String(a || '') > String(b || '');
}

/**
 * Voegt twee versies van je kast samen (bijv. telefoon en server).
 * Per serie en per volume wint de laatst gewijzigde versie; bij gelijke tijd wint `b`.
 * Wat verwijderd is blijft weg, tenzij het daarna nog is aangepast.
 */
export function mergeStates(a, b, now = nowIso()) {
  const A = normalizeState(a);
  const B = normalizeState(b);

  const deleted = { ...A.deleted };
  for (const [id, t] of Object.entries(B.deleted)) {
    if (!deleted[id] || newer(t, deleted[id])) deleted[id] = t;
  }
  const cutoff = new Date(Date.parse(now) - TOMBSTONE_DAYS * 864e5).toISOString();
  for (const [id, t] of Object.entries(deleted)) if (t < cutoff) delete deleted[id];

  const pick = (listA, listB) => {
    const map = new Map(listA.map((x) => [x.id, x]));
    for (const x of listB) {
      const cur = map.get(x.id);
      if (!cur || !newer(cur.updatedAt, x.updatedAt)) map.set(x.id, x);
    }
    return [...map.values()].filter((x) => !deleted[x.id] || newer(x.updatedAt, deleted[x.id]));
  };

  const series = pick(A.series, B.series);
  const seriesIds = new Set(series.map((s) => s.id));
  const volumes = pick(A.volumes, B.volumes).filter((v) => seriesIds.has(v.seriesId));
  const checked = [A.releasesCheckedAt, B.releasesCheckedAt].filter(Boolean).sort().pop() || null;

  return { version: SCHEMA_VERSION, series, volumes, deleted, releasesCheckedAt: checked };
}

/** Vergelijkt twee states op inhoud (volgorde maakt niet uit). */
export function sameState(a, b) {
  const key = (s) =>
    JSON.stringify({
      series: [...s.series].sort((x, y) => x.id.localeCompare(y.id)),
      volumes: [...s.volumes].sort((x, y) => x.id.localeCompare(y.id)),
      deleted: Object.keys(s.deleted || {}).sort().map((k) => [k, s.deleted[k]]),
      releasesCheckedAt: s.releasesCheckedAt || null,
    });
  return key(a) === key(b);
}

// ---------------------------------------------------------------- Metron

const METRON_FORMATS = {
  'trade paperback': 'trade',
  hardcover: 'hardcover',
  'hard cover': 'hardcover',
  omnibus: 'omnibus',
  'graphic novel': 'overig',
};

export function formatFromMetronType(type) {
  const t = String(type || '').toLowerCase();
  if (t in METRON_FORMATS) return METRON_FORMATS[t];
  if (!t) return 'overig';
  return 'issue';
}

export function isCollectedType(type) {
  return ['trade', 'hardcover', 'omnibus'].includes(formatFromMetronType(type)) || /graphic novel/i.test(type || '');
}

/** "The Flash TPB (2012)" → { name: "The Flash", year: "2012" } */
export function splitMetronSeriesName(str) {
  const m = String(str || '').trim().match(/^(.*?)(?:\s+(?:TPB|HC|GN))?\s*\((\d{4})\)(?:\s+Digital)?$/);
  if (m) return { name: m[1].trim(), year: m[2] };
  return { name: String(str || '').trim(), year: '' };
}

/** "Ultimate Comics X-Men (2011) #13" → { series: "Ultimate Comics X-Men", number: "13" } */
export function parseReprint(str) {
  const m = String(str || '').match(/^(.*?)\s*(?:Chapter\s*)?#\s*([^\s#]+)\s*$/);
  if (!m) return null;
  return { series: splitMetronSeriesName(m[1]).name, number: m[2] };
}

function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/^vol(ume)?\.?\s*\d+\s*[:·-]?\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameNumber(a, b) {
  if (!a || !b) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Zet Metron-issues (volumes) om naar gegevens voor een volume.
 * `item` mag een lijst-item of een detail zijn: { id, number, title?, image?, store_date?, cover_date?, reprints? }
 */
export function volumeDataFromMetron(item, format) {
  const issues = (item.reprints || [])
    .map((r) => parseReprint(r.issue))
    .filter(Boolean)
    .map((r) => ({ id: makeId('i'), series: r.series, number: r.number, read: false }));
  const fallbackName = item.issue ? splitMetronSeriesName(String(item.issue).replace(/\s*#.*$/, '')).name : '';
  const title =
    String(item.title || '').trim() ||
    (Array.isArray(item.name) && item.name.filter(Boolean).join(' / ')) ||
    (format === 'issue' && fallbackName ? `${fallbackName} #${item.number}` : '') ||
    `Deel ${item.number}`;
  return {
    title,
    number: String(item.number || ''),
    cover: cleanUrl(item.image),
    storeDate: cleanDate(item.store_date) || cleanDate(item.cover_date),
    metronId: Number(item.id),
    issues,
    format,
  };
}

/**
 * Past een Metron-serie toe op een serie in je kast: koppelt bestaande delen (op Metron-id,
 * deelnummer of titel), vult covers, datums en issues aan, en voegt ontbrekende delen toe.
 * Leesstatus, bezit, notities en gelezen issues blijven altijd van jou.
 * @param {object} opts { markNew: nieuwe delen krijgen het label "nieuw" }
 * @returns {{ state, added: string[], updated: string[] }}
 */
export function applyMetronItems(state, seriesId, items, format, { markNew = false, now = nowIso(), linkKey = null, umbrella = '' } = {}) {
  let next = state;
  const added = [];
  const updated = [];
  const sorted = [...items].sort((a, b) => {
    const na = Number(a.number);
    const nb = Number(b.number);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.number).localeCompare(String(b.number));
  });

  const keysOf = (issues) => new Set((issues || []).map(issueKey));
  const untouchedGeneric = (v) => v.metronId == null && v.readStatus === 'unread' && v.ownership === 'none' && !v.note && !v.linkKey;
  const coveredGenerics = new Map(); // id → Set van issues die door nieuwe delen gedekt zijn
  let slot = 0;

  for (const item of sorted) {
    const data = volumeDataFromMetron(item, format);
    let insertAt = null;
    if (umbrella && data.issues.length) {
      const mine = keysOf(data.issues);
      const vols0 = volumesOf(next, seriesId).filter((v) => v.linkKey !== linkKey || !linkKey);
      // Staat de inhoud al in je kast (bijv. in een hardcover die meer bundelt)? Dan niet dubbel toevoegen.
      const already = vols0.find((v) => v.metronId !== data.metronId && !untouchedGeneric(v) && v.issues.length && [...mine].every((k) => keysOf(v.issues).has(k)));
      if (already && !vols0.some((v) => v.metronId === data.metronId)) continue;
      // Een algemeen deel uit de leesroute ("X-Men Vol. 1–2") maakt plaats voor de echte delen.
      const generic = vols0.find((v) => untouchedGeneric(v) && v.issues.some((i) => mine.has(issueKey(i))));
      if (generic) {
        slot += 1;
        insertAt = generic.position + slot / 100;
        const cov = coveredGenerics.get(generic.id) || new Set();
        for (const k of mine) cov.add(k);
        coveredGenerics.set(generic.id, cov);
      }
    }
    if (umbrella) {
      // In een verzamelserie met meerdere reeksen: titel met reeksnaam, zonder los deelnummer.
      const t = String(item.title || '').trim();
      data.title = t ? `${umbrella} Vol. ${data.number}: ${t}` : `${umbrella} #${data.number}`;
      data.number = '';
    }
    const vols = volumesOf(next, seriesId);
    const sameLink = (v) => !linkKey || !v.linkKey || v.linkKey === linkKey;
    const match =
      vols.find((v) => v.metronId === data.metronId && sameLink(v)) ||
      vols.find((v) => v.metronId == null && !v.isSide && sameNumber(v.number, data.number)) ||
      vols.find((v) => v.metronId == null && data.title && normTitle(v.title) === normTitle(data.title));

    if (match) {
      const patch = {
        preMetron: match.preMetron || (match.metronId == null ? { format: match.format, cover: match.cover, storeDate: match.storeDate } : null),
        linkKey: linkKey || match.linkKey || null,
        metronId: data.metronId,
        cover: data.cover || match.cover,
        storeDate: data.storeDate || match.storeDate,
        number: match.number || data.number,
        title: item.title ? data.title : match.title,
        format: match.metronId == null && match.format === 'trade' ? data.format : match.format,
      };
      let issues = data.issues.length ? mergeIssues(match.issues, data.issues) : match.issues;
      // Een boek dat al uit is: dan heb je alle issues erin ook gelezen.
      if (match.readStatus === 'read') issues = issues.map((i) => (i.read ? i : { ...i, read: true }));
      const changed =
        patch.metronId !== match.metronId ||
        patch.linkKey !== match.linkKey ||
        patch.cover !== match.cover ||
        patch.storeDate !== match.storeDate ||
        patch.title !== match.title ||
        patch.number !== match.number ||
        patch.format !== match.format ||
        JSON.stringify(issues.map((i) => [i.series, i.number])) !== JSON.stringify(match.issues.map((i) => [i.series, i.number]));
      if (changed) {
        next = replaceVolume(next, { ...match, ...patch, issues, updatedAt: now });
        next = syncStatusFromIssues(next, match.id, now);
        updated.push(match.id);
      }
      continue;
    }

    const num = Number(data.number);
    const position = insertAt != null
      ? insertAt
      : !umbrella && Number.isFinite(num) && data.number !== '' && !vols.some((v) => v.position === num) ? num : nextPosition(next, seriesId);
    const r = addVolume(next, { ...data, seriesId, position, isNew: markNew, fromMetron: true, linkKey }, now);
    next = r.state;
    added.push(r.id);
  }
  // Algemene routedelen die nu helemaal door echte delen gedekt zijn, verdwijnen.
  for (const [id, cov] of coveredGenerics) {
    const v = getVolume(next, id);
    if (v && v.issues.every((i) => cov.has(issueKey(i)))) {
      next = { ...next, volumes: next.volumes.filter((x) => x.id !== id), deleted: withDeleted(next, [id], now) };
    }
  }
  return { state: next, added, updated };
}

/** Delen met een verschijningsdatum in de toekomst. */
export function upcoming(state, today = new Date().toISOString().slice(0, 10)) {
  return state.volumes
    .filter((v) => v.storeDate && v.storeDate > today)
    .sort((a, b) => a.storeDate.localeCompare(b.storeDate));
}

export function newVolumes(state) {
  return state.volumes.filter((v) => v.isNew);
}

export function isReleased(v, today = new Date().toISOString().slice(0, 10)) {
  return !v.storeDate || v.storeDate <= today;
}

/** Koppelt één los boek aan een Metron-issue (bijv. een hardcover die niet in een reeks zit). */
export function linkVolumeToMetron(state, volumeId, item, format, now = nowIso()) {
  const v = getVolume(state, volumeId);
  if (!v) return state;
  const data = volumeDataFromMetron(item, format);
  let issues = data.issues.length ? mergeIssues(v.issues, data.issues) : v.issues;
  if (v.readStatus === 'read') issues = issues.map((i) => (i.read ? i : { ...i, read: true }));
  let next = replaceVolume(state, {
    ...v,
    metronId: data.metronId,
    cover: data.cover || v.cover,
    storeDate: data.storeDate || v.storeDate,
    format: data.format || v.format,
    title: v.title || data.title,
    issues,
    updatedAt: now,
  });
  next = syncStatusFromIssues(next, volumeId, now);
  return next;
}

/** Nette uitgevernaam uit Metron ("DC Comics" → "DC"). */
export function publisherFromMetron(name) {
  const n = String(name || '').trim();
  if (/^dc\b/i.test(n)) return 'DC';
  if (/^marvel/i.test(n)) return 'Marvel';
  if (/^image/i.test(n)) return 'Image';
  if (/^dark horse/i.test(n)) return 'Dark Horse';
  if (/^idw/i.test(n)) return 'IDW';
  if (/^boom/i.test(n)) return 'Boom!';
  return n;
}

/**
 * Maakt van `target` de nieuwe kast op een manier die sync begrijpt (voor ongedaan maken,
 * back-up terugzetten, alles wissen): teruggezette records krijgen een nieuwe tijd,
 * en wat weg moet krijgt een verwijder-markering.
 */
export function adoptState(current, target, now = nowIso()) {
  const cur = normalizeState(current);
  const tgt = normalizeState(target);
  const deleted = { ...cur.deleted };
  const bump = (curList, tgtList) => {
    const byId = new Map(curList.map((x) => [x.id, x]));
    const keep = new Set(tgtList.map((x) => x.id));
    for (const x of curList) if (!keep.has(x.id)) deleted[x.id] = now;
    return tgtList.map((x) => {
      delete deleted[x.id];
      const c = byId.get(x.id);
      return c && JSON.stringify(c) === JSON.stringify(x) ? x : { ...x, updatedAt: now };
    });
  };
  return {
    ...tgt,
    series: bump(cur.series, tgt.series),
    volumes: bump(cur.volumes, tgt.volumes),
    deleted,
    releasesCheckedAt: cur.releasesCheckedAt || tgt.releasesCheckedAt,
  };
}

/**
 * Maakt een Metron-koppeling ongedaan: haalt de delen weg die Metron heeft toegevoegd en die je
 * niet hebt aangeraakt, en zet je eigen delen terug (formaat, cover, datum).
 * Delen die je las, bezit, op je verlanglijst zette of van een notitie voorzag blijven altijd staan.
 */
export function planUnlink(state, seriesId, linkKey = null) {
  const series = getSeries(state, seriesId);
  if (!series) return { remove: [], restore: [] };
  const primaryKey = linkKeyOf(series.metron);
  // Per reeks: alleen de delen van die reeks (oude delen zonder markering horen bij de eerste koppeling).
  const ofLink = (v) => !linkKey || v.linkKey === linkKey || (!v.linkKey && linkKey === primaryKey);
  const vols = volumesOf(state, seriesId).filter(ofLink);
  const untouched = (v) => v.readStatus === 'unread' && v.ownership === 'none' && !v.note && !v.issues.some((i) => i.read);
  // Oudere koppelingen (zonder fromMetron-markering): alles wat na je laatste leesactie is aangemaakt.
  const cutoff = series.metron?.linkedAt || series.lastActivityAt;
  const added = (v) => v.fromMetron || (v.metronId != null && !v.preMetron && String(v.createdAt) > String(cutoff));
  const remove = vols.filter((v) => added(v) && untouched(v)).map((v) => v.id);
  const restore = vols.filter((v) => v.metronId != null && !remove.includes(v.id)).map((v) => v.id);
  return { remove, restore };
}

export function unlinkMetron(state, seriesId, now = nowIso(), linkKey = null) {
  const { remove, restore } = planUnlink(state, seriesId, linkKey);
  const gone = new Set(remove);
  const volumes = state.volumes
    .filter((v) => !gone.has(v.id))
    .map((v) => {
      if (!restore.includes(v.id)) return v;
      const pre = v.preMetron || { format: v.format === 'issue' ? 'trade' : v.format, cover: null, storeDate: null };
      return { ...v, metronId: null, cover: pre.cover, storeDate: pre.storeDate, format: pre.format, preMetron: null, fromMetron: false, isNew: false, linkKey: null, updatedAt: now };
    });
  const unlinkSeries = (s) => {
    if (!linkKey) return { ...s, metron: null, links: [], updatedAt: now };
    const rest = seriesLinks(s).filter((l) => linkKeyOf(l) !== linkKey);
    return { ...s, metron: rest[0] || null, links: rest.slice(1), updatedAt: now };
  };
  return {
    ...state,
    volumes,
    series: state.series.map((s) => (s.id === seriesId ? unlinkSeries(s) : s)),
    deleted: withDeleted(state, remove, now),
  };
}

export const SOURCE_LABELS = { metron: 'Metron', comicvine: 'Comic Vine' };

/** Formaat voor delen uit een bron zonder serietype (Comic Vine): wat de serie al het meest heeft, anders trade. */
export function formatForSource(state, seriesId, source, metronType) {
  if (source !== 'comicvine') return formatFromMetronType(metronType);
  const counts = {};
  for (const v of volumesOf(state, seriesId)) if (v.format !== 'issue') counts[v.format] = (counts[v.format] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'trade';
}

// ---------------------------------------------------------------- leesroute

export function setVolumeKind(state, id, kind, now = nowIso()) {
  const v = getVolume(state, id);
  if (!v || !(kind in KINDS)) return state;
  return replaceVolume(state, { ...v, kind, isSide: kind === 'side', updatedAt: now });
}

/** "+ Toch lezen" / weghalen uit je route (alleen voor zijverhalen). */
export function setInRoute(state, id, on, now = nowIso()) {
  const v = getVolume(state, id);
  if (!v) return state;
  return replaceVolume(state, { ...v, inRoute: !!on, updatedAt: now });
}

export function setMainOnly(state, seriesId, on, now = nowIso()) {
  return { ...state, series: state.series.map((s) => (s.id === seriesId ? { ...s, mainOnly: !!on, updatedAt: now } : s)) };
}

/** Schuift een deel één plek omhoog (-1) of omlaag (+1) in de volgorde. */
export function moveVolume(state, id, dir, now = nowIso()) {
  const v = getVolume(state, id);
  if (!v) return state;
  const vols = volumesOf(state, v.seriesId);
  const i = vols.findIndex((x) => x.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= vols.length) return state;
  // Hernummer netjes 1..n en wissel de twee.
  const order = vols.map((x) => x.id);
  [order[i], order[j]] = [order[j], order[i]];
  const pos = new Map(order.map((vid, k) => [vid, k + 1]));
  return {
    ...state,
    volumes: state.volumes.map((x) => (pos.has(x.id) && x.position !== pos.get(x.id) ? { ...x, position: pos.get(x.id), updatedAt: now } : x)),
  };
}

/**
 * De Ultimate Comics-leesroute (2011–2014), van Ultimate Fallout tot Cataclysm.
 * `match` herkent delen die al in je kast staan.
 */
export const ULTIMATE_ROUTE = [
  { title: 'Ultimate Fallout', kind: 'event', issues: 'Ultimate Fallout #1–6', match: /fallout/ },
  { title: 'Ultimate Comics Spider-Man Vol. 1–2', kind: 'main', issues: 'Ultimate Comics Spider-Man #1–12', match: /spider-man(?!.*divided)(?!\s*#?1[3-8])/ },
  { title: 'Ultimate Comics Hawkeye', kind: 'side', issues: 'Ultimate Comics Hawkeye #1–4', match: /hawkeye/ },
  { title: 'Ultimate Comics Ultimates by Jonathan Hickman Vol. 1–2', kind: 'main', issues: 'Ultimate Comics Ultimates #1–12', match: /hickman|ultimates (by|vol)/ },
  { title: 'Ultimate Comics X-Men Vol. 1–2', kind: 'main', issues: 'Ultimate Comics X-Men #1–12', match: /x-men(?!.*divided)/ },
  { title: 'Spider-Men', kind: 'side', issues: 'Spider-Men #1–5', note: 'Crossover met het gewone Marvel-universum.', match: /^spider-men/ },
  { title: 'Divided We Fall, United We Stand', kind: 'event', issues: 'Ultimate Comics Ultimates #13–18\nUltimate Comics X-Men #13–18\nUltimate Comics Spider-Man #13–18', match: /divided we fall/ },
  { title: 'Ultimate Comics Iron Man', kind: 'side', issues: 'Ultimate Comics Iron Man #1–4', match: /iron man/ },
  { title: 'Ultimate Comics Wolverine', kind: 'side', issues: 'Ultimate Comics Wolverine #1–4', match: /wolverine/ },
  { title: 'Ultimates, X-Men en Spider-Man vanaf #19', kind: 'main', issues: 'Ultimate Comics Ultimates #19–30\nUltimate Comics X-Men #19–33\nUltimate Comics Spider-Man #19–28', match: /vanaf #?19|#19/ },
  { title: 'Hunger', kind: 'side', issues: 'Hunger #1–4', note: 'Aanloop naar Cataclysm.', match: /^hunger/ },
  { title: 'Cataclysm: The Ultimates\' Last Stand', kind: 'event', issues: 'Cataclysm: The Ultimates\' Last Stand #1–5', match: /cataclysm/ },
];

/**
 * Vult een serie aan met een leesroute: bestaande delen worden herkend en op hun plek gezet
 * (je leesstatus blijft), ontbrekende delen worden toegevoegd. Delen die niet in de route staan
 * komen erachter.
 */
export function applyRouteTemplate(state, seriesId, template, now = nowIso()) {
  let next = state;
  const used = new Set();
  const order = [];
  let added = 0;
  for (const entry of template) {
    const vols = volumesOf(next, seriesId);
    const found = vols.find((v) => !used.has(v.id) && entry.match.test(v.title.toLowerCase()));
    if (found) {
      used.add(found.id);
      order.push(found.id);
      let patched = { ...found, kind: entry.kind, isSide: entry.kind === 'side', updatedAt: now };
      if (!found.issues.length) {
        const { issues } = parseIssues(entry.issues, '');
        patched = { ...patched, issues: found.readStatus === 'read' ? issues.map((i) => ({ ...i, read: true })) : issues };
      }
      next = replaceVolume(next, patched);
      continue;
    }
    const r = addVolume(next, {
      seriesId,
      title: entry.title,
      number: '',
      position: 0,
      format: 'trade',
      kind: entry.kind,
      issues: parseIssues(entry.issues, '').issues,
      note: entry.note || '',
    }, now);
    next = r.state;
    used.add(r.id);
    order.push(r.id);
    added += 1;
  }
  for (const v of volumesOf(next, seriesId)) if (!used.has(v.id)) order.push(v.id);
  const pos = new Map(order.map((id, k) => [id, k + 1]));
  next = {
    ...next,
    volumes: next.volumes.map((v) => (pos.has(v.id) && v.position !== pos.get(v.id) ? { ...v, position: pos.get(v.id), updatedAt: now } : v)),
  };
  return { state: next, added, matched: used.size - added };
}

// ---------------------------------------------------------------- meerdere reeksen per serie

export function linkKeyOf(link) {
  return link ? `${link.source || 'metron'}:${link.id}` : null;
}

/** Alle online reeksen van een serie (de eerste koppeling plus extra reeksen). */
export function seriesLinks(series) {
  const out = [];
  const seen = new Set();
  for (const l of [series?.metron, ...(series?.links || [])]) {
    if (!l) continue;
    const k = linkKeyOf(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** Voegt een extra reeks toe aan een serie (of maakt hem de eerste als er nog geen is). */
export function addLink(state, seriesId, link, now = nowIso()) {
  const s = getSeries(state, seriesId);
  if (!s) return state;
  const clean = cleanMetronSeries(link);
  if (seriesLinks(s).some((l) => linkKeyOf(l) === linkKeyOf(clean))) return state;
  const patch = s.metron ? { links: [...(s.links || []), clean] } : { metron: clean };
  return { ...state, series: state.series.map((x) => (x.id === seriesId ? { ...x, ...patch, updatedAt: now } : x)) };
}

/** Voegt één boek uit een online bron toe aan een serie (via "+ Volume" → Zoek online). */
export function addVolumeFromSource(state, seriesId, item, format, { reeksName = '', now = nowIso() } = {}) {
  const data = volumeDataFromMetron(item, format);
  const title = String(item.title || '').trim() || (reeksName ? (data.number && data.number !== '1' ? `${reeksName} #${data.number}` : reeksName) : data.title);
  return addVolume(state, { ...data, title, number: '', seriesId, position: nextPosition(state, seriesId) }, now);
}
