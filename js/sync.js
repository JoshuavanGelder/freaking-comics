// Automatische sync: bij openen, na elke wijziging (even wachten), bij terugkomen in de app en elke 5 minuten.
import { api, isConnected } from './api.js';
import { getState, setFromSync, subscribe } from './store.js';
import { mergeStates, sameState, normalizeState } from './model.js';

const EPOCH_KEY = 'freaking-comics:epoch';

export function getEpoch() {
  try {
    return localStorage.getItem(EPOCH_KEY) || null;
  } catch {
    return null;
  }
}

export function setEpoch(epoch) {
  try {
    if (epoch) localStorage.setItem(EPOCH_KEY, epoch);
    else localStorage.removeItem(EPOCH_KEY);
  } catch { /* niets aan te doen */ }
}

const listeners = new Set();
const status = { state: 'off', lastSyncedAt: null, error: null, rev: 0 };
let timer = null;
let running = null;
let again = false;

function setStatus(patch) {
  Object.assign(status, patch);
  listeners.forEach((fn) => fn(status));
}

export const syncStatus = () => ({ ...status });
export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Eén sync-ronde: stuur de lokale kast, krijg de samengevoegde terug. `join`: bewust samenvoegen bij koppelen. */
export function syncNow({ join = false } = {}) {
  if (!isConnected()) {
    setStatus({ state: 'off' });
    return Promise.resolve(null);
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setStatus({ state: 'syncing', error: null });
    try {
      const sent = getState();
      const res = await api('/api/sync', { method: 'POST', body: { state: sent, epoch: getEpoch(), join } });
      setEpoch(res.epoch || null);
      if (res.reset) {
        // De kast is op een ander apparaat gewist: neem de serverkast over.
        setFromSync(res.state);
        setStatus({ state: 'ok', lastSyncedAt: new Date().toISOString(), rev: res.rev });
        return res;
      }
      // Wat er tijdens het wachten lokaal veranderde, gaat niet verloren.
      const local = getState();
      const merged = local === sent ? normalizeState(res.state) : mergeStates(res.state, local);
      if (!sameState(merged, local)) setFromSync(merged);
      if (!sameState(merged, res.state)) again = true;
      setStatus({ state: 'ok', lastSyncedAt: new Date().toISOString(), rev: res.rev });
      return res;
    } catch (err) {
      setStatus({ state: err.status === 0 ? 'offline' : 'error', error: err.message });
      return null;
    } finally {
      running = null;
      if (again) {
        again = false;
        schedule(1500);
      }
    }
  })();
  return running;
}

function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

/** Haalt de kast van de server op zonder iets te sturen (voor de keuze bij koppelen). */
export async function fetchRemote() {
  return api('/api/sync');
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  subscribe((source) => {
    if (source !== 'sync' && isConnected()) schedule(1500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isConnected()) syncNow();
  });
  window.addEventListener('online', () => isConnected() && syncNow());
  setInterval(() => {
    if (document.visibilityState === 'visible' && isConnected()) syncNow();
  }, 5 * 60_000);
  if (isConnected()) syncNow();
}
