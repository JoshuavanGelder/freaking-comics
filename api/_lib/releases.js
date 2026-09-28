// Controle op nieuwe delen: vergelijkt je gekoppelde series met Metron en voegt ontbrekende delen toe.
import * as M from '../../js/model.js';
import { listSeriesItems, getIssue } from './metron.js';

/**
 * @param {object} state        je kast
 * @param {object} checks       { [seriesId]: laatst gecontroleerd (ISO) } – oudste eerst aan de beurt
 * @param {object} opts         { deadline: ms-tijdstip waarop we stoppen, now }
 * @returns {{ state, checks, added: string[], checkedSeries: number, pending: number }}
 */
export async function checkReleases(state, checks = {}, { deadline = Date.now() + 50_000, now = new Date().toISOString() } = {}) {
  let next = state;
  const nextChecks = { ...checks };
  const added = [];
  const linked = next.series
    .filter((s) => s.metron && s.metron.id)
    .sort((a, b) => String(checks[a.id] || '').localeCompare(String(checks[b.id] || '')));

  let checkedSeries = 0;
  for (const series of linked) {
    if (Date.now() > deadline - 5_000) break;
    const items = await listSeriesItems(series.metron.id, { fresh: true, deadline });
    const vols = M.volumesOf(next, series.id);
    const known = new Set(vols.map((v) => v.metronId).filter((x) => x != null));
    // Details alleen ophalen voor delen die nog niet in je kast staan (of nog geen issues hebben).
    const missing = items.filter((i) => !known.has(i.id));
    const detailed = [];
    for (const item of missing.slice(0, 10)) {
      if (Date.now() > deadline - 5_000) break;
      detailed.push(await getIssue(item.id, { deadline }).catch(() => item));
    }
    const format = M.formatFromMetronType(series.metron.type);
    // Bestaande delen: lijstgegevens (cover, datum) bijwerken; nieuwe delen: met details.
    const detailedIds = new Set(detailed.map((d) => d.id));
    const payload = [...items.filter((i) => known.has(i.id)).map((i) => ({ ...i, title: '' })), ...detailed];
    const r = M.applyMetronItems(next, series.id, payload, format, { markNew: true, now });
    next = r.state;
    added.push(...r.added);
    // Alleen "klaar" als alle ontbrekende delen verwerkt zijn.
    if (missing.every((m) => detailedIds.has(m.id))) nextChecks[series.id] = now;
    checkedSeries += 1;
  }
  next = { ...next, releasesCheckedAt: now };
  return { state: next, checks: nextChecks, added, checkedSeries, pending: linked.length - checkedSeries };
}
