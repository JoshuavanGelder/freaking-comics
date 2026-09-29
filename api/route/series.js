// Voor het aanvullen van een leesroute: per serienaam alle nummers met datum (van Metron).
import { json, preflight, handle, requireApp, HttpError } from '../_lib/http.js';
import { findIssueSeries, listSeriesItems } from '../_lib/metron.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  requireApp(request);
  const p = new URL(request.url).searchParams;
  const names = (p.get('names') || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (!names.length) throw new HttpError(400, 'Geen series opgegeven.');
  const year = Number(p.get('year')) || null;
  const deadline = Date.now() + 50_000;
  const out = [];
  for (const name of names) {
    try {
      const found = await findIssueSeries(name, year);
      if (!found) {
        out.push({ name, found: null, issues: [] });
        continue;
      }
      const items = await listSeriesItems(found.id, { deadline });
      out.push({ name, found, issues: items.map((i) => ({ number: i.number, date: i.cover_date || i.store_date || null })) });
    } catch (err) {
      out.push({ name, found: null, issues: [], error: err.message });
    }
  }
  return json({ results: out });
});
