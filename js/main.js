// Opstarten, routes en tekenen.
import { load, subscribe, getState } from './store.js';
import { newVolumes, isReleased } from './model.js';
import { startSync, onSyncStatus } from './sync.js';
import { metronView, reeksView } from './views/metron.js';
import { h, nav } from './ui.js';
import { homeView } from './views/home.js';
import { kastView, wishlistView } from './views/lists.js';
import { serieView, volumeView } from './views/detail.js';
import { serieFormView, volumeFormView } from './views/forms.js';
import { settingsView } from './views/settings.js';
import { routeView } from './views/route.js';

const routes = [
  [/^\/$/, () => homeView()],
  [/^\/kast$/, () => kastView()],
  [/^\/verlanglijst$/, () => wishlistView()],
  [/^\/instellingen$/, (_m, ctx) => settingsView({}, ctx)],
  [/^\/zoeken$/, (_m, ctx, q) => metronView({}, ctx, q)],
  [/^\/reeks\/(metron|comicvine)\/(\d+)$/, (m, ctx, q) => reeksView({ source: m[1], id: m[2] }, ctx, q)],
  [/^\/toevoegen$/, (_m, ctx, q) => volumeFormView({}, ctx, q)],
  [/^\/serie\/nieuw$/, () => serieFormView()],
  [/^\/serie\/([\w-]+)\/bewerken$/, (m) => serieFormView({ id: m[1] })],
  [/^\/serie\/([\w-]+)\/route$/, (m, ctx) => routeView({ id: m[1] }, ctx)],
  [/^\/serie\/([\w-]+)$/, (m, ctx) => serieView({ id: m[1] }, ctx)],
  [/^\/volume\/nieuw$/, (_m, ctx, q) => volumeFormView({}, ctx, q)],
  [/^\/volume\/([\w-]+)\/bewerken$/, (m, ctx, q) => volumeFormView({ id: m[1] }, ctx, q)],
  [/^\/volume\/([\w-]+)$/, (m, ctx) => volumeView({ id: m[1] }, ctx)],
];

const app = document.getElementById('app');
const ctx = { rerender: () => render({ keepFocus: true }) };

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}

function render({ keepFocus = false } = {}) {
  const { path, query } = parseHash();
  let view = null;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      view = fn(m, ctx, query);
      break;
    }
  }
  if (!view) {
    location.replace('#/');
    return;
  }

  // Bij hertekenen na een tik: focus terug op dezelfde knop (voor toetsenbord/schermlezer).
  const activeKey = keepFocus ? document.activeElement?.getAttribute?.('data-key') : null;

  document.title = view.title;
  app.replaceChildren(h('div', { class: 'app' }, view.body), view.nav ? nav(view.nav) : '');

  if (activeKey) {
    const el = app.querySelector(`[data-key="${CSS.escape(activeKey)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  return view;
}

function onRoute() {
  const view = render();
  window.scrollTo(0, 0);
  if (view?.focus) view.focus.focus({ preventScroll: true });
}

/** Aantal nieuwe delen als stipje op het app-icoon (waar de telefoon dat ondersteunt). */
function updateBadge() {
  const n = newVolumes(getState()).filter((v) => isReleased(v)).length;
  try {
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* niet ondersteund */ }
}

load();
subscribe(() => {
  render({ keepFocus: true });
  updateBadge();
});
onSyncStatus(() => {
  if (parseHash().path === '/instellingen') render({ keepFocus: true });
});
updateBadge();
startSync();
window.addEventListener('hashchange', onRoute);
onRoute();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
