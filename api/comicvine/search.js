// Zoek een volume (reeks of los boek) op Comic Vine.
import { json, preflight, handle, requireApp, HttpError } from '../_lib/http.js';
import { searchVolumes } from '../_lib/comicvine.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  requireApp(request);
  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q || q.length < 2) throw new HttpError(400, 'Typ minstens twee letters.');
  return json({ results: await searchVolumes(q) });
});
