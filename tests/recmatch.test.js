import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMatch, cleanMetronName } from '../api/_lib/recmatch.js';
import * as M from '../js/model.js';

const cv = (score, extra = {}) => ({ id: 11, name: 'Flash', start_year: 2013, count_of_issues: 9, image: 'cv.jpg', score, ...extra });
const metron = (score, extra = {}) => ({ id: 22, name: 'Flash TPB (2013)', year: 2013, issueCount: 9, score, ...extra });

test('chooseMatch: Metron moet duidelijk beter passen, anders blijft het Comic Vine', () => {
  assert.equal(chooseMatch(cv(10), metron(10)).source, 'comicvine');
  assert.equal(chooseMatch(cv(10), metron(11)).source, 'comicvine'); // precies 1 punt verschil telt niet
  assert.equal(chooseMatch(cv(7), metron(10.5)).source, 'metron');
  assert.equal(chooseMatch(null, metron(5)).source, 'metron');
  assert.equal(chooseMatch(cv(5), null).source, 'comicvine');
  assert.equal(chooseMatch(null, null), null);
  const m = chooseMatch(cv(7), metron(10.5));
  assert.deepEqual({ id: m.id, name: m.name, year: m.year, issueCount: m.issueCount }, { id: 22, name: 'Flash', year: 2013, issueCount: 9 });
});

test('cleanMetronName haalt jaartal en uitgavevorm weg', () => {
  assert.equal(cleanMetronName('Flash TPB (2013)'), 'Flash');
  assert.equal(cleanMetronName('The Flash by Geoff Johns Omnibus (2010)'), 'The Flash by Geoff Johns');
  assert.equal(cleanMetronName('Saga'), 'Saga');
});

test('recMatch en recInShelf kennen beide bronnen en oude aanraders met alleen cv', () => {
  assert.deepEqual(M.recMatch({ cv: { id: 5, image: 'a' } }), { id: 5, image: 'a', source: 'comicvine' });
  assert.equal(M.recMatch({ match: { source: 'metron', id: 7 } }).source, 'metron');
  assert.equal(M.recMatch({ cv: null, match: null }), null);
  const keys = new Set(['comicvine:5', 'metron:7']);
  assert.equal(M.recInShelf({ cv: { id: 5 } }, keys), true);
  assert.equal(M.recInShelf({ match: { source: 'metron', id: 7 } }, keys), true);
  assert.equal(M.recInShelf({ match: { source: 'metron', id: 5 } }, keys), false);
  assert.equal(M.recInShelf({}, keys), false);
});
