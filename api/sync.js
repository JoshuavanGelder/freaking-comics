// Sync: haalt je kast op en voegt wijzigingen van dit apparaat samen met die van de server.
import { json, preflight, handle, requireApp, readJson, HttpError } from './_lib/http.js';
import { getJson, setJson, KEYS } from './_lib/store.js';
import { mergeStates, emptyState, sameState } from '../js/model.js';

export const OPTIONS = preflight;

async function load() {
  const stored = await getJson(KEYS.state);
  return stored && stored.state ? stored : { rev: 0, updatedAt: null, state: null };
}

export const GET = handle(async (request) => {
  requireApp(request);
  return json(await load());
});

export const POST = handle(async (request) => {
  requireApp(request);
  const body = await readJson(request);
  if (!body.state) throw new HttpError(400, 'Geen gegevens meegestuurd.');
  const stored = await load();
  let merged;
  try {
    merged = mergeStates(stored.state || emptyState(), body.state);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  if (stored.state && sameState(merged, stored.state)) return json(stored);
  const record = { rev: (stored.rev || 0) + 1, updatedAt: new Date().toISOString(), state: merged };
  await setJson(KEYS.state, record);
  return json(record);
});

export const PUT = POST;
