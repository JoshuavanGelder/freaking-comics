// Opstarten, routes en tekenen.
import { load, subscribe } from './store.js';
import { h, nav } from './ui.js';
import { homeView } from './views/home.js';
import { kastView, wishlistView } from './views/lists.js';
import { serieView, volumeView } from './views/detail.js';
import { serieFormView, volumeFormView } from './views/forms.js';
import { settingsView } from './views/settings.js';

const routes = [
  [/^\/$/, () => homeView()],
  [/^\/kast$/, () => kastView()],
  [/^\/verlanglijst$/, () => wishlistView()],
  [/^\/instellingen$/, () => settingsView()],
  [/^\/toevoegen$/, (_m, ctx, q) => volumeFormView({}, ctx, q)],
  [/^\/serie\/nieuw$/, () => serieFormView()],
  [/^\/serie\/([\w-]+)\/bewerken$/, (m) => serieFormView({ id: m[1] })],
  [/^\/serie\/([\w-]+)$/, (m, ctx) => serieView({ id: m[1] }, ctx)],
  [/^\/volume\/nieuw$/, (_m, ctx, q) => volumeFormView({}, ctx, q)],
  [/^\/volume\/([\w-]+)\/bewerken$/, (m, ctx, q) => volumeFormView({ id: m[1] }, ctx, q)],
  [/^\/volume\/([\w-]+)$/, (m) => volumeView({ id: m[1] })],
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

load();
subscribe(() => render({ keepFocus: true }));
window.addEventListener('hashchange', onRoute);
onRoute();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
