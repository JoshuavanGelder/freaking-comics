// Zoek een serie op Metron. Verzamelde edities (TPB, HC, omnibus) komen bovenaan.
import { json, preflight, handle, requireApp, HttpError } from '../_lib/http.js';
import { searchSeries } from '../_lib/metron.js';
import { isCollectedType } from '../../js/model.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  requireApp(request);
  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q || q.length < 2) throw new HttpError(400, 'Typ minstens twee letters.');
  const all = new URL(request.url).searchParams.get('alles') === '1';
  const results = await searchSeries(q, { collected: !all });
  results.sort((a, b) => Number(isCollectedType(b.type)) - Number(isCollectedType(a.type)) || (a.year || 0) - (b.year || 0));
  return json({ results });
});
