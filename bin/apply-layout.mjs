#!/usr/bin/env node
// Shell trigger: applies the matching layout to the Orca worktree of the calling terminal.
//   layout            interactive: prints one result line, exits non-zero on error
//   layout --auto     shell-start hook: silent, opt-in via "autoApplyOnShellStart", errors go to auto.log
import { appendFile, mkdir } from 'node:fs/promises';
import nodePath from 'node:path';
import { configFilePath } from '../src/config.mjs';
import { runShellApply } from '../src/shell-apply.mjs';
import { orcaCli } from '../orca-cli.mjs';
import { fs, git } from '../ports.mjs';

const auto = process.argv.slice(2).includes('--auto');
const configFile = configFilePath();

try {
  const result = await runShellApply({
    auto,
    env: process.env,
    now: Date.now,
    configFile,
    fs,
    git,
    orcaCli,
    log: () => {},
  });
  if (!auto) console.log(result.message);
} catch (error) {
  if (auto) {
    try {
      await mkdir(nodePath.dirname(configFile), { recursive: true });
      await appendFile(nodePath.join(nodePath.dirname(configFile), 'auto.log'), `${new Date().toISOString()} ${error.message}\n`);
    } catch {
      // nowhere left to report to
    }
  } else {
    console.error(`repo-layouts: ${error.message}`);
    process.exitCode = 1;
  }
}
