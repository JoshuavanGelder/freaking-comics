// Kleine DOM-helpers en herbruikbare onderdelen. Tekst gaat altijd via textContent (veilig).
import { COLORS } from './model.js';

/**
 * h('div', { class: 'x', onClick: fn, 'aria-label': '…' }, kind, 'tekst', [lijst])
 * `style` mag een string of object zijn. Props met waarde null/false/undefined worden overgeslagen.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'value' && 'value' in el) {
      el.value = value;
    } else if (key === 'checked' || key === 'selected' || key === 'disabled') {
      el[key] = !!value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  home: ['M3 11l9-7 9 7', 'M5 10v10h14V10'],
  shelf: ['M4 4h4v16H4z', 'M10 4h4v16h-4z', 'M16 5l3.5-1 3 15.5-3.5 1z'],
  bookmark: ['M6 3h12v18l-6-4-6 4z'],
  back: ['M19 12H5', 'M11 6l-6 6 6 6'],
  plus: ['M12 5v14', 'M5 12h14'],
  chevron: ['M9 6l6 6-6 6'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  gear: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  ],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  pause: ['M8 5v14', 'M16 5v14'],
  play: ['M7 4l13 8-13 8z'],
  check: ['M5 12l5 5L20 7'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  route: ['M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M6 15V9a4 4 0 0 1 4-4h6', 'M18 9v6a4 4 0 0 1-4 4H8'],
};

export function icon(name, { size = 20, color = 'currentColor', width = 2.6 } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color);
  svg.setAttribute('stroke-width', width);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Tijdelijke cover: gekleurd vlak met halftone en het deelnummer.
 * Echte covers komen in stap 2 uit Metron.
 */
export function cover(volume, series, size = 'md', { ghost = false } = {}) {
  const color = COLORS[series?.color] || COLORS.red;
  const light = series?.color === 'yellow';
  const word = !volume?.number && size === 'lg';
  const label = volume?.number || (word ? volume?.title || '' : '');
  const cls = [
    'cover',
    `cover--${size}`,
    word ? 'cover--word' : '',
    light ? 'dots cover--yellow' : 'dots-light',
    ghost ? 'cover--ghost' : '',
  ].join(' ');
  const box = h('div', { class: cls, style: { backgroundColor: color }, 'aria-hidden': 'true' }, label);
  if (volume?.cover) {
    const img = h('img', { class: `cover__img${ghost ? ' cover__img--faded' : ''}`, src: volume.cover, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    box.classList.add('cover--photo');
    box.appendChild(img);
  }
  return box;
}

export function formatDate(iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '';
  try {
    return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('nl-NL', opts);
  } catch {
    return iso.slice(0, 10);
  }
}

export function progress(done, total, text) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h(
    'div',
    { class: 'progress' },
    h(
      'div',
      {
        class: 'progress__bar',
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': total,
        'aria-valuenow': done,
        'aria-label': text,
      },
      h('div', { class: `progress__fill dots${pct === 0 ? ' progress__fill--empty' : ''}`, style: { width: `${pct}%` } }),
    ),
    h('div', { class: 'progress__text' }, text),
  );
}

export function section(title, meta, ...children) {
  return h(
    'section',
    { class: 'section' },
    h('div', { class: 'section__head' }, h('h2', { class: 'h2' }, h('span', {}, title)), meta ? h('div', { class: 'meta' }, meta) : null),
    ...children,
  );
}

export function bubble(...paragraphs) {
  return h('div', { class: 'bubble' }, ...paragraphs.map((p) => h('p', {}, p)));
}

export function backButton(href, label = 'Terug') {
  return h('a', { class: 'icon-btn', href, 'aria-label': label }, icon('back', { width: 2.8 }));
}

export function topbar(left, label, right) {
  return h(
    'div',
    { class: 'topbar' },
    left || h('span', { style: { width: '44px' } }),
    h('div', { class: 'topbar__label' }, label),
    right || h('span', { style: { width: '44px' } }),
  );
}

export function nav(active) {
  const item = (href, key, iconName, label) =>
    h(
      'a',
      { href, 'aria-current': active === key ? 'page' : null },
      icon(iconName, { size: 22, width: active === key ? 2.4 : 2.2 }),
      label,
    );
  return h(
    'nav',
    { class: 'nav', 'aria-label': 'Hoofdmenu' },
    h(
      'div',
      { class: 'nav__inner' },
      item('#/', 'home', 'home', 'Home'),
      item('#/kast', 'kast', 'shelf', 'Mijn kast'),
      item('#/verlanglijst', 'wish', 'bookmark', 'Verlanglijst'),
    ),
  );
}

// ---------------------------------------------------------------- toast

let toastTimer = null;

/** Korte melding onderin, optioneel met één actie (bijv. "Ongedaan maken"). */
export function toast(message, action) {
  const wrap = document.getElementById('toast');
  if (!wrap) return;
  clearTimeout(toastTimer);
  wrap.replaceChildren(
    h(
      'div',
      { class: 'toast', role: 'status' },
      h('span', { class: 'toast__text' }, message),
      action
        ? h(
            'button',
            {
              class: 'btn btn--ink',
              type: 'button',
              onClick: () => {
                wrap.replaceChildren();
                action.run();
              },
            },
            action.label,
          )
        : null,
    ),
  );
  toastTimer = setTimeout(() => wrap.replaceChildren(), action ? 6000 : 3000);
}
