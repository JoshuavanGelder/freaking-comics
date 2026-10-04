// Aanraders: boeken die Claude je aanraadt op basis van je kast en wat je Top/Niks vond.
// Covers en de reeks om toe te voegen komen van Comic Vine of Metron, wat het best past.
import * as M from '../model.js';
import { getState, subscribe } from '../store.js';
import { h, icon, cover, section, bubble, topbar, toast, formatDate } from '../ui.js';
import { api, isConnected } from '../api.js';
import { syncNow } from '../sync.js';

const KIND_LABELS = { vervolg: 'VERVOLG', 'zelfde-maker': 'ZELFDE MAKER', vergelijkbaar: 'IN DEZELFDE SFEER', klassieker: 'KLASSIEKER' };
const COLOR_BY_PUBLISHER = [[/marvel/i, 'red'], [/\bdc\b|vertigo/i, 'blue'], [/image/i, 'yellow']];

// Zolang de app open is. De lijst wordt (stil) opnieuw opgehaald als hij ouder is dan 30 seconden,
// zodat een aanrader die je net hebt toegevoegd vanzelf verdwijnt.
const recs = { status: 'idle', data: null, error: null, making: false, fetching: false, fetchedAt: 0 };

function load(ctx) {
  if (!isConnected() || recs.fetching || recs.making) return;
  if (recs.fetchedAt && Date.now() - recs.fetchedAt < 30_000) return;
  recs.fetching = true;
  if (!recs.data) recs.status = 'loading';
  api('/api/aanraders')
    .then((data) => {
      recs.data = data;
      recs.status = 'ok';
      recs.error = null;
    })
    .catch((err) => {
      if (!recs.data) recs.status = 'error';
      recs.error = err.message;
    })
    .finally(() => {
      recs.fetching = false;
      recs.fetchedAt = Date.now();
      ctx?.rerender();
    });
}

// Je kast veranderd (bijv. een boek toegevoegd of Top gegeven): bij de volgende weergave opnieuw ophalen.
subscribe(() => {
  recs.fetchedAt = 0;
});

const canMakeHere = (state) => state.volumes.some((v) => v.readStatus !== 'unread');

/** Aanraders worden nooit vanzelf gemaakt: alleen met de knop, en die verschijnt alleen als je kast veranderd is. */
function needsUpdate(d) {
  return M.recsNeedUpdate(getState(), { generatedAt: d.generatedAt, basedOn: d.basedOn, visibleCount: d.items.length });
}

function updateButton(ctx, d, { block = true } = {}) {
  return h(
    'button',
    { class: `btn btn--yellow${block ? ' btn--block' : ''}`, type: 'button', 'data-key': 'recs-refresh', disabled: recs.making, onClick: () => make(ctx) },
    icon('star', { size: 18, width: 2.4 }),
    recs.making ? 'Claude zoekt boeken voor je uit…' : d.generatedAt ? 'Aanraders bijwerken' : 'Maak aanraders',
  );
}

function updateReason(d) {
  if (!d.generatedAt) return 'Claude kijkt in je kast en zoekt boeken die bij je passen.';
  if (d.items.length < 3) return d.items.length ? `Nog maar ${d.items.length} ${d.items.length === 1 ? 'aanrader' : 'aanraders'} over.` : 'Alle aanraders zijn op.';
  return 'Je kast is veranderd sinds de laatste aanraders.';
}

async function make(ctx, { auto = false } = {}) {
  if (recs.making) return;
  recs.making = true;
  recs.error = null;
  ctx?.rerender();
  try {
    await syncNow(); // de server moet je nieuwste kast (en Top/Niks) kennen
    recs.data = await api('/api/aanraders', { method: 'POST', body: { refresh: true }, timeout: 90_000 });
    recs.status = 'ok';
    recs.fetchedAt = Date.now();
    if (!auto) toast('Nieuwe aanraders!');
  } catch (err) {
    recs.error = err.message;
    if (!auto) toast(err.message);
  }
  recs.making = false;
  ctx?.rerender();
}

async function post(body, ctx) {
  try {
    recs.data = await api('/api/aanraders', { method: 'POST', body });
  } catch (err) {
    toast(err.message);
  }
  ctx?.rerender();
}

function dismiss(item, ctx) {
  if (recs.data) recs.data = { ...recs.data, items: recs.data.items.filter((i) => i.key !== item.key) };
  ctx?.rerender();
  post({ dismiss: item.key }, ctx);
  toast(`${item.series} weggeklikt. Claude raadt dit niet meer aan.`, { label: 'Ongedaan', run: () => post({ undismiss: item.key }, ctx) });
}

/** Wat je intussen al hebt toegevoegd, meteen weglaten (de server doet dat pas na de volgende sync). */
function visible(items) {
  const state = getState();
  const keys = M.shelfLinkKeys(state);
  const titles = M.shelfTitles(state);
  return items.filter((i) => !M.recInShelf(i, keys) && !titles.has(`${i.series} ${i.title}`.toLowerCase().trim()));
}

function becauseName(v) {
  const s = M.getSeries(getState(), v.seriesId);
  const name = M.volumeName(v);
  return s && v.number && !name.toLowerCase().includes(s.title.toLowerCase()) ? `${s.title} ${name}` : name;
}

function colorFor(publisher) {
  return (COLOR_BY_PUBLISHER.find(([re]) => re.test(publisher || '')) || [null, 'red'])[1];
}

function recCard(item, ctx) {
  const found = M.recMatch(item);
  const target = found ? `#/reeks/${found.source}/${found.id}?van=aanraders` : `#/zoeken?q=${encodeURIComponent(item.series)}`;
  const heading = [item.series, item.title && !item.title.toLowerCase().startsWith(item.series.toLowerCase()) ? item.title : ''].filter(Boolean).join(' · ') || item.title;
  const meta = [item.publisher, item.year, item.creators].filter(Boolean).join(' · ');
  const because = item.because ? M.findVolumeByTitle(getState(), item.because) : null;
  return h(
    'article',
    { class: 'card rec', 'data-key': `rec-${item.key}` },
    h(
      'a',
      { class: 'rec__head', href: target },
      cover({ cover: found?.image || null, number: '', title: item.series }, { color: colorFor(item.publisher) }, 'md'),
      h(
        'div',
        { class: 'rec__body' },
        h('span', { class: `tag tag--kind is-${item.kind}` }, KIND_LABELS[item.kind] || 'AANRADER'),
        h('div', { class: 'rec__title' }, heading),
        meta ? h('div', { class: 'sub' }, meta) : null,
      ),
    ),
    bubble(item.reason),
    item.because ? h('div', { class: 'rec__because' }, because ? h('a', { href: `#/volume/${because.id}` }, `Omdat je ${becauseName(because)} las`) : `Omdat je ${item.because} las`) : null,
    h(
      'div',
      { class: 'rec__actions' },
      h('a', { class: 'btn btn--ink', href: target }, found ? 'Bekijken en toevoegen' : 'Zoeken'),
      h('button', { class: 'btn btn--ghost', type: 'button', 'data-key': `dismiss-${item.key}`, onClick: () => dismiss(item, ctx) }, 'Niks voor mij'),
    ),
  );
}

function setupHint() {
  return bubble(
    'Voor aanraders heeft de server een Anthropic API-sleutel nodig (ANTHROPIC_API_KEY in Vercel).',
    'Maak er een op console.anthropic.com en zet er wat tegoed op; aanraders maken kost een paar cent per keer.',
  );
}

function rateHint(state) {
  const read = state.volumes.filter((v) => v.readStatus === 'read');
  const rated = read.filter((v) => v.rating).length;
  if (!read.length || rated >= Math.min(3, read.length)) return null;
  return h('p', { class: 'hint' }, `Tip: geef boeken die je gelezen hebt een duim (Top of Niks). Dan worden de aanraders beter. Nu ${rated} van ${read.length} beoordeeld.`);
}

/** Blok op Home: de eerste twee aanraders. */
export function homeRecs(ctx) {
  if (!isConnected()) return null;
  load(ctx);
  const d = recs.data && { ...recs.data, items: visible(recs.data.items), canMake: canMakeHere(getState()) };
  if (!d || !d.configured.ai || !d.canMake) return null;
  const update = needsUpdate(d) || recs.making ? [h('p', { class: 'hint' }, updateReason(d)), updateButton(ctx, d)] : null;
  if (!d.items.length) return section('Aanraders voor jou', null, update);
  const more = d.items.length > 2 ? h('a', { class: 'btn btn--block', href: '#/aanraders' }, `Alle aanraders (${d.items.length})`) : null;
  return section('Aanraders voor jou', `${d.items.length}`, h('div', { class: 'stack', style: { gap: '16px' } }, d.items.slice(0, 2).map((i) => recCard(i, ctx))), more, update);
}

export function aanradersView(ctx) {
  const state = getState();
  const header = topbar(null, 'Aanraders');
  const main = (...children) => ({ title: 'Aanraders · Freaking Comics', nav: 'recs', body: [header, h('main', { class: 'main', id: 'main' }, ...children)] });

  if (!isConnected()) {
    return main(bubble('Aanraders komen van je server. Koppel eerst de app.'), h('a', { class: 'btn btn--ink btn--block', href: '#/instellingen' }, 'Koppelen'));
  }
  load(ctx);
  if (!recs.data && recs.status !== 'error') return main(h('p', { class: 'hint', role: 'status' }, 'Aanraders ophalen…'));
  if (recs.status === 'error' && !recs.data) return main(h('div', { class: 'error-box', role: 'alert' }, recs.error), h('button', { class: 'btn btn--block', type: 'button', onClick: () => { recs.status = 'idle'; recs.fetchedAt = 0; ctx.rerender(); } }, 'Opnieuw proberen'));

  const d = { ...recs.data, items: visible(recs.data.items), canMake: canMakeHere(state) };
  if (!d.configured.ai) return main(setupHint());
  if (!d.canMake) {
    return main(bubble('Zet eerst een paar boeken in je kast die je gelezen hebt. Dan weet Claude wat je leuk vindt.'), h('a', { class: 'btn btn--ink btn--block', href: '#/zoeken' }, 'Serie zoeken'));
  }

  const update = needsUpdate(d) || recs.making;
  const when = d.generatedAt ? `Gemaakt op ${formatDate(d.generatedAt.slice(0, 10))}.` : '';
  const status = update
    ? h('div', { class: 'stack' }, h('p', { class: 'hint', role: 'status' }, updateReason(d)), updateButton(ctx, d))
    : h('p', { class: 'hint', style: { textAlign: 'center' } }, `${when} Bijgewerkt met je huidige kast. Lees je iets, voeg je iets toe of geef je een duim, dan kun je ze hier bijwerken.`);
  return main(
    rateHint(state),
    recs.error ? h('div', { class: 'error-box', role: 'alert' }, recs.error) : null,
    update ? status : null,
    d.items.length ? h('div', { class: 'stack', style: { gap: '18px' } }, d.items.map((i) => recCard(i, ctx))) : null,
    update ? null : status,
    d.dismissedCount ? h('p', { class: 'hint', style: { textAlign: 'center' } }, `${d.dismissedCount} weggeklikt.`) : null,
  );
}
