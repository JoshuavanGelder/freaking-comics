// Home: "Verder lezen" (alle series waar je mee bezig bent, laatst gelezen bovenaan),
// daarna wat er op de stapel ligt en wat op pauze staat.
import * as M from '../model.js';
import { getState } from '../store.js';
import { h, icon, cover, progress, section, bubble, formatDate } from '../ui.js';
import { isConnected } from '../api.js';
import * as A from '../actions.js';

export function continueCard(state, series) {
  const next = M.nextUp(state, series.id);
  const stats = M.seriesStats(state, series.id);
  const issue = next && next.readStatus === 'reading' ? M.nextIssue(next) : null;
  const inIssues = !!(next && next.issues.length && next.readStatus === 'reading');

  let line = 'Alles gelezen';
  if (next && issue && inIssues) line = `${next.title} · volgende: ${M.formatIssues([issue], series.title)}`;
  else if (next) line = `Volgende: ${M.volumeShortName(next)}`;

  const prog = inIssues ? M.volumeProgress(next) : null;
  const bar = inIssues
    ? progress(prog.done, prog.total, `${prog.done}/${prog.total} issues`)
    : progress(stats.readMain, stats.main, `${stats.readMain}/${stats.main} volumes`);

  const kicker = series.line && !series.title.toLowerCase().includes(series.line.toLowerCase())
    ? `${series.title} (${series.line})`
    : series.title;

  let action = null;
  if (next && issue && inIssues) {
    const label = M.formatIssues([issue], series.title);
    action = h(
      'button',
      { class: 'btn btn--yellow', type: 'button', 'data-key': `next-issue-${series.id}`, onClick: () => A.markNextIssue(next.id) },
      icon('check', { size: 18, width: 3 }),
      `${label} gelezen`,
    );
  } else if (next && !M.isReleased(next)) {
    action = h('div', { class: 'btn btn--ghost', role: 'note' }, `Verschijnt ${formatDate(next.storeDate, { day: 'numeric', month: 'short', year: 'numeric' })}`);
  } else if (next) {
    action = h(
      'button',
      { class: 'btn btn--yellow', type: 'button', 'data-key': `next-vol-${series.id}`, onClick: () => A.markNextRead(series.id) },
      icon('check', { size: 18, width: 3 }),
      `${next.number ? `Vol. ${next.number}` : 'Boek'} uit!`,
    );
  }

  return h(
    'article',
    { class: 'card continue' },
    h(
      'a',
      { class: 'continue__link', href: next ? `#/volume/${next.id}` : `#/serie/${series.id}` },
      cover(next, series, 'md'),
      h(
        'div',
        { class: 'continue__body' },
        h('div', { class: 'kicker' }, kicker),
        h('div', { class: 'title' }, line),
        bar,
      ),
      icon('chevron', { width: 3 }),
    ),
    h(
      'div',
      { class: 'continue__actions' },
      action,
      h('a', { class: 'btn', href: `#/serie/${series.id}` }, 'Serie'),
    ),
  );
}

export function shelfItem(state, series, { extra } = {}) {
  const stats = M.seriesStats(state, series.id);
  const vols = M.volumesOf(state, series.id);
  const shown = M.nextUp(state, series.id) || vols[vols.length - 1] || null;
  const kicker = [series.publisher, series.line].filter(Boolean).join(' · ');
  return h(
    'div',
    { class: 'stack' },
    h(
      'a',
      { class: 'shelf-item', href: `#/serie/${series.id}` },
      cover(shown, series, 'sm'),
      h(
        'div',
        { class: 'shelf-item__body' },
        kicker ? h('div', { class: 'kicker' }, kicker) : null,
        h('div', { class: 'title' }, series.title),
        h('div', { class: 'sub' }, stats.total ? `${stats.readMain}/${stats.main} gelezen · ${stats.owned} in bezit` : 'Nog geen volumes'),
      ),
      icon('chevron', { width: 3 }),
    ),
    extra || null,
  );
}

export function homeView() {
  const state = getState();
  const header = h(
    'header',
    { class: 'topbar' },
    h('h1', { class: 'logo' }, 'FREAKING COMICS'),
    h('a', { class: 'icon-btn', href: isConnected() ? '#/zoeken' : '#/toevoegen', 'aria-label': 'Toevoegen' }, icon('plus', { width: 3 })),
  );

  if (!state.series.length) {
    return {
      title: 'Freaking Comics',
      nav: 'home',
      body: [
        header,
        h(
          'main',
          { class: 'main', id: 'main' },
          isConnected()
            ? bubble('Je kast is nog leeg!', 'Zoek de serie die je nu leest. Je kiest zelf tot welk deel je gelezen hebt; daarna houdt de app bij wat het volgende is.')
            : bubble('Je kast is nog leeg!', 'Koppel eerst de app aan je server, dan zoek je series op via Metron en Comic Vine.'),
          isConnected()
            ? h('a', { class: 'btn btn--ink btn--big btn--block', href: '#/zoeken' }, 'Serie zoeken')
            : h('a', { class: 'btn btn--ink btn--big btn--block', href: '#/instellingen' }, 'Koppelen'),
        ),
      ],
    };
  }

  const cont = M.continueReading(state);
  const fresh = M.newVolumes(state).filter((v) => M.isReleased(v));
  const soon = M.upcoming(state).slice(0, 8);
  const seriesOf = (v) => M.getSeries(state, v.seriesId);
  const strip = (vols, tag) =>
    h(
      'div',
      { class: 'new-strip' },
      vols.map((v) =>
        h(
          'a',
          { class: 'new-card', href: `#/volume/${v.id}` },
          cover(v, seriesOf(v), 'md'),
          h('span', { class: `tag ${tag === 'new' ? 'tag--new' : 'tag--soon'}` }, tag === 'new' ? 'NIEUW' : formatDate(v.storeDate, { day: 'numeric', month: 'short' }).toUpperCase()),
          h('div', { class: 'kicker' }, seriesOf(v)?.title || ''),
          h('div', { class: 'new-card__title' }, M.volumeShortName(v)),
        ),
      ),
    );
  const stack = M.seriesByPhase(state, 'new');
  const paused = M.seriesByPhase(state, 'paused');

  return {
    title: 'Freaking Comics',
    nav: 'home',
    body: [
      header,
      h(
        'main',
        { class: 'main', id: 'main' },
        fresh.length
          ? section('Nieuw verschenen', `${fresh.length}`, bubble(fresh.length === 1 ? 'Er is een nieuw deel uit van een serie die je leest!' : `Er zijn ${fresh.length} nieuwe delen uit van series die je leest!`), strip(fresh, 'new'))
          : null,
        section(
          'Verder lezen',
          cont.length ? `${cont.length} bezig` : null,
          cont.length
            ? h('div', { class: 'stack', style: { gap: '16px' } }, cont.map((s) => continueCard(state, s)))
            : h('p', { class: 'hint' }, 'Je bent nergens mee bezig. Kies iets van de stapel of uit je kast.'),
        ),
        soon.length ? section('Binnenkort', `${soon.length}`, strip(soon, 'soon')) : null,
        stack.length
          ? section('Op de stapel', `${stack.length}`, h('div', { class: 'stack' }, stack.map((s) => shelfItem(state, s))))
          : null,
        paused.length
          ? section(
              'Op pauze',
              `${paused.length}`,
              h(
                'div',
                { class: 'stack', style: { gap: '14px' } },
                paused.map((s) =>
                  shelfItem(state, s, {
                    extra: h(
                      'button',
                      { class: 'btn btn--ghost', type: 'button', 'data-key': `resume-${s.id}`, onClick: () => A.setPaused(s.id, false) },
                      icon('play', { size: 16 }),
                      `${s.title} hervatten`,
                    ),
                  }),
                ),
              ),
            )
          : null,
      ),
    ],
  };
}
