// Freaking Comics – datamodel en pure logica.
// Alles hier is zonder DOM of opslag, zodat het met `node --test` te testen is.
// Reducers geven altijd een NIEUWE state terug en laten de oude ongemoeid.

export const SCHEMA_VERSION = 1;

export const READ_STATUS = /** @type {const} */ (['unread', 'reading', 'read']);
export const OWNERSHIP = /** @type {const} */ (['none', 'owned', 'wishlist']);

export const READ_LABELS = { unread: 'Nog niet', reading: 'Bezig', read: 'Gelezen' };
export const OWN_LABELS = { none: 'Niet in bezit', owned: 'In bezit', wishlist: 'Verlanglijst' };

export const FORMATS = {
  trade: 'Trade paperback',
  hardcover: 'Hardcover',
  omnibus: 'Omnibus',
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
 *   issues: Issue[], note: string, readAt: string|null, createdAt: string, updatedAt: string
 * }} Volume
 * @typedef {{
 *   id: string, title: string, publisher: string, line: string, years: string,
 *   color: keyof typeof COLORS, paused: boolean, createdAt: string, lastActivityAt: string
 * }} Series
 * @typedef {{ version: number, series: Series[], volumes: Volume[] }} State
 */

// ---------------------------------------------------------------- basis

/** @returns {State} */
export function emptyState() {
  return { version: SCHEMA_VERSION, series: [], volumes: [] };
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
export function nextUp(state, seriesId) {
  const vols = volumesOf(state, seriesId);
  const reading = vols.find((v) => v.readStatus === 'reading');
  if (reading) return reading;
  const main = vols.filter((v) => !v.isSide);
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
  return rest.find((x) => !x.isSide) || rest[0] || null;
}

export function seriesStats(state, seriesId) {
  const vols = volumesOf(state, seriesId);
  const main = vols.filter((v) => !v.isSide);
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
  const main = vols.filter((v) => !v.isSide);
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
  return state.series.map((s) => (s.id === seriesId ? { ...s, lastActivityAt: now, ...extra } : s));
}

function replaceVolume(state, v) {
  return { ...state, volumes: state.volumes.map((x) => (x.id === v.id ? v : x)) };
}

function cleanSeriesData(data) {
  const color = data.color in COLORS ? data.color : 'red';
  return {
    title: String(data.title || '').trim(),
    publisher: String(data.publisher || '').trim(),
    line: String(data.line || '').trim(),
    years: String(data.years || '').trim(),
    color,
  };
}

export function addSeries(state, data, now = nowIso()) {
  const clean = cleanSeriesData(data);
  if (!clean.title) throw new Error('Een serie heeft een titel nodig.');
  const series = { id: makeId('s'), ...clean, paused: false, createdAt: now, lastActivityAt: now };
  return { state: { ...state, series: [...state.series, series] }, id: series.id };
}

export function updateSeries(state, id, data) {
  const clean = cleanSeriesData(data);
  if (!clean.title) throw new Error('Een serie heeft een titel nodig.');
  return { ...state, series: state.series.map((s) => (s.id === id ? { ...s, ...clean } : s)) };
}

export function deleteSeries(state, id) {
  return {
    ...state,
    series: state.series.filter((s) => s.id !== id),
    volumes: state.volumes.filter((v) => v.seriesId !== id),
  };
}

export function setPaused(state, id, paused) {
  // Pauzeren is geen lezen: de volgorde op Home blijft gelijk.
  return { ...state, series: state.series.map((s) => (s.id === id ? { ...s, paused: !!paused } : s)) };
}

function cleanVolumeData(data) {
  const position = Number(data.position);
  return {
    seriesId: data.seriesId,
    title: String(data.title || '').trim(),
    number: String(data.number ?? '').trim(),
    position: Number.isFinite(position) ? position : 0,
    format: data.format in FORMATS ? data.format : 'trade',
    isSide: !!data.isSide,
    ownership: OWNERSHIP.includes(data.ownership) ? data.ownership : 'none',
    note: String(data.note || '').trim(),
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

export function deleteVolume(state, id) {
  return { ...state, volumes: state.volumes.filter((v) => v.id !== id) };
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
  return { version: SCHEMA_VERSION, series, volumes };
}
