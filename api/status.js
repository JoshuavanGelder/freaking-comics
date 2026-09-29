// Laat zien wat er op de server is ingesteld (zonder geheimen prijs te geven).
import { json, preflight, handle, requireApp } from './_lib/http.js';
import { storageConfigured } from './_lib/store.js';
import { metronConfigured } from './_lib/metron.js';
import { comicVineConfigured } from './_lib/comicvine.js';
import { claudeConfigured } from './_lib/claude.js';

export const OPTIONS = preflight;

export const GET = handle(async (request) => {
  let authorized = null;
  if (request.headers.get('x-app-secret')) {
    try {
      requireApp(request);
      authorized = true;
    } catch {
      authorized = false;
    }
  }
  return json({
    ok: true,
    version: '0.8.0',
    configured: {
      secret: !!process.env.APP_SECRET,
      storage: storageConfigured(),
      metron: metronConfigured(),
      comicvine: comicVineConfigured(),
      cron: !!process.env.CRON_SECRET,
      ai: claudeConfigured(),
    },
    authorized,
  });
});
