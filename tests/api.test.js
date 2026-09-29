import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakes, fake } from '../tools/fake-services.js';

installFakes();
const sync = await import('../api/sync.js');
const status = await import('../api/status.js');
const search = await import('../api/metron/search.js');
const seriesApi = await import('../api/metron/series.js');
const issuesApi = await import('../api/metron/issues.js');
const cron = await import('../api/cron.js');
const reset = await import('../api/reset.js');
const cvSearch = await import('../api/comicvine/search.js');
const cvSeries = await import('../api/comicvine/series.js');
const M = await import('../js/model.js');
const { seedState } = await import('./fixtures/seed.js');

const H = { 'x-app-secret': 'geheim' };
const req = (path, init = {}) => new Request(`http://localhost${path}`, init);
const body = async (res) => ({ status: res.status, ...(await res.json()) });

test('status laat zien wat is ingesteld', async () => {
  const r = await body(await status.GET(req('/api/status', { headers: H })));
  assert.equal(r.authorized, true);
  assert.deepEqual(r.configured, { secret: true, storage: true, metron: true, comicvine: true, cron: true });
  const bad = await body(await status.GET(req('/api/status', { headers: { 'x-app-secret': 'fout' } })));
  assert.equal(bad.authorized, false);
});

test('zonder wachtwoord geen toegang', async () => {
  const r = await sync.GET(req('/api/sync'));
  assert.equal(r.status, 401);
  const r2 = await search.GET(req('/api/metron/search?q=flash', { headers: { 'x-app-secret': 'fout' } }));
  assert.equal(r2.status, 401);
});

test('sync: eerste upload, daarna samenvoegen van twee apparaten', async () => {
  fake.store.clear();
  const empty = await body(await sync.GET(req('/api/sync', { headers: H })));
  assert.equal(empty.state, null);

  const phone = seedState();
  const up = await body(await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: phone }) })));
  assert.equal(up.rev, 1);

  const flash = phone.series.find((s) => s.title === 'The Flash');
  const v6 = M.nextUp(phone, flash.id);
  const laptop = M.setReadStatus(up.state, v6.id, 'read', '2026-09-29T10:00:00.000Z');
  const phone2 = M.setOwnership(phone, v6.id, 'owned', '2026-09-29T09:00:00.000Z');
  await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: laptop }) }));
  const final = await body(await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: phone2 }) })));
  const v = M.getVolume(final.state, v6.id);
  // Laptop was later: gelezen wint (volume-niveau: nieuwste versie van het hele volume)
  assert.equal(v.readStatus, 'read');
  assert.equal(final.rev, 2);

  // Niets veranderd → geen nieuwe revisie
  const same = await body(await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: final.state }) })));
  assert.equal(same.rev, 2);
});

test('sync weigert rommel', async () => {
  const r = await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: { foo: 1 } }) }));
  assert.equal(r.status, 400);
});

test('Metron zoeken zet verzamelde edities bovenaan', async () => {
  const r = await body(await search.GET(req('/api/metron/search?q=the%20flash', { headers: H })));
  assert.equal(r.results[0].type, 'Trade Paperback');
  assert.equal(r.results[0].name, 'The Flash TPB (2012)');
  // standaard alleen verzamelde edities, ook zonder "The" in de naam
  assert.deepEqual(r.results.map((x) => x.name).sort(), ['Flash TPB (2013)', 'The Flash TPB (2012)']);
  const all = await body(await search.GET(req('/api/metron/search?q=the%20flash&alles=1', { headers: H })));
  assert.equal(all.results.length, 3);
  assert.equal(all.results[0].type, 'Trade Paperback');
});

test('Metron serie + details', async () => {
  const r = await body(await seriesApi.GET(req('/api/metron/series?id=1001', { headers: H })));
  assert.equal(r.series.type, 'Trade Paperback');
  assert.equal(r.items.length, 9);
  const ids = r.items.slice(5, 7).map((i) => i.id).join(',');
  const d = await body(await issuesApi.GET(req(`/api/metron/issues?ids=${ids}`, { headers: H })));
  assert.equal(d.issues[0].title, 'Out of Time');
  assert.ok(d.issues[0].reprints.length > 5);
  // Tweede keer komt uit de cache
  const before = fake.calls.length;
  await issuesApi.GET(req(`/api/metron/issues?ids=${ids}`, { headers: H }));
  assert.equal(fake.calls.length, before);
});

test('cron: vindt nieuwe delen van gekoppelde series', async () => {
  fake.store.clear();
  let state = seedState();
  const flash = state.series.find((s) => s.title === 'The Flash');
  state = M.updateSeries(state, flash.id, { metron: { id: 1001, name: 'The Flash TPB (2012)', type: 'Trade Paperback' } });
  await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state }) }));

  // Eerste controle: koppelt de 9 bestaande delen, niets nieuw
  const first = await body(await cron.GET(req('/api/cron', { headers: { authorization: 'Bearer cron-geheim' } })));
  assert.equal(first.added.length, 0);
  assert.equal(first.checkedSeries, 1);

  fake.addIssue(1001, 10, 'Brand New Deal', '2099-05-01');
  const second = await body(await cron.POST(req('/api/cron', { method: 'POST', headers: H })));
  assert.equal(second.added.length, 1);
  assert.equal(second.added[0].title, 'Brand New Deal');

  const stored = await body(await sync.GET(req('/api/sync', { headers: H })));
  const vols = M.volumesOf(stored.state, flash.id);
  assert.equal(vols.length, 10);
  assert.ok(vols.every((v) => v.metronId));
  assert.equal(M.newVolumes(stored.state).length, 1);
  assert.equal(M.upcoming(stored.state, '2026-09-28').length, 1);
  // Leesstatus is niet aangetast
  assert.equal(M.volumesOf(stored.state, flash.id).filter((v) => v.readStatus === 'read').length, 5);
});

test('cron zonder geheim mag niet', async () => {
  const r = await cron.GET(req('/api/cron'));
  assert.equal(r.status, 401);
});

test('Metron werkt ook met gebruikersnaam en wachtwoord', async () => {
  const token = process.env.METRON_TOKEN;
  delete process.env.METRON_TOKEN;
  process.env.METRON_USERNAME = 'lezer';
  process.env.METRON_PASSWORD = 'wachtwoord';
  try {
    const r = await body(await search.GET(req('/api/metron/search?q=saga', { headers: H })));
    assert.equal(r.results[0].name, 'Saga TPB (2012)');
    process.env.METRON_PASSWORD = 'fout';
    const bad = await search.GET(req('/api/metron/search?q=saga', { headers: H }));
    assert.equal(bad.status, 502);
  } finally {
    process.env.METRON_TOKEN = token;
    delete process.env.METRON_USERNAME;
    delete process.env.METRON_PASSWORD;
  }
});

test('Comic Vine: zoeken en een reeks met inhoud ophalen', async () => {
  const r = await body(await cvSearch.GET(req('/api/comicvine/search?q=the%20flash', { headers: H })));
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].source, 'comicvine');
  const s = await body(await cvSeries.GET(req('/api/comicvine/series?id=1111', { headers: H })));
  assert.equal(s.detailed, true);
  assert.equal(s.items.length, 9);
  assert.equal(s.items[5].title, 'Out of Time');
  assert.equal(s.items[5].reprints.length, 7);
  assert.equal(s.items[5].reprints[6].issue, 'The Flash Annual #3');
});

test('Comic Vine: foute sleutel geeft een nette melding', async () => {
  const key = process.env.COMICVINE_API_KEY;
  process.env.COMICVINE_API_KEY = 'fout';
  try {
    const r = await cvSearch.GET(req('/api/comicvine/search?q=saga-onbekend', { headers: H }));
    assert.equal(r.status, 502);
  } finally {
    process.env.COMICVINE_API_KEY = key;
  }
});

test('cron: Comic Vine-reeks koppelt bestaande delen en vindt nieuwe', async () => {
  fake.store.clear();
  let state = seedState();
  const flash = state.series.find((s) => s.title === 'The Flash');
  state = M.updateSeries(state, flash.id, { metron: { id: 1111, name: 'The Flash (Comic Vine)', type: 'Comic Vine', source: 'comicvine' } });
  await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state }) }));
  const first = await body(await cron.POST(req('/api/cron', { method: 'POST', headers: H })));
  assert.equal(first.added.length, 0);
  const stored = await body(await sync.GET(req('/api/sync', { headers: H })));
  const vols = M.volumesOf(stored.state, flash.id);
  assert.equal(vols.length, 9);
  assert.ok(vols.every((v) => v.metronId && v.format === 'trade' && v.cover));
  const v6 = vols.find((v) => v.number === '6');
  assert.equal(M.formatIssues(v6.issues, 'The Flash'), '#30–35, Annual #3');
  assert.equal(vols.filter((v) => v.readStatus === 'read').length, 5);
});

test('alles wissen: server leeg, oude apparaten nemen de lege kast over', async () => {
  fake.store.clear();
  const phone = seedState();
  const first = await body(await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: phone }) })));
  assert.equal(first.state.series.length, 2);
  const wiped = await body(await reset.POST(req('/api/reset', { method: 'POST', headers: H })));
  assert.ok(wiped.epoch);
  assert.equal(wiped.state.series.length, 0);
  // Een apparaat met oude gegevens en zonder epoch krijgt de lege kast terug
  const old = await body(await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: phone }) })));
  assert.equal(old.reset, true);
  assert.equal(old.state.series.length, 0);
  // Met de juiste epoch wordt gewoon samengevoegd
  let fresh = M.emptyState();
  fresh = M.addSeries(fresh, { title: 'Saga' }).state;
  const ok = await body(await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: fresh, epoch: wiped.epoch }) })));
  assert.equal(ok.reset, undefined);
  assert.deepEqual(ok.state.series.map((s) => s.title), ['Saga']);
  // Bewust samenvoegen bij koppelen (join) mag ook zonder epoch
  const joined = await body(await sync.POST(req('/api/sync', { method: 'POST', headers: H, body: JSON.stringify({ state: M.addSeries(M.emptyState(), { title: 'Hunger' }).state, join: true }) })));
  assert.equal(joined.state.series.length, 2);
});

test('Comic Vine: inhoud uit echte omschrijvingen (The Flash New 52)', async () => {
  const { collectedFromDescription: C } = await import('../api/_lib/comicvine.js');
  const g = (d) => M.formatIssues(C(d, 'The Flash').map((x, i) => ({ id: String(i), ...M.parseReprint(x.issue), read: false })), 'The Flash');
  assert.equal(g('Collects issues #1-8 of the original monthly series.'), '#1–8');
  assert.equal(g('collecting issues #0, 9-12 and THE FLASH ANNUAL #1! Who'), '#0, #9–12, Annual #1');
  assert.equal(g("stories from THE FLASH #20-25, and #23.2: REVERSE FLASH!"), '#20–25, #23.2');
  assert.equal(g('from issues #26-29 and FLASH ANNUAL #2, find out'), '#26–29, Annual #2');
  assert.equal(g('from THE FLASH #30-35, THE FLASH ANNUAL #3 and THE FLASH: FUTURES END #1, the'), '#30–35, Annual #3, Futures End #1');
  assert.equal(g('Collects THE FLASH #41-47 and the Sneak Peek story from CONVERGENCE: DETECTIVE COMICS #2.'), '#41–47, Convergence Detective Comics #2');
  assert.equal(g('with Zoom from issues #48-52, The Flash is on the run'), '#48–52');
});

test('leesroute: nummers per serie en Metron-leeslijsten', async () => {
  const routeSeries = await import('../api/route/series.js');
  const lists = await import('../api/metron/lists.js');
  const r = await body(await routeSeries.GET(req('/api/route/series?names=Ultimate%20Comics%20X-Men|Ultimate%20Comics%20Ultimates|Bestaat%20Niet&year=2012', { headers: H })));
  assert.equal(r.results[0].found.id, 4001);
  assert.equal(r.results[0].issues.length, 20);
  assert.ok(r.results[0].issues[0].date);
  assert.equal(r.results[1].issues.length, 24);
  assert.equal(r.results[2].found, null);
  const l = await body(await lists.GET(req('/api/metron/lists?q=cata', { headers: H })));
  assert.equal(l.results[0].name, 'Cataclysm');
  const items = await body(await lists.GET(req('/api/metron/lists?id=27', { headers: H })));
  assert.equal(items.items.length, 5);
  assert.equal(items.items[3].type, 'TIE_IN');
  assert.equal(M.kindFromListType('Event', 'TIE_IN'), 'side');
  assert.equal(M.kindFromListType('Event', 'CORE'), 'event');
});
