// Diagnose (alleen met de CRON_SECRET als ?key=): laat zien wat er in de kast staat en wat een bron teruggeeft.
// Bedoeld om problemen met gegevens uit Metron of Comic Vine te kunnen nazoeken.
import { timingSafeEqual, createHash } from 'node:crypto';
import { json, handle, HttpError } from './_lib/http.js';
import { getJson, KEYS } from './_lib/store.js';
import { cvGet } from './_lib/comicvine.js';
import { metronGet } from './_lib/metron.js';

function allowed(key) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !key) return false;
  const a = createHash('sha256').update(key).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export const GET = handle(async (request) => {
  const p = new URL(request.url).searchParams;
  if (!allowed(p.get('key'))) throw new HttpError(401, 'Geen toegang.');
  const what = p.get('what');

  if (what === 'kast') {
    const stored = await getJson(KEYS.state);
    const state = stored?.state || { series: [], volumes: [] };
    const q = (p.get('serie') || '').toLowerCase();
    const series = state.series.filter((s) => !q || s.title.toLowerCase().includes(q));
    return json({
      rev: stored?.rev,
      epoch: stored?.epoch,
      series: series.map((s) => ({
        title: s.title,
        metron: s.metron,
        links: s.links,
        volumes: state.volumes
          .filter((v) => v.seriesId === s.id)
          .sort((a, b) => a.position - b.position)
          .map((v) => ({ pos: v.position, title: v.title, number: v.number, kind: v.kind, read: v.readStatus, ext: v.metronId, link: v.linkKey, date: v.storeDate, issues: v.issues.map((i) => `${i.series} #${i.number}`) })),
      })),
    });
  }

  if (what === 'cv-search') {
    const d = await cvGet('search/', { query: p.get('q') || '', resources: 'volume', field_list: 'id,name,start_year,publisher,count_of_issues', limit: 10, page: p.get('page') || 1 });
    return json(d.results);
  }

  if (what === 'cv-issues') {
    const d = await cvGet('issues/', { filter: `volume:${Number(p.get('id'))}`, field_list: 'id,name,issue_number,cover_date,store_date,description,deck', sort: 'cover_date:asc', limit: 100 });
    return json(d.results.map((i) => ({ ...i, description: String(i.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 700) })));
  }

  if (what === 'cv-volume') {
    const d = await cvGet(`volume/4050-${Number(p.get('id'))}/`, { field_list: 'id,name,start_year,publisher,count_of_issues,description,deck' });
    return json({ ...d.results, description: String(d.results.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500) });
  }

  if (what === 'metron-search') {
    const d = await metronGet('series/', { name: p.get('q') || '', series_type_id: p.get('type') || undefined });
    return json(d.results);
  }

  throw new HttpError(400, 'Onbekende vraag.');
});
