// Eén Metron-serie met al zijn delen (lijstgegevens: nummer, cover, datum).
import { json, preflight, handle, requireApp, HttpError } from '../_lib/http.js';
import { getSeries, listSeriesItems } from '../_lib/metron.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  requireApp(request);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Geen geldige serie.');
  const [series, items] = [await getSeries(id), await listSeriesItems(id)];
  return json({ series, items });
});
