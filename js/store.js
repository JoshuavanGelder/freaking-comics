// Opslag: houdt de state bij, bewaart hem in localStorage en seint de UI bij wijzigingen.
import { normalizeState, emptyState } from './model.js';
import { seedState } from './seed.js';

const KEY = 'freaking-comics:v1';

let state = emptyState();
let undoSnapshot = null;
let storageOk = true;
const listeners = new Set();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = normalizeState(JSON.parse(raw));
      return { fresh: false };
    }
  } catch {
    // Kapotte opslag: begin opnieuw met de startdata, maar gooi de oude niet weg.
    try {
      localStorage.setItem(`${KEY}:kapot:${Date.now()}`, localStorage.getItem(KEY) || '');
    } catch { /* niets aan te doen */ }
  }
  state = seedState();
  save();
  return { fresh: true };
}

export const getState = () => state;
export const isStorageOk = () => storageOk;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Voert een reducer uit. `fn` krijgt de state en geeft een nieuwe state terug,
 * of een object `{ state, ...extra }`; dat object komt terug bij de aanroeper.
 */
export function dispatch(fn, { undoable = false } = {}) {
  const prev = state;
  const result = fn(state);
  const next = result && result.state && Array.isArray(result.state.series) ? result.state : result;
  if (next !== prev) {
    undoSnapshot = undoable ? prev : null;
    state = next;
    save();
    notify();
  }
  return result;
}

export function canUndo() {
  return undoSnapshot !== null;
}

export function undo() {
  if (!undoSnapshot) return;
  state = undoSnapshot;
  undoSnapshot = null;
  save();
  notify();
}

export function exportJson() {
  return JSON.stringify({ app: 'freaking-comics', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export function importJson(text) {
  const parsed = normalizeState(JSON.parse(text));
  undoSnapshot = state;
  state = parsed;
  save();
  notify();
  return parsed;
}

export function replaceAll(next) {
  undoSnapshot = state;
  state = next;
  save();
  notify();
}

export function resetToSeed() {
  replaceAll(seedState());
}
