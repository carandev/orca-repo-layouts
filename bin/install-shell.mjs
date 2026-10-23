#!/usr/bin/env node
// Installs (or replaces) the orca-repo-layouts block in a shell profile.
//   node bin/install-shell.mjs                       PowerShell 5.1 profile (Windows)
//   node bin/install-shell.mjs --shell pwsh          PowerShell 7 profile
//   node bin/install-shell.mjs --shell bash|zsh      prints the snippet to paste into ~/.bashrc / ~/.zshrc
//   node bin/install-shell.mjs --print               print the block, change nothing
//   node bin/install-shell.mjs --uninstall           remove the block
//   --profile <path> overrides the profile location
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeBlock, renderBlock, upsertBlock } from '../src/shell-profile.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const shell = option('--shell') ?? (process.platform === 'win32' ? 'powershell' : 'bash');
const script = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), 'apply-layout.mjs');
const block = renderBlock({ shell, script });

if (flag('--print') || shell === 'bash' || shell === 'zsh') {
  if (!flag('--print')) console.log(`Add this to ~/.${shell}rc:\n`);
  process.stdout.write(block);
  process.exit(0);
}

const exe = shell === 'pwsh' ? 'pwsh' : 'powershell';
const profile =
  option('--profile') ??
  execFileSync(exe, ['-NoProfile', '-Command', '$PROFILE.CurrentUserCurrentHost'], { encoding: 'utf8' }).trim();

let existing = null;
try {
  existing = await readFile(profile, 'utf8');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

if (flag('--uninstall')) {
  if (existing == null) {
    console.log(`No profile at ${profile}; nothing to remove`);
  } else {
    await writeFile(profile, removeBlock(existing));
    console.log(`Removed the orca-repo-layouts block from ${profile}`);
  }
  process.exit(0);
}

await mkdir(nodePath.dirname(profile), { recursive: true });
// The backup keeps the pre-installer original: a re-run never overwrites it.
if (existing != null) {
  await copyFile(profile, `${profile}.bak-orca-repo-layouts`, constants.COPYFILE_EXCL).catch((e) => {
    if (e.code !== 'EEXIST') throw e;
  });
}
// A BOM keeps Windows PowerShell 5.1 from reading a new profile as ANSI.
await writeFile(profile, upsertBlock(existing ?? null, existing == null ? `\uFEFF${block}` : block));
console.log(`Installed the orca-repo-layouts block in ${profile}`);
if (existing != null) console.log(`Backup: ${profile}.bak-orca-repo-layouts`);
