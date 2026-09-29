// Animatie tussen schermen, in pop-art-stijl.
// - Dieper de app in (Home → serie → boek): het nieuwe scherm schuift als een strippaneel
//   van rechts over het oude, met een dikke inktrand.
// - Terug: het scherm schuift weer naar rechts weg.
// - Wisselen tussen de tabbladen onderin: het nieuwe scherm "knalt" erin.
// Gebruikt de View Transitions API waar de browser die heeft; anders een eenvoudige
// CSS-animatie op het nieuwe scherm. Niets bij "beperk beweging".

const TABS = ['/', '/kast', '/aanraders', '/verlanglijst'];

/** Hoe diep een scherm in de app zit. Tabbladen 0, formulieren het diepst. */
export function depth(path) {
  if (TABS.includes(path)) return 0;
  if (/\/(bewerken|nieuw)$/.test(path) || path === '/toevoegen') return 4;
  if (/^\/volume\//.test(path) || /^\/serie\/[\w-]+\/route$/.test(path) || /^\/reeks\//.test(path)) return 2;
  return 1; // serie, zoeken, instellingen
}

/**
 * Welke animatie hoort bij deze stap?
 * @returns {'tab'|'fwd'|'back'|null} null = niet animeren (zelfde scherm)
 */
export function transitionKind(from, to) {
  if (!from || from === to) return null;
  if (TABS.includes(from) && TABS.includes(to)) return 'tab';
  const a = depth(from);
  const b = depth(to);
  if (b > a) return 'fwd';
  if (b < a) return 'back';
  return 'fwd'; // zijwaarts op hetzelfde niveau (bijv. serie → andere serie)
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Voert `update` (het tekenen van het nieuwe scherm) uit, met animatie als dat past.
 * `update` wordt altijd precies één keer aangeroepen.
 */
export function runTransition(kind, update) {
  const root = document.documentElement;
  if (!kind || reducedMotion() || document.visibilityState === 'hidden') {
    update();
    return;
  }

  if (typeof document.startViewTransition === 'function') {
    root.dataset.nav = kind;
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      update();
    };
    try {
      const vt = document.startViewTransition(once);
      vt.finished.finally(() => {
        if (root.dataset.nav === kind) delete root.dataset.nav;
      });
      // Als de browser de overgang overslaat, is het scherm toch getekend.
      vt.updateCallbackDone.catch(() => once());
    } catch {
      delete root.dataset.nav;
      once();
    }
    return;
  }

  // Terugval: alleen het nieuwe scherm animeert.
  update();
  const page = document.querySelector('#app > .app');
  if (!page) return;
  page.classList.add('page-in', `page-in--${kind}`);
  page.addEventListener('animationend', () => page.classList.remove('page-in', `page-in--${kind}`), { once: true });
}
