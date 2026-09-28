// Mijn kast (alle series) en de verlanglijst.
import * as M from '../model.js';
import { getState } from '../store.js';
import { h, icon, cover, bubble, section } from '../ui.js';
import * as A from '../actions.js';
import { shelfItem } from './home.js';

const PHASE_ORDER = ['active', 'new', 'paused', 'done'];

export function kastView() {
  const state = getState();
  const header = h(
    'header',
    { class: 'topbar' },
    h('h1', { class: 'logo', style: { fontSize: '32px' } }, 'MIJN KAST'),
    h('a', { class: 'icon-btn', href: '#/instellingen', 'aria-label': 'Instellingen en back-up' }, icon('gear', { width: 2.2 })),
  );

  const groups = PHASE_ORDER.map((phase) => ({ phase, list: M.seriesByPhase(state, phase) })).filter((g) => g.list.length);
  const totals = state.volumes.reduce(
    (acc, v) => ({ read: acc.read + (v.readStatus === 'read' ? 1 : 0), owned: acc.owned + (v.ownership === 'owned' ? 1 : 0) }),
    { read: 0, owned: 0 },
  );

  return {
    title: 'Mijn kast · Freaking Comics',
    nav: 'kast',
    body: [
      header,
      h(
        'main',
        { class: 'main', id: 'main' },
        h(
          'div',
          { class: 'stats' },
          stat(state.series.length, state.series.length === 1 ? 'serie' : 'series'),
          stat(totals.read, 'gelezen'),
          stat(totals.owned, 'in bezit'),
        ),
        h(
          'div',
          { class: 'row' },
          h('a', { class: 'btn btn--yellow', href: '#/serie/nieuw', style: { flex: '1' } }, icon('plus', { size: 18, width: 3 }), 'Serie'),
          h('a', { class: 'btn', href: '#/volume/nieuw', style: { flex: '1' } }, icon('plus', { size: 18, width: 3 }), 'Volume'),
        ),
        groups.length
          ? groups.map((g) => section(M.PHASE_LABELS[g.phase], `${g.list.length}`, h('div', { class: 'stack' }, g.list.map((s) => shelfItem(state, s)))))
          : bubble('Hier komen al je series te staan.'),
      ),
    ],
  };
}

function stat(num, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat__num' }, String(num)), h('div', { class: 'stat__label' }, label));
}

export function wishlistView() {
  const state = getState();
  const vols = M.wishlist(state);
  const bySeries = state.series
    .map((s) => ({ series: s, vols: M.sortVolumes(vols.filter((v) => v.seriesId === s.id)) }))
    .filter((g) => g.vols.length);

  return {
    title: 'Verlanglijst · Freaking Comics',
    nav: 'wish',
    body: [
      h('header', { class: 'topbar' }, h('h1', { class: 'logo', style: { fontSize: '32px' } }, 'VERLANGLIJST')),
      h(
        'main',
        { class: 'main', id: 'main' },
        bySeries.length
          ? bySeries.map((g) =>
              section(
                g.series.title,
                `${g.vols.length}`,
                h(
                  'div',
                  { class: 'stack' },
                  g.vols.map((v) =>
                    h(
                      'div',
                      { class: 'card', style: { display: 'flex', gap: '12px', alignItems: 'center', boxShadow: '4px 4px 0 var(--ink)', padding: '10px 12px' } },
                      cover(v, g.series, 'sm'),
                      h(
                        'a',
                        { href: `#/volume/${v.id}`, class: 'vol-row__body', style: { textDecoration: 'none' } },
                        h('div', { class: 'vol-row__title' }, M.volumeName(v)),
                        h('div', { class: 'sub' }, M.formatIssues(v.issues, g.series.title) || M.FORMATS[v.format]),
                      ),
                      h(
                        'button',
                        { class: 'btn btn--yellow', type: 'button', 'data-key': `bought-${v.id}`, onClick: () => A.setOwnership(v.id, 'owned', { announce: true }) },
                        'Gekocht',
                      ),
                    ),
                  ),
                ),
              ),
            )
          : [
              bubble('Je verlanglijst is leeg.', 'Zet een deel op je verlanglijst via de knop "Verlanglijst" op de pagina van dat deel.'),
              h('a', { class: 'btn btn--block', href: '#/kast' }, 'Naar mijn kast'),
            ],
      ),
    ],
  };
}
