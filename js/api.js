// Verbinding met de Freaking Comics-server (Vercel): wachtwoord bewaren en API-aanroepen doen.

const KEY = 'freaking-comics:koppeling';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
  } catch {
    return {};
  }
}

let config = read();

function write(next) {
  config = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* privé-venster: dan alleen voor deze sessie */ }
}

/** Standaard praat de app met de server op hetzelfde adres; op GitHub Pages kun je een ander adres invullen. */
export function serverUrl() {
  return (config.server || '').replace(/\/$/, '') || location.origin;
}

export function isConnected() {
  return !!config.secret;
}

export function getConnection() {
  return { server: config.server || '', secret: config.secret || '' };
}

export function saveConnection({ server, secret }) {
  write({ ...config, server: (server || '').trim(), secret: (secret || '').trim() });
}

export function disconnect() {
  write({});
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, secret, server, timeout = 60_000 } = {}) {
  const base = (server ?? config.server ?? '').replace(/\/$/, '') || location.origin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'X-App-Secret': secret ?? config.secret ?? '',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiError(0, err.name === 'AbortError' ? 'De server reageert niet.' : 'Geen verbinding met de server.');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Serverfout (${res.status}).`);
  if (!data) throw new ApiError(res.status, 'De server gaf geen geldig antwoord. Draait de app op Vercel?');
  return data;
}
