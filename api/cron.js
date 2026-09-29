// Dagelijkse taak (Vercel Cron) én de knop "Nu controleren": zoekt nieuwe delen van je gekoppelde series.
import { json, preflight, handle, requireCronOrApp } from './_lib/http.js';
import { getJson, setJson, KEYS } from './_lib/store.js';
import { checkReleases } from './_lib/releases.js';
import { mergeStates } from '../js/model.js';

export const OPTIONS = preflight;

async function run(request) {
  requireCronOrApp(request);
  const started = Date.now();
  const stored = await getJson(KEYS.state);
  if (!stored || !stored.state) return json({ ok: true, added: [], message: 'Nog geen kast op de server.' });
  const checks = (await getJson(KEYS.checks)) || {};
  const result = await checkReleases(stored.state, checks, { deadline: started + 50_000 });
  await setJson(KEYS.checks, result.checks);

  // Opnieuw lezen en samenvoegen: er kan tijdens de controle gesynct zijn.
  const latest = (await getJson(KEYS.state)) || stored;
  const merged = mergeStates(latest.state, result.state);
  // Is de kast intussen gewist? Dan niets terugzetten.
  if (latest.epoch !== stored.epoch) return json({ ok: true, added: [], message: 'De kast is intussen gewist.' });
  const record = { rev: (latest.rev || 0) + 1, updatedAt: new Date().toISOString(), epoch: latest.epoch || null, state: merged };
  await setJson(KEYS.state, record);
  return json({
    ok: true,
    added: result.added.map((id) => merged.volumes.find((v) => v.id === id)).filter(Boolean).map((v) => ({ id: v.id, title: v.title, number: v.number })),
    checkedSeries: result.checkedSeries,
    pending: result.pending,
    rev: record.rev,
  });
}

export const GET = handle(run);
export const POST = handle(run);
