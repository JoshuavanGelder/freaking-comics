// Instellingen: back-up maken/terugzetten, startdata, alles wissen, app installeren.
import { getState, exportJson, importJson, resetToSeed, replaceAll, isStorageOk, setFromSync } from '../store.js';
import { emptyState } from '../model.js';
import { h, backButton, topbar, toast, section, bubble, formatDate } from '../ui.js';
import { api, isConnected, getConnection, saveConnection, disconnect } from '../api.js';
import { syncNow, syncStatus, fetchRemote } from '../sync.js';

export const APP_VERSION = '0.2.0';

// Schermstatus van het koppel-formulier.
const conn = { busy: false, error: null, choice: null, checking: false };

const MISSING = {
  secret: 'APP_SECRET (het app-wachtwoord)',
  storage: 'opslag (Upstash Redis koppelen in Vercel → Storage)',
  metron: 'METRON_TOKEN (je Metron-token)',
};

async function connect(server, secret, rerender) {
  conn.busy = true;
  conn.error = null;
  rerender();
  try {
    const status = await api('/api/status', { server, secret });
    const missing = Object.entries(MISSING).filter(([k]) => !status.configured[k]).map(([, v]) => v);
    if (!status.configured.secret || !status.configured.storage) {
      throw new Error(`Op de server ontbreekt nog: ${missing.join(', ')}.`);
    }
    if (status.authorized !== true) throw new Error('Dat wachtwoord klopt niet met APP_SECRET op de server.');
    saveConnection({ server, secret });
    const remote = await fetchRemote();
    if (remote.state && remote.state.series.length && getState().series.length) {
      conn.choice = remote;
    } else if (remote.state && remote.state.series.length) {
      setFromSync(remote.state);
      toast('Gekoppeld! Je kast is binnengehaald.');
    } else {
      await syncNow();
      toast('Gekoppeld! Je kast staat nu ook op de server.');
    }
    if (missing.length) toast(`Gekoppeld, maar nog niet ingesteld: ${missing.join(', ')}.`);
  } catch (err) {
    conn.error = err.message;
  }
  conn.busy = false;
  rerender();
}

function connectionSection(rerender) {
  if (conn.choice) {
    const remote = conn.choice.state;
    return section(
      'Welke kast?',
      null,
      bubble(`Op de server staat al een kast met ${remote.series.length} series en ${remote.volumes.length} volumes. Wat wil je op dit apparaat?`),
      h('button', { class: 'btn btn--ink btn--block', type: 'button', onClick: () => { setFromSync(remote); conn.choice = null; toast('Kast van de server gebruikt.'); syncNow(); } }, 'Kast van de server gebruiken'),
      h('button', { class: 'btn btn--block', type: 'button', onClick: () => { conn.choice = null; syncNow(); toast('Samengevoegd.'); } }, 'Samenvoegen met wat hier staat'),
      h('p', { class: 'hint' }, 'Nieuw apparaat? Kies "van de server". Samenvoegen kan dubbele series opleveren als je op beide dezelfde startdata had.'),
    );
  }

  if (isConnected()) {
    const st = syncStatus();
    const text = {
      ok: st.lastSyncedAt ? `Gesynchroniseerd, ${new Date(st.lastSyncedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : 'Gekoppeld',
      syncing: 'Bezig met synchroniseren…',
      error: `Probleem: ${st.error}`,
      offline: 'Geen internet; sync volgt vanzelf.',
      off: 'Gekoppeld',
    }[st.state];
    const lastCheck = getState().releasesCheckedAt;
    return section(
      'Sync & automatisch',
      null,
      h('p', { class: 'meta', style: { margin: 0 } }, h('span', { class: `sync-dot sync-dot--${st.state}`, 'aria-hidden': 'true' }), text),
      h('p', { class: 'hint' }, `Je kast synct vanzelf tussen je apparaten. Elke ochtend kijkt de server op Metron of er nieuwe delen zijn${lastCheck ? `; laatst: ${formatDate(lastCheck.slice(0, 10))}` : ''}.`),
      h('button', { class: 'btn btn--yellow btn--block', type: 'button', disabled: st.state === 'syncing', onClick: () => syncNow() }, 'Nu synchroniseren'),
      h(
        'button',
        {
          class: 'btn btn--block',
          type: 'button',
          disabled: conn.checking,
          onClick: async () => {
            conn.checking = true;
            rerender();
            try {
              await syncNow();
              const r = await api('/api/cron', { method: 'POST', timeout: 90_000 });
              await syncNow();
              toast(r.added?.length ? `${r.added.length} nieuwe ${r.added.length === 1 ? 'deel' : 'delen'} gevonden!` : r.message || 'Geen nieuwe delen gevonden.');
            } catch (err) {
              toast(err.message);
            }
            conn.checking = false;
            rerender();
          },
        },
        conn.checking ? 'Bezig met controleren…' : 'Nu controleren op nieuwe delen',
      ),
      h('button', { class: 'btn btn--ghost btn--block', type: 'button', onClick: () => { if (confirm('Dit apparaat ontkoppelen? Je kast blijft hier en op de server staan.')) { disconnect(); rerender(); } } }, 'Ontkoppelen'),
    );
  }

  const current = getConnection();
  const onPages = /github\.io$/.test(location.hostname);
  const server = h('input', { class: 'input', id: 'c-server', type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://freaking-comics.vercel.app', value: current.server });
  const secret = h('input', { class: 'input', id: 'c-secret', type: 'password', autocomplete: 'current-password', value: current.secret });
  return section(
    'Koppelen',
    null,
    h('p', { class: 'hint' }, 'Koppel de app aan je server voor sync tussen apparaten, zoeken op Metron en automatisch nieuwe delen.'),
    conn.error ? h('div', { class: 'error-box', role: 'alert' }, conn.error) : null,
    h(
      'form',
      {
        class: 'stack',
        onSubmit: (e) => {
          e.preventDefault();
          connect(server.value.trim(), secret.value.trim(), rerender);
        },
      },
      onPages || current.server
        ? h('div', { class: 'field' }, h('label', { for: 'c-server' }, 'Serveradres'), server, h('p', { class: 'hint' }, 'Het adres van je app op Vercel.'))
        : null,
      h('div', { class: 'field' }, h('label', { for: 'c-secret' }, 'App-wachtwoord'), secret, h('p', { class: 'hint' }, 'Hetzelfde als APP_SECRET in Vercel. Eén keer invullen per apparaat.')),
      h('button', { class: 'btn btn--ink btn--block', type: 'submit', disabled: conn.busy }, conn.busy ? 'Bezig…' : 'Koppelen'),
    ),
  );
}

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

export function settingsView(_params, ctx) {
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
        connectionSection(ctx.rerender),
        section('Als app op je telefoon', null, installHint()),
        section(
          'Back-up',
          `${state.series.length} series · ${state.volumes.length} volumes`,
          h('p', { class: 'hint' }, isConnected() ? 'Je kast staat op dit apparaat én op je server. Een back-upbestand is een extra zekerheid.' : 'Alles staat op dit apparaat. Maak af en toe een back-up, dan ben je niks kwijt als je van telefoon wisselt.'),
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
        h('p', { class: 'hint', style: { textAlign: 'center' } }, `Freaking Comics ${APP_VERSION} · gegevens en covers via Metron (metron.cloud).`),
      ),
    ],
  };
}
