import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { seedState } from '../js/seed.js';

const T1 = '2026-09-01T10:00:00.000Z';
const T2 = '2026-09-02T10:00:00.000Z';
const T3 = '2026-09-03T10:00:00.000Z';

function base() {
  let s = M.emptyState();
  const r = M.addSeries(s, { title: 'The Flash' }, T1);
  s = r.state;
  const a = M.addVolume(s, { seriesId: r.id, title: 'A', number: '1', position: 1 }, T1);
  const b = M.addVolume(a.state, { seriesId: r.id, title: 'B', number: '2', position: 2 }, T1);
  return { s: b.state, seriesId: r.id, a: a.id, b: b.id };
}

test('mergeStates: nieuwste wijziging per volume wint', () => {
  const { s, a, b } = base();
  const phone = M.setReadStatus(s, a, 'read', T2);
  const laptop = M.setOwnership(s, b, 'owned', T3);
  const merged = M.mergeStates(phone, laptop, T3);
  assert.equal(M.getVolume(merged, a).readStatus, 'read');
  assert.equal(M.getVolume(merged, b).ownership, 'owned');
  // en andersom geeft hetzelfde resultaat
  assert.ok(M.sameState(merged, M.mergeStates(laptop, phone, T3)));
});

test('mergeStates: verwijderd blijft verwijderd', () => {
  const { s, a } = base();
  const phone = M.deleteVolume(s, a, T2);
  const merged = M.mergeStates(s, phone, T2);
  assert.equal(M.getVolume(merged, a), null);
  const merged2 = M.mergeStates(phone, s, T2);
  assert.equal(M.getVolume(merged2, a), null);
});

test('mergeStates: aanpassen na verwijderen op ander apparaat wint', () => {
  const { s, a } = base();
  const phone = M.deleteVolume(s, a, T2);
  const laptop = M.setReadStatus(s, a, 'read', T3);
  const merged = M.mergeStates(phone, laptop, T3);
  assert.equal(M.getVolume(merged, a).readStatus, 'read');
});

test('mergeStates: serie verwijderen haalt ook de volumes weg', () => {
  const { s, seriesId, b } = base();
  const phone = M.deleteSeries(s, seriesId, T2);
  const merged = M.mergeStates(s, phone, T2);
  assert.equal(merged.series.length, 0);
  assert.equal(M.getVolume(merged, b), null);
});

test('mergeStates: oude v1-data wordt netjes opgewaardeerd', () => {
  const old = JSON.parse(JSON.stringify(seedState()));
  delete old.deleted;
  old.version = 1;
  old.series.forEach((x) => delete x.updatedAt);
  const merged = M.mergeStates(old, M.emptyState());
  assert.equal(merged.version, 2);
  assert.equal(merged.series.length, 2);
  assert.ok(merged.series.every((x) => x.updatedAt));
});

test('Metron-namen ontleden', () => {
  assert.deepEqual(M.splitMetronSeriesName('The Flash TPB (2012)'), { name: 'The Flash', year: '2012' });
  assert.deepEqual(M.splitMetronSeriesName('Saga (2012)'), { name: 'Saga', year: '2012' });
  assert.deepEqual(M.parseReprint('The Flash (2011) #23.3'), { series: 'The Flash', number: '23.3' });
  assert.deepEqual(M.parseReprint('The Flash Annual (2012) #1'), { series: 'The Flash Annual', number: '1' });
  assert.equal(M.formatFromMetronType('Trade Paperback'), 'trade');
  assert.equal(M.formatFromMetronType('Hardcover'), 'hardcover');
  assert.equal(M.formatFromMetronType('Ongoing Series'), 'issue');
  assert.ok(M.isCollectedType('Omnibus'));
  assert.ok(!M.isCollectedType('Ongoing Series'));
});

const metronFlash = [
  { id: 106, number: '6', title: 'Out of Time', image: 'https://static.metron.cloud/6.jpg', store_date: '2015-02-11',
    reprints: [{ id: 1, issue: 'The Flash (2011) #30' }, { id: 2, issue: 'The Flash (2011) #31' }, { id: 3, issue: 'The Flash Annual (2012) #3' }] },
  { id: 101, number: '1', title: 'Move Forward', image: 'https://static.metron.cloud/1.jpg', store_date: '2012-10-10', reprints: [{ id: 9, issue: 'The Flash (2011) #1' }] },
  { id: 110, number: '10', title: 'Nieuw Deel', image: null, store_date: '2099-01-01', reprints: [] },
];

test('applyMetronItems: koppelt bestaande delen en behoudt je leesstatus', () => {
  const s0 = seedState();
  const flash = s0.series.find((x) => x.title === 'The Flash');
  const { state, added, updated } = M.applyMetronItems(s0, flash.id, metronFlash, 'trade', { now: T3 });
  const vols = M.volumesOf(state, flash.id);
  const v1 = vols.find((v) => v.number === '1');
  const v6 = vols.find((v) => v.number === '6');
  assert.equal(v1.readStatus, 'read');
  assert.equal(v1.issues.length, 1);
  assert.equal(v1.issues[0].read, true);
  assert.equal(v1.metronId, 101);
  assert.equal(v1.cover, 'https://static.metron.cloud/1.jpg');
  assert.equal(v6.issues.length, 3);
  assert.equal(M.formatIssues(v6.issues, 'The Flash'), '#30–31, Annual #3');
  assert.equal(v6.storeDate, '2015-02-11');
  assert.equal(updated.length, 2);
  assert.equal(added.length, 1);
  const v10 = M.getVolume(state, added[0]);
  assert.equal(v10.number, '10');
  assert.equal(v10.position, 10);
  assert.equal(v10.isNew, false);
  assert.equal(M.upcoming(state, '2026-09-28')[0].id, v10.id);
  // Bladwijzer staat nog steeds op 6
  assert.equal(M.nextUp(state, flash.id).number, '6');
});

test('applyMetronItems: nogmaals toepassen verandert niets; nieuwe delen krijgen label', () => {
  const s0 = seedState();
  const flash = s0.series.find((x) => x.title === 'The Flash');
  const first = M.applyMetronItems(s0, flash.id, metronFlash, 'trade', { now: T2 }).state;
  const again = M.applyMetronItems(first, flash.id, metronFlash, 'trade', { now: T3, markNew: true });
  assert.equal(again.added.length, 0);
  assert.equal(again.updated.length, 0);
  const extra = [...metronFlash, { id: 111, number: '11', title: 'Nog Nieuwer', reprints: [] }];
  const r = M.applyMetronItems(first, flash.id, extra, 'trade', { now: T3, markNew: true });
  assert.equal(r.added.length, 1);
  assert.equal(M.getVolume(r.state, r.added[0]).isNew, true);
  assert.equal(M.newVolumes(r.state).length, 1);
  const seen = M.markSeen(r.state, r.added[0], T3);
  assert.equal(M.newVolumes(seen).length, 0);
});

test('applyMetronItems: gelezen issues blijven gelezen', () => {
  const s0 = seedState();
  const flash = s0.series.find((x) => x.title === 'The Flash');
  let s = M.applyMetronItems(s0, flash.id, metronFlash, 'trade', { now: T2 }).state;
  const v6 = M.volumesOf(s, flash.id).find((v) => v.number === '6');
  s = M.setIssueRead(s, v6.id, v6.issues[0].id, true, T2);
  const more = metronFlash.map((x) => (x.id === 106 ? { ...x, reprints: [...x.reprints, { id: 4, issue: 'The Flash (2011) #32' }] } : x));
  s = M.applyMetronItems(s, flash.id, more, 'trade', { now: T3 }).state;
  const after = M.getVolume(s, v6.id);
  assert.equal(after.issues.length, 4);
  assert.equal(after.issues[0].read, true);
  assert.equal(after.readStatus, 'reading');
});

test('linkVolumeToMetron: los boek krijgt cover en issues, gelezen blijft gelezen', () => {
  let s = seedState();
  const dwf = s.volumes.find((v) => v.title.startsWith('Divided'));
  const iron = s.volumes.find((v) => v.title.includes('Iron Man'));
  const item = { id: 20001, number: '1', title: '', image: 'https://static.metron.cloud/dwf.jpg', store_date: '2013-01-02',
    reprints: [{ id: 1, issue: 'Ultimate Comics X-Men (2011) #13' }, { id: 2, issue: 'Ultimate Comics X-Men (2011) #19' }] };
  s = M.linkVolumeToMetron(s, dwf.id, item, 'hardcover', T3);
  const after = M.getVolume(s, dwf.id);
  assert.equal(after.title, 'Divided We Fall, United We Stand');
  assert.equal(after.metronId, 20001);
  assert.equal(after.cover, 'https://static.metron.cloud/dwf.jpg');
  // Metron is leidend voor de inhoud: de lijst wordt die van Metron.
  assert.deepEqual(after.issues.map((i) => i.number), ['13', '19']);
  s = M.linkVolumeToMetron(s, iron.id, { id: 5, number: '1', title: 'x', reprints: [{ id: 3, issue: 'Ultimate Comics Iron Man (2012) #1' }] }, 'trade', T3);
  assert.equal(M.getVolume(s, iron.id).readStatus, 'read');
  assert.equal(M.getVolume(s, iron.id).issues[0].read, true);
  assert.equal(M.publisherFromMetron('DC Comics'), 'DC');
});

test('adoptState: ongedaan maken overleeft een sync', () => {
  const { s, a } = base();
  const done = M.setReadStatus(s, a, 'read', T2); // wijziging, al naar de server
  const server = done;
  const undone = M.adoptState(done, s, T3); // ongedaan maken
  assert.equal(M.getVolume(undone, a).readStatus, 'unread');
  const merged = M.mergeStates(server, undone, T3);
  assert.equal(M.getVolume(merged, a).readStatus, 'unread');
});

test('adoptState: alles wissen wist ook op de server', () => {
  const { s } = base();
  const wiped = M.adoptState(s, M.emptyState(), T2);
  const merged = M.mergeStates(s, wiped, T2);
  assert.equal(merged.series.length, 0);
  assert.equal(merged.volumes.length, 0);
});
