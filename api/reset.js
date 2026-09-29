// "Alles wissen": maakt de kast op de server leeg en geeft een nieuwe epoch, zodat alle apparaten meegaan.
import { randomUUID } from 'node:crypto';
import { json, preflight, handle, requireApp } from './_lib/http.js';
import { getJson, setJson, KEYS } from './_lib/store.js';
import { emptyState } from '../js/model.js';

export const OPTIONS = preflight;

export const POST = handle(async (request) => {
  requireApp(request);
  const stored = (await getJson(KEYS.state)) || {};
  const now = new Date().toISOString();
  const record = { rev: (stored.rev || 0) + 1, updatedAt: now, resetAt: now, epoch: randomUUID(), state: emptyState() };
  await setJson(KEYS.state, record);
  await setJson(KEYS.checks, {});
  await setJson(KEYS.recs, {});
  return json(record);
});
