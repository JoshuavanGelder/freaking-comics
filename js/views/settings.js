// Instellingen: back-up maken/terugzetten, startdata, alles wissen, app installeren.
import { getState, exportJson, importJson, resetToSeed, replaceAll, isStorageOk } from '../store.js';
import { emptyState } from '../model.js';
import { h, backButton, topbar, toast, section, bubble } from '../ui.js';

export const APP_VERSION = '0.1.0';

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function installHint() {
  if (isStandalone()) return h('p', { class: 'hint' }, 'Je gebruikt Freaking Comics al als app. Top!');
  return isIos()
    ? bubble('Op je iPhone: open deze pagina in Safari, tik op Deel (het vierkantje met pijl) en kies "Zet op beginscherm".')
    : bubble('Op Android: tik in Chrome op ⋮ en kies "App installeren" of "Toevoegen aan startscherm".');
}

export function settingsView() {
  const state = getState();
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'sr-only',
    id: 'import-file',
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const data = importJson(await file.text());
        toast(`Back-up teruggezet: ${data.series.length} series, ${data.volumes.length} volumes.`);
        location.hash = '#/kast';
      } catch (ex) {
        toast(ex instanceof SyntaxError ? 'Dit bestand is geen geldige back-up.' : ex.message);
      }
      e.target.value = '';
    },
  });

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `freaking-comics-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Back-up gedownload.');
  };

  return {
    title: 'Instellingen · Freaking Comics',
    nav: 'kast',
    body: [
      topbar(backButton('#/kast', 'Naar mijn kast'), 'Instellingen'),
      h(
        'main',
        { class: 'main', id: 'main' },
        isStorageOk() ? null : h('div', { class: 'error-box' }, 'Let op: je browser laat de app nu niets opslaan (privé-venster?). Wijzigingen zijn weg als je de app sluit.'),
        section('Als app op je telefoon', null, installHint()),
        section(
          'Back-up',
          `${state.series.length} series · ${state.volumes.length} volumes`,
          h('p', { class: 'hint' }, 'Alles staat op dit apparaat. Maak af en toe een back-up, dan ben je niks kwijt als je van telefoon wisselt.'),
          h('button', { class: 'btn btn--yellow btn--block', type: 'button', onClick: download }, 'Back-up downloaden'),
          fileInput,
          h('label', { class: 'btn btn--block', for: 'import-file', tabindex: '0', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } }, 'Back-up terugzetten'),
        ),
        section(
          'Opnieuw beginnen',
          null,
          h(
            'button',
            {
              class: 'btn btn--block',
              type: 'button',
              onClick: () => {
                if (!confirm('Je kast vervangen door de startdata (The Flash en Ultimate Comics)?')) return;
                resetToSeed();
                toast('Startdata teruggezet.');
                location.hash = '#/';
              },
            },
            'Startdata terugzetten',
          ),
          h(
            'button',
            {
              class: 'btn btn--ghost btn--block',
              type: 'button',
              onClick: () => {
                if (!confirm('Echt alles wissen? Maak eerst een back-up als je twijfelt.')) return;
                replaceAll(emptyState());
                toast('Je kast is leeg.');
                location.hash = '#/';
              },
            },
            'Alles wissen',
          ),
        ),
        h('p', { class: 'hint', style: { textAlign: 'center' } }, `Freaking Comics ${APP_VERSION} · gegevens en covers via Metron volgen in de volgende versie.`),
      ),
    ],
  };
}
