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

function ongoing(count, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({ id: 70000 + offset + i, number: String(i + 1), title: '', issue: `The Flash (1987) #${i + 1}`, image: `https://static.metron.cloud/o${i}.jpg`, store_date: '1987-01-01' }));
}

test('unlinkMetron: verkeerde koppeling (losse nummers) netjes terugdraaien', () => {
  const s0 = seedState();
  const flash = s0.series.find((x) => x.title === 'The Flash');
  let s = M.updateSeries(s0, flash.id, { metron: { id: 1, name: 'The Flash (1987)', type: 'Ongoing Series', linkedAt: T3 } }, T3);
  s = M.applyMetronItems(s, flash.id, ongoing(400), 'issue', { now: T3 }).state;
  assert.equal(M.volumesOf(s, flash.id).length, 400);
  // Je leest intussen per ongeluk "issue" 20 → dat deel blijft staan
  const v20 = M.volumesOf(s, flash.id).find((v) => v.number === '20');
  s = M.setOwnership(s, v20.id, 'owned', T3);
  const plan = M.planUnlink(s, flash.id);
  assert.equal(plan.remove.length, 390);
  s = M.unlinkMetron(s, flash.id, T3);
  const vols = M.volumesOf(s, flash.id);
  assert.equal(vols.length, 10);
  const v6 = vols.find((v) => v.title === 'Out of Time');
  assert.equal(v6.format, 'trade');
  assert.equal(v6.cover, null);
  assert.equal(v6.metronId, null);
  assert.equal(M.getSeries(s, flash.id).metron, null);
  assert.equal(M.nextUp(s, flash.id).title, 'Out of Time');
  assert.equal(M.seriesStats(s, flash.id).readMain, 5);
  // Na sync met de oude (kapotte) serverversie blijft het opgeruimd
  const merged = M.mergeStates(s, s, T3);
  assert.equal(M.volumesOf(merged, flash.id).length, 10);
});

test('unlinkMetron: oude koppeling zonder markeringen (zoals vanochtend)', () => {
  const s0 = seedState();
  const flash = s0.series.find((x) => x.title === 'The Flash');
  let s = M.updateSeries(s0, flash.id, { metron: { id: 1, name: 'The Flash (1987)', type: 'Ongoing Series' } }, T3);
  s = M.applyMetronItems(s, flash.id, ongoing(300), 'issue', { now: '2026-09-29T06:01:12.000Z' }).state;
  s = M.applyMetronItems(s, flash.id, ongoing(300, 1000), 'issue', { now: '2026-09-29T06:02:01.000Z' }).state;
  // Nabootsen van oude data: de nieuwe markeringen bestaan nog niet
  s = { ...s, volumes: s.volumes.map((v) => ({ ...v, fromMetron: false, preMetron: null })) };
  assert.ok(M.volumesOf(s, flash.id).length > 500);
  s = M.unlinkMetron(s, flash.id, T3);
  const vols = M.volumesOf(s, flash.id);
  assert.deepEqual(vols.map((v) => v.title), ['Move Forward', 'Rogues Revolution', 'Gorilla Warfare', 'Reverse', 'History Lessons', 'Out of Time', 'Savage World', 'Zoom', 'Full Stop']);
  assert.ok(vols.every((v) => v.format === 'trade' && v.metronId == null && v.cover == null));
});

test('leesroute: zijverhalen, + Toch lezen, alleen hoofdverhaal', () => {
  let s = seedState();
  const ult = s.series.find((x) => x.title === 'Ultimate Comics');
  const r = M.applyRouteTemplate(s, ult.id, M.ULTIMATE_ROUTE, T3);
  s = r.state;
  assert.equal(r.added, 10);
  assert.equal(r.matched, 2);
  const vols = M.volumesOf(s, ult.id);
  assert.equal(vols.length, 12);
  assert.equal(vols[0].title, 'Ultimate Fallout');
  assert.equal(vols[6].title, 'Divided We Fall, United We Stand');
  assert.equal(vols[6].readStatus, 'reading');
  assert.equal(vols[6].issues.length, 18);
  const iron = vols.find((v) => v.title.includes('Iron Man'));
  assert.equal(iron.kind, 'side');
  assert.equal(iron.readStatus, 'read');
  // Route: 3 events + 4 hoofdverhaal + Iron Man (gelezen) = 8
  assert.equal(M.routeVolumes(s, ult.id).length, 8);
  const hawkeye = vols.find((v) => v.title.includes('Hawkeye'));
  s = M.setInRoute(s, hawkeye.id, true, T3);
  assert.equal(M.routeVolumes(s, ult.id).length, 9);
  s = M.setMainOnly(s, ult.id, false, T3);
  assert.equal(M.routeVolumes(s, ult.id).length, 12);
  s = M.setMainOnly(s, ult.id, true, T3);
  // Bladwijzer: DWF (bezig)
  assert.equal(M.nextUp(s, ult.id).title, 'Divided We Fall, United We Stand');
  s = M.setReadStatus(s, vols[6].id, 'read', T3);
  // Daarna: Wolverine is zijverhaal (niet in route) → vanaf #19
  assert.equal(M.nextUp(s, ult.id).title, 'Ultimates, X-Men en Spider-Man vanaf #19');
  // Nogmaals toepassen voegt niets dubbel toe
  assert.equal(M.applyRouteTemplate(s, ult.id, M.ULTIMATE_ROUTE, T3).added, 0);
});

test('moveVolume wisselt twee delen van plek', () => {
  let s = seedState();
  const flash = s.series.find((x) => x.title === 'The Flash');
  const [v1, v2] = M.volumesOf(s, flash.id);
  s = M.moveVolume(s, v2.id, -1, T3);
  const after = M.volumesOf(s, flash.id);
  assert.equal(after[0].id, v2.id);
  assert.equal(after[1].id, v1.id);
});

test('meerdere reeksen: toevoegen, apart ontkoppelen', () => {
  let s = seedState();
  const ult = s.series.find((x) => x.title === 'Ultimate Comics');
  const a = { id: 10, name: 'Ultimate Comics Ultimates (2011)', type: 'Comic Vine', source: 'comicvine' };
  const b = { id: 20, name: 'Ultimate Comics X-Men (2011)', type: 'Comic Vine', source: 'comicvine' };
  s = M.addLink(s, ult.id, a, T3);
  s = M.applyMetronItems(s, ult.id, [{ id: 1, number: '1', title: 'The Republic Is Burning' }, { id: 2, number: '2', title: 'Two' }], 'trade', { linkKey: 'comicvine:10', umbrella: 'Ultimates', now: T3 }).state;
  s = M.addLink(s, ult.id, b, T3);
  s = M.applyMetronItems(s, ult.id, [{ id: 1, number: '1', title: 'Blood' }], 'trade', { linkKey: 'comicvine:20', umbrella: 'X-Men', now: T3 }).state;
  assert.equal(M.seriesLinks(M.getSeries(s, ult.id)).length, 2);
  const titles = M.volumesOf(s, ult.id).map((v) => v.title);
  assert.ok(titles.includes('Ultimates Vol. 1: The Republic Is Burning'));
  assert.ok(titles.includes('X-Men Vol. 1: Blood'));
  assert.equal(M.volumesOf(s, ult.id).length, 5);
  // Alleen X-Men ontkoppelen
  s = M.unlinkMetron(s, ult.id, T3, 'comicvine:20');
  assert.equal(M.volumesOf(s, ult.id).length, 4);
  const left = M.seriesLinks(M.getSeries(s, ult.id));
  assert.deepEqual(left.map((l) => l.id), [10]);
  // Nu de eerste: alles weg wat die toevoegde, eigen boeken blijven
  s = M.unlinkMetron(s, ult.id, T3, 'comicvine:10');
  assert.equal(M.volumesOf(s, ult.id).length, 2);
  assert.equal(M.seriesLinks(M.getSeries(s, ult.id)).length, 0);
});

test('addVolumeFromSource: los boek met cover en issues', () => {
  let s = seedState();
  const ult = s.series.find((x) => x.title === 'Ultimate Comics');
  const r = M.addVolumeFromSource(s, ult.id, { id: 5, number: '1', title: '', image: 'https://x/y.jpg', reprints: [{ id: 1, issue: 'Hunger #1' }] }, 'trade', { reeksName: 'Hunger', now: T3 });
  const v = M.getVolume(r.state, r.id);
  assert.equal(v.title, 'Hunger');
  assert.equal(v.cover, 'https://x/y.jpg');
  assert.equal(v.metronId, 5);
  assert.equal(v.fromMetron, false);
  assert.equal(v.issues.length, 1);
});

test('reeks in leesroute vervangt het algemene routedeel en slaat dubbele inhoud over', () => {
  let s = seedState();
  const ult = s.series.find((x) => x.title === 'Ultimate Comics');
  s = M.applyRouteTemplate(s, ult.id, M.ULTIMATE_ROUTE, T3).state;
  const posGeneric = M.volumesOf(s, ult.id).find((v) => v.title === 'Ultimate Comics X-Men Vol. 1–2').position;
  const items = [
    { id: 1, number: '1', title: 'Blood', reprints: [1, 2, 3, 4, 5, 6].map((n) => ({ issue: `Ultimate Comics X-Men #${n}` })) },
    { id: 2, number: '2', title: 'Divided We Fall', reprints: [13, 14, 15, 16, 17, 18].map((n) => ({ issue: `Ultimate Comics X-Men #${n}` })) },
    { id: 3, number: '3', title: 'Two', reprints: [7, 8, 9, 10, 11, 12].map((n) => ({ issue: `Ultimate Comics X-Men #${n}` })) },
  ];
  const r = M.applyMetronItems(s, ult.id, items, 'trade', { linkKey: 'comicvine:44', umbrella: 'X-Men', now: T3 });
  s = r.state;
  const titles = M.volumesOf(s, ult.id).map((v) => v.title);
  assert.equal(r.added.length, 2); // "Divided We Fall" zit al in de hardcover
  assert.ok(!titles.includes('Ultimate Comics X-Men Vol. 1–2'));
  const blood = M.volumesOf(s, ult.id).find((v) => v.title === 'X-Men Vol. 1: Blood');
  assert.ok(blood.position > posGeneric && blood.position < posGeneric + 1);
  assert.equal(titles.indexOf('X-Men Vol. 1: Blood') + 1, titles.indexOf('X-Men Vol. 3: Two'));
});
