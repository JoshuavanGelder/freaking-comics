// Nep-Metron en nep-Upstash voor lokaal testen (geen echte accounts nodig).
// Wordt alleen gebruikt door tools/dev-server.js en de tests.

const store = new Map();

const SERIES = [
  { id: 1000, series: 'The Flash (2011)', name: 'The Flash', year_began: 2011, year_end: 2016, volume: 4, issue_count: 52, publisher: { id: 2, name: 'DC Comics' }, series_type: { id: 1, name: 'Ongoing Series' } },
  { id: 1001, series: 'The Flash TPB (2012)', name: 'The Flash', year_began: 2012, year_end: 2016, volume: 1, issue_count: 9, publisher: { id: 2, name: 'DC Comics' }, series_type: { id: 10, name: 'Trade Paperback' } },
  { id: 2001, series: 'Ultimate Comics: Divided We Fall, United We Stand HC (2013)', name: 'Ultimate Comics: Divided We Fall, United We Stand', year_began: 2013, year_end: 2013, volume: 1, issue_count: 1, publisher: { id: 1, name: 'Marvel' }, series_type: { id: 8, name: 'Hardcover' } },
  { id: 1002, series: 'Flash TPB (2013)', name: 'Flash', year_began: 2013, year_end: 2017, volume: 1, issue_count: 9, publisher: { id: 2, name: 'DC Comics' }, series_type: { id: 10, name: 'Trade Paperback' } },
  { id: 3001, series: 'Saga TPB (2012)', name: 'Saga', year_began: 2012, year_end: null, volume: 1, issue_count: 3, publisher: { id: 3, name: 'Image' }, series_type: { id: 10, name: 'Trade Paperback' } },
];

const FLASH_TITLES = ['Move Forward', 'Rogues Revolution', 'Gorilla Warfare', 'Reverse', 'History Lessons', 'Out of Time', 'Savage World', 'Zoom', 'Full Stop'];
const cover = (id) => `https://static.metron.cloud/media/issue/fake/${id}.jpg`;

const ISSUES = [];
FLASH_TITLES.forEach((title, i) => {
  const n = i + 1;
  const first = [1, 9, 13, 20, 26, 30, 36, 41, 48][i];
  const last = [8, 12, 19, 25, 29, 35, 40, 47, 52][i];
  const reprints = [];
  for (let k = first; k <= last; k += 1) reprints.push({ id: 50000 + k, issue: `The Flash (2011) #${k}` });
  if (n === 6) reprints.push({ id: 59003, issue: 'The Flash Annual (2012) #3' });
  ISSUES.push({ id: 10000 + n, seriesId: 1001, number: String(n), title, store_date: `201${2 + Math.floor(i / 2)}-0${(i % 9) + 1}-15`, reprints });
});
ISSUES.push({
  id: 20001, seriesId: 2001, number: '1', title: '', store_date: '2013-01-02',
  reprints: [13, 14, 15, 16, 17, 18].flatMap((k) => [
    { id: 60000 + k, issue: `Ultimate Comics Ultimates (2011) #${k}` },
    { id: 61000 + k, issue: `Ultimate Comics X-Men (2011) #${k}` },
    { id: 62000 + k, issue: `Ultimate Comics Spider-Man (2011) #${k}` },
  ]),
});
for (let k = 1; k <= 52; k += 1) ISSUES.push({ id: 40000 + k, seriesId: 1000, number: String(k), title: '', store_date: '2012-01-01', reprints: [] });
['Volume One', 'Volume Two', 'Volume Three'].forEach((title, i) => {
  ISSUES.push({ id: 30001 + i, seriesId: 3001, number: String(i + 1), title, store_date: `201${3 + i}-10-23`, reprints: [] });
});

export const fake = {
  calls: [],
  /** Voegt een nieuw deel toe aan een nep-serie (voor de "nieuwe delen"-test). */
  addIssue(seriesId, number, title, storeDate) {
    ISSUES.push({ id: 90000 + ISSUES.length, seriesId, number: String(number), title, store_date: storeDate, reprints: [] });
  },
  store,
};

function seriesStr(s) {
  return s.series;
}

function listItem(i) {
  const s = SERIES.find((x) => x.id === i.seriesId);
  return { id: i.id, series: { id: s.id, name: s.name, volume: s.volume, year_began: s.year_began }, number: i.number, issue: `${seriesStr(s)} #${i.number}`, cover_date: i.store_date, store_date: i.store_date, image: cover(i.id), cover_hash: '', modified: '2026-01-01T00:00:00Z' };
}

function detail(i) {
  const s = SERIES.find((x) => x.id === i.seriesId);
  return { ...listItem(i), title: i.title, name: [], series: { id: s.id, name: s.name, volume: s.volume, year_began: s.year_began, series_type: s.series_type }, reprints: i.reprints, desc: '' };
}

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-RateLimit-Burst-Remaining': '19', 'X-RateLimit-Burst-Reset': String(Math.floor(Date.now() / 1000) + 60) },
  });
}

function metron(url, init) {
  fake.calls.push(url.pathname + url.search);
  const auth = new Headers(init?.headers).get('authorization');
  const basic = `Basic ${Buffer.from('lezer:wachtwoord').toString('base64')}`;
  if (auth !== 'Bearer test-token' && auth !== basic) return respond({ detail: 'Invalid token.' }, 401);
  const path = url.pathname.replace(/^\/api\//, '');
  const p = url.searchParams;
  let m;
  if (path === 'series/') {
    const words = (p.get('name') || '').toLowerCase().split(/\s+/).filter(Boolean);
    const typeId = p.get('series_type_id');
    const results = SERIES.filter((s) => words.every((w) => s.series.toLowerCase().includes(w)) && (!typeId || String(s.series_type.id) === typeId));
    return respond({ count: results.length, next: null, previous: null, results });
  }
  if ((m = path.match(/^series\/(\d+)\/$/))) {
    const s = SERIES.find((x) => x.id === Number(m[1]));
    return s ? respond({ ...s, name: s.name, status: 'Completed' }) : respond({ detail: 'Not found.' }, 404);
  }
  if (path === 'issue/') {
    const results = ISSUES.filter((i) => i.seriesId === Number(p.get('series_id'))).map(listItem);
    return respond({ count: results.length, next: null, previous: null, results });
  }
  if ((m = path.match(/^issue\/(\d+)\/$/))) {
    const i = ISSUES.find((x) => x.id === Number(m[1]));
    return i ? respond(detail(i)) : respond({ detail: 'Not found.' }, 404);
  }
  return respond({ detail: 'Not found.' }, 404);
}

async function upstash(init) {
  const [cmd, key, value, ex, ttl] = JSON.parse(init.body);
  if (cmd === 'GET') return respond({ result: store.has(key) ? store.get(key) : null });
  if (cmd === 'SET') {
    store.set(key, value);
    void ex; void ttl;
    return respond({ result: 'OK' });
  }
  return respond({ error: `onbekend commando ${cmd}` }, 400);
}

/** Vervangt globalThis.fetch voor metron.cloud en de nep-Redis; de rest gaat gewoon door. */
export function installFakes() {
  process.env.METRON_TOKEN ||= 'test-token';
  process.env.APP_SECRET ||= 'geheim';
  process.env.CRON_SECRET ||= 'cron-geheim';
  process.env.KV_REST_API_URL ||= 'https://fake-redis.local';
  process.env.KV_REST_API_TOKEN ||= 'redis-token';
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === 'metron.cloud') return metron(url, init);
    if (url.hostname === 'fake-redis.local') return upstash(init);
    return real(input, init);
  };
}
