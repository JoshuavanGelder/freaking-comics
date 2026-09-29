// Zoeken op Metron en gegevens binnenhalen: een hele serie, of één los boek koppelen.
import * as M from '../model.js';
import { getState, dispatch, undo } from '../store.js';
import { api, isConnected } from '../api.js';
import { h, icon, backButton, topbar, toast, bubble, section } from '../ui.js';

// Schermstatus zolang je op deze pagina bent.
const ui = { key: '', q: '', results: null, loading: false, error: null, job: null, pick: null, all: false };

function reset(key, q) {
  Object.assign(ui, { key, q, results: null, loading: false, error: null, job: null, pick: null, all: false });
}

const COLOR_BY_PUBLISHER = { DC: 'blue', Marvel: 'red', Image: 'yellow' };

function describe(r) {
  const years = r.year ? `${r.year}${r.yearEnd ? `–${r.yearEnd}` : r.yearEnd === null ? '–' : ''}` : '';
  const count = r.issueCount != null ? `${r.issueCount} ${M.isCollectedType(r.type) ? (r.issueCount === 1 ? 'deel' : 'delen') : 'nummers'}` : '';
  return [r.type, M.publisherFromMetron(r.publisher), years, count].filter(Boolean).join(' · ');
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

/** Haalt een Metron-serie binnen: in een bestaande serie (koppelen/bijwerken) of als nieuwe serie. */
export async function importSeries(metronId, localSeriesId, ctx, { confirmed = false } = {}) {
  ui.error = null;
  ui.job = { label: 'Serie ophalen', done: 0, total: 1 };
  ctx.rerender();
  try {
    const { series, items } = await api(`/api/metron/series?id=${metronId}`, { timeout: 90_000 });
    const format = M.formatFromMetronType(series.type);
    const collected = format !== 'issue';
    if (!collected && !confirmed && items.length > 12) {
      const ok = confirm(
        `"${series.name}" is een serie met ${items.length} losse nummers, geen trades.\n\n` +
          `Elk nummer wordt dan een apart deel in je kast. Lees je trades of hardcovers, kies dan een serie met "Trade Paperback" of "Hardcover".\n\nToch doorgaan?`,
      );
      if (!ok) {
        ui.job = null;
        ctx.rerender();
        return;
      }
    }
    // Bij verzamelde edities zijn de details nodig (titel, welke issues erin zitten).
    const details = collected && items.length ? await fetchDetails(items.slice(0, 60), ctx, 'Delen ophalen') : items;
    const all = collected ? [...details, ...items.slice(60)] : items;
    const existing = localSeriesId ? M.getSeries(getState(), localSeriesId) : null;
    const linkedAt = existing?.metron?.id === series.id && existing.metron.linkedAt ? existing.metron.linkedAt : new Date().toISOString();
    const metron = { id: series.id, name: `${series.name}${series.type ? ` (${series.type})` : ''}`, type: series.type, linkedAt };

    const result = dispatch((s) => {
      let st = s;
      let id = localSeriesId;
      if (id && M.getSeries(st, id)) {
        st = M.updateSeries(st, id, { metron });
      } else {
        const publisher = M.publisherFromMetron(series.publisher);
        const r = M.addSeries(st, {
          title: series.name,
          publisher,
          line: series.imprint || '',
          years: series.year ? `${series.year}–${series.yearEnd || ''}` : '',
          color: COLOR_BY_PUBLISHER[publisher] || 'ink',
          metron,
        });
        st = r.state;
        id = r.id;
      }
      const applied = M.applyMetronItems(st, id, all, format);
      return { state: applied.state, id, added: applied.added.length, updated: applied.updated.length };
    }, { undoable: true });
    ui.job = null;
    const parts = [];
    if (result.added) parts.push(`${result.added} ${result.added === 1 ? 'deel' : 'delen'} toegevoegd`);
    if (result.updated) parts.push(`${result.updated} bijgewerkt`);
    toast(parts.length ? `${parts.join(', ')}.` : 'Alles was al up-to-date.', parts.length ? { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } } : undefined);
    ui.key = '';
    location.replace(`#/serie/${result.id}`);
  } catch (err) {
    ui.job = null;
    ui.error = err.message;
    ctx.rerender();
  }
}

async function linkVolume(volumeId, item, type, ctx) {
  ui.error = null;
  ui.job = { label: 'Gegevens ophalen', done: 0, total: 1 };
  ctx.rerender();
  try {
    const { issues } = await api(`/api/metron/issues?ids=${item.id}`);
    dispatch((s) => M.linkVolumeToMetron(s, volumeId, issues[0], M.formatFromMetronType(type)));
    ui.job = null;
    toast('Gekoppeld aan Metron.');
    location.replace(`#/volume/${volumeId}`);
  } catch (err) {
    ui.job = null;
    ui.error = err.message;
    ctx.rerender();
  }
}

async function runSearch(ctx) {
  const q = ui.q.trim();
  if (q.length < 2) return;
  ui.loading = true;
  ui.error = null;
  ui.pick = null;
  ctx.rerender();
  try {
    const { results } = await api(`/api/metron/search?q=${encodeURIComponent(q)}${ui.all ? '&alles=1' : ''}`, { timeout: 90_000 });
    ui.results = results;
  } catch (err) {
    ui.error = err.message;
  }
  ui.loading = false;
  ctx.rerender();
}

async function openForVolume(result, volumeId, ctx) {
  ui.loading = true;
  ctx.rerender();
  try {
    const { series, items } = await api(`/api/metron/series?id=${result.id}`);
    ui.loading = false;
    if (items.length === 1) {
      await linkVolume(volumeId, items[0], series.type, ctx);
      return;
    }
    ui.pick = { series, items };
  } catch (err) {
    ui.loading = false;
    ui.error = err.message;
  }
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
    h('p', { class: 'hint' }, 'Metron laat 20 verzoeken per minuut toe; bij grote series kan dit even duren.'),
  );
}

export function metronView(_params, ctx, query) {
  const state = getState();
  const seriesId = query.get('serie');
  const volumeId = query.get('volume');
  const localSeries = seriesId ? M.getSeries(state, seriesId) : null;
  const localVolume = volumeId ? M.getVolume(state, volumeId) : null;
  const refresh = query.get('bijwerken') === '1' && localSeries?.metron;
  const key = `${seriesId || ''}|${volumeId || ''}|${refresh ? 'r' : ''}`;
  if (ui.key !== key) {
    const guess = localVolume ? localVolume.title : localSeries ? localSeries.title : '';
    reset(key, guess);
    if (refresh && isConnected()) queueMicrotask(() => importSeries(localSeries.metron.id, localSeries.id, ctx));
    else if (guess && isConnected()) queueMicrotask(() => runSearch(ctx));
  }

  const back = localVolume ? `#/volume/${localVolume.id}` : localSeries ? `#/serie/${localSeries.id}` : '#/kast';
  const label = refresh ? 'Bijwerken' : localVolume ? 'Boek koppelen' : localSeries ? 'Serie koppelen' : 'Serie zoeken';

  if (!isConnected()) {
    return {
      title: 'Zoeken op Metron · Freaking Comics',
      nav: 'kast',
      body: [
        topbar(backButton(back), label),
        h(
          'main',
          { class: 'main', id: 'main' },
          bubble('Om op Metron te zoeken moet de app eerst met je server gekoppeld zijn.'),
          h('a', { class: 'btn btn--ink btn--block', href: '#/instellingen' }, 'Naar koppelen'),
          localVolume || localSeries ? null : h('a', { class: 'btn btn--block', href: '#/serie/nieuw' }, 'Handmatig een serie toevoegen'),
        ),
      ],
    };
  }

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

  const intro = localVolume
    ? `Zoek het boek "${localVolume.title}" op Metron. Je leesstatus en gelezen issues blijven gewoon staan.`
    : localSeries
      ? `Kies de Metron-serie die bij "${localSeries.title}" hoort. Kies je trades? Pak dan de serie met "Trade Paperback". Je leesstatus blijft staan; ontbrekende delen worden toegevoegd.`
      : 'Zoek een serie. Voor trades kies je de versie met "Trade Paperback" of "Hardcover".';

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
            { class: 'vol-row', type: 'button', style: { textAlign: 'left', width: '100%' }, onClick: () => linkVolume(localVolume.id, item, ui.pick.series.type, ctx) },
            item.image ? h('img', { class: 'cover cover--sm', src: item.image, alt: '', loading: 'lazy' }) : h('div', { class: 'cover cover--sm dots-light', style: { backgroundColor: 'var(--ink)' } }, item.number),
            h('div', { class: 'vol-row__body' }, h('div', { class: 'vol-row__title' }, `#${item.number}${item.title ? ` · ${item.title}` : ''}`), h('div', { class: 'sub' }, item.store_date || '')),
            icon('chevron', { width: 3 }),
          ),
        ),
      ),
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { ui.pick = null; ctx.rerender(); } }, 'Terug naar de zoekresultaten'),
    );
  } else if (ui.results) {
    list = ui.results.length
      ? h(
          'div',
          { class: 'stack' },
          ui.results.map((r) =>
            h(
              'button',
              {
                class: 'shelf-item',
                type: 'button',
                style: { textAlign: 'left', width: '100%' },
                'data-key': `res-${r.id}`,
                onClick: () => (localVolume ? openForVolume(r, localVolume.id, ctx) : importSeries(r.id, localSeries?.id, ctx)),
              },
              h(
                'div',
                { class: 'shelf-item__body' },
                M.isCollectedType(r.type) ? h('span', { class: 'tag' }, r.type.toUpperCase()) : h('span', { class: 'tag tag--soon' }, 'LOSSE NUMMERS'),
                h('div', { class: 'title' }, r.name),
                h('div', { class: 'sub' }, describe(r)),
              ),
              icon('chevron', { width: 3 }),
            ),
          ),
        )
      : bubble(`Niets gevonden voor "${ui.q}". Probeer minder woorden, of alleen de naam van de serie.`);
  }

  return {
    title: 'Zoeken op Metron · Freaking Comics',
    nav: 'kast',
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
              runSearch(ctx);
            },
          },
          h('label', { class: 'sr-only', for: 'q' }, 'Zoeken'),
          input,
          h('button', { class: 'btn btn--ink', type: 'submit', disabled: ui.loading || !!ui.job }, ui.loading ? '…' : 'Zoek'),
        ),
        h(
          'label',
          { class: 'check', for: 'f-all' },
          h('input', {
            type: 'checkbox',
            id: 'f-all',
            checked: ui.all,
            onChange: (e) => {
              ui.all = e.target.checked;
              runSearch(ctx);
            },
          }),
          h('span', {}, 'Ook series met losse nummers tonen', h('br'), h('span', { class: 'hint' }, 'Standaard zie je alleen trades, hardcovers en omnibussen.')),
        ),
        ui.error ? h('div', { class: 'error-box', role: 'alert' }, ui.error) : null,
        ui.job ? progressCard() : list,
        localVolume || localSeries ? null : h('a', { class: 'btn btn--ghost btn--block', href: '#/serie/nieuw' }, 'Niet gevonden? Handmatig toevoegen'),
      ),
    ],
  };
}
