import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveOrcaCli } from '../orca-cli.mjs';

const none = () => false;

test('resolveOrcaCli on Windows uses orca.exe and rebuilds APPDATA/LOCALAPPDATA from USERPROFILE', () => {
  const { bin, env } = resolveOrcaCli({
    env: { USERPROFILE: 'C:\\Users\\me', PATH: 'p' },
    platform: 'win32',
    pathApi: path.win32,
    exists: none,
  });
  assert.equal(bin, 'C:\\Users\\me\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe');
  assert.equal(env.APPDATA, 'C:\\Users\\me\\AppData\\Roaming');
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\me\\AppData\\Local');
  assert.equal(env.PATH, 'p');
});

test('resolveOrcaCli on Windows keeps APPDATA/LOCALAPPDATA when present', () => {
  const { bin, env } = resolveOrcaCli({
    env: { USERPROFILE: 'C:\\Users\\me', APPDATA: 'D:\\Roam', LOCALAPPDATA: 'D:\\Local' },
    platform: 'win32',
    pathApi: path.win32,
    exists: none,
  });
  assert.equal(bin, 'D:\\Local\\Programs\\orca\\resources\\bin\\orca.exe');
  assert.equal(env.APPDATA, 'D:\\Roam');
});

test('resolveOrcaCli on Linux prefers the ~/.local/bin/orca-ide symlink', () => {
  const link = '/home/me/.local/bin/orca-ide';
  const { bin, env } = resolveOrcaCli({
    env: { HOME: '/home/me', PATH: '/usr/bin' },
    platform: 'linux',
    pathApi: path.posix,
    exists: (p) => p === link,
  });
  assert.equal(bin, link);
  assert.deepEqual(env, { HOME: '/home/me', PATH: '/usr/bin' });
});

test('resolveOrcaCli on Linux falls back to orca-ide on PATH, never bare orca', () => {
  const { bin } = resolveOrcaCli({ env: { HOME: '/home/me' }, platform: 'linux', pathApi: path.posix, exists: none });
  assert.equal(bin, 'orca-ide');
});

test('resolveOrcaCli on macOS uses orca on PATH', () => {
  const { bin } = resolveOrcaCli({ env: { HOME: '/Users/me' }, platform: 'darwin', pathApi: path.posix, exists: none });
  assert.equal(bin, 'orca');
});
