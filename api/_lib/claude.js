// Claude (Anthropic API) voor aanraders: leest je kast en geeft boeken terug met een reden erbij.
import { HttpError } from './http.js';

const BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

export function claudeConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const KINDS = ['vervolg', 'zelfde-maker', 'vergelijkbaar', 'klassieker'];

const TOOL = {
  name: 'aanraders',
  description: 'Geef de aanbevolen stripboeken terug.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            series: { type: 'string', description: 'Name of the comic series as published in English, without volume number or year, e.g. "The Flash" or "Ultimate Comics Spider-Man". This is used to search Comic Vine.' },
            title: { type: 'string', description: 'The specific collected edition to start with, e.g. "Vol. 1: Lightning Strikes Twice" or "Omnibus Vol. 1".' },
            publisher: { type: 'string' },
            year: { type: 'integer', description: 'Year the first issue of the collected run was published.' },
            creators: { type: 'string', description: 'Main writer and artist, e.g. "Joshua Williamson / Carmine Di Giandomenico".' },
            kind: { type: 'string', enum: KINDS, description: 'vervolg = continues a story from the shelf; zelfde-maker = same writer/artist; vergelijkbaar = similar tone/theme; klassieker = acclaimed must-read that fits the taste.' },
            because: { type: 'string', description: 'Exact title of the book on the shelf this recommendation mainly builds on (copy it from the shelf list), or empty.' },
            reason: { type: 'string', description: 'Why, in informal Dutch (je-vorm), max 2 short sentences, concrete, referring to what the reader read or liked. No spoilers.' },
          },
          required: ['series', 'title', 'publisher', 'year', 'kind', 'reason'],
        },
      },
    },
    required: ['items'],
  },
};

const SYSTEM = `You are a comic book shop clerk with encyclopedic knowledge of DC, Marvel, Image and other English-language comics. You recommend collected editions (trade paperbacks, hardcovers, omnibuses) to one reader based on their shelf.

Rules:
- Recommend only books that really exist as English collected editions. Never invent titles; if unsure about an exact volume title, name the series and "Vol. 1".
- Never recommend anything that is already on the shelf (read, unread, owned or on the wishlist), nor anything on the "not for me" list.
- Mix: about a third direct continuations or the logical next step of stories on the shelf (e.g. what to read after finishing a run), a third by the same writers or artists, a third similar in tone or theme, possibly from other publishers. At most one "klassieker".
- Books marked TOP weigh heavily; books marked NIKS mean: avoid that style, writer or kind of story.
- For a continuation of a series the reader is still reading, do not recommend the next volume of that same collected series (the app already tracks that); recommend what comes after the run, or a related series.
- Write "reason" in informal Dutch (je-vorm), max 2 short sentences, concrete and enthusiastic but not over the top, without spoilers.`;

/** Vraagt Claude om aanraders. Geeft een lijst ruwe items terug (nog zonder Comic Vine-gegevens). */
export async function askRecommendations({ profile, dismissed = [], previous = [], count = 8 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(503, 'Aanraders zijn nog niet ingesteld: zet ANTHROPIC_API_KEY in Vercel.');
  const user = [
    `My shelf (Dutch labels: gelezen = read, bezig = reading, nog niet = not read yet):\n\n${profile || '(empty)'}`,
    dismissed.length ? `Not for me (never recommend):\n${dismissed.map((d) => `- ${d}`).join('\n')}` : '',
    previous.length ? `Recommended last time (try to suggest different books, unless one is clearly the best fit):\n${previous.map((d) => `- ${d}`).join('\n')}` : '',
    `Recommend ${count} books.`,
  ].filter(Boolean).join('\n\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  let res;
  try {
    res = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-api-key': key.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 3000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch (err) {
    throw new HttpError(504, err.name === 'AbortError' ? 'Claude deed er te lang over. Probeer het nog eens.' : `Claude is niet bereikbaar: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Anthropic weigert de sleutel. Kijk ANTHROPIC_API_KEY na.');
  if (res.status === 429 || res.status === 529) throw new HttpError(429, 'Claude is even druk. Probeer het over een minuutje nog eens.');
  if (!res.ok || !body) {
    const msg = body?.error?.message || `fout ${res.status}`;
    if (/credit balance/i.test(msg)) throw new HttpError(402, 'Je Anthropic-tegoed is op. Vul het aan op console.anthropic.com.');
    throw new HttpError(502, `Claude: ${msg}`);
  }
  const call = (body.content || []).find((c) => c.type === 'tool_use' && c.name === TOOL.name);
  const items = Array.isArray(call?.input?.items) ? call.input.items : [];
  return items
    .filter((i) => i && i.series && i.reason)
    .map((i) => ({
      series: String(i.series).trim(),
      title: String(i.title || '').trim(),
      publisher: String(i.publisher || '').trim(),
      year: Number(i.year) || null,
      creators: String(i.creators || '').trim(),
      kind: KINDS.includes(i.kind) ? i.kind : 'vergelijkbaar',
      because: String(i.because || '').trim(),
      reason: String(i.reason).trim(),
    }));
}
