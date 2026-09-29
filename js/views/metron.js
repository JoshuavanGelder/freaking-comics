// Online zoeken (Metron én Comic Vine tegelijk), een reeks bekijken vóór je hem toevoegt,
// en losse boeken koppelen of toevoegen.
import * as M from '../model.js';
import { getState, dispatch, undo } from '../store.js';
import { api, isConnected } from '../api.js';
import { h, icon, backButton, topbar, toast, bubble, section, formatDate } from '../ui.js';

const SOURCES = ['comicvine', 'metron'];
const SHOW_KEY = 'freaking-comics:bron';

// Welke bron(nen) je wilt zien: 'beide', 'comicvine' of 'metron'. Onthouden op dit apparaat.
function getShow() {
  try {
    const v = localStorage.getItem(SHOW_KEY);
    return v === 'comicvine' || v === 'metron' ? v : 'beide';
  } catch {
    return 'beide';
  }
}
function setShow(v) {
  try {
    localStorage.setItem(SHOW_KEY, v);
  } catch { /* niets aan te doen */ }
}
const shownSources = () => (getShow() === 'beide' ? SOURCES : [getShow()]);
const base = (source) => (source === 'comicvine' ? '/api/comicvine' : '/api/metron');
const COLOR_BY_PUBLISHER = { DC: 'blue', Marvel: 'red', Image: 'yellow' };
const UNDO = { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } };

// Schermstatus zolang je op deze pagina bent.
const ui = {
  key: '',
  q: '',
  results: null, // { comicvine: [], metron: [] }
  errors: {},
  loading: false,
  error: null,
  job: null,
  pick: null,
  all: false,
};

function reset(key, q) {
  Object.assign(ui, { key, q, results: null, errors: {}, loading: false, error: null, job: null, pick: null, all: false });
}

// Opgehaalde reeksen (voor het voorbeeldscherm), zolang de app open is.
const previews = new Map();

function describe(r) {
  if (r.source === 'comicvine') {
    const count = r.issueCount != null ? `${r.issueCount} ${r.issueCount === 1 ? 'nummer' : 'nummers'}` : '';
    return [M.publisherFromMetron(r.publisher), r.year, count].filter(Boolean).join(' · ');
  }
  const years = r.year ? `${r.year}${r.yearEnd ? `–${r.yearEnd}` : r.yearEnd === null ? '–' : ''}` : '';
  const count = r.issueCount != null ? `${r.issueCount} ${M.isCollectedType(r.type) ? (r.issueCount === 1 ? 'deel' : 'delen') : 'nummers'}` : '';
  return [r.type, M.publisherFromMetron(r.publisher), years, count].filter(Boolean).join(' · ');
}

function manyIssues(r) {
  return r.source === 'comicvine' ? r.issueCount > 30 : !M.isCollectedType(r.type);
}

/** Korte reeksnaam binnen een verzamelserie: "Ultimate Comics X-Men" in "Ultimate Comics" → "X-Men". */
function shortName(reeks, seriesTitle) {
  const r = String(reeks || '').trim();
  const t = String(seriesTitle || '').trim();
  if (t && r.toLowerCase().startsWith(t.toLowerCase())) {
    const rest = r.slice(t.length).replace(/^[\s:–-]+/, '').trim();
    if (rest) return rest;
  }
  return r;
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const na = Number(a.number);
    const nb = Number(b.number);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.number).localeCompare(String(b.number));
  });
}

async function fetchDetails(items, ctx, label) {
  const out = [];
  ui.job = { label, done: 0, total: items.length };
  ctx.rerender();
  for (let i = 0; i < items.length; i += 6) {
    const chunk = items.slice(i, i + 6);
    const res = await api(`/api/metron/issues?ids=${chunk.map((x) => x.id).join(',')}`, { timeout: 90_000 });
    out.push(...res.issues);
    ui.job = { label, done: out.length, total: items.length };
    ctx.rerender();
  }
  return out;
}

async function loadReeks(source, id) {
  const key = `${source}:${id}`;
  if (!previews.has(key)) previews.set(key, api(`${base(source)}/series?id=${id}`, { timeout: 90_000 }));
  try {
    return await previews.get(key);
  } catch (err) {
    previews.delete(key);
    throw err;
  }
}

/**
 * Haalt een online reeks binnen.
 * mode 'link'    – koppelt een bestaande serie (of maakt een nieuwe) aan deze reeks
 * mode 'extra'   – voegt de reeks toe aan een serie die al andere reeksen heeft (verzamelserie)
 * mode 'refresh' – werkt een al gekoppelde reeks bij
 * readUpTo       – zoveel delen (op volgorde) meteen op "gelezen" zetten
 */
export async function importSeries(reeksId, localSeriesId, ctx, { source = 'metron', mode = 'link', silent = false, readUpTo = 0, preloaded = null, newTitle = '' } = {}) {
  ui.error = null;
  ui.job = { label: 'Reeks ophalen', done: 0, total: 1 };
  ctx.rerender();
  try {
    const { series, items, detailed } = preloaded || (await api(`${base(source)}/series?id=${reeksId}`, { timeout: 90_000 }));
    const existing = localSeriesId ? M.getSeries(getState(), localSeriesId) : null;
    const format = M.formatForSource(getState(), localSeriesId, source, series.type);
    // Een verzamelserie (losse boeken zonder deelnummer) koppel je per reeks.
    const own = localSeriesId ? M.volumesOf(getState(), localSeriesId) : [];
    if (mode === 'link' && own.length && own.every((v) => !v.number) && !existing?.metron) mode = 'extra';
    const collected = source === 'comicvine' ? items.length <= 30 : format !== 'issue';

    // Bij verzamelde edities van Metron zijn de details nodig (titel, welke issues erin zitten).
    const needDetails = source === 'metron' && collected && !detailed && items.length;
    const details = needDetails ? await fetchDetails(items.slice(0, 60), ctx, 'Delen ophalen') : items;
    const all = needDetails ? [...details, ...items.slice(60)] : items;

    const key = M.linkKeyOf({ id: series.id, source });
    const prior = existing ? M.seriesLinks(existing).find((l) => M.linkKeyOf(l) === key) : null;
    const label = source === 'comicvine' ? `${series.name}${series.year ? ` (${series.year})` : ''}` : `${series.name}${series.type ? ` (${series.type})` : ''}`;
    // Nieuwe serie met een eigen naam (bijv. "Ultimate Comics" voor de X-Men-reeks): dan is het een verzamelserie.
    const title = String(newTitle || '').trim() || series.name;
    const umbrella = prior
      ? prior.umbrella || ''
      : mode === 'extra'
        ? shortName(series.name, existing?.title)
        : !existing && title.toLowerCase() !== series.name.toLowerCase() ? shortName(series.name, title) : '';
    const link = { id: series.id, name: label, type: series.type, linkedAt: prior?.linkedAt || new Date().toISOString(), source, umbrella };
    const readIds = new Set(sortItems(all).slice(0, Math.max(0, readUpTo)).map((i) => i.id));

    const result = dispatch((s) => {
      let st = s;
      let id = localSeriesId;
      if (id && M.getSeries(st, id)) {
        if (!prior) st = mode === 'extra' ? M.addLink(st, id, link) : M.updateSeries(st, id, { metron: link });
      } else {
        const publisher = M.publisherFromMetron(series.publisher);
        const r = M.addSeries(st, {
          title,
          publisher,
          line: series.imprint || '',
          years: series.year ? `${series.year}–${series.yearEnd || ''}` : '',
          color: COLOR_BY_PUBLISHER[publisher] || 'ink',
          metron: link,
        });
        st = r.state;
        id = r.id;
      }
      const applied = M.applyMetronItems(st, id, all, format, { linkKey: key, umbrella });
      st = applied.state;
      // "Gelezen t/m": zet de eerste delen meteen op gelezen.
      for (const v of M.volumesOf(st, id)) {
        if (readIds.has(v.metronId) && (!v.linkKey || v.linkKey === key) && v.readStatus !== 'read') st = M.setReadStatus(st, v.id, 'read');
      }
      return { state: st, id, added: applied.added.length, updated: applied.updated.length };
    }, { undoable: true });
    ui.job = null;
    if (!silent) {
      const parts = [];
      if (result.added) parts.push(`${result.added} ${result.added === 1 ? 'deel' : 'delen'} toegevoegd`);
      if (result.updated) parts.push(`${result.updated} bijgewerkt`);
      if (readIds.size) parts.push(`t/m deel ${readIds.size} gelezen`);
      toast(parts.length ? `${parts.join(', ')}.` : 'Alles was al up-to-date.', parts.length ? UNDO : undefined);
      ui.key = '';
      location.replace(`#/serie/${result.id}`);
    }
    return result;
  } catch (err) {
    ui.job = null;
    ui.error = err.message;
    ctx.rerender();
    return null;
  }
}

/** Werkt alle gekoppelde reeksen van een serie bij. */
async function refreshAll(series, ctx) {
  const links = M.seriesLinks(series);
  let added = 0;
  let updated = 0;
  for (const l of links) {
    const r = await importSeries(l.id, series.id, ctx, { source: l.source || 'metron', mode: 'refresh', silent: true });
    if (!r) return;
    added += r.added;
    updated += r.updated;
  }
  ui.job = null;
  const parts = [];
  if (added) parts.push(`${added} ${added === 1 ? 'deel' : 'delen'} toegevoegd`);
  if (updated) parts.push(`${updated} bijgewerkt`);
  toast(parts.length ? `${parts.join(', ')}.` : 'Alles was al up-to-date.');
  ui.key = '';
  location.replace(`#/serie/${series.id}`);
}

/** "+ Volume → Zoek online": voegt één boek toe aan een serie. */
async function addBook(seriesId, item, reeks, ctx, source) {
  ui.error = null;
  ui.job = { label: 'Boek ophalen', done: 0, total: 1 };
  ctx.rerender();
  try {
    const full = source === 'comicvine' ? item : (await api(`/api/metron/issues?ids=${item.id}`)).issues[0];
    const format = source === 'comicvine' ? M.formatForSource(getState(), seriesId, source, '') : M.formatFromMetronType(reeks.type);
    const r = dispatch((s) => M.addVolumeFromSource(s, seriesId, full, format, { reeksName: reeks.name }), { undoable: true });
    ui.job = null;
    ui.key = '';
    toast('Boek toegevoegd.', UNDO);
    location.replace(`#/volume/${r.id}`);
  } catch (err) {
    ui.job = null;
    ui.error = err.message;
    ctx.rerender();
  }
}

/** Koppelt een bestaand boek aan één nummer uit een online reeks. */
async function linkVolume(volumeId, item, type, ctx, source = 'metron') {
  ui.error = null;
  ui.job = { label: 'Gegevens ophalen', done: 0, total: 1 };
  ctx.rerender();
  try {
    const full = source === 'comicvine' ? item : (await api(`/api/metron/issues?ids=${item.id}`)).issues[0];
    const v = M.getVolume(getState(), volumeId);
    const format = source === 'comicvine' ? v?.format || 'trade' : M.formatFromMetronType(type);
    dispatch((s) => M.linkVolumeToMetron(s, volumeId, full, format), { undoable: true });
    ui.job = null;
    ui.key = '';
    toast(`Gekoppeld aan ${M.SOURCE_LABELS[source]}.`, UNDO);
    location.replace(`#/volume/${volumeId}`);
  } catch (err) {
    ui.job = null;
    ui.error = err.message;
    ctx.rerender();
  }
}

/** Voor één boek: koppelen aan een bestaand deel (volumeId) of toevoegen aan een serie (addTo). */
async function openForBook(result, { volumeId, addTo }, ctx) {
  ui.loading = true;
  ctx.rerender();
  try {
    const { series, items } = await loadReeks(result.source, result.id);
    ui.loading = false;
    if (items.length === 1) {
      if (addTo) await addBook(addTo, items[0], series, ctx, result.source);
      else await linkVolume(volumeId, items[0], series.type, ctx, result.source);
      return;
    }
    ui.pick = { series, items: sortItems(items), source: result.source, volumeId, addTo };
  } catch (err) {
    ui.loading = false;
    ui.error = err.message;
  }
  ctx.rerender();
}

async function runSearch(ctx, { seriesId } = {}) {
  const q = ui.q.trim();
  if (q.length < 2) return;
  ui.loading = true;
  ui.error = null;
  ui.pick = null;
  ui.errors = {};
  ctx.rerender();
  const local = seriesId ? M.getSeries(getState(), seriesId) : null;
  const year = Number(String(local?.years || '').slice(0, 4)) || null;
  const have = local ? M.volumesOf(getState(), local.id).filter((v) => !v.isSide).length : 0;
  // Hoe lager, hoe waarschijnlijker de juiste: zelfde jaren, ongeveer evenveel delen, geen reeks met honderden nummers.
  const score = (r) =>
    (year ? Math.abs((r.year || 0) - year) : 0) +
    (have && r.issueCount != null ? Math.abs(r.issueCount - have) / 2 : 0) +
    (manyIssues(r) ? 30 : 0);
  const results = {};
  await Promise.all(
    shownSources().map(async (src) => {
      try {
        const extra = src === 'metron' && ui.all ? '&alles=1' : '';
        const res = await api(`${base(src)}/search?q=${encodeURIComponent(q)}${extra}`, { timeout: 90_000 });
        const list = res.results.map((r) => ({ ...r, source: src }));
        results[src] = (year || have ? list.sort((a, b) => score(a) - score(b)) : list).slice(0, 20);
      } catch (err) {
        results[src] = [];
        ui.errors[src] = err.message;
      }
    }),
  );
  ui.results = results;
  ui.loading = false;
  ctx.rerender();
}

function progressCard() {
  const { label, done, total } = ui.job;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h(
    'div',
    { class: 'card stack', role: 'status' },
    h('div', { class: 'title' }, `${label}…`),
    h('div', { class: 'progress' }, h('div', { class: 'progress__bar' }, h('div', { class: 'progress__fill dots', style: { width: `${Math.max(pct, 4)}%` } })), h('div', { class: 'progress__text' }, total > 1 ? `${done}/${total}` : '')),
    h('p', { class: 'hint' }, 'Bij grote reeksen kan dit even duren.'),
  );
}

function thumb(src, fallback) {
  return src
    ? h('img', { class: 'cover cover--sm', src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
    : h('div', { class: 'cover cover--sm dots-light', style: { backgroundColor: 'var(--ink)' } }, fallback || '');
}

function resultButton(r, onClick) {
  return h(
    'button',
    { class: 'shelf-item', type: 'button', style: { textAlign: 'left', width: '100%' }, 'data-key': `res-${r.source}-${r.id}`, onClick },
    thumb(r.image, ''),
    h(
      'div',
      { class: 'shelf-item__body' },
      manyIssues(r)
        ? h('span', { class: 'tag tag--soon' }, r.source === 'comicvine' ? 'VEEL NUMMERS' : 'LOSSE NUMMERS')
        : r.source === 'metron' && r.type ? h('span', { class: 'tag' }, r.type.toUpperCase()) : null,
      h('div', { class: 'title' }, r.name),
      h('div', { class: 'sub' }, describe(r)),
    ),
    icon('chevron', { width: 3 }),
  );
}

export function metronView(_params, ctx, query) {
  const state = getState();
  const seriesId = query.get('serie');
  const volumeId = query.get('volume');
  const localSeries = seriesId ? M.getSeries(state, seriesId) : null;
  const localVolume = volumeId ? M.getVolume(state, volumeId) : null;
  const addTo = query.get('toevoegen') && M.getSeries(state, query.get('toevoegen')) ? query.get('toevoegen') : null;
  const addSeries = addTo ? M.getSeries(state, addTo) : null;
  const refresh = query.get('bijwerken') === '1' && localSeries?.metron;
  const extra = query.get('extra') === '1' && !!localSeries;
  const key = `${seriesId || ''}|${volumeId || ''}|${addTo || ''}|${refresh ? 'r' : ''}|${extra ? 'x' : ''}`;
  if (ui.key !== key) {
    const guess = localVolume ? localVolume.title : localSeries && !extra ? localSeries.title : '';
    reset(key, guess);
    if (refresh && isConnected()) queueMicrotask(() => refreshAll(localSeries, ctx));
    else if (guess && isConnected()) queueMicrotask(() => runSearch(ctx, { seriesId: extra ? null : seriesId }));
  }

  const back = localVolume ? `#/volume/${localVolume.id}` : addSeries ? `#/serie/${addSeries.id}` : localSeries ? `#/serie/${localSeries.id}` : '#/';
  const label = refresh ? 'Bijwerken' : localVolume ? 'Boek koppelen' : addSeries ? 'Boek toevoegen' : extra ? 'Reeks toevoegen' : localSeries ? 'Serie koppelen' : 'Zoeken';

  if (!isConnected()) {
    return {
      title: 'Online zoeken · Freaking Comics',
      nav: 'kast',
      body: [
        topbar(backButton(back), label),
        h('main', { class: 'main', id: 'main' }, bubble('Om online te zoeken moet de app eerst met je server gekoppeld zijn.'), h('a', { class: 'btn btn--ink btn--block', href: '#/instellingen' }, 'Naar koppelen')),
      ],
    };
  }

  const bookMode = !!(localVolume || addSeries);
  const intro = localVolume
    ? `Zoek het boek "${localVolume.title}". Kies de reeks en daarna het boek. Je leesstatus blijft staan.`
    : addSeries
      ? `Zoek een boek voor "${addSeries.title}". Kies de reeks en daarna het boek; cover, titel en issues komen vanzelf mee.`
      : extra
        ? `Zoek een reeks voor "${localSeries.title}", bijv. "Ultimate Comics X-Men". Je ziet eerst wat erin zit voordat je iets toevoegt.`
        : localSeries
          ? `Kies de reeks die bij "${localSeries.title}" hoort. Je ziet eerst wat erin zit voordat je iets koppelt.`
          : 'Zoek een serie op Metron en Comic Vine. Je ziet eerst wat erin zit, en kiest tot welk deel je gelezen hebt.';

  const input = h('input', {
    class: 'input',
    type: 'search',
    id: 'q',
    enterkeyhint: 'search',
    autocomplete: 'off',
    value: ui.q,
    placeholder: 'bijv. The Flash, Saga, Ultimate…',
    onInput: (e) => { ui.q = e.target.value; },
  });

  const onPick = (r) => {
    if (bookMode) return openForBook(r, { volumeId: localVolume?.id, addTo: addSeries?.id }, ctx);
    const params = new URLSearchParams();
    if (localSeries) params.set('serie', localSeries.id);
    if (extra) params.set('extra', '1');
    location.hash = `#/reeks/${r.source}/${r.id}${params.toString() ? `?${params}` : ''}`;
    return null;
  };

  let list = null;
  if (ui.pick) {
    list = section(
      'Welk boek?',
      `${ui.pick.items.length}`,
      h('p', { class: 'hint' }, ui.pick.series.name),
      h(
        'div',
        { class: 'stack' },
        ui.pick.items.map((item) =>
          h(
            'button',
            {
              class: 'vol-row',
              type: 'button',
              style: { textAlign: 'left', width: '100%' },
              onClick: () => (ui.pick.addTo
                ? addBook(ui.pick.addTo, item, ui.pick.series, ctx, ui.pick.source)
                : linkVolume(ui.pick.volumeId, item, ui.pick.series.type, ctx, ui.pick.source)),
            },
            thumb(item.image, item.number),
            h('div', { class: 'vol-row__body' }, h('div', { class: 'vol-row__title' }, `#${item.number}${item.title ? ` · ${item.title}` : ''}`), h('div', { class: 'sub' }, item.store_date || item.cover_date || '')),
            icon('chevron', { width: 3 }),
          ),
        ),
      ),
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { ui.pick = null; ctx.rerender(); } }, 'Terug naar de zoekresultaten'),
    );
  } else if (ui.results) {
    const shown = shownSources();
    const total = shown.reduce((n, s) => n + (ui.results[s] || []).length, 0);
    list = total
      ? shown.map((src) =>
          section(
            M.SOURCE_LABELS[src],
            `${(ui.results[src] || []).length}`,
            ui.errors[src] ? h('div', { class: 'error-box', role: 'alert' }, ui.errors[src]) : null,
            (ui.results[src] || []).length
              ? h('div', { class: 'stack' }, ui.results[src].map((r) => resultButton(r, () => onPick(r))))
              : ui.errors[src] ? null : h('p', { class: 'hint' }, `Niets gevonden op ${M.SOURCE_LABELS[src]}.`),
          ),
        )
      : [
          bubble(`Niets gevonden voor "${ui.q}". Probeer minder woorden, of alleen de naam van de serie.`),
          ...shown.filter((s) => ui.errors[s]).map((s) => h('div', { class: 'error-box', role: 'alert' }, `${M.SOURCE_LABELS[s]}: ${ui.errors[s]}`)),
        ];
  }

  return {
    title: 'Online zoeken · Freaking Comics',
    nav: 'kast',
    focus: ui.results || ui.q ? null : input,
    body: [
      topbar(backButton(back, 'Terug'), label),
      h(
        'main',
        { class: 'main', id: 'main' },
        h('p', { class: 'hint' }, intro),
        h(
          'form',
          {
            class: 'row',
            role: 'search',
            style: { flexWrap: 'nowrap' },
            onSubmit: (e) => {
              e.preventDefault();
              runSearch(ctx, { seriesId: extra || bookMode ? null : seriesId });
            },
          },
          h('label', { class: 'sr-only', for: 'q' }, 'Zoeken'),
          input,
          h('button', { class: 'btn btn--ink', type: 'submit', disabled: ui.loading || !!ui.job }, ui.loading ? '…' : 'Zoek'),
        ),
        h(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': 'Zoeken in' },
          [['beide', 'Beide'], ['comicvine', 'Comic Vine'], ['metron', 'Metron']].map(([v, text]) =>
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': String(getShow() === v),
                'data-key': `show-${v}`,
                onClick: () => {
                  setShow(v);
                  // Resultaten van een bron die nog niet opgehaald is? Dan opnieuw zoeken.
                  if (ui.results && shownSources().some((s) => !(s in ui.results))) runSearch(ctx, { seriesId: extra || bookMode ? null : seriesId });
                  else ctx.rerender();
                },
              },
              text,
            ),
          ),
        ),
        getShow() === 'comicvine' ? null : h(
          'label',
          { class: 'check', for: 'f-all' },
          h('input', { type: 'checkbox', id: 'f-all', checked: ui.all, onChange: (e) => { ui.all = e.target.checked; runSearch(ctx, { seriesId: extra || bookMode ? null : seriesId }); } }),
          h('span', {}, 'Ook Metron-series met losse nummers tonen', h('br'), h('span', { class: 'hint' }, 'Standaard zie je bij Metron alleen trades, hardcovers en omnibussen.')),
        ),
        ui.loading ? h('p', { class: 'hint', role: 'status' }, `Zoeken op ${shownSources().map((s) => M.SOURCE_LABELS[s]).join(' en ')}…`) : null,
        ui.error ? h('div', { class: 'error-box', role: 'alert' }, ui.error) : null,
        ui.job ? progressCard() : list,
        addSeries
          ? h('a', { class: 'btn btn--ghost btn--block', href: `#/volume/nieuw?serie=${addSeries.id}&handmatig=1` }, 'Niet gevonden? Handmatig invullen')
          : null,
      ),
    ],
  };
}

// ---------------------------------------------------------------- voorbeeld van een reeks

const previewUi = { key: '', data: null, error: null, readUpTo: 0, target: '', newTitle: '' };

export function reeksView({ source, id }, ctx, query) {
  const state = getState();
  const targetParam = query.get('serie');
  const extra = query.get('extra') === '1';
  const key = `${source}:${id}|${targetParam || ''}|${extra}`;
  if (previewUi.key !== key) {
    Object.assign(previewUi, { key, data: null, error: null, readUpTo: 0, newTitle: '', target: targetParam && M.getSeries(state, targetParam) ? targetParam : 'nieuw' });
    ui.job = null;
    ui.error = null;
    loadReeks(source, id)
      .then((data) => {
        if (previewUi.key === key) {
          previewUi.data = data;
          ctx.rerender();
        }
      })
      .catch((err) => {
        if (previewUi.key === key) {
          previewUi.error = err.message;
          ctx.rerender();
        }
      });
  }

  const back = targetParam ? `#/zoeken?serie=${targetParam}${extra ? '&extra=1' : ''}` : '#/zoeken';
  const header = topbar(backButton(back, 'Terug naar zoeken'), M.SOURCE_LABELS[source]);
  if (previewUi.error) {
    return { title: 'Reeks · Freaking Comics', nav: 'kast', body: [header, h('main', { class: 'main', id: 'main' }, h('div', { class: 'error-box', role: 'alert' }, previewUi.error))] };
  }
  if (!previewUi.data) {
    return { title: 'Reeks · Freaking Comics', nav: 'kast', body: [header, h('main', { class: 'main', id: 'main' }, h('p', { class: 'hint', role: 'status' }, 'Reeks ophalen…'))] };
  }

  const { series, items } = previewUi.data;
  const sorted = sortItems(items);
  const r = { ...series, source, issueCount: series.issueCount ?? items.length };
  const many = source === 'comicvine' ? items.length > 30 : !M.isCollectedType(series.type);
  const target = previewUi.target === 'nieuw' ? null : M.getSeries(state, previewUi.target);
  const already = target && M.seriesLinks(target).some((l) => M.linkKeyOf(l) === M.linkKeyOf({ id: series.id, source }));

  const targetSelect = h(
    'select',
    { class: 'select', id: 'p-target', onChange: (e) => { previewUi.target = e.target.value; ctx.rerender(); } },
    h('option', { value: 'nieuw', selected: previewUi.target === 'nieuw' }, 'Nieuwe serie'),
    [...state.series].sort((a, b) => a.title.localeCompare(b.title)).map((s) => h('option', { value: s.id, selected: previewUi.target === s.id }, `Bij ${s.title}`)),
  );
  const readSelect = h(
    'select',
    { class: 'select', id: 'p-read', onChange: (e) => { previewUi.readUpTo = Number(e.target.value); ctx.rerender(); } },
    h('option', { value: '0', selected: previewUi.readUpTo === 0 }, 'Nog niets gelezen'),
    sorted.slice(0, 200).map((it, i) => h('option', { value: String(i + 1), selected: previewUi.readUpTo === i + 1 }, `t/m #${it.number}${it.title ? ` · ${it.title}` : ''}`)),
  );

  const go = () => {
    if (many && !confirm(`Deze reeks heeft ${items.length} losse nummers; elk nummer wordt een apart deel in je kast.\n\nToch toevoegen?`)) return;
    const own = target ? M.volumesOf(state, target.id) : [];
    const mode = target && (extra || (own.length && own.every((v) => !v.number)) || (target.metron && !already)) ? 'extra' : 'link';
    importSeries(series.id, target?.id || null, ctx, { source, mode, readUpTo: previewUi.readUpTo, preloaded: previewUi.data, newTitle: target ? '' : previewUi.newTitle });
  };

  return {
    title: `${series.name} · Freaking Comics`,
    nav: 'kast',
    body: [
      header,
      h(
        'section',
        { class: 'hero dots' },
        h('div', { class: 'hero__titles' }, h('span', { class: 'tag tag--ink' }, [M.SOURCE_LABELS[source], M.publisherFromMetron(series.publisher)].filter(Boolean).join(' · ').toUpperCase()), h('h1', { class: 'hero__title', style: { fontSize: 'clamp(30px, 9vw, 44px)' } }, series.name), h('div', { class: 'meta' }, describe(r))),
      ),
      h(
        'main',
        { class: 'main', id: 'main', style: { paddingTop: '20px' } },
        many ? bubble(`Let op: dit is een reeks met ${items.length} losse nummers. Lees je trades, zoek dan een reeks met weinig nummers en titels.`) : null,
        ui.error ? h('div', { class: 'error-box', role: 'alert' }, ui.error) : null,
        ui.job
          ? progressCard()
          : h(
              'div',
              { class: 'card stack', style: { boxShadow: 'none' } },
              h('div', { class: 'field' }, h('label', { for: 'p-target' }, 'Waar komt hij?'), targetSelect),
              target
                ? null
                : h(
                    'div',
                    { class: 'field' },
                    h('label', { for: 'p-title' }, 'Naam van de serie'),
                    h('input', { class: 'input', id: 'p-title', autocomplete: 'off', value: previewUi.newTitle || series.name, onInput: (e) => { previewUi.newTitle = e.target.value; } }),
                    h('p', { class: 'hint' }, 'Maak je een verzamelserie met meerdere reeksen (zoals "Ultimate Comics")? Geef hem dan die naam; andere reeksen voeg je daarna toe met "+ Reeks".'),
                  ),
              h('div', { class: 'field' }, h('label', { for: 'p-read' }, 'Al gelezen'), readSelect, h('p', { class: 'hint' }, 'Deze delen komen meteen op "gelezen"; de bladwijzer staat dan op het deel erna.')),
              h('button', { class: 'btn btn--ink btn--big btn--block', type: 'button', 'data-key': 'preview-add', onClick: go }, already ? 'Bijwerken' : target ? 'Koppelen' : 'Toevoegen'),
            ),
        section(
          'Wat zit erin',
          `${items.length}`,
          h(
            'div',
            { class: 'stack' },
            sorted.slice(0, 60).map((it, i) =>
              h(
                'div',
                { class: `vol-row${i < previewUi.readUpTo ? '' : ''}` },
                thumb(it.image, it.number),
                h(
                  'div',
                  { class: 'vol-row__body' },
                  h('div', { class: 'vol-row__title' }, `#${it.number}${it.title ? ` · ${it.title}` : ''}`),
                  h('div', { class: 'sub' }, [it.store_date || it.cover_date ? formatDate(it.store_date || it.cover_date) : '', (it.reprints || []).length ? M.formatIssues((it.reprints || []).map((x) => M.parseReprint(x.issue)).filter(Boolean).map((x, k) => ({ id: String(k), ...x, read: false }))) : ''].filter(Boolean).join(' · ')),
                ),
                i < previewUi.readUpTo ? h('span', { class: 'pill pill--read' }, 'Gelezen') : null,
              ),
            ),
            items.length > 60 ? h('p', { class: 'hint' }, `En nog ${items.length - 60} meer.`) : null,
          ),
        ),
      ),
    ],
  };
}
