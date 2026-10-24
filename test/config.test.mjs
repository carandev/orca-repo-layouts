import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { configFilePath, loadConfig, matchProject, validateConfig } from '../src/config.mjs';

const FILE = '/cfg/config.json';
const fsOf = (files) => ({ readFile: async (p) => (p in files ? files[p] : null) });
const load = (obj) => loadConfig({ configFile: FILE, fs: fsOf({ [FILE]: JSON.stringify(obj) }) });
const layoutOf = (layout) => load({ projects: { X: { layout } } });

test('configFilePath on Windows derives APPDATA from USERPROFILE', () => {
  const p = configFilePath({ env: { USERPROFILE: 'C:\\Users\\me' }, platform: 'win32', pathApi: path.win32 });
  assert.equal(p, 'C:\\Users\\me\\AppData\\Roaming\\orca-repo-layouts\\config.json');
  const q = configFilePath({ env: { APPDATA: 'D:\\Roam' }, platform: 'win32', pathApi: path.win32 });
  assert.equal(q, 'D:\\Roam\\orca-repo-layouts\\config.json');
});

test('configFilePath elsewhere uses XDG_CONFIG_HOME or ~/.config', () => {
  assert.equal(
    configFilePath({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', pathApi: path.posix }),
    '/x/orca-repo-layouts/config.json',
  );
  assert.equal(
    configFilePath({ env: { HOME: '/home/me' }, platform: 'linux', pathApi: path.posix }),
    '/home/me/.config/orca-repo-layouts/config.json',
  );
});

test('missing file returns null', async () => {
  assert.equal(await loadConfig({ configFile: FILE, fs: fsOf({}) }), null);
});

test('invalid JSON names the file', async () => {
  await assert.rejects(
    loadConfig({ configFile: FILE, fs: fsOf({ [FILE]: '{oops' }) }),
    (e) => e.message.includes(FILE) && /invalid json/i.test(e.message),
  );
});

test('top-level must be an object; unknown top-level keys are ignored', async () => {
  await assert.rejects(loadConfig({ configFile: FILE, fs: fsOf({ [FILE]: '[]' }) }), /JSON object/);
  const c = await load({ extra: 1, projects: {} });
  assert.deepEqual(c.projects, {});
});

test('directory is rejected with an explanation', async () => {
  await assert.rejects(load({ projects: { X: { directory: 'd' } } }), /directory.*not supported.*Orca/);
});

test('unknown project key is an error', async () => {
  await assert.rejects(load({ projects: { X: { nope: 1 } } }), /projects\["X"\]\.nope/);
});

test('layout defaults to [] and normalizes entries', async () => {
  assert.deepEqual((await load({ projects: { X: {} } })).projects.X.layout, []);
  const c = await layoutOf([
    { label: 'a', command: 'claude' },
    { split: 'down', cwd: ' sub ' },
    { split: 'right', from: 0, ratio: 0.3 },
    { label: 't' },
  ]);
  assert.deepEqual(c.projects.X.layout, [
    { label: 'a', command: 'claude' },
    { split: 'down', cwd: 'sub', from: 0 },
    { split: 'right', ratio: 0.3, from: 0 },
    { label: 't' },
  ]);
});

test('layout validation errors', async () => {
  await assert.rejects(layoutOf('x'), /must be an array/);
  await assert.rejects(layoutOf([1]), /must be an object/);
  await assert.rejects(layoutOf([{ bogus: 1 }]), /bogus.*not a recognized key/);
  await assert.rejects(layoutOf([{ command: '' }]), /command.*non-empty/);
  await assert.rejects(layoutOf([{ cwd: '/abs' }]), /relative/);
  await assert.rejects(layoutOf([{ cwd: 'C:\\abs' }]), /relative/);
  await assert.rejects(layoutOf([{ cwd: '../up' }]), /inside the worktree/);
  await assert.rejects(layoutOf([{ split: 'right' }]), /first entry/);
  await assert.rejects(layoutOf([{}, { split: 'left' }]), /"right" or "down"/);
  await assert.rejects(layoutOf([{}, { split: 'right', label: 'x' }]), /label.*tab entries/);
  await assert.rejects(layoutOf([{}, { ratio: 0.5 }]), /ratio.*requires "split"/);
  await assert.rejects(layoutOf([{}, { from: 0 }]), /from.*requires "split"/);
  await assert.rejects(layoutOf([{}, { split: 'right', ratio: 1 }]), /ratio/);
  await assert.rejects(layoutOf([{}, { split: 'right', from: 1 }]), /earlier entry/);
});

// --- project matching ---
const L = (n) => ({ layout: [{ command: n }] });

test('absolute path key beats folder name beats "*"', () => {
  const projects = { '*': L('star'), crm: L('name'), '/work/crm': L('abs') };
  assert.equal(matchProject(projects, '/work/crm', path.posix).key, '/work/crm');
  assert.equal(matchProject(projects, '/other/crm', path.posix).key, 'crm');
  assert.equal(matchProject(projects, '/other/zzz', path.posix).key, '*');
  assert.equal(matchProject({ crm: L('n') }, '/other/zzz', path.posix), undefined);
});

test('windows matching is case and slash insensitive', () => {
  const projects = { 'C:/Dev/Univer.CRM': L('abs'), 'laboratto.sgl': L('name') };
  assert.equal(matchProject(projects, 'c:\\dev\\univer.crm', path.win32).key, 'C:/Dev/Univer.CRM');
  assert.equal(matchProject(projects, 'D:\\x\\Laboratto.SGL', path.win32).key, 'laboratto.sgl');
});

test('posix matching is case sensitive', () => {
  assert.equal(matchProject({ Crm: L('n') }, '/w/crm', path.posix), undefined);
});

test('selected entry is used whole and an empty layout opts out', async () => {
  const c = await load({ projects: { '*': L('star'), X: { layout: [] } } });
  const m = matchProject(c.projects, '/w/X', path.posix);
  assert.deepEqual(m.entry.layout, []);
});

test('browser entries: true or an http(s) URL, normalized as { browser }', async () => {
  const config = await layoutOf([{}, { browser: true }, { browser: ' https://localhost:5001/x ' }, { browser: 'http://a.test' }]);
  assert.deepEqual(config.projects.X.layout, [{}, { browser: true }, { browser: 'https://localhost:5001/x' }, { browser: 'http://a.test' }]);
});

test('browser entries are rejected on entry 0, with bad values, and with any other key', async () => {
  await assert.rejects(layoutOf([{ browser: true }]), /layout\[0\]\.browser.*first entry/);
  for (const bad of [false, 3, '', 'localhost:5001', 'ftp://x.test', 'javascript:alert(1)', 'not a url']) {
    await assert.rejects(layoutOf([{}, { browser: bad }]), /layout\[1\]\.browser/, String(bad));
  }
  for (const extra of [{ split: 'right' }, { from: 0 }, { ratio: 0.3 }, { label: 'x' }, { cwd: 'a' }, { command: 'x' }, { agent: 'claude' }]) {
    const [key] = Object.keys(extra);
    await assert.rejects(layoutOf([{}, { browser: true, ...extra }]), (e) => e.message.includes(`layout[1].${key} `), key);
  }
});

test('split entries cannot reference a browser entry, explicitly or by default', async () => {
  await assert.rejects(layoutOf([{}, { browser: true }, { split: 'right', from: 1 }]), /layout\[2\]\.from.*browser/);
  await assert.rejects(layoutOf([{}, { browser: true }, { split: 'right' }]), /layout\[2\]\.from.*browser/);
  const ok = await layoutOf([{}, { browser: true }, { split: 'right', from: 0 }]);
  assert.equal(ok.projects.X.layout[2].from, 0);
});

test('autoApplyOnShellStart: optional boolean, default false', async () => {
  assert.equal((await load({})).autoApplyOnShellStart, false);
  assert.equal((await load({ autoApplyOnShellStart: true })).autoApplyOnShellStart, true);
  assert.equal((await load({ autoApplyOnShellStart: false })).autoApplyOnShellStart, false);
  await assert.rejects(load({ autoApplyOnShellStart: 'yes' }), /autoApplyOnShellStart.*boolean/);
});

test('validateConfig validates a parsed object with the same messages as loadConfig', () => {
  const ok = validateConfig({ autoApplyOnShellStart: true, projects: { X: { layout: [{ label: 'a' }] } } }, FILE);
  assert.equal(ok.autoApplyOnShellStart, true);
  assert.equal(ok.source, FILE);
  assert.deepEqual(ok.projects.X.layout, [{ label: 'a' }]);
  assert.throws(() => validateConfig([], FILE), /must contain a JSON object/);
  assert.throws(() => validateConfig({ autoApplyOnShellStart: 1 }, FILE), /autoApplyOnShellStart/);
  assert.throws(() => validateConfig({ projects: { X: { directory: 'd' } } }, FILE), /directory.*not supported/);
});
