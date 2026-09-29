// Eén Comic Vine-volume met al zijn nummers, meteen met details.
import { json, preflight, handle, requireApp, HttpError } from '../_lib/http.js';
import { getVolume, listVolumeIssues } from '../_lib/comicvine.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  requireApp(request);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Geen geldige reeks.');
  const series = await getVolume(id);
  const items = await listVolumeIssues(id);
  return json({ series, items, detailed: true });
});
