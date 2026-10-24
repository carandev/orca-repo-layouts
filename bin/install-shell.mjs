#!/usr/bin/env node
// Installs (or replaces) the orca-repo-layouts block in a shell profile.
//   node bin/install-shell.mjs                       PowerShell 5.1 profile (Windows)
//   node bin/install-shell.mjs --shell pwsh          PowerShell 7 profile
//   node bin/install-shell.mjs --shell bash|zsh      prints the snippet to paste into ~/.bashrc / ~/.zshrc
//   node bin/install-shell.mjs --print               print the block, change nothing
//   node bin/install-shell.mjs --uninstall           remove the block
//   --profile <path> overrides the profile location
import { execFileSync } from 'node:child_process';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { installProfile, uninstallTargets } from '../src/shell-install.mjs';
import { renderBlock } from '../src/shell-profile.mjs';
import { fs } from '../ports.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const shell = option('--shell') ?? (process.platform === 'win32' ? 'powershell' : 'bash');
const script = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), 'apply-layout.mjs');
const block = renderBlock({ shell, script });

if (flag('--print') || shell === 'bash' || shell === 'zsh') {
  if (!flag('--print')) console.log(`Add this to ~/.${shell}rc (or run the "Repo Layouts: Install shell integration" command in Orca):
`);
  process.stdout.write(block);
  process.exit(0);
}

const exe = shell === 'pwsh' ? 'pwsh' : 'powershell';
const profile =
  option('--profile') ??
  execFileSync(exe, ['-NoProfile', '-Command', '$PROFILE.CurrentUserCurrentHost'], { encoding: 'utf8' }).trim();

if (flag('--uninstall')) {
  const [result] = await uninstallTargets({ targets: [{ shell, profile }], fs });
  if (result.error) throw new Error(result.error);
  console.log(
    result.removed
      ? `Removed the orca-repo-layouts block from ${profile}`
      : `No orca-repo-layouts block in ${profile}; nothing to remove`,
  );
  process.exit(0);
}

const { backup } = await installProfile({ fs, profile, shell, script });
console.log(`Installed the orca-repo-layouts block in ${profile}`);
if (backup) console.log(`Backup: ${backup}`);
