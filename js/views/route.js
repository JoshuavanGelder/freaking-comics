// Leesroute: de hele verhaallijn van een serie, met "Alleen hoofdverhaal" en "+ Toch lezen".
import * as M from '../model.js';
import { getState, dispatch, undo } from '../store.js';
import { h, icon, backButton, topbar, toast, bubble, formatDate } from '../ui.js';

// Volgorde aanpassen staat per serie aan/uit zolang de app open is.
const editing = new Set();

const UNDO = { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } };

function progressLabel(state, series) {
  const all = M.volumesOf(state, series.id);
  const route = M.routeVolumes(state, series.id);
  const read = route.filter((v) => v.readStatus === 'read').length;
  const reading = route.filter((v) => v.readStatus === 'reading').length;
  const first = series.mainOnly === false ? `${all.length} delen in totaal` : `${route.length} delen in jouw route`;
  return [first, `${read} gelezen`, reading ? `${reading} bezig` : ''].filter(Boolean).join(' · ');
}

function tagFor(v, included) {
  if (v.kind === 'event') return h('span', { class: 'tag tag--red' }, 'EVENT');
  if (v.isSide && v.readStatus !== 'unread') return h('span', { class: 'tag' }, 'ZIJVERHAAL · AL GELEZEN');
  if (v.isSide && included) return h('span', { class: 'tag' }, 'ZIJVERHAAL · IN JE ROUTE');
  if (v.isSide) return h('span', { class: 'tag' }, 'ZIJVERHAAL');
  return null;
}

function statusBadge(v, series) {
  if (v.readStatus === 'read') return h('span', { class: 'pill pill--read' }, 'Gelezen');
  if (v.readStatus === 'reading') {
    const p = M.volumeProgress(v);
    return h('span', { class: 'pill pill--reading' }, p.unit === 'issues' ? `Bezig ${p.done}/${p.total}` : 'Bezig');
  }
  if (!M.isReleased(v)) return h('span', { class: 'pill pill--wishlist' }, formatDate(v.storeDate, { day: 'numeric', month: 'short' }));
  void series;
  return h('span', { class: 'route-dot', 'aria-label': 'Nog niet gelezen' });
}

function subline(v, series) {
  const issues = M.formatIssues(v.issues, series.title);
  return [issues, v.note].filter(Boolean).join(' · ') || M.FORMATS[v.format];
}

function kindChips(v) {
  return h(
    'div',
    { class: 'route-kinds', role: 'group', 'aria-label': `Soort van ${v.title}` },
    Object.entries(M.KINDS).map(([k, label]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(v.kind === k), 'data-key': `kind-${v.id}-${k}`, onClick: () => dispatch((s) => M.setVolumeKind(s, v.id, k)) }, label),
    ),
  );
}

export function routeView({ id }, ctx) {
  const state = getState();
  const series = M.getSeries(state, id);
  if (!series) {
    return { title: 'Niet gevonden', nav: 'kast', body: [topbar(backButton('#/kast'), 'Leesroute'), h('main', { class: 'main' }, bubble('Deze serie bestaat niet (meer).'))] };
  }
  const vols = M.volumesOf(state, id);
  const mainOnly = series.mainOnly !== false;
  const isEditing = editing.has(id);
  const next = M.nextUp(state, id);
  const badge = [series.publisher, series.line].filter(Boolean).join(' · ').toUpperCase();

  const rows = vols.map((v, i) => {
    const included = M.inRoute(series, v);
    const collapsed = v.isSide && mainOnly && !included && !isEditing;
    if (collapsed) {
      return h(
        'div',
        { class: 'route-skip' },
        h('div', { class: 'route-skip__text' }, 'Overgeslagen: ', h('b', {}, v.title), ' ', M.formatIssues(v.issues, series.title)),
        h(
          'button',
          { class: 'btn', type: 'button', 'data-key': `include-${v.id}`, 'aria-label': `${v.title} toch in je route zetten`, onClick: () => { dispatch((s) => M.setInRoute(s, v.id, true), { undoable: true }); toast(`${v.title} staat in je route.`, UNDO); } },
          '+ Toch lezen',
        ),
      );
    }
    const removable = v.isSide && v.inRoute && v.readStatus === 'unread' && mainOnly;
    const cls = ['route-card', v.isSide ? 'route-card--side' : '', v.isSide && !included ? 'route-card--dashed' : '', next?.id === v.id ? 'route-card--next' : ''].join(' ');
    return h(
      'article',
      { class: cls },
      h(
        'a',
        { class: 'route-card__body', href: `#/volume/${v.id}` },
        tagFor(v, v.inRoute),
        h('div', { class: 'vol-row__title' }, M.volumeName(v)),
        h('div', { class: 'sub' }, subline(v, series)),
        next?.id === v.id ? h('div', { class: 'kicker', style: { color: 'var(--red)' } }, v.readStatus === 'reading' ? 'Hier ben je' : 'Volgende in je route') : null,
      ),
      isEditing
        ? h(
            'div',
            { class: 'route-move' },
            h('button', { class: 'icon-btn', type: 'button', disabled: i === 0, 'aria-label': `${v.title} omhoog`, 'data-key': `up-${v.id}`, onClick: () => dispatch((s) => M.moveVolume(s, v.id, -1)) }, icon('chevron', { width: 3, size: 18 })),
            h('button', { class: 'icon-btn', type: 'button', disabled: i === vols.length - 1, 'aria-label': `${v.title} omlaag`, 'data-key': `down-${v.id}`, onClick: () => dispatch((s) => M.moveVolume(s, v.id, 1)) }, icon('chevron', { width: 3, size: 18 })),
          )
        : removable
          ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${v.title} uit je route halen`, 'data-key': `exclude-${v.id}`, onClick: () => dispatch((s) => M.setInRoute(s, v.id, false), { undoable: true }) }, icon('close', { width: 2.8, size: 16 }))
          : statusBadge(v, series),
      isEditing ? kindChips(v) : null,
    );
  });

  return {
    title: `Leesroute ${series.title} · Freaking Comics`,
    nav: 'kast',
    body: [
      topbar(
        backButton(`#/serie/${id}`, `Terug naar ${series.title}`),
        'Leesroute',
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': isEditing ? 'Klaar met aanpassen' : 'Volgorde en soort aanpassen',
            'aria-pressed': String(isEditing),
            'data-key': 'route-edit',
            onClick: () => { if (isEditing) editing.delete(id); else editing.add(id); ctx.rerender(); },
          },
          icon(isEditing ? 'check' : 'edit', { width: 2.6 }),
        ),
      ),
      h(
        'section',
        { class: 'route-hero dots-light' },
        badge ? h('span', { class: 'tag tag--red', style: { border: '2px solid var(--ink)' } }, badge) : null,
        h('h1', { class: 'hero__title', style: { color: 'var(--white)' } }, series.title),
        series.years ? h('div', { class: 'route-hero__sub' }, series.years) : null,
        h('div', { class: 'route-hero__progress' }, progressLabel(state, series)),
      ),
      h(
        'main',
        { class: 'main', id: 'main', style: { paddingTop: '20px' } },
        h(
          'section',
          { class: 'card', style: { boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: '8px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
            h('div', { id: 'mainOnlyLabel', class: 'title' }, 'Alleen hoofdverhaal'),
            h(
              'button',
              {
                class: 'toggle',
                type: 'button',
                role: 'switch',
                'aria-checked': String(mainOnly),
                'aria-labelledby': 'mainOnlyLabel',
                'data-key': 'main-only',
                onClick: () => dispatch((s) => M.setMainOnly(s, id, !mainOnly)),
              },
              h('span', { class: 'toggle__knob' }),
            ),
          ),
          h('p', { class: 'hint' }, mainOnly
            ? 'Zijverhalen sla je over, tenzij je ze al gelezen hebt of zelf toevoegt met "+ Toch lezen".'
            : 'Je ziet de complete leesroute, inclusief alle zijverhalen.'),
        ),
        isEditing
          ? bubble('Zet delen op de goede plek met de pijltjes, of alles in één keer op verschijningsdatum. Kies per deel: hoofdverhaal, zijverhaal of event. Tik op ✓ als je klaar bent.')
          : null,
        isEditing
          ? h(
              'button',
              {
                class: 'btn btn--block',
                type: 'button',
                'data-key': 'sort-date',
                onClick: () => { dispatch((s) => M.sortByDate(s, id), { undoable: true }); toast('Op verschijningsdatum gezet.', UNDO); },
              },
              'Zet alles op verschijningsdatum',
            )
          : null,
        vols.length ? h('div', { class: 'stack' }, rows) : bubble('Deze route is nog leeg. Voeg boeken of hele reeksen toe; ze komen vanzelf op verschijningsdatum te staan.'),
        h(
          'div',
          { class: 'row' },
          h('a', { class: 'btn', style: { flex: '1' }, href: `#/zoeken?toevoegen=${id}` }, icon('plus', { size: 18, width: 3 }), 'Boek'),
          h('a', { class: 'btn', style: { flex: '1' }, href: `#/zoeken?serie=${id}&extra=1` }, icon('plus', { size: 18, width: 3 }), 'Reeks'),
        ),
        h('p', { class: 'hint' }, 'Tik op ✏️ om de volgorde aan te passen of per deel te kiezen: hoofdverhaal, zijverhaal of event.'),
      ),
    ],
  };
}
