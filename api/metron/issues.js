// Details van een paar Metron-issues tegelijk (titel, verzamelde issues, cover). Max. 6 per keer.
import { json, preflight, handle, requireApp, HttpError } from '../_lib/http.js';
import { getIssue } from '../_lib/metron.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  requireApp(request);
  const ids = (new URL(request.url).searchParams.get('ids') || '')
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length) throw new HttpError(400, 'Geen issues gevraagd.');
  if (ids.length > 6) throw new HttpError(400, 'Maximaal 6 tegelijk.');
  const deadline = Date.now() + 45_000;
  const issues = [];
  for (const id of ids) issues.push(await getIssue(id, { deadline }));
  return json({ issues });
});
