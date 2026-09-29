// Diagnose (alleen met de CRON_SECRET als ?key=): laat zien wat er in de kast staat en wat een bron teruggeeft.
// Bedoeld om problemen met gegevens uit Metron of Comic Vine te kunnen nazoeken.
import { timingSafeEqual, createHash } from 'node:crypto';
import { json, handle, HttpError } from './_lib/http.js';
import { getJson, KEYS } from './_lib/store.js';
import { cvGet } from './_lib/comicvine.js';
import { metronGet, findIssueSeries, listSeriesItems } from './_lib/metron.js';
import { refreshRecs } from './aanraders.js';

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

  if (what === 'metron-lists') {
    const d = await metronGet('reading_list/', { name: p.get('q') || '' });
    return json({ count: d.count, results: d.results.map((r) => ({ id: r.id, name: r.name, type: r.list_type, source: r.attribution_source, user: r.user?.username, rating: r.average_rating })) });
  }

  if (what === 'metron-list-items') {
    const d = await metronGet(`reading_list/${Number(p.get('id'))}/items/`, { page: p.get('page') || 1 });
    return json({ count: d.count, next: !!d.next, items: d.results.map((i) => `${i.order}. ${i.issue?.series?.name} (${i.issue?.series?.year_began}) #${i.issue?.number} ${i.issue_type || ''} ${i.issue?.cover_date || ''}`) });
  }

  if (what === 'route-series') {
    const out = [];
    for (const name of (p.get('names') || '').split('|').filter(Boolean)) {
      const found = await findIssueSeries(name, Number(p.get('year')) || null);
      const items = found ? await listSeriesItems(found.id) : [];
      out.push({ name, found, count: items.length, first: items.slice(0, 3).map((i) => `#${i.number} ${i.cover_date}`), last: items.slice(-2).map((i) => `#${i.number} ${i.cover_date}`) });
    }
    return json(out);
  }

  if (what === 'metron-search') {
    const d = await metronGet('series/', { name: p.get('q') || '', series_type_id: p.get('type') || undefined });
    return json(d.results);
  }

  if (what === 'aanraders') {
    const started = Date.now();
    const r = await refreshRecs();
    return json({ ms: Date.now() - started, items: r.items.map((i) => ({ kind: i.kind, book: `${i.series} ${i.title}`, year: i.year, cv: i.cv ? `${i.cv.id} ${i.cv.name} (${i.cv.year}, ${i.cv.issueCount})` : null, because: i.because, reason: i.reason })) });
  }

  throw new HttpError(400, 'Onbekende vraag.');
});
