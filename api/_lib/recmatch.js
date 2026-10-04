// Koppelt een aanrader van Claude aan een reeks online: zoekt op Comic Vine én Metron en kiest de beste.
import { findRecommendation as findComicVine, matchScore, comicVineConfigured } from './comicvine.js';
import { recommendationCandidates, seriesCover, metronConfigured } from './metron.js';

/** Metron noemt trades "Flash TPB (2013)": haal jaartal en uitgavevorm weg om te kunnen vergelijken. */
export function cleanMetronName(name) {
  return String(name || '')
    .replace(/\s*\(\d{4}(?:\s*-\s*\d{0,4})?\)\s*$/, '')
    .replace(/\s+(TPB|HC|SC|OGN|GN|Omnibus|Hardcover|Trade Paperback|Graphic Novel)\s*$/i, '')
    .trim();
}

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Beste Metron-reeks voor een aanrader, met dezelfde score als Comic Vine. */
export async function findMetron(item, { deadline } = {}) {
  const candidates = await recommendationCandidates(item.series, { deadline });
  let best = null;
  for (const s of candidates) {
    const score = matchScore(item, { name: cleanMetronName(s.name), publisher: s.publisher, year: s.year, issueCount: s.issueCount });
    if (score >= 4 && (!best || score > best.score)) best = { ...s, score };
  }
  return best;
}

/**
 * Kiest tussen de twee treffers. Metron moet duidelijk beter passen (meer dan 1 punt), anders blijft
 * het Comic Vine: daar komen de covers en de nummers van een deel direct uit.
 */
export function chooseMatch(cv, metron) {
  const cvScore = cv ? cv.score : -Infinity;
  const mScore = metron ? metron.score : -Infinity;
  if (metron && (!cv || mScore > cvScore + 1)) {
    return { source: 'metron', id: metron.id, name: cleanMetronName(metron.name), year: metron.year || null, image: null, issueCount: metron.issueCount ?? null };
  }
  if (cv) return { source: 'comicvine', id: cv.id, name: cv.name, year: cv.start_year || null, image: cv.image || null, issueCount: cv.count_of_issues ?? null };
  return null;
}

/** Zoekt bij een aanrader de beste reeks. Een bron die niet antwoordt telt gewoon niet mee. */
export async function findMatch(item) {
  const [cv, metron] = await Promise.all([
    comicVineConfigured() ? withTimeout(findComicVine(item).catch(() => null), 15_000) : null,
    metronConfigured() ? withTimeout(findMetron(item, { deadline: Date.now() + 12_000 }).catch(() => null), 14_000) : null,
  ]);
  const match = chooseMatch(cv, metron);
  if (match?.source === 'metron') {
    match.image = (await withTimeout(seriesCover(match.id, { deadline: Date.now() + 8_000 }).catch(() => ''), 9_000)) || null;
  }
  return match;
}
