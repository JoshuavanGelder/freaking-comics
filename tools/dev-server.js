// Lokale server: serveert de app en de /api-functies zoals Vercel dat doet.
// Gebruik: node tools/dev-server.js          (met nep-Metron en nep-opslag)
//          REAL=1 node tools/dev-server.js   (met echte METRON_TOKEN / KV_* uit je omgeving)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (!process.env.REAL) {
  const { installFakes } = await import('./fake-services.js');
  installFakes();
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function api(req, res, pathname) {
  const file = join(root, `${pathname}.js`);
  if (!normalize(file).startsWith(join(root, 'api')) || pathname.includes('/_lib/')) return false;
  try {
    await stat(file);
  } catch {
    return false;
  }
  const mod = await import(pathToFileURL(file).href);
  const handler = mod[req.method];
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = handler ? await handler(request) : new Response('Method not allowed', { status: 405 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/') && (await api(req, res, pathname.replace(/\/$/, '')))) return;
    let file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(root)) throw new Error('nope');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Niet gevonden');
  }
});

const port = Number(process.env.PORT || 5173);
server.listen(port, () => console.log(`Freaking Comics draait op http://localhost:${port}`));
