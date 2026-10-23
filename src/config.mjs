import nodePath from 'node:path';
import { looksAbsolute } from './path.mjs';

const ENTRY_KEYS = new Set(['command', 'cwd', 'split', 'ratio', 'from', 'label', 'agent', 'browser']);
const WILDCARD = '*';
const PROJECT_KEYS = new Set(['layout']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * User config location: <APPDATA>\orca-repo-layouts\config.json on Windows
 * (APPDATA is rebuilt from USERPROFILE because the plugin worker env is scrubbed),
 * else $XDG_CONFIG_HOME or ~/.config.
 */
export function configFilePath({ env = process.env, platform = process.platform, pathApi = nodePath } = {}) {
  const home = env.USERPROFILE ?? env.HOME ?? '';
  if (platform === 'win32') {
    const appData = env.APPDATA ?? pathApi.join(home, 'AppData', 'Roaming');
    return pathApi.join(appData, 'orca-repo-layouts', 'config.json');
  }
  const base = env.XDG_CONFIG_HOME ?? pathApi.join(home, '.config');
  return pathApi.join(base, 'orca-repo-layouts', 'config.json');
}

/** True when a relative `cwd` would climb above its base directory. */
function escapesBase(cwd) {
  let depth = 0;
  for (const seg of cwd.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue;
    depth += seg === '..' ? -1 : 1;
    if (depth < 0) return true;
  }
  return false;
}

/** Validates and normalizes one project's layout. `label` is e.g. `projects["X"].layout`. */
function normalizeLayout(layout, label, file) {
  if (!Array.isArray(layout)) throw new Error(`${label} in ${file} must be an array`);
  const result = [];
  layout.forEach((entry, i) => {
    result.push(normalizeEntry(entry, i, label, file, result));
  });
  return result;
}

/** Validates one layout entry; `done` holds the already-normalized earlier entries. */
function normalizeEntry(entry, i, label, file, done) {
  const at = `${label}[${i}]`;
  const fail = (key, msg) => {
    throw new Error(`${key ? `${at}.${key}` : at} in ${file} ${msg}`);
  };
  if (!isObject(entry)) fail('', 'must be an object');
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) fail(key, 'is not a recognized key');
  }
  if (entry.browser !== undefined) return normalizeBrowser(entry, i, at, file, fail);
  const out = {};
  if (entry.command !== undefined) {
    if (typeof entry.command !== 'string' || !entry.command.trim()) fail('command', 'must be a non-empty string');
    out.command = entry.command;
  }
  if (entry.label !== undefined) {
    if (typeof entry.label !== 'string' || !entry.label.trim()) fail('label', 'must be a non-empty string');
    if (i > 0 && entry.split !== undefined) {
      throw new Error(`${at}.label: only allowed on tab entries (no "split") (in ${file})`);
    }
    out.label = entry.label;
  }
  if (entry.cwd !== undefined) {
    if (typeof entry.cwd !== 'string' || !entry.cwd.trim()) fail('cwd', 'must be a non-empty string');
    const cwd = entry.cwd.trim();
    if (looksAbsolute(cwd)) fail('cwd', 'must be relative to the worktree');
    if (escapesBase(cwd)) fail('cwd', 'must stay inside the worktree');
    out.cwd = cwd;
  }
  if (entry.agent !== undefined) {
    if (i > 0) fail('agent', 'is only allowed on the first entry');
    if (typeof entry.agent !== 'string' || !entry.agent.trim()) fail('agent', 'must be a non-empty string');
    out.agent = entry.agent.trim();
  }
  if (i === 0) {
    for (const key of ['split', 'ratio', 'from']) {
      if (entry[key] !== undefined) fail(key, 'is not allowed on the first entry (the first terminal)');
    }
    return out;
  }
  if (entry.split === undefined) {
    // No split: the entry opens a new tab, so pane-relative options make no sense.
    for (const key of ['ratio', 'from']) {
      if (entry[key] !== undefined) throw new Error(`${at}.${key}: requires "split" (in ${file})`);
    }
    return out;
  }
  if (entry.split !== 'right' && entry.split !== 'down') fail('split', 'must be "right" or "down"');
  out.split = entry.split;
  if (entry.ratio !== undefined) {
    if (typeof entry.ratio !== 'number' || !(entry.ratio > 0 && entry.ratio < 1)) {
      fail('ratio', 'must be a number greater than 0 and less than 1');
    }
    out.ratio = entry.ratio;
  }
  if (entry.from !== undefined && (!Number.isInteger(entry.from) || entry.from < 0 || entry.from >= i)) {
    fail('from', 'must be the integer index of an earlier entry');
  }
  out.from = entry.from ?? i - 1;
  if (done[out.from].browser !== undefined) {
    fail('from', `must not reference browser entry ${out.from}: a browser tab has no pane to split`);
  }
  return out;
}

/** A browser entry is always its own tab: `true` (blank) or an http(s) URL, and nothing else. */
function normalizeBrowser(entry, i, at, file, fail) {
  if (i === 0) fail('browser', 'is not allowed on the first entry (the first terminal)');
  for (const key of Object.keys(entry)) {
    if (key !== 'browser') fail(key, 'is not allowed on a browser entry');
  }
  if (entry.browser === true) return { browser: true };
  let url = null;
  if (typeof entry.browser === 'string') {
    try {
      const parsed = new URL(entry.browser.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = entry.browser.trim();
    } catch {
      // not a URL
    }
  }
  if (url === null) fail('browser', 'must be true or an http/https URL');
  return { browser: url };
}

const isWin = (pathApi) => pathApi.sep === '\\';

/**
 * Finds the project config for `repoRoot`: absolute-path key, then basename key, then `"*"`.
 * The selected entry is used whole; entries are never merged. `"*"` is not a path or a name.
 */
export function matchProject(projects, repoRoot, pathApi = nodePath) {
  const fold = (s) => (isWin(pathApi) ? s.toLowerCase().replaceAll('/', '\\') : s);
  const root = fold(pathApi.resolve(repoRoot));
  const keys = Object.keys(projects).filter((k) => k !== WILDCARD);
  const byPath = keys.find((k) => pathApi.isAbsolute(k) && fold(pathApi.resolve(k)) === root);
  if (byPath !== undefined) return { key: byPath, entry: projects[byPath] };
  const name = fold(pathApi.basename(root));
  const byName = keys.find((k) => !pathApi.isAbsolute(k) && fold(k) === name);
  if (byName !== undefined) return { key: byName, entry: projects[byName] };
  return projects[WILDCARD] ? { key: WILDCARD, entry: projects[WILDCARD] } : undefined;
}

function readProjects(data, file) {
  const projects = {};
  if (data.projects === undefined) return projects;
  if (!isObject(data.projects)) throw new Error(`"projects" in ${file} must be an object`);
  for (const [name, proj] of Object.entries(data.projects)) {
    const at = `projects["${name}"]`;
    if (!isObject(proj)) throw new Error(`${at} in ${file} must be an object`);
    for (const key of Object.keys(proj)) {
      if (key === 'directory') {
        throw new Error(`${at}.directory in ${file} is not supported: Orca decides where worktrees are created`);
      }
      if (!PROJECT_KEYS.has(key)) throw new Error(`${at}.${key} in ${file} is not a recognized key`);
    }
    projects[name] = {
      layout: proj.layout === undefined ? [] : normalizeLayout(proj.layout, `${at}.layout`, file),
    };
  }
  return projects;
}

/**
 * Reads and validates the user config. `fs.readFile(path)` must return the file text,
 * or null when the file does not exist (then this returns null). Unknown top-level keys are ignored.
 */
export async function loadConfig({ configFile, fs }) {
  const text = await fs.readFile(configFile);
  if (text == null) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${configFile}: ${e.message}`);
  }
  if (!isObject(data)) throw new Error(`${configFile} must contain a JSON object`);
  if (data.autoApplyOnShellStart !== undefined && typeof data.autoApplyOnShellStart !== 'boolean') {
    throw new Error(`"autoApplyOnShellStart" in ${configFile} must be a boolean`);
  }
  return {
    projects: readProjects(data, configFile),
    autoApplyOnShellStart: data.autoApplyOnShellStart === true,
    source: configFile,
  };
}
