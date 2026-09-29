// Beheer vanaf de server (via de diagnose-functie): een Comic Vine-reeks toevoegen, delen op
// "In bezit"/"Gelezen" zetten, een serie weghalen. Zo kan Claude vanuit de chat je kast invullen,
// bijvoorbeeld na een foto van je boekenkast. Apparaten halen de wijzigingen op bij de volgende sync.
import * as M from '../../js/model.js';
import { getJson, setJson, KEYS } from './store.js';
import { getVolume, listVolumeIssues } from './comicvine.js';
import { HttpError } from './http.js';

const COLOR_BY_PUBLISHER = { DC: 'blue', Marvel: 'red', Image: 'yellow' };

/** Leest de kast, voert `fn` uit en schrijft het resultaat terug als nieuwe revisie. */
export async function changeState(fn) {
  const stored = (await getJson(KEYS.state)) || { rev: 0, epoch: null, state: M.emptyState() };
  const before = stored.state || M.emptyState();
  const out = await fn(before);
  const record = { rev: (stored.rev || 0) + 1, updatedAt: new Date().toISOString(), epoch: stored.epoch || null, state: M.normalizeState(out.state) };
  await setJson(KEYS.state, record);
  return { rev: record.rev, ...out, state: undefined };
}

/** "1,2,5-7" of "alle" → functie die zegt of een deelnummer erbij hoort. */
export function numberFilter(spec) {
  const s = String(spec || '').trim().toLowerCase();
  if (!s) return () => false;
  if (s === 'alle' || s === 'all') return () => true;
  const set = new Set();
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) for (let n = Number(m[1]); n <= Number(m[2]); n += 1) set.add(String(n));
    else set.add(part);
  }
  return (number) => set.has(String(number || '').toLowerCase());
}

function markVolumes(state, volumes, { own, read }) {
  let st = state;
  for (const v of volumes) {
    if (own && M.OWNERSHIP.includes(own)) st = M.setOwnership(st, v.id, own);
    if (read && M.READ_STATUS.includes(read)) st = M.setReadStatus(st, v.id, read);
  }
  return st;
}

function summary(state, seriesId) {
  const s = M.getSeries(state, seriesId);
  return {
    id: s.id,
    title: s.title,
    volumes: M.volumesOf(state, seriesId).map((v) => `${v.number ? `Vol. ${v.number}` : '–'} ${v.title} · ${v.readStatus} · ${v.ownership}${v.rating ? ` · ${v.rating}` : ''} · ${v.id}`),
  };
}

/**
 * Voegt een Comic Vine-reeks toe (of werkt hem bij als hij al gekoppeld is) en zet delen op bezit/gelezen.
 * opts: { bezit: "1,2" | "alle", gelezen: "1-3", verlanglijst: "4", titel, force }
 */
export async function addComicVine(cvId, opts = {}) {
  const series = await getVolume(cvId);
  const items = await listVolumeIssues(cvId);
  if (items.length > 30 && !opts.force) {
    throw new HttpError(400, `${series.name} (${series.year}) heeft ${items.length} nummers; dat is waarschijnlijk een reeks losse nummers, geen trades. Gebruik force=1 als het toch moet.`);
  }
  return changeState((state) => {
    let st = state;
    const key = M.linkKeyOf({ id: series.id, source: 'comicvine' });
    let target = st.series.find((s) => M.seriesLinks(s).some((l) => M.linkKeyOf(l) === key));
    let id = target?.id;
    if (!id) {
      const publisher = M.publisherFromMetron(series.publisher);
      const link = { id: series.id, name: `${series.name}${series.year ? ` (${series.year})` : ''}`, type: 'Comic Vine', linkedAt: new Date().toISOString(), source: 'comicvine', umbrella: '' };
      const r = M.addSeries(st, { title: String(opts.titel || '').trim() || series.name, publisher, years: series.year ? `${series.year}–` : '', color: COLOR_BY_PUBLISHER[publisher] || 'ink', metron: link });
      st = r.state;
      id = r.id;
    }
    const applied = M.applyMetronItems(st, id, items, M.formatForSource(st, id, 'comicvine', ''), { linkKey: key });
    st = applied.state;
    const vols = M.volumesOf(st, id).filter((v) => v.linkKey === key);
    // Eén boek zonder deelnummer (one-shot/hardcover) telt als nummer "1".
    const num = (v) => v.number || (vols.length === 1 ? '1' : '');
    const pick = (spec) => vols.filter((v) => numberFilter(spec)(num(v)));
    st = markVolumes(st, pick(opts.verlanglijst), { own: 'wishlist' });
    st = markVolumes(st, pick(opts.bezit), { own: 'owned' });
    st = markVolumes(st, pick(opts.gelezen), { read: 'read' });
    return { state: st, existed: !!target, added: applied.added.length, series: summary(st, id) };
  });
}

/** Past één boek aan: bezit (owned|wishlist|none), gelezen (read|reading|unread), oordeel (top|niks|geen). */
export async function changeVolume(volumeId, { bezit, gelezen, oordeel } = {}) {
  return changeState((state) => {
    const v = M.getVolume(state, volumeId);
    if (!v) throw new HttpError(404, 'Dat boek staat niet in de kast.');
    let st = markVolumes(state, [v], { own: bezit, read: gelezen });
    if (oordeel) {
      const cur = M.getVolume(st, volumeId).rating;
      if (oordeel === 'geen') { if (cur) st = M.setRating(st, volumeId, cur); } // zelfde keuze = weghalen
      else if (cur !== oordeel) st = M.setRating(st, volumeId, oordeel);
    }
    return { state: st, series: summary(st, v.seriesId) };
  });
}

/** Past delen van een serie aan op deelnummer, zoals bij addComicVine. */
export async function changeSeries(seriesId, opts = {}) {
  return changeState((state) => {
    if (!M.getSeries(state, seriesId)) throw new HttpError(404, 'Die serie staat niet in de kast.');
    const vols = M.volumesOf(state, seriesId);
    const pick = (spec) => vols.filter((v) => numberFilter(spec)(v.number));
    let st = state;
    st = markVolumes(st, pick(opts.verlanglijst), { own: 'wishlist' });
    st = markVolumes(st, pick(opts.bezit), { own: 'owned' });
    st = markVolumes(st, pick(opts.gelezen), { read: 'read' });
    return { state: st, series: summary(st, seriesId) };
  });
}

export async function removeSeries(seriesId) {
  return changeState((state) => {
    const s = M.getSeries(state, seriesId);
    if (!s) throw new HttpError(404, 'Die serie staat niet in de kast.');
    return { state: M.deleteSeries(state, seriesId), removed: s.title };
  });
}
