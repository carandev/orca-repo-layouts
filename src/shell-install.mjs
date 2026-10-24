import nodePath from 'node:path';
import { getBlock, removeBlock, renderBlock, upsertBlock } from './shell-profile.mjs';

export const BACKUP_SUFFIX = '.bak-orca-repo-layouts';

/**
 * Profiles to manage: [{ shell, profile }].
 * Windows: the Windows PowerShell 5.1 profile plus PowerShell 7's when `pwsh` answers (`psProfile(exe)` -> path | null).
 * Linux/macOS: ~/.bashrc and ~/.zshrc that exist; when neither does, create ~/.zshrc on macOS, ~/.bashrc elsewhere.
 * Ports: fs {readFile -> text|null}.
 */
export async function listTargets({ platform = process.platform, home, fs, psProfile, pathApi = nodePath }) {
  if (platform === 'win32') {
    const targets = [];
    for (const [shell, exe] of [['powershell', 'powershell'], ['pwsh', 'pwsh']]) {
      const profile = await psProfile(exe);
      if (profile) targets.push({ shell, profile });
    }
    return targets;
  }
  const candidates = [
    { shell: 'bash', profile: pathApi.join(home, '.bashrc') },
    { shell: 'zsh', profile: pathApi.join(home, '.zshrc') },
  ];
  const existing = [];
  for (const c of candidates) if ((await fs.readFile(c.profile)) != null) existing.push(c);
  if (existing.length > 0) return existing;
  return [platform === 'darwin' ? candidates[1] : candidates[0]];
}

/**
 * Upserts the block into one profile. The backup keeps the pre-installer original: a re-run never overwrites it.
 * Ports: fs {readFile, mkdir, writeFile, copyFileExclusive(from, to) (throws EEXIST when `to` exists)}.
 */
export async function installProfile({ fs, profile, shell, script, pathApi = nodePath }) {
  const block = renderBlock({ shell, script });
  const existing = await fs.readFile(profile);
  await fs.mkdir(pathApi.dirname(profile));
  let backup;
  if (existing != null) {
    backup = `${profile}${BACKUP_SUFFIX}`;
    await fs.copyFileExclusive(profile, backup).catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
  }
  // A BOM keeps Windows PowerShell 5.1 from reading a new profile as ANSI.
  await fs.writeFile(profile, upsertBlock(existing ?? null, existing == null ? `\uFEFF${block}` : block));
  return { profile, shell, backup };
}

/** Installs into every target; a failing target is reported as { profile, error } instead of throwing. */
export async function installTargets({ targets, script, fs, pathApi }) {
  const results = [];
  for (const { shell, profile } of targets) {
    try {
      results.push(await installProfile({ fs, profile, shell, script, pathApi }));
    } catch (e) {
      results.push({ profile, shell, error: e.message });
    }
  }
  return results;
}

/** Removes the block from every target that has one: [{ profile, removed }]. */
export async function uninstallTargets({ targets, fs }) {
  const results = [];
  for (const { profile } of targets) {
    try {
      const text = await fs.readFile(profile);
      if (text == null || getBlock(text) == null) {
        results.push({ profile, removed: false });
        continue;
      }
      await fs.writeFile(profile, removeBlock(text));
      results.push({ profile, removed: true });
    } catch (e) {
      results.push({ profile, removed: false, error: e.message });
    }
  }
  return results;
}

/**
 * Rewrites an existing block that points at another script path (e.g. after a plugin update moved the directory).
 * Never adds a block. Returns the profiles it rewrote.
 */
export async function refreshTargets({ targets, script, fs, pathApi }) {
  const updated = [];
  for (const { shell, profile } of targets) {
    const current = getBlock(await fs.readFile(profile));
    if (current == null || current === renderBlock({ shell, script })) continue;
    await installProfile({ fs, profile, shell, script, pathApi });
    updated.push(profile);
  }
  return updated;
}
