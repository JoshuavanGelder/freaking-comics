// Acties die de UI aanroept: reducer uitvoeren + een melding met "Ongedaan maken".
import * as M from './model.js';
import { dispatch, getState, undo } from './store.js';
import { toast } from './ui.js';

const UNDO = { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } };

export function markVolumeRead(volumeId) {
  const v = M.getVolume(getState(), volumeId);
  if (!v) return;
  dispatch((s) => M.setReadStatus(s, volumeId, 'read'), { undoable: true });
  toast(`${M.volumeShortName(v)} uit!`, UNDO);
}

export function markNextRead(seriesId) {
  const r = dispatch((s) => M.markNextRead(s, seriesId), { undoable: true });
  if (!r.id) return;
  const s = getState();
  const v = M.getVolume(s, r.id);
  const series = M.getSeries(s, seriesId);
  const next = M.nextUp(s, seriesId);
  const msg = next
    ? `${M.volumeShortName(v)} uit! Volgende: ${M.volumeShortName(next)}`
    : `${M.volumeShortName(v)} uit! ${series.title} is helemaal gelezen.`;
  toast(msg, UNDO);
}

export function setReadStatus(volumeId, status) {
  dispatch((s) => M.setReadStatus(s, volumeId, status), { undoable: true });
}

export function setOwnership(volumeId, ownership, { announce = false } = {}) {
  const v = M.getVolume(getState(), volumeId);
  dispatch((s) => M.setOwnership(s, volumeId, ownership), { undoable: true });
  if (announce && v) toast(`${M.volumeShortName(v)}: ${M.OWN_LABELS[ownership].toLowerCase()}.`, UNDO);
}

export function toggleIssue(volumeId, issueId, read) {
  const before = M.getVolume(getState(), volumeId);
  dispatch((s) => M.setIssueRead(s, volumeId, issueId, read), { undoable: true });
  const after = M.getVolume(getState(), volumeId);
  if (before && after && before.readStatus !== 'read' && after.readStatus === 'read') {
    toast(`${M.volumeShortName(after)} uit!`, UNDO);
  }
}

export function markNextIssue(volumeId) {
  const v = M.getVolume(getState(), volumeId);
  const issue = v && M.nextIssue(v);
  if (!issue) return;
  toggleIssue(volumeId, issue.id, true);
}

export function setPaused(seriesId, paused) {
  const series = M.getSeries(getState(), seriesId);
  dispatch((s) => M.setPaused(s, seriesId, paused), { undoable: true });
  if (series) toast(paused ? `${series.title} staat op pauze.` : `${series.title} gaat weer verder.`, UNDO);
}

export function deleteSeries(seriesId) {
  const series = M.getSeries(getState(), seriesId);
  dispatch((s) => M.deleteSeries(s, seriesId), { undoable: true });
  if (series) toast(`${series.title} is verwijderd.`, UNDO);
}

export function deleteVolume(volumeId) {
  const v = M.getVolume(getState(), volumeId);
  dispatch((s) => M.deleteVolume(s, volumeId), { undoable: true });
  if (v) toast(`${M.volumeShortName(v)} is verwijderd.`, UNDO);
}

export function setRating(volumeId, rating) {
  const before = M.getVolume(getState(), volumeId);
  dispatch((s) => M.setRating(s, volumeId, rating), { undoable: true });
  const after = M.getVolume(getState(), volumeId);
  if (!before || !after) return;
  if (after.rating === 'top') toast('Top! Daar houden de aanraders rekening mee.', UNDO);
  else if (after.rating === 'niks') toast('Genoteerd: niks voor jou.', UNDO);
}
