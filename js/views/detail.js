// Serie-pagina (bladwijzer, voortgang, alle delen) en volume-pagina (status, issues, volgende deel).
import * as M from '../model.js';
import { getState, dispatch, undo } from '../store.js';
import { h, icon, cover, section, bubble, backButton, topbar, progress, formatDate, toast } from '../ui.js';
import * as A from '../actions.js';
import { isConnected } from '../api.js';

const FILTERS = [
  ['all', 'Alles', () => true],
  ['read', 'Gelezen', (v) => v.readStatus === 'read'],
  ['unread', 'Ongelezen', (v) => v.readStatus !== 'read'],
  ['owned', 'In bezit', (v) => v.ownership === 'owned'],
  ['missing', 'Ontbreekt', (v) => v.ownership !== 'owned' && v.readStatus !== 'read'],
];

// Filterkeuze per serie, alleen zolang de app open is.
const filterBySeries = new Map();

function notFound(what) {
  return {
    title: 'Niet gevonden · Freaking Comics',
    nav: 'kast',
    body: [
      topbar(backButton('#/kast', 'Naar mijn kast'), what),
      h('main', { class: 'main', id: 'main' }, bubble(`Deze ${what.toLowerCase()} bestaat niet (meer).`), h('a', { class: 'btn btn--block', href: '#/kast' }, 'Naar mijn kast')),
    ],
  };
}

function volumePill(v, isNext) {
  if (isNext && v.readStatus !== 'reading') return h('span', { class: 'pill pill--reading' }, 'Volgende');
  if (v.readStatus === 'read') return h('span', { class: 'pill pill--read' }, 'Gelezen');
  if (v.readStatus === 'reading') return h('span', { class: 'pill pill--reading' }, 'Bezig');
  if (v.ownership === 'owned') return h('span', { class: 'pill' }, 'In bezit');
  if (v.ownership === 'wishlist') return h('span', { class: 'pill pill--wishlist' }, 'Verlanglijst');
  return h('span', { class: 'pill pill--wishlist' }, 'Ontbreekt');
}

function volumeRow(v, series, isNext = false) {
  const missing = !isNext && v.ownership !== 'owned' && v.readStatus === 'unread';
  const cls = ['vol-row', v.readStatus === 'reading' ? 'vol-row--reading' : '', isNext ? 'vol-row--next' : '', missing ? 'vol-row--missing' : '', v.isSide ? 'vol-row--side' : ''].join(' ');
  const released = M.isReleased(v);
  const sub = !released
    ? `Verschijnt ${formatDate(v.storeDate)}`
    : M.formatIssues(v.issues, series.title) || M.FORMATS[v.format];
  return h(
    'a',
    { class: cls, href: `#/volume/${v.id}` },
    cover(v, series, 'sm', { ghost: missing }),
    h(
      'div',
      { class: 'vol-row__body' },
      v.isNew ? h('span', { class: 'tag tag--new' }, 'NIEUW') : null,
      v.isSide ? h('span', { class: 'tag' }, 'TUSSENDOOR') : null,
      h('div', { class: 'vol-row__title' }, M.volumeName(v)),
      h('div', { class: 'sub' }, sub),
    ),
    volumePill(v, isNext),
  );
}

export function serieView({ id }, ctx) {
  const state = getState();
  const series = M.getSeries(state, id);
  if (!series) return notFound('Serie');

  const vols = M.volumesOf(state, id);
  const stats = M.seriesStats(state, id);
  const phase = M.seriesPhase(state, series);
  const next = M.nextUp(state, id);
  const filterKey = filterBySeries.get(id) || 'all';
  const filterFn = (FILTERS.find((f) => f[0] === filterKey) || FILTERS[0])[2];
  const shown = vols.filter(filterFn);
  const badge = [series.publisher, series.line].filter(Boolean).join(' · ').toUpperCase();
  const sub = [series.years ? `Serie ${series.years}` : '', `${stats.main} ${stats.main === 1 ? 'volume' : 'volumes'}`].filter(Boolean).join(' · ');

  let nextBox;
  if (!vols.length) {
    nextBox = h('div', { class: 'next-box' }, h('div', { class: 'title' }, 'Nog geen delen'), h('a', { class: 'btn btn--ink', href: `#/volume/nieuw?serie=${id}` }, 'Eerste volume toevoegen'));
  } else if (!next) {
    nextBox = h('div', { class: 'next-box' }, h('div', { class: 'title' }, 'Helemaal uitgelezen!'), h('div', { class: 'sub' }, 'Nieuw deel verschenen? Voeg het toe en de bladwijzer schuift mee.'));
  } else {
    const inIssues = next.readStatus === 'reading' && next.issues.length;
    const issue = inIssues ? M.nextIssue(next) : null;
    nextBox = h(
      'div',
      { class: 'next-box' },
      h('div', { class: 'kicker' }, next.readStatus === 'reading' ? 'Bladwijzer · je leest nu' : 'Bladwijzer · volgende deel'),
      h('a', { href: `#/volume/${next.id}`, class: 'title' }, M.volumeName(next)),
      issue ? h('div', { class: 'sub' }, `Volgende issue: ${M.formatIssues([issue], series.title)}`) : null,
      h(
        'button',
        { class: 'btn btn--yellow', type: 'button', 'data-key': 'serie-next', onClick: () => A.markNextRead(id) },
        icon('check', { size: 18, width: 3 }),
        'Uit! Markeer als gelezen',
      ),
    );
  }

  return {
    title: `${series.title} · Freaking Comics`,
    nav: 'kast',
    body: [
      topbar(backButton('#/kast', 'Naar mijn kast'), 'Serie', h('a', { class: 'icon-btn', href: `#/serie/${id}/bewerken`, 'aria-label': 'Serie bewerken' }, icon('edit', { width: 2.4 }))),
      h(
        'section',
        { class: 'hero dots' },
        h(
          'div',
          { class: 'hero__top' },
          h(
            'div',
            { class: 'hero__titles' },
            badge ? h('span', { class: 'tag tag--ink' }, badge) : null,
            h('h1', { class: 'hero__title' }, series.title),
            h('div', { class: 'meta' }, sub),
          ),
          h('div', { class: 'burst', role: 'img', 'aria-label': `${stats.readMain} van ${stats.main} gelezen` }, h('div', { class: 'burst__num' }, `${stats.readMain}/${stats.main}`), h('div', { class: 'burst__label' }, 'GELEZEN')),
        ),
        h(
          'div',
          { class: 'stats' },
          statBox(stats.read, 'gelezen'),
          statBox(stats.owned, 'in bezit'),
          statBox(stats.missing, 'ontbreekt'),
        ),
        nextBox,
      ),
      h(
        'main',
        { class: 'main', id: 'main', style: { paddingTop: '20px' } },
        h(
          'div',
          { class: 'row' },
          h('a', { class: 'btn', href: `#/volume/nieuw?serie=${id}`, style: { flex: '1' } }, icon('plus', { size: 18, width: 3 }), 'Volume'),
          phase === 'paused'
            ? h('button', { class: 'btn', type: 'button', 'data-key': 'pause', style: { flex: '1' }, onClick: () => A.setPaused(id, false) }, icon('play', { size: 16 }), 'Hervatten')
            : h('button', { class: 'btn', type: 'button', 'data-key': 'pause', style: { flex: '1' }, onClick: () => A.setPaused(id, true) }, icon('pause', { size: 18 }), 'Pauze'),
        ),
        metronBox(series),
        vols.length
          ? section(
              'Alle delen',
              `${shown.length}`,
              h(
                'div',
                { class: 'filters', role: 'group', 'aria-label': 'Filter' },
                FILTERS.map(([key, label]) =>
                  h(
                    'button',
                    {
                      class: 'chip',
                      type: 'button',
                      'aria-pressed': String(key === filterKey),
                      'data-key': `filter-${key}`,
                      onClick: () => {
                        filterBySeries.set(id, key);
                        ctx.rerender();
                      },
                    },
                    label,
                  ),
                ),
              ),
              shown.length
                ? h('div', { class: 'stack' }, shown.map((v) => volumeRow(v, series, next?.id === v.id)))
                : h('p', { class: 'hint' }, 'Niks gevonden met dit filter.'),
            )
          : null,
      ),
    ],
  };
}

function statBox(num, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat__num' }, String(num)), h('div', { class: 'stat__label' }, label));
}

function segmented(label, options, current, onPick, keyPrefix) {
  return h(
    'div',
    {},
    h('p', { class: 'field-label', id: `${keyPrefix}-label` }, label),
    h(
      'div',
      { class: 'segmented', role: 'group', 'aria-labelledby': `${keyPrefix}-label` },
      options.map(([value, text]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(value === current),
            'data-key': `${keyPrefix}-${value}`,
            onClick: () => value !== current && onPick(value),
          },
          text,
        ),
      ),
    ),
  );
}

export function volumeView({ id }) {
  const state = getState();
  const v = M.getVolume(state, id);
  if (!v) return notFound('Volume');
  const series = M.getSeries(state, v.seriesId);
  const following = M.followingVolume(state, id);
  const prog = M.volumeProgress(v);
  const groups = M.groupIssues(v.issues);
  const badge = [series.publisher, series.line].filter(Boolean).join(' · ').toUpperCase();
  if (v.isNew) queueMicrotask(() => dispatch((s) => M.markSeen(s, id)));
  const dateFact = v.storeDate ? (M.isReleased(v) ? `Verschenen ${formatDate(v.storeDate)}` : `Verschijnt ${formatDate(v.storeDate)}`) : '';
  const facts = [M.FORMATS[v.format], v.isSide ? 'Zijverhaal' : '', dateFact, v.readAt && v.readStatus === 'read' ? `Uit op ${formatDate(v.readAt.slice(0, 10))}` : '']
    .filter(Boolean)
    .join(' · ');

  return {
    title: `${M.volumeName(v)} · Freaking Comics`,
    nav: 'kast',
    body: [
      topbar(backButton(`#/serie/${series.id}`, `Terug naar ${series.title}`), 'Volume', h('a', { class: 'icon-btn', href: `#/volume/${id}/bewerken`, 'aria-label': 'Volume bewerken' }, icon('edit', { width: 2.4 }))),
      h(
        'section',
        { class: 'vol-head' },
        h('div', { class: 'vol-head__side' }, cover(v, series, 'lg'), v.metronId
          ? null
          : h('a', { class: 'btn btn--ghost', style: { fontSize: '12px', padding: '0 8px' }, href: isConnected() ? `#/zoeken?volume=${id}` : '#/instellingen' }, 'Koppel online')),
        h(
          'div',
          { class: 'vol-head__info' },
          badge ? h('span', { class: 'tag tag--red' }, badge) : null,
          h('a', { href: `#/serie/${series.id}`, class: 'kicker' }, series.title),
          h('h1', { class: 'vol-title' }, M.volumeName(v)),
          facts ? h('div', { class: 'hint' }, facts) : null,
          v.issues.length ? h('div', { class: 'hint' }, M.formatIssues(v.issues, series.title)) : null,
        ),
      ),
      h(
        'main',
        { class: 'main', id: 'main', style: { paddingTop: '22px' } },
        segmented(
          'Leesstatus',
          [['unread', 'Nog niet'], ['reading', 'Bezig'], ['read', 'Gelezen']],
          v.readStatus,
          (value) => (value === 'read' ? A.markVolumeRead(id) : A.setReadStatus(id, value)),
          'read',
        ),
        segmented(
          'In de kast',
          [['none', 'Niet'], ['owned', 'In bezit'], ['wishlist', 'Verlanglijst']],
          v.ownership,
          (value) => A.setOwnership(id, value),
          'own',
        ),
        v.note ? h('div', { class: 'note' }, v.note) : null,
        section(
          'Wat zit erin',
          v.issues.length ? `${prog.done} van ${prog.total} gelezen` : null,
          v.issues.length
            ? [
                h('p', { class: 'hint' }, 'Tik een issue aan als je het gelezen hebt.'),
                progress(prog.done, prog.total, `${Math.round((prog.done / prog.total) * 100)}%`),
                groups.map((g) => {
                  const done = g.issues.filter((i) => i.read).length;
                  const name = shortSeriesName(g.series, series.title);
                  return h(
                    'div',
                    { class: 'card issue-group' },
                    h('div', { class: 'issue-group__head' }, h('div', { class: 'title', style: { fontSize: '15px' } }, name), h('div', { class: 'meta' }, `${done}/${g.issues.length}`)),
                    h(
                      'div',
                      { class: 'issue-grid' },
                      g.issues.map((i) =>
                        h(
                          'button',
                          {
                            class: 'issue',
                            type: 'button',
                            'aria-pressed': String(i.read),
                            'aria-label': `${g.series} #${i.number}, ${i.read ? 'gelezen' : 'niet gelezen'}`,
                            'data-key': `issue-${i.id}`,
                            onClick: () => A.toggleIssue(id, i.id, !i.read),
                          },
                          `#${i.number}`,
                        ),
                      ),
                    ),
                  );
                }),
              ]
            : h('p', { class: 'hint' }, 'Nog geen issues ingevuld. Dat kan via Bewerken (bijv. "#1–8, Annual #1"); of koppel het boek online, dan wordt het automatisch ingevuld.'),
        ),
        section(
          'Het verhaal gaat verder',
          null,
          following
            ? h(
                'a',
                { class: 'vol-row', href: `#/volume/${following.id}` },
                h('div', { class: 'kicker', style: { width: '60px', flexShrink: '0' } }, 'DAARNA'),
                h('div', { class: 'vol-row__body' }, h('div', { class: 'vol-row__title' }, M.volumeName(following)), h('div', { class: 'sub' }, M.READ_LABELS[following.readStatus])),
                icon('chevron', { width: 3 }),
              )
            : h('p', { class: 'hint' }, `Dit is het laatste deel dat in je kast staat voor ${series.title}.`),
          h('a', { class: 'btn btn--ink btn--big btn--block', href: `#/serie/${series.id}` }, `Hele serie bekijken`, icon('arrow', { size: 18, width: 3, color: 'var(--yellow)' })),
        ),
      ),
    ],
  };
}

function shortSeriesName(name, context) {
  if (name === context) return name;
  if (name.startsWith(`${context} `)) return name.slice(context.length + 1);
  return name;
}

function metronBox(series) {
  if (!series.metron) {
    return h(
      'a',
      { class: 'btn btn--ghost btn--block', href: isConnected() ? `#/zoeken?serie=${series.id}` : '#/instellingen' },
      M.volumesOf(getState(), series.id).length && M.volumesOf(getState(), series.id).every((v) => !v.number)
        ? 'Koppel de hele serie online (bij losse boeken: liever per boek)'
        : 'Koppel online (Metron of Comic Vine): covers, issues en nieuwe delen automatisch',
    );
  }
  return h(
    'div',
    { class: 'next-box', style: { borderStyle: 'dashed' } },
    h('div', { class: 'kicker' }, `Gekoppeld aan ${M.SOURCE_LABELS[series.metron.source || 'metron']}`),
    h('div', { class: 'sub' }, series.metron.name),
    h('p', { class: 'hint' }, 'Nieuwe delen verschijnen hier vanzelf; elke ochtend wordt gecontroleerd.'),
    isConnected()
      ? h('a', { class: 'btn', href: `#/zoeken?serie=${series.id}&bijwerken=1` }, 'Nu bijwerken')
      : null,
    h(
      'button',
      {
        class: 'btn btn--ghost',
        type: 'button',
        'data-key': 'metron-unlink',
        onClick: () => {
          const { remove, restore } = M.planUnlink(getState(), series.id);
          const msg =
            `Koppeling met ${series.metron.name} ongedaan maken?\n\n` +
            `${remove.length} ${remove.length === 1 ? 'deel' : 'delen'} die ${M.SOURCE_LABELS[series.metron.source || 'metron']} heeft toegevoegd (en die je niet gelezen, gekocht of genoteerd hebt) worden weggehaald. ` +
            `${restore.length} ${restore.length === 1 ? 'eigen deel krijgt' : 'eigen delen krijgen'} weer hun oude gegevens. Je leesstatus blijft staan.`;
          if (!confirm(msg)) return;
          dispatch((s) => M.unlinkMetron(s, series.id), { undoable: true });
          toast(`Ontkoppeld: ${remove.length} ${remove.length === 1 ? 'deel' : 'delen'} weggehaald.`, { label: 'Ongedaan', run: () => { undo(); toast('Teruggezet.'); } });
        },
      },
      'Koppeling ongedaan maken',
    ),
  );
}
