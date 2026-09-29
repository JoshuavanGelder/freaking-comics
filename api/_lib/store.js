// Opslag via Upstash Redis (REST). Vercel zet de variabelen automatisch
// als je in het Vercel-dashboard een Upstash Redis-database aan het project koppelt.
import { HttpError } from './http.js';

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export function storageConfigured() {
  return !!config();
}

async function command(...args) {
  const cfg = config();
  if (!cfg) throw new HttpError(503, 'Er is nog geen opslag gekoppeld (Upstash Redis in Vercel).');
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new HttpError(502, `Opslag gaf een fout: ${body.error || res.status}`);
  return body.result;
}

export async function getJson(key) {
  const raw = await command('GET', key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setJson(key, value, ttlSeconds) {
  const args = ['SET', key, JSON.stringify(value)];
  if (ttlSeconds) args.push('EX', String(ttlSeconds));
  await command(...args);
}

export const KEYS = {
  state: 'fc:state',
  checks: 'fc:release-checks',
  recs: 'fc:aanraders',
  metronIssue: (id) => `fc:metron:issue:${id}`,
  metronSeriesItems: (id) => `fc:metron:series-items:${id}`,
};
