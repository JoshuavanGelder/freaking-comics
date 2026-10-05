import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { seedState } from './fixtures/seed.js';

const T = '2026-01-01T00:00:00.000Z';

function flashFixture(readUpTo = 5, total = 9) {
  let s = M.emptyState();
  const r = M.addSeries(s, { title: 'The Flash', publisher: 'DC', color: 'red' }, T);
  s = r.state;
  const ids = [];
  for (let n = 1; n <= total; n += 1) {
    const v = M.addVolume(s, { seriesId: r.id, title: `Deel ${n}`, number: String(n), position: n }, T);
    s = v.state;
    ids.push(v.id);
    if (n <= readUpTo) s = M.setReadStatus(s, v.id, 'read', T);
  }
  return { s, seriesId: r.id, ids };
}

test('parseIssues: bereik en losse nummers', () => {
  const { issues, errors } = M.parseIssues('#0, #9–12, Annual #1', 'The Flash');
  assert.deepEqual(errors, []);
  assert.deepEqual(
    issues.map((i) => `${i.series} ${i.number}`),
    ['The Flash 0', 'The Flash 9', 'The Flash 10', 'The Flash 11', 'The Flash 12', 'The Flash Annual 1'],
  );
});

test('parseIssues: meerdere series per regel en punt-nummers', () => {
  const { issues } = M.parseIssues(
    'Ultimate Comics X-Men #13-14\nUltimate Comics Spider-Man #13; #20–21, #23.3',
    'Ultimate Comics',
  );
  assert.deepEqual(
    issues.map((i) => `${i.series} ${i.number}`),
    [
      'Ultimate Comics X-Men 13',
      'Ultimate Comics X-Men 14',
      'Ultimate Comics Spider-Man 13',
      'Ultimate Comics 20',
      'Ultimate Comics 21',
      'Ultimate Comics 23.3',
    ],
  );
});

test('parseIssues: kale nummers, dubbelen en fouten', () => {
  const { issues, errors } = M.parseIssues('1-3, 2, onzin, #5-2', 'X');
  assert.deepEqual(issues.map((i) => i.number), ['1', '2', '3']);
  assert.deepEqual(errors, ['onzin', '#5-2']);
});

test('formatIssues: compact en ingekort op context', () => {
  const { issues } = M.parseIssues('#30–35, Annual #3, Futures End #1, #23.3', 'The Flash');
  assert.equal(M.formatIssues(issues, 'The Flash'), '#30–35, #23.3, Annual #3, Futures End #1');
  const dwf = M.parseIssues('Ultimate Comics X-Men #13–18', 'Ultimate Comics').issues;
  assert.equal(M.formatIssues(dwf, 'Ultimate Comics'), 'X-Men #13–18');
});

test('nextUp: volgt na het laatst gelezen deel', () => {
  const { s, seriesId, ids } = flashFixture(5);
  assert.equal(M.nextUp(s, seriesId).id, ids[5]);
  const st = M.seriesStats(s, seriesId);
  assert.equal(st.readMain, 5);
  assert.equal(st.main, 9);
});

test('nextUp: een boek dat je leest gaat voor', () => {
  const { s: s0, seriesId, ids } = flashFixture(5);
  const s = M.setReadStatus(s0, ids[7], 'reading', T);
  assert.equal(M.nextUp(s, seriesId).id, ids[7]);
});

test('nextUp: zijverhalen worden overgeslagen, overgeslagen delen niet vergeten', () => {
  let { s, seriesId, ids } = flashFixture(4, 5);
  const side = M.addVolume(s, { seriesId, title: 'Tie-in', position: 4.5, isSide: true }, T);
  s = side.state;
  assert.equal(M.nextUp(s, seriesId).id, ids[4]);
  s = M.setReadStatus(s, ids[4], 'read', T);
  s = M.setReadStatus(s, ids[1], 'unread', T);
  // Alles na het laatste gelezen deel is uit, dus terug naar het gat.
  assert.equal(M.nextUp(s, seriesId).id, ids[1]);
});

test('seriesPhase en markNextRead', () => {
  let { s, seriesId } = flashFixture(8, 9);
  const series = M.getSeries(s, seriesId);
  assert.equal(M.seriesPhase(s, series), 'active');
  const r = M.markNextRead(s, seriesId, T);
  s = r.state;
  assert.equal(M.seriesPhase(s, M.getSeries(s, seriesId)), 'done');
  assert.equal(M.nextUp(s, seriesId), null);
  assert.equal(M.markNextRead(s, seriesId, T).id, null);
});

test('seriesPhase: alleen series met een deel in bezit komen op de stapel', () => {
  let { s, seriesId, ids } = flashFixture(0, 3);
  const phase = () => M.seriesPhase(s, M.getSeries(s, seriesId));
  // Niets in bezit: niet op de stapel.
  assert.equal(phase(), 'unowned');
  // Alleen op de verlanglijst: ook niet.
  s = M.setOwnership(s, ids[0], 'wishlist', T);
  assert.equal(phase(), 'unowned');
  assert.equal(M.seriesByPhase(s, 'new').length, 0);
  // Een deel in bezit: wel.
  s = M.setOwnership(s, ids[1], 'owned', T);
  assert.equal(phase(), 'new');
  assert.equal(M.seriesByPhase(s, 'new').length, 1);
  // Lezen gaat boven bezit.
  s = M.setReadStatus(s, ids[1], 'reading', T);
  assert.equal(phase(), 'active');
});

test('pauze: lezen hervat de serie', () => {
  let { s, seriesId, ids } = flashFixture(2, 4);
  s = M.setPaused(s, seriesId, true, T);
  assert.equal(M.seriesPhase(s, M.getSeries(s, seriesId)), 'paused');
  assert.equal(M.continueReading(s).length, 0);
  s = M.setReadStatus(s, ids[2], 'read', T);
  assert.equal(M.getSeries(s, seriesId).paused, false);
});

test('setIssueRead: status van het boek volgt de issues', () => {
  let s = M.emptyState();
  const r = M.addSeries(s, { title: 'Ultimate Comics' }, T);
  const issues = M.parseIssues('#1-2', 'Ultimate Comics').issues;
  const v = M.addVolume(r.state, { seriesId: r.id, title: 'Boek', issues }, T);
  s = v.state;
  const [a, b] = M.getVolume(s, v.id).issues;
  s = M.setIssueRead(s, v.id, a.id, true, T);
  assert.equal(M.getVolume(s, v.id).readStatus, 'reading');
  assert.equal(M.nextIssue(M.getVolume(s, v.id)).id, b.id);
  s = M.setIssueRead(s, v.id, b.id, true, T);
  assert.equal(M.getVolume(s, v.id).readStatus, 'read');
  assert.ok(M.getVolume(s, v.id).readAt);
  s = M.setIssueRead(s, v.id, b.id, false, T);
  assert.equal(M.getVolume(s, v.id).readStatus, 'reading');
  s = M.setReadStatus(s, v.id, 'unread', T);
  assert.ok(M.getVolume(s, v.id).issues.every((i) => !i.read));
});

test('updateVolume behoudt gelezen issues bij een nieuwe issue-lijst', () => {
  let s = M.emptyState();
  const r = M.addSeries(s, { title: 'X' }, T);
  const v = M.addVolume(r.state, { seriesId: r.id, title: 'B', issues: M.parseIssues('#1-3', 'X').issues }, T);
  s = v.state;
  const first = M.getVolume(s, v.id).issues[0];
  s = M.setIssueRead(s, v.id, first.id, true, T);
  s = M.updateVolume(s, v.id, { issues: M.parseIssues('#1-4', 'X').issues }, T);
  const vol = M.getVolume(s, v.id);
  assert.equal(vol.issues.length, 4);
  assert.equal(vol.issues[0].read, true);
  assert.equal(vol.issues[0].id, first.id);
  assert.equal(vol.readStatus, 'reading');
});

test('reducers laten de oude state ongemoeid', () => {
  const { s, ids } = flashFixture(1, 2);
  const before = JSON.stringify(s);
  M.setReadStatus(s, ids[1], 'read', T);
  M.setOwnership(s, ids[1], 'wishlist', T);
  M.deleteVolume(s, ids[0]);
  assert.equal(JSON.stringify(s), before);
});

test('validatie', () => {
  assert.throws(() => M.addSeries(M.emptyState(), { title: '  ' }));
  assert.throws(() => M.addVolume(M.emptyState(), { seriesId: 'nope', title: 'x' }));
  assert.throws(() => M.normalizeState({ foo: 1 }));
  assert.throws(() => M.normalizeState({ version: 99, series: [], volumes: [] }));
});

test('normalizeState: round-trip en wezen worden weggelaten', () => {
  const seed = seedState();
  const copy = M.normalizeState(JSON.parse(JSON.stringify(seed)));
  assert.deepEqual(copy, seed);
  const orphan = M.normalizeState({ series: [], volumes: [{ id: 'v1', seriesId: 'weg', title: 'x' }] });
  assert.equal(orphan.volumes.length, 0);
});

test('startdata klopt met het plan', () => {
  const s = seedState();
  const flash = s.series.find((x) => x.title === 'The Flash');
  const next = M.nextUp(s, flash.id);
  assert.equal(M.volumeName(next), 'Vol. 6: Out of Time');
  const cont = M.continueReading(s).map((x) => x.title);
  assert.deepEqual(cont, ['The Flash', 'Ultimate Comics']);
  const ult = s.series.find((x) => x.title === 'Ultimate Comics');
  const dwf = M.nextUp(s, ult.id);
  assert.equal(dwf.title, 'Divided We Fall, United We Stand');
  assert.equal(dwf.issues.length, 18);
  assert.equal(dwf.ownership, 'owned');
});

test('issuesToText: terug te lezen zonder verlies', () => {
  const cases = [
    ['#0, #9–12, Annual #1, Futures End #1, #23.3', 'The Flash'],
    ['Ultimate Comics Ultimates #13–18\nUltimate Comics X-Men #13–18', 'Ultimate Comics'],
  ];
  for (const [text, ctx] of cases) {
    const a = M.parseIssues(text, ctx).issues;
    const b = M.parseIssues(M.issuesToText(a, ctx), ctx).issues;
    const key = (l) => l.map((i) => `${i.series}|${i.number}`).sort();
    assert.deepEqual(key(b), key(a));
  }
  assert.equal(M.issuesToText(M.parseIssues('#1-3, Annual #1', 'X').issues, 'X'), '#1–3\nX Annual #1');
});

test('waardering: Top/Niks per boek, nogmaals tikken haalt weg; komt in het leesprofiel', () => {
  let state = seedState();
  const flash = state.series.find((s) => s.title === 'The Flash');
  const v = M.volumesOf(state, flash.id)[0];
  state = M.setRating(state, v.id, 'top');
  assert.equal(M.getVolume(state, v.id).rating, 'top');
  assert.match(M.tasteProfile(state), /## The Flash[\s\S]*Move Forward.*gelezen, vond ik TOP/);
  state = M.setRating(state, v.id, 'niks');
  assert.equal(M.getVolume(state, v.id).rating, 'niks');
  state = M.setRating(state, v.id, 'niks');
  assert.equal(M.getVolume(state, v.id).rating, null);
  // Blijft bewaard bij sync/import
  state = M.setRating(state, v.id, 'top');
  assert.equal(M.getVolume(M.normalizeState(JSON.parse(JSON.stringify(state))), v.id).rating, 'top');
  assert.equal(M.getVolume(M.updateVolume(state, v.id, { note: 'mooi' }), v.id).rating, 'top');
});

test('aanraders bijwerken: alleen als de kast of een status veranderd is, of er < 3 over zijn', () => {
  let state = seedState();
  const basedOn = M.profileHash(M.tasteProfile(state));
  const at = '2026-09-29T08:00:00.000Z';
  assert.equal(M.recsNeedUpdate(state, { generatedAt: null, basedOn: null, visibleCount: 0 }), true);
  assert.equal(M.recsNeedUpdate(state, { generatedAt: at, basedOn, visibleCount: 6 }), false);
  assert.equal(M.recsNeedUpdate(state, { generatedAt: at, basedOn, visibleCount: 2 }), true);
  const flash = state.series.find((s) => s.title === 'The Flash');
  const v = M.volumesOf(state, flash.id).find((x) => x.readStatus !== 'read');
  assert.equal(M.recsNeedUpdate(M.setReadStatus(state, v.id, 'read'), { generatedAt: at, basedOn, visibleCount: 6 }), true);
  assert.equal(M.recsNeedUpdate(M.setOwnership(state, v.id, 'owned'), { generatedAt: at, basedOn, visibleCount: 6 }), true);
  // Iets wat niet in het profiel zit (bijv. een notitie) telt niet
  assert.equal(M.recsNeedUpdate(M.updateVolume(state, v.id, { note: 'leuk' }), { generatedAt: at, basedOn, visibleCount: 6 }), false);
});
