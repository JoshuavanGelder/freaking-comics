// Aanraders: Claude leest je kast (met Top/Niks per boek) en raadt boeken aan; Comic Vine levert cover en reeks.
// GET  → de laatst gemaakte aanraders (zonder wat je wegklikte of inmiddels in je kast hebt).
// POST { refresh: true }   → nieuwe aanraders maken
// POST { dismiss: key }    → "Niks voor mij" (wordt onthouden en aan Claude doorgegeven)
// POST { undismiss: key }  → wegklikken ongedaan maken
import { json, preflight, handle, requireApp, readJson, HttpError } from './_lib/http.js';
import { getJson, setJson, KEYS } from './_lib/store.js';
import { askRecommendations, claudeConfigured } from './_lib/claude.js';
import { comicVineConfigured } from './_lib/comicvine.js';
import { metronConfigured } from './_lib/metron.js';
import { findMatch } from './_lib/recmatch.js';
import { tasteProfile, shelfTitles, shelfLinkKeys, recInShelf, recMatch, emptyState, profileHash as hash, recsNeedUpdate } from '../js/model.js';

export const OPTIONS = preflight;

// Nieuwe aanraders worden alleen gemaakt als je erom vraagt (knop "Aanraders bijwerken"),
// en alleen als je kast (boeken of status) veranderd is sinds de vorige keer, of er minder dan 3 over zijn.

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
  const keys = shelfLinkKeys(state);
  const titles = shelfTitles(state);
  return (item) => recInShelf(item, keys) || titles.has(`${item.series} ${item.title}`.toLowerCase().trim());
}

function view(state, recs) {
  const dismissed = new Set(recs.dismissed.map((d) => d.key));
  const has = inShelf(state);
  const items = recs.items.filter((i) => !dismissed.has(i.key) && !has(i));
  const readSomething = state.volumes.some((v) => v.readStatus !== 'unread');
  return {
    configured: { ai: claudeConfigured(), comicvine: comicVineConfigured(), metron: metronConfigured() },
    generatedAt: recs.generatedAt || null,
    basedOn: recs.basedOn || null,
    items,
    dismissedCount: dismissed.size,
    canMake: readSomething,
    needsUpdate: readSomething && recsNeedUpdate(state, { generatedAt: recs.generatedAt, basedOn: recs.basedOn, visibleCount: items.length }),
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
  // Per aanrader zoeken we op Comic Vine én Metron en nemen de reeks die het best past.
  const matched = await Promise.all(raw.map((item) => findMatch(item).catch(() => null)));
  raw.forEach((item, k) => {
    const key = keyOf(item);
    if (seen.has(key)) return;
    seen.add(key);
    const match = matched[k];
    const full = {
      key,
      ...item,
      match,
      // Voor oudere versies van de app, die alleen `cv` kennen.
      cv: match?.source === 'comicvine' ? { id: match.id, name: match.name, year: match.year, image: match.image, issueCount: match.issueCount } : null,
    };
    if (!has(full)) items.push(full);
  });
  // Gevonden (Comic Vine of Metron) eerst: die kun je meteen bekijken en toevoegen.
  items.sort((a, b) => (recMatch(b) ? 1 : 0) - (recMatch(a) ? 1 : 0));
  return { ...recs, generatedAt: new Date().toISOString(), basedOn: hash(profile), items };
}

/** Nieuwe aanraders maken en bewaren (ook gebruikt door de diagnose-functie). */
export async function refreshRecs() {
  const { state, recs } = await loadAll();
  const next = await generate(state, recs);
  await setJson(KEYS.recs, next);
  return view(state, next);
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
    // Niets veranderd sinds de vorige keer? Dan Claude niet opnieuw vragen (kost geld en geeft hetzelfde).
    const recent = recs.generatedAt && Date.now() - Date.parse(recs.generatedAt) < 20_000;
    if (!recent && view(state, recs).needsUpdate) recs = await generate(state, recs);
  } else {
    throw new HttpError(400, 'Onbekende vraag.');
  }
  await setJson(KEYS.recs, recs);
  return json(view(state, recs));
});
