// Zoeken op Metron of Comic Vine en gegevens binnenhalen: een hele serie, of één los boek koppelen.
import * as M from '../model.js';
import { getState, dispatch, undo } from '../store.js';
import { api, isConnected } from '../api.js';
import { h, icon, backButton, topbar, toast, bubble, section } from '../ui.js';

// Schermstatus zolang je op deze pagina bent.
const ui = { key: '', q: '', results: null, loading: false, error: null, job: null, pick: null, all: false, source: 'metron' };

const base = (source) => (source === 'comicvine' ? '/api/comicvine' : '/api/metron');

function reset(key, q) {
  Object.assign(ui, { key, q, results: null, loading: false, error: null, job: null, pick: null, all: false, source: 'metron' });
}

const COLOR_BY_PUBLISHER = { DC: 'blue', Marvel: 'red', Image: 'yellow' };

function describe(r) {
  if (r.source === 'comicvine') {
    const count = r.issueCount != null ? `${r.issueCount} ${r.issueCount === 1 ? 'nummer' : 'nummers'}` : '';
    return [M.publisherFromMetron(r.publisher), r.year, count].filter(Boolean).join(' · ');
  }
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

/**
 * Haalt een online reeks binnen.
 * mode 'link'    – koppelt een bestaande serie (of maakt een nieuwe) aan deze reeks
 * mode 'extra'   – voegt de reeks toe aan een serie die al andere reeksen heeft (verzamelserie)
 * mode 'refresh' – werkt een al gekoppelde reeks bij
 */
export async function importSeries(metronId, localSeriesId, ctx, { confirmed = false, source = 'metron', mode = 'link', silent = false } = {}) {
  ui.error = null;
  ui.job = { label: 'Reeks ophalen', done: 0, total: 1 };
  ctx.rerender();
  try {
    const { series, items, detailed } = await api(`${base(source)}/series?id=${metronId}`, { timeout: 90_000 });
    const format = M.formatForSource(getState(), localSeriesId, source, series.type);
    const existing = localSeriesId ? M.getSeries(getState(), localSeriesId) : null;
    // Een verzamelserie (losse boeken zonder deelnummer, zoals "Ultimate Comics") koppel je per reeks, niet als geheel.
    const own = localSeriesId ? M.volumesOf(getState(), localSeriesId) : [];
    const loose = own.length > 0 && own.every((v) => !v.number);
    if (mode === 'link' && loose && !confirmed && !existing?.metron) mode = 'extra';
    const collected = source === 'comicvine' ? items.length <= 30 : format !== 'issue';
    if (mode !== 'refresh' && !collected && !confirmed && items.length > 12) {
      const ok = confirm(
        `"${series.name}" is een reeks met ${items.length} losse nummers, geen trades.\n\n` +
          `Elk nummer wordt dan een apart deel in je kast. Lees je trades of hardcovers, kies dan een reeks met "Trade Paperback" of "Hardcover".\n\nToch doorgaan?`,
      );
      if (!ok) {
        ui.job = null;
        ctx.rerender();
        return null;
      }
    }
    // Bij verzamelde edities zijn de details nodig (titel, welke issues erin zitten).
    const needDetails = collected && !detailed && items.length;
    const details = needDetails ? await fetchDetails(items.slice(0, 60), ctx, 'Delen ophalen') : items;
    const all = needDetails ? [...details, ...items.slice(60)] : items;

    const key = M.linkKeyOf({ id: series.id, source });
    const prior = existing ? M.seriesLinks(existing).find((l) => M.linkKeyOf(l) === key) : null;
    const label = source === 'comicvine' ? `${series.name}${series.year ? ` (${series.year})` : ''}` : `${series.name}${series.type ? ` (${series.type})` : ''}`;
    const umbrella = prior ? prior.umbrella || '' : mode === 'extra' ? shortName(series.name, existing?.title) : '';
    const link = { id: series.id, name: label, type: series.type, linkedAt: prior?.linkedAt || new Date().toISOString(), source, umbrella };

    const result = dispatch((s) => {
      let st = s;
      let id = localSeriesId;
      if (id && M.getSeries(st, id)) {
        if (!prior) st = mode === 'extra' ? M.addLink(st, id, link) : M.updateSeries(st, id, { metron: link });
      } else {
        const publisher = M.publisherFromMetron(series.publisher);
        const r = M.addSeries(st, {
          title: series.name,
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
      return { state: applied.state, id, added: applied.added.length, updated: applied.updated.length };
    }, { undoable: true });
    ui.job = null;
    if (!silent) {
      const parts = [];
      if (result.added) parts.push(`${result.added} ${result.added === 1 ? 'deel' : 'delen'} toegevoegd`);
      if (result.updated) parts.push(`${result.updated} bijgewerkt`);
      toast(parts.length ? `${parts.join(', ')}.` : 'Alles was al up-to-date.', parts.length ? { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } } : undefined);
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
  for (const [i, l] of links.entries()) {
    const r = await importSeries(l.id, series.id, ctx, { confirmed: true, source: l.source || 'metron', mode: 'refresh', silent: true });
    if (!r) return;
    added += r.added;
    updated += r.updated;
    ui.job = { label: 'Reeksen bijwerken', done: i + 1, total: links.length };
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
    toast('Boek toegevoegd.', { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } });
    location.replace(`#/volume/${r.id}`);
  } catch (err) {
    ui.job = null;
    ui.error = err.message;
    ctx.rerender();
  }
}

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
    toast(`Gekoppeld aan ${M.SOURCE_LABELS[source]}.`, { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } });
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
    const extra = ui.source === 'metron' && ui.all ? '&alles=1' : '';
    const { results } = await api(`${base(ui.source)}/search?q=${encodeURIComponent(q)}${extra}`, { timeout: 90_000 });
    // Series uit dezelfde jaren als die in je kast eerst.
    const local = ui.seriesId ? M.getSeries(getState(), ui.seriesId) : null;
    const year = Number(String(local?.years || '').slice(0, 4)) || null;
    const have = local ? M.volumesOf(getState(), local.id).filter((v) => !v.isSide).length : 0;
    // Hoe lager, hoe waarschijnlijker de juiste: zelfde jaren, en bij Comic Vine ongeveer evenveel nummers als jij delen hebt.
    const score = (r) =>
      (year ? Math.abs((r.year || 0) - year) : 0) +
      (r.source === 'comicvine' && have ? Math.abs((r.issueCount ?? have) - have) / 2 + (r.issueCount > 30 ? 50 : 0) : 0);
    ui.results = (year || have ? [...results].sort((a, b) => score(a) - score(b)) : results).slice(0, 30);
  } catch (err) {
    ui.error = err.message;
  }
  ui.loading = false;
  ctx.rerender();
}

/** Voor één boek: koppelen aan een bestaand deel (volumeId) of toevoegen aan een serie (addTo). */
async function openForBook(result, { volumeId, addTo }, ctx) {
  ui.loading = true;
  ctx.rerender();
  try {
    const { series, items } = await api(`${base(ui.source)}/series?id=${result.id}`, { timeout: 90_000 });
    ui.loading = false;
    if (items.length === 1) {
      if (addTo) await addBook(addTo, items[0], series, ctx, ui.source);
      else await linkVolume(volumeId, items[0], series.type, ctx, ui.source);
      return;
    }
    ui.pick = { series, items, source: ui.source, volumeId, addTo };
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
  const addTo = query.get('toevoegen') && M.getSeries(state, query.get('toevoegen')) ? query.get('toevoegen') : null;
  const addSeries = addTo ? M.getSeries(state, addTo) : null;
  const refresh = query.get('bijwerken') === '1' && localSeries?.metron;
  const extra = query.get('extra') === '1' && !!localSeries;
  const key = `${seriesId || ''}|${volumeId || ''}|${addTo || ''}|${refresh ? 'r' : ''}|${extra ? 'x' : ''}`;
  if (ui.key !== key) {
    const guess = localVolume ? localVolume.title : addSeries ? '' : localSeries && !extra ? localSeries.title : '';
    reset(key, guess);
    ui.seriesId = extra || addTo ? null : seriesId;
    if (addTo && M.seriesLinks(addSeries)[0]?.source === 'comicvine') ui.source = 'comicvine';
    if (refresh && isConnected()) queueMicrotask(() => refreshAll(localSeries, ctx));
    else if (guess && isConnected()) queueMicrotask(() => runSearch(ctx));
  }

  const back = localVolume ? `#/volume/${localVolume.id}` : addSeries ? `#/serie/${addSeries.id}` : localSeries ? `#/serie/${localSeries.id}` : '#/kast';
  const label = refresh ? 'Bijwerken' : localVolume ? 'Boek koppelen' : addSeries ? 'Boek toevoegen' : extra ? 'Reeks toevoegen' : localSeries ? 'Serie koppelen' : 'Serie zoeken';

  if (!isConnected()) {
    return {
      title: 'Online zoeken · Freaking Comics',
      nav: 'kast',
      body: [
        topbar(backButton(back), label),
        h(
          'main',
          { class: 'main', id: 'main' },
          bubble('Om online te zoeken moet de app eerst met je server gekoppeld zijn.'),
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

  const cv = ui.source === 'comicvine';
  const intro = localVolume
    ? `Zoek het boek "${localVolume.title}". Je leesstatus en gelezen issues blijven gewoon staan.`
    : addSeries
      ? `Zoek een boek om aan "${addSeries.title}" toe te voegen. Kies de reeks en daarna het boek; cover, titel en issues komen vanzelf mee.`
    : extra
      ? `Zoek een reeks die bij "${localSeries.title}" hoort, bijv. "Ultimate Comics Ultimates" of "Ultimate Comics X-Men". Alle delen van die reeks komen in deze serie, en nieuwe delen verschijnen vanzelf. Je kunt meerdere reeksen toevoegen.`
    : localSeries
      ? cv
        ? `Kies de Comic Vine-reeks die bij "${localSeries.title}" hoort: dezelfde uitgever en jaren, met ongeveer evenveel nummers als jij delen hebt. Je leesstatus blijft staan.`
        : `Kies de Metron-serie die bij "${localSeries.title}" hoort. Kies je trades? Pak dan de serie met "Trade Paperback". Je leesstatus blijft staan; ontbrekende delen worden toegevoegd.`
      : cv
        ? 'Zoek een reeks. Op Comic Vine is een trade-reeks meestal een reeks met weinig nummers (bijv. 9) met titels als "Move Forward".'
        : 'Zoek een serie. Voor trades kies je de versie met "Trade Paperback" of "Hardcover".';

  const sourceTabs = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': 'Bron', style: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
    ['metron', 'comicvine'].map((src) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(ui.source === src),
          'data-key': `src-${src}`,
          disabled: !!ui.job,
          onClick: () => {
            if (ui.source === src) return;
            ui.source = src;
            ui.results = null;
            ui.pick = null;
            ui.error = null;
            runSearch(ctx);
          },
        },
        M.SOURCE_LABELS[src],
      ),
    ),
  );

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
                onClick: () => (localVolume || addSeries
                  ? openForBook(r, { volumeId: localVolume?.id, addTo: addSeries?.id }, ctx)
                  : importSeries(r.id, localSeries?.id, ctx, { source: ui.source, mode: extra ? 'extra' : 'link' })),
              },
              h(
                'div',
                { class: 'shelf-item__body' },
                r.source === 'comicvine'
                  ? (r.issueCount > 30 ? h('span', { class: 'tag tag--soon' }, 'VEEL NUMMERS') : null)
                  : M.isCollectedType(r.type) ? h('span', { class: 'tag' }, r.type.toUpperCase()) : h('span', { class: 'tag tag--soon' }, 'LOSSE NUMMERS'),
                h('div', { class: 'title' }, r.name),
                h('div', { class: 'sub' }, describe(r)),
              ),
              icon('chevron', { width: 3 }),
            ),
          ),
        )
      : bubble(`Niets gevonden voor "${ui.q}". Probeer minder woorden, of alleen de naam van de serie.`);
    if (ui.results.length) {
      list = [
        list,
        h('p', { class: 'hint' }, cv
          ? 'Staat hij er niet tussen? Probeer een kortere zoekterm (bijv. alleen "Flash").'
          : 'Staat hij er niet tussen? Probeer Comic Vine hierboven, een kortere zoekterm (bijv. alleen "Flash"), of vink "Ook series met losse nummers" aan.'),
      ];
    }
  }

  return {
    title: 'Online zoeken · Freaking Comics',
    nav: 'kast',
    body: [
      topbar(backButton(back, 'Terug'), label),
      h(
        'main',
        { class: 'main', id: 'main' },
        refresh ? null : sourceTabs,
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
        cv ? null : h(
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
        localVolume || localSeries ? null
          : addSeries ? h('a', { class: 'btn btn--ghost btn--block', href: `#/volume/nieuw?serie=${addSeries.id}&handmatig=1` }, 'Niet gevonden? Handmatig invullen')
          : h('a', { class: 'btn btn--ghost btn--block', href: '#/serie/nieuw' }, 'Niet gevonden? Handmatig toevoegen'),
      ),
    ],
  };
}
