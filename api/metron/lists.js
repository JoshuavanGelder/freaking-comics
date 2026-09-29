// Metron-leeslijsten zoeken (bijv. "Cataclysm"), of de nummers van één leeslijst ophalen (?id=).
import { json, preflight, handle, requireApp, HttpError } from '../_lib/http.js';
import { searchReadingLists, readingListItems } from '../_lib/metron.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  requireApp(request);
  const p = new URL(request.url).searchParams;
  const id = Number(p.get('id'));
  if (id) return json({ items: await readingListItems(id) });
  const q = p.get('q')?.trim();
  if (!q || q.length < 2) throw new HttpError(400, 'Typ minstens twee letters.');
  return json({ results: await searchReadingLists(q) });
});
