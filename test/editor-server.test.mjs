import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEditorServer } from '../src/editor-server.mjs';

const FILE = '/cfg/orca-repo-layouts/config.json';
const TOKEN = 'a'.repeat(48);

function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const writes = [];
  return {
    files,
    writes,
    readFile: async (p) => (files.has(p) ? files.get(p) : null),
    mkdir: async () => {},
    writeFile: async (p, text) => {
      writes.push(p);
      files.set(p, text);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    remove: async (p) => {
      files.delete(p);
    },
  };
}

const servers = [];
async function start(opts = {}) {
  const fs = opts.fs ?? memFs();
  const server = createEditorServer({ configFile: FILE, fs, html: '<h1>editor</h1>', token: TOKEN, ...opts });
  servers.push(server);
  const info = await server.start();
  return { server, fs, ...info };
}
test.afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const json = (r) => JSON.parse(r.text);
const get = (port, headers = { 'X-Token': TOKEN }) => request(port, { path: '/api/config', headers });
const post = (port, body, headers = {}) =>
  request(port, {
    method: 'POST',
    path: '/api/config',
    headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('start returns a loopback url with the token and is reused when running', async () => {
  const { server, url, port } = await start();
  assert.equal(url, `http://127.0.0.1:${port}/?token=${TOKEN}`);
  assert.equal((await server.start()).port, port);
});

test('GET / requires the token and serves the page with a locked-down CSP', async () => {
  const { port } = await start();
  assert.equal((await request(port, { path: '/' })).status, 403);
  assert.equal((await request(port, { path: '/?token=nope' })).status, 403);
  const ok = await request(port, { path: `/?token=${TOKEN}` });
  assert.equal(ok.status, 200);
  assert.equal(ok.text, '<h1>editor</h1>');
  assert.match(ok.headers['content-type'], /text\/html/);
  assert.match(ok.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(ok.headers['access-control-allow-origin'], undefined);
});

test('a Host header that is not loopback:port is rejected (DNS rebinding)', async () => {
  const { port } = await start();
  const bad = await request(port, { path: `/?token=${TOKEN}`, headers: { Host: `evil.example:${port}` } });
  assert.equal(bad.status, 403);
  const wrongPort = await request(port, { path: `/?token=${TOKEN}`, headers: { Host: '127.0.0.1:1' } });
  assert.equal(wrongPort.status, 403);
  const localhost = await request(port, { path: `/?token=${TOKEN}`, headers: { Host: `localhost:${port}` } });
  assert.equal(localhost.status, 200);
});

test('GET /api/config requires the X-Token header', async () => {
  const { port } = await start();
  assert.equal((await get(port, {})).status, 403);
  assert.equal((await request(port, { path: `/api/config?token=${TOKEN}` })).status, 403);
  assert.equal((await get(port, { 'X-Token': 'x' })).status, 403);
});

test('GET /api/config reports a missing file', async () => {
  const { port } = await start();
  assert.deepEqual(json(await get(port)), { exists: false, path: FILE, data: null, error: null });
});

test('GET /api/config returns parsed data and a validation error for a bad config', async () => {
  const good = { projects: { X: { layout: [{ label: 'a' }] } } };
  let s = await start({ fs: memFs({ [FILE]: JSON.stringify(good) }) });
  assert.deepEqual(json(await get(s.port)), { exists: true, path: FILE, data: good, error: null });

  const bad = { projects: { X: { directory: 'd' } } };
  s = await start({ fs: memFs({ [FILE]: JSON.stringify(bad) }) });
  const r = json(await get(s.port));
  assert.deepEqual(r.data, bad);
  assert.match(r.error, /directory/);
});

test('GET /api/config for unparseable JSON returns data null and the parse error', async () => {
  const { port } = await start({ fs: memFs({ [FILE]: '{oops' }) });
  const r = json(await get(port));
  assert.equal(r.exists, true);
  assert.equal(r.data, null);
  assert.match(r.error, /invalid json/i);
});

test('POST valid config writes it atomically (tmp file then rename) with 2 spaces and a newline', async () => {
  const fs = memFs();
  const { port } = await start({ fs });
  const cfg = { autoApplyOnShellStart: true, projects: { '*': { layout: [{ label: 'claude' }] } } };
  const r = await post(port, cfg);
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), { ok: true });
  assert.equal(fs.files.get(FILE), `${JSON.stringify(cfg, null, 2)}\n`);
  assert.equal(fs.writes.length, 1);
  assert.notEqual(fs.writes[0], FILE);
  assert.ok(fs.writes[0].startsWith(FILE));
  assert.equal(fs.files.size, 1);
});

test('POST invalid config returns 400 with the validation message and does not write', async () => {
  const fs = memFs();
  const { port } = await start({ fs });
  const r = await post(port, { projects: { X: { layout: [{ split: 'right' }] } } });
  assert.equal(r.status, 400);
  const body = json(r);
  assert.equal(body.ok, false);
  assert.match(body.error, /layout\[0\]/);
  assert.equal(fs.writes.length, 0);
  assert.equal((await post(port, '{not json')).status, 400);
  assert.equal(fs.writes.length, 0);
});

test('POST needs the token, a JSON content type and a same-origin Origin', async () => {
  const fs = memFs();
  const { port } = await start({ fs });
  const cfg = { projects: {} };
  assert.equal((await post(port, cfg, { 'X-Token': 'nope' })).status, 403);
  assert.equal((await post(port, cfg, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(port, cfg, { Origin: 'http://evil.example' })).status, 403);
  assert.equal(fs.writes.length, 0);
  assert.equal((await post(port, cfg, { Origin: `http://127.0.0.1:${port}` })).status, 200);
  assert.equal(fs.writes.length, 1);
});

test('POST over the body limit is rejected and nothing is written', async () => {
  const fs = memFs();
  const { port } = await start({ fs, maxBodyBytes: 64 });
  const r = await post(port, JSON.stringify({ projects: {}, pad: 'x'.repeat(500) })).catch(() => ({ status: 'reset' }));
  assert.ok(r.status === 413 || r.status === 'reset');
  assert.equal(fs.writes.length, 0);
});

test('unknown routes are 404 and other methods 405', async () => {
  const { port } = await start();
  assert.equal((await request(port, { path: '/nope', headers: { 'X-Token': TOKEN } })).status, 404);
  assert.equal((await request(port, { method: 'DELETE', path: '/api/config', headers: { 'X-Token': TOKEN } })).status, 405);
});

test('a failed write cleans up the temp file and returns 500', async () => {
  const fs = memFs();
  fs.rename = async () => {
    throw new Error('disk full');
  };
  const { port } = await start({ fs });
  const r = await post(port, { projects: {} });
  assert.equal(r.status, 500);
  assert.match(json(r).error, /disk full/);
  assert.equal(fs.files.size, 0);
});

test('shuts down after the idle timeout and can be started again', async () => {
  const { server, port } = await start({ idleMs: 60 });
  assert.equal(server.isRunning(), true);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(server.isRunning(), false);
  await assert.rejects(request(port, { path: '/' }));
  const again = await server.start();
  assert.equal(server.isRunning(), true);
  assert.match(again.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
});

test('activity resets the idle timer', async () => {
  const { server, port } = await start({ idleMs: 200 });
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 90));
    await request(port, { path: `/?token=${TOKEN}` });
  }
  assert.equal(server.isRunning(), true);
});

test('default token is random per server', async () => {
  const a = createEditorServer({ configFile: FILE, fs: memFs(), html: '' });
  const b = createEditorServer({ configFile: FILE, fs: memFs(), html: '' });
  servers.push(a, b);
  const [x, y] = [await a.start(), await b.start()];
  assert.notEqual(x.token, y.token);
  assert.ok(x.token.length >= 32);
});
