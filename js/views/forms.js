// Formulieren: serie toevoegen/bewerken en volume toevoegen/bewerken.
import * as M from '../model.js';
import { getState, dispatch } from '../store.js';
import { h, backButton, topbar, toast } from '../ui.js';
import * as A from '../actions.js';
import { isConnected } from '../api.js';

function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
}

function errorBox() {
  return h('div', { class: 'error-box', role: 'alert', hidden: true });
}

function showError(box, err) {
  box.textContent = err instanceof Error ? err.message : String(err);
  box.hidden = false;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ---------------------------------------------------------------- serie

export function serieFormView({ id } = {}) {
  const state = getState();
  const existing = id ? M.getSeries(state, id) : null;
  if (id && !existing) {
    return { title: 'Niet gevonden', nav: 'kast', body: [topbar(backButton('#/kast'), 'Serie'), h('main', { class: 'main' }, h('p', {}, 'Deze serie bestaat niet (meer).'))] };
  }
  const data = existing || { title: '', publisher: '', line: '', years: '', color: 'red' };
  let color = data.color;

  const err = errorBox();
  const title = h('input', { class: 'input', id: 'f-title', name: 'title', required: true, autocomplete: 'off', value: data.title, placeholder: 'bijv. The Flash' });
  const publisher = h(
    'select',
    { class: 'select', id: 'f-publisher', name: 'publisher' },
    h('option', { value: '' }, '—'),
    M.PUBLISHERS.map((p) => h('option', { value: p, selected: p === data.publisher }, p)),
    data.publisher && !M.PUBLISHERS.includes(data.publisher) ? h('option', { value: data.publisher, selected: true }, data.publisher) : null,
  );
  const line = h('input', { class: 'input', id: 'f-line', name: 'line', autocomplete: 'off', value: data.line, placeholder: 'New 52, Ultimate…' });
  const years = h('input', { class: 'input', id: 'f-years', name: 'years', autocomplete: 'off', value: data.years, placeholder: '2011–2016' });

  const swatchButtons = Object.entries(M.COLORS).map(([key, hex]) =>
    h('button', {
      class: `swatch ${key === 'yellow' ? 'dots' : 'dots-light'}`,
      type: 'button',
      style: { backgroundColor: hex },
      'aria-pressed': String(key === color),
      'aria-label': { red: 'Rood', blue: 'Blauw', yellow: 'Geel', ink: 'Zwart' }[key],
      onClick: (e) => {
        color = key;
        swatchButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
        e.currentTarget.setAttribute('aria-pressed', 'true');
      },
    }),
  );

  const back = existing ? `#/serie/${existing.id}` : '#/kast';

  const form = h(
    'form',
    {
      class: 'form',
      novalidate: true,
      onSubmit: (e) => {
        e.preventDefault();
        const values = { title: title.value, publisher: publisher.value, line: line.value, years: years.value, color };
        try {
          if (existing) {
            dispatch((s) => M.updateSeries(s, existing.id, values));
            toast('Opgeslagen.');
            location.replace(`#/serie/${existing.id}`);
          } else {
            const r = dispatch((s) => M.addSeries(s, values));
            toast(`${values.title.trim()} staat in je kast.`);
            location.replace(`#/volume/nieuw?serie=${r.id}&eerste=1`);
          }
        } catch (ex) {
          showError(err, ex);
          title.focus();
        }
      },
    },
    !existing && isConnected()
      ? h('a', { class: 'btn btn--yellow btn--block', href: '#/zoeken' }, 'Zoek online (vult alles automatisch in)')
      : null,
    err,
    field('Titel', title),
    h('div', { class: 'field-row' }, field('Uitgever', publisher), field('Jaren', years)),
    field('Lijn of tijdperk', line, 'Handig als dezelfde titel vaker opnieuw begon.'),
    h('div', { class: 'field' }, h('p', { class: 'field-label', style: { margin: 0 } }, 'Kleur van de covers'), h('div', { class: 'swatches', role: 'group', 'aria-label': 'Kleur' }, swatchButtons)),
    h('div', { class: 'form-actions' }, h('a', { class: 'btn', href: back }, 'Annuleren'), h('button', { class: 'btn btn--ink', type: 'submit' }, existing ? 'Opslaan' : 'Toevoegen')),
    existing
      ? h(
          'div',
          { class: 'danger-zone' },
          h(
            'button',
            {
              class: 'btn btn--ghost btn--block',
              type: 'button',
              onClick: () => {
                const n = M.volumesOf(getState(), existing.id).length;
                if (!confirm(`${existing.title} en ${n} ${n === 1 ? 'volume' : 'volumes'} verwijderen?`)) return;
                location.replace('#/kast');
                A.deleteSeries(existing.id);
              },
            },
            'Serie verwijderen',
          ),
        )
      : null,
  );

  return {
    title: `${existing ? 'Serie bewerken' : 'Nieuwe serie'} · Freaking Comics`,
    nav: 'kast',
    focus: existing ? null : title,
    body: [topbar(backButton(back, 'Annuleren'), existing ? 'Serie bewerken' : 'Nieuwe serie'), h('main', { id: 'main' }, form)],
  };
}

// ---------------------------------------------------------------- volume

export function volumeFormView({ id } = {}, _ctx, query = new URLSearchParams()) {
  const state = getState();
  const existing = id ? M.getVolume(state, id) : null;
  if (id && !existing) {
    return { title: 'Niet gevonden', nav: 'kast', body: [topbar(backButton('#/kast'), 'Volume'), h('main', { class: 'main' }, h('p', {}, 'Dit volume bestaat niet (meer).'))] };
  }
  if (!state.series.length) {
    location.replace('#/serie/nieuw');
    return { title: 'Nieuwe serie', nav: 'kast', body: [] };
  }

  const firstOfSeries = query.get('eerste') === '1';
  const presetSeries = existing?.seriesId || (M.getSeries(state, query.get('serie')) ? query.get('serie') : M.continueReading(state)[0]?.id || state.series[0].id);
  const seriesTitle = () => M.getSeries(getState(), seriesSel.value)?.title || '';

  const err = errorBox();
  const seriesSel = h(
    'select',
    { class: 'select', id: 'f-series', name: 'seriesId' },
    [...state.series].sort((a, b) => a.title.localeCompare(b.title)).map((s) =>
      h('option', { value: s.id, selected: s.id === presetSeries }, [s.title, s.line ? `(${s.line})` : ''].filter(Boolean).join(' ')),
    ),
  );
  const title = h('input', { class: 'input', id: 'f-title', name: 'title', required: true, autocomplete: 'off', value: existing?.title || '', placeholder: 'bijv. Out of Time' });
  const number = h('input', { class: 'input', id: 'f-number', name: 'number', autocomplete: 'off', inputmode: 'decimal', value: existing?.number || '', placeholder: 'bijv. 6' });
  const position = h('input', {
    class: 'input',
    id: 'f-position',
    name: 'position',
    type: 'number',
    step: 'any',
    inputmode: 'decimal',
    value: String(existing ? existing.position : M.nextPosition(state, presetSeries)),
  });
  let positionTouched = !!existing;
  position.addEventListener('input', () => { positionTouched = true; });
  number.addEventListener('input', () => {
    if (!positionTouched && /^\d+(\.\d+)?$/.test(number.value.trim())) position.value = number.value.trim();
  });
  seriesSel.addEventListener('change', () => {
    if (!existing && !positionTouched) position.value = String(M.nextPosition(getState(), seriesSel.value));
    updatePreview();
  });

  const format = h('select', { class: 'select', id: 'f-format', name: 'format' }, Object.entries(M.FORMATS).map(([k, label]) => h('option', { value: k, selected: k === (existing?.format || 'trade') }, label)));
  const isSide = h('input', { type: 'checkbox', id: 'f-side', name: 'isSide', checked: !!existing?.isSide });
  const readStatus = h('select', { class: 'select', id: 'f-read', name: 'readStatus' }, M.READ_STATUS.map((k) => h('option', { value: k, selected: k === (existing?.readStatus || 'unread') }, M.READ_LABELS[k])));
  const ownership = h('select', { class: 'select', id: 'f-own', name: 'ownership' }, M.OWNERSHIP.map((k) => h('option', { value: k, selected: k === (existing?.ownership || 'none') }, M.OWN_LABELS[k])));

  const series0 = M.getSeries(state, presetSeries);
  const issues = h('textarea', {
    class: 'textarea',
    id: 'f-issues',
    name: 'issues',
    spellcheck: 'false',
    autocapitalize: 'off',
    placeholder: '#1–8, Annual #1',
  });
  issues.value = existing ? M.issuesToText(existing.issues, series0?.title || '') : '';
  const preview = h('p', { class: 'preview', 'aria-live': 'polite' });
  const note = h('textarea', { class: 'textarea', id: 'f-note', name: 'note', style: { minHeight: '80px' } });
  note.value = existing?.note || '';

  function updatePreview() {
    const { issues: list, errors } = M.parseIssues(issues.value, seriesTitle());
    preview.replaceChildren();
    preview.className = 'preview';
    if (!issues.value.trim()) {
      preview.textContent = 'Optioneel. Eén regel per serie als het boek er meerdere bevat.';
      return;
    }
    if (errors.length) {
      preview.className = 'preview preview--error';
      preview.textContent = `Snap ik niet: ${errors.join(', ')}`;
      return;
    }
    preview.textContent = `${list.length} ${list.length === 1 ? 'issue' : 'issues'}: ${M.formatIssues(list, seriesTitle())}`;
  }
  issues.addEventListener('input', updatePreview);
  updatePreview();

  const back = existing ? `#/volume/${existing.id}` : query.get('serie') ? `#/serie/${query.get('serie')}` : '#/';

  const form = h(
    'form',
    {
      class: 'form',
      novalidate: true,
      onSubmit: (e) => {
        e.preventDefault();
        const parsed = M.parseIssues(issues.value, seriesTitle());
        if (parsed.errors.length) {
          showError(err, `Kijk de issues nog even na: ${parsed.errors.join(', ')}`);
          issues.focus();
          return;
        }
        const values = {
          seriesId: seriesSel.value,
          title: title.value,
          number: number.value,
          position: position.value === '' ? M.nextPosition(getState(), seriesSel.value) : Number(position.value),
          format: format.value,
          isSide: isSide.checked,
          // Alleen doorgeven als je hem zelf veranderde, anders volgt hij de issues.
          readStatus: existing && readStatus.value === existing.readStatus ? undefined : readStatus.value,
          ownership: ownership.value,
          issues: parsed.issues,
          note: note.value,
        };
        try {
          if (existing) {
            dispatch((s) => M.updateVolume(s, existing.id, values));
            toast('Opgeslagen.');
            location.replace(`#/volume/${existing.id}`);
          } else {
            const r = dispatch((s) => M.addVolume(s, values));
            toast(`${M.volumeShortName(M.getVolume(getState(), r.id))} toegevoegd.`, {
              label: 'Nog een',
              run: () => { location.hash = `#/volume/nieuw?serie=${values.seriesId}`; },
            });
            location.replace(`#/serie/${values.seriesId}`);
          }
        } catch (ex) {
          showError(err, ex);
        }
      },
    },
    firstOfSeries ? h('div', { class: 'bubble' }, h('p', {}, 'Top! Voeg nu het eerste deel toe. Alleen de titel is nodig.')) : null,
    err,
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'f-series' }, 'Serie'),
      seriesSel,
      existing ? null : h('a', { href: '#/serie/nieuw', class: 'hint', style: { fontWeight: '700' } }, '+ Nieuwe serie aanmaken'),
    ),
    field('Titel', title),
    h('div', { class: 'field-row' }, field('Deelnummer', number), field('Plek in de serie', position)),
    h('p', { class: 'hint', style: { marginTop: '-10px' } }, 'De plek bepaalt de volgorde. Een tie-in tussen deel 4 en 5? Kies plek 4.5.'),
    h('label', { class: 'check', for: 'f-side' }, isSide, h('span', {}, h('b', {}, 'Tussendoor (zijverhaal). '), 'Telt niet mee voor "volgende deel", tenzij je het aan het lezen bent.')),
    field('Formaat', format),
    h('div', { class: 'field' }, h('label', { for: 'f-issues' }, 'Issues erin'), issues, preview),
    h('div', { class: 'field-row' }, field('Leesstatus', readStatus), field('In de kast', ownership)),
    field('Notitie', note),
    h('div', { class: 'form-actions' }, h('a', { class: 'btn', href: back }, 'Annuleren'), h('button', { class: 'btn btn--ink', type: 'submit' }, existing ? 'Opslaan' : 'Toevoegen')),
    existing
      ? h(
          'div',
          { class: 'danger-zone' },
          h(
            'button',
            {
              class: 'btn btn--ghost btn--block',
              type: 'button',
              onClick: () => {
                if (!confirm(`${M.volumeName(existing)} verwijderen?`)) return;
                location.replace(`#/serie/${existing.seriesId}`);
                A.deleteVolume(existing.id);
              },
            },
            'Volume verwijderen',
          ),
        )
      : null,
  );

  return {
    title: `${existing ? 'Volume bewerken' : 'Nieuw volume'} · Freaking Comics`,
    nav: 'kast',
    focus: existing ? null : title,
    body: [topbar(backButton(back, 'Annuleren'), existing ? 'Volume bewerken' : 'Nieuw volume'), h('main', { id: 'main' }, form)],
  };
}

