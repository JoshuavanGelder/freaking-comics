// Aanraders: Claude leest je kast (met Top/Niks per boek) en raadt boeken aan; Comic Vine levert cover en reeks.
// GET  → de laatst gemaakte aanraders (zonder wat je wegklikte of inmiddels in je kast hebt).
// POST { refresh: true }   → nieuwe aanraders maken
// POST { dismiss: key }    → "Niks voor mij" (wordt onthouden en aan Claude doorgegeven)
// POST { undismiss: key }  → wegklikken ongedaan maken
import { json, preflight, handle, requireApp, readJson, HttpError } from './_lib/http.js';
import { getJson, setJson, KEYS } from './_lib/store.js';
import { askRecommendations, claudeConfigured } from './_lib/claude.js';
import { findRecommendation, comicVineConfigured } from './_lib/comicvine.js';
import { tasteProfile, shelfTitles, seriesLinks, emptyState } from '../js/model.js';

export const OPTIONS = preflight;

const STALE_AFTER = 2 * 86400e3; // kast veranderd én ouder dan 2 dagen → vanzelf opnieuw

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function keyOf(item) {
  return `${item.series} ${item.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

async function loadAll() {
  const [stored, recs] = await Promise.all([getJson(KEYS.state), getJson(KEYS.recs)]);
  const state = stored?.state || emptyState();
  return { state, recs: recs && typeof recs === 'object' ? { items: [], dismissed: [], ...recs } : { items: [], dismissed: [] } };
}

/** Wat al in de kast staat, via Comic Vine-koppelingen of op titel. */
function inShelf(state) {
  const cv = new Set();
  for (const s of state.series) for (const l of seriesLinks(s)) if (l.source === 'comicvine') cv.add(Number(l.id));
  const titles = shelfTitles(state);
  return (item) => (item.cv && cv.has(Number(item.cv.id))) || titles.has(`${item.series} ${item.title}`.toLowerCase().trim());
}

function view(state, recs) {
  const profile = tasteProfile(state);
  const dismissed = new Set(recs.dismissed.map((d) => d.key));
  const has = inShelf(state);
  const items = recs.items.filter((i) => !dismissed.has(i.key) && !has(i));
  const readSomething = state.volumes.some((v) => v.readStatus !== 'unread');
  const age = recs.generatedAt ? Date.now() - Date.parse(recs.generatedAt) : Infinity;
  const changed = recs.basedOn !== hash(profile);
  return {
    configured: { ai: claudeConfigured(), comicvine: comicVineConfigured() },
    generatedAt: recs.generatedAt || null,
    items,
    dismissedCount: dismissed.size,
    canMake: readSomething,
    stale: readSomething && (!recs.generatedAt || items.length < 3 || (changed && age > STALE_AFTER)),
  };
}

async function generate(state, recs) {
  const profile = tasteProfile(state);
  if (!profile) throw new HttpError(400, 'Je kast is nog leeg. Voeg eerst een paar boeken toe die je gelezen hebt.');
  const raw = await askRecommendations({
    profile,
    dismissed: recs.dismissed.map((d) => d.label).slice(-60),
    previous: recs.items.map((i) => `${i.series} ${i.title}`.trim()).slice(0, 12),
  });
  const has = inShelf(state);
  const seen = new Set();
  const items = [];
  const matched = await Promise.all(
    raw.map((item) => (comicVineConfigured() ? findRecommendation(item).catch(() => null) : Promise.resolve(null))),
  );
  raw.forEach((item, k) => {
    const key = keyOf(item);
    if (seen.has(key)) return;
    seen.add(key);
    const m = matched[k];
    const full = {
      key,
      ...item,
      cv: m ? { id: m.id, name: m.name, year: m.start_year, image: m.image, issueCount: m.count_of_issues } : null,
    };
    if (!has(full)) items.push(full);
  });
  // Gevonden op Comic Vine eerst: die kun je meteen bekijken en toevoegen.
  items.sort((a, b) => (b.cv ? 1 : 0) - (a.cv ? 1 : 0));
  return { ...recs, generatedAt: new Date().toISOString(), basedOn: hash(profile), items };
}

export const GET = handle(async (request) => {
  requireApp(request);
  const { state, recs } = await loadAll();
  return json(view(state, recs));
});

export const POST = handle(async (request) => {
  requireApp(request);
  const body = await readJson(request);
  let { state, recs } = await loadAll();

  if (body.dismiss) {
    const item = recs.items.find((i) => i.key === body.dismiss);
    if (!recs.dismissed.some((d) => d.key === body.dismiss)) {
      recs.dismissed = [...recs.dismissed, { key: body.dismiss, label: item ? `${item.series} ${item.title}`.trim() : body.dismiss, at: new Date().toISOString() }].slice(-200);
    }
  } else if (body.undismiss) {
    recs.dismissed = recs.dismissed.filter((d) => d.key !== body.undismiss);
  } else if (body.refresh) {
    const recent = recs.generatedAt && Date.now() - Date.parse(recs.generatedAt) < 20_000;
    if (!recent) recs = await generate(state, recs);
  } else {
    throw new HttpError(400, 'Onbekende vraag.');
  }
  await setJson(KEYS.recs, recs);
  return json(view(state, recs));
});
