import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import nodePath from 'node:path';
import { validateConfig } from './config.mjs';

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function tokenMatches(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Localhost-only config editor server. Never writes anywhere but `configFile`.
 * Ports: fs {readFile -> text|null, mkdir(dir), writeFile(path, text), rename(from, to), remove(path)}.
 * `html` is the page body (a string, or a function returning it, possibly async). `token` defaults to a fresh random value. Shuts itself down after `idleMs` of no requests.
 * Returns { start() -> { url, port, token } (reuses a running server), stop(), isRunning() }.
 */
export function createEditorServer({
  configFile,
  fs,
  html,
  token = randomBytes(24).toString('hex'),
  idleMs = 15 * 60_000,
  maxBodyBytes = 256 * 1024,
  pathApi = nodePath,
}) {
  let server = null;
  let port = 0;
  let idleTimer = null;
  let starting = null;

  const urlOf = () => `http://127.0.0.1:${port}/?token=${token}`;

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void stop(), idleMs);
    idleTimer.unref();
  }

  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
  const fail = (res, status, error) => send(res, status, { ok: false, error });

  async function readConfig() {
    const text = await fs.readFile(configFile);
    if (text == null) return { exists: false, path: configFile, data: null, error: null };
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { exists: true, path: configFile, data: null, error: `Invalid JSON in ${configFile}: ${e.message}` };
    }
    try {
      validateConfig(data, configFile);
      return { exists: true, path: configFile, data, error: null };
    } catch (e) {
      return { exists: true, path: configFile, data, error: e.message };
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBodyBytes) {
          reject(Object.assign(new Error('Request body too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  // Temp file in the same directory, then rename: a crash never leaves a half-written config.
  async function writeConfig(text) {
    await fs.mkdir(pathApi.dirname(configFile));
    const tmp = `${configFile}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, configFile);
    } catch (e) {
      await Promise.resolve(fs.remove(tmp)).catch(() => {});
      throw e;
    }
  }

  async function handle(req, res) {
    touch();
    const origins = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!origins.includes(req.headers.host)) return fail(res, 403, 'Bad Host header');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/') {
      if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
      if (!tokenMatches(url.searchParams.get('token'), token)) return fail(res, 403, 'Invalid token');
      const page = typeof html === 'function' ? await html() : html;
      if (page == null) return fail(res, 500, 'Editor page is missing');
      return send(res, 200, page, 'text/html; charset=utf-8', { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' });
    }
    if (url.pathname !== '/api/config') return fail(res, 404, 'Not found');
    if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Method not allowed');
    if (!tokenMatches(req.headers['x-token'], token)) return fail(res, 403, 'Invalid token');
    if (req.method === 'GET') return send(res, 200, await readConfig());

    const origin = req.headers.origin;
    if (origin !== undefined && !origins.some((o) => origin === `http://${o}`)) return fail(res, 403, 'Bad Origin');
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return fail(res, 415, 'Content-Type must be application/json');
    }
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch (e) {
      if (e.status) return fail(res, e.status, e.message);
      return fail(res, 400, `Invalid JSON: ${e.message}`);
    }
    try {
      validateConfig(data, configFile);
    } catch (e) {
      return fail(res, 400, e.message);
    }
    try {
      await writeConfig(`${JSON.stringify(data, null, 2)}\n`);
    } catch (e) {
      return fail(res, 500, `Could not write ${configFile}: ${e.message}`);
    }
    return send(res, 200, { ok: true });
  }

  async function start() {
    if (server) return { url: urlOf(), port, token };
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        handle(req, res).catch((e) => {
          if (!res.headersSent) fail(res, 500, e.message);
          else res.end();
        });
      });
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        s.removeListener('error', reject);
        server = s;
        port = s.address().port;
        touch();
        resolve({ url: urlOf(), port, token });
      });
    }).finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stop() {
    clearTimeout(idleTimer);
    const s = server;
    server = null;
    if (!s) return;
    await new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections();
    });
  }

  return { start, stop, isRunning: () => server !== null };
}
