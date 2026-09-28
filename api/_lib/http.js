// Gedeelde hulpjes voor de server-functies (Vercel, Web-standaard Request/Response).
import { timingSafeEqual, createHash } from 'node:crypto';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
  'Access-Control-Max-Age': '86400',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/** Controleert het app-wachtwoord (header X-App-Secret). */
export function requireApp(request) {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new HttpError(503, 'APP_SECRET is nog niet ingesteld op de server.');
  const given = request.headers.get('x-app-secret') || '';
  if (!given || !safeEqual(given, secret)) throw new HttpError(401, 'Verkeerd app-wachtwoord.');
}

/** Voor de dagelijkse taak: Vercel stuurt "Authorization: Bearer <CRON_SECRET>". Het app-wachtwoord mag ook. */
export function requireCronOrApp(request) {
  const cron = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (cron && auth === `Bearer ${cron}`) return 'cron';
  requireApp(request);
  return 'app';
}

/** Wikkelt een handler: vangt fouten af en zet ze om in nette JSON. */
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      return json({ error: err.message || 'Er ging iets mis.' }, status);
    }
  };
}

export async function readJson(request, maxBytes = 2_000_000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Te veel gegevens in één keer.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Ongeldige JSON.');
  }
}
