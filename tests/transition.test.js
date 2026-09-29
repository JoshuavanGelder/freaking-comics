import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionKind, depth } from '../js/transition.js';

test('tabbladen onderling knallen erin', () => {
  assert.equal(transitionKind('/', '/kast'), 'tab');
  assert.equal(transitionKind('/verlanglijst', '/aanraders'), 'tab');
});

test('dieper de app in schuift vooruit, terug schuift terug', () => {
  assert.equal(transitionKind('/kast', '/serie/abc'), 'fwd');
  assert.equal(transitionKind('/serie/abc', '/volume/v1'), 'fwd');
  assert.equal(transitionKind('/volume/v1', '/volume/v1/bewerken'), 'fwd');
  assert.equal(transitionKind('/zoeken', '/reeks/comicvine/53722'), 'fwd');
  assert.equal(transitionKind('/volume/v1', '/serie/abc'), 'back');
  assert.equal(transitionKind('/serie/abc/bewerken', '/serie/abc'), 'back');
  assert.equal(transitionKind('/serie/abc', '/kast'), 'back');
});

test('geen animatie bij de eerste keer of hetzelfde scherm', () => {
  assert.equal(transitionKind(null, '/'), null);
  assert.equal(transitionKind('/kast', '/kast'), null);
});

test('diepte per scherm', () => {
  assert.equal(depth('/'), 0);
  assert.equal(depth('/instellingen'), 1);
  assert.equal(depth('/serie/abc/route'), 2);
  assert.equal(depth('/serie/nieuw'), 4);
  assert.equal(depth('/toevoegen'), 4);
});
