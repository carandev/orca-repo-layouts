import { homedir } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyForActiveWorktree, applyForWorktree } from './src/apply.mjs';
import { configFilePath } from './src/config.mjs';
import { openConfigEditor } from './src/editor-command.mjs';
import { createEditorServer } from './src/editor-server.mjs';
import { installTargets, listTargets, refreshTargets, uninstallTargets } from './src/shell-install.mjs';
import { orcaCli, waitForFirstTerminal } from './orca-cli.mjs';
import { fs, git, openExternal, psProfile } from './ports.mjs';

const defaultDeps = {
  fs,
  git,
  orcaCli,
  waitForFirstTerminal,
  openExternal,
  psProfile,
  platform: process.platform,
  home: process.env.USERPROFILE ?? process.env.HOME ?? homedir(),
  pathApi: nodePath,
  // The installed copy of the plugin: its location changes across Orca updates, so it is resolved at runtime.
  scriptPath: fileURLToPath(new URL('./bin/apply-layout.mjs', import.meta.url)),
  configFile: configFilePath(),
  createServer: ({ configFile }) =>
    createEditorServer({
      configFile,
      fs,
      html: () => fs.readFile(fileURLToPath(new URL('./src/editor/index.html', import.meta.url))),
    }),
};

export default function activate(orca, overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const log = (message) => orca.log(`repo-layouts: ${message}`);
  const notify = (title, body) => orca.host.call('notifications.show', { title, body: body.slice(0, 1000) });
  const configFile = deps.configFile;

  const shellTargets = () =>
    listTargets({ platform: deps.platform, home: deps.home, fs: deps.fs, psProfile: deps.psProfile, pathApi: deps.pathApi });

  // After a plugin update the installed directory moves; keep an existing shell block pointing at the live copy.
  // Best-effort: errors are only logged, and a block is never added here.
  void (async () => {
    try {
      const updated = await refreshTargets({
        targets: await shellTargets(),
        script: deps.scriptPath,
        fs: deps.fs,
        pathApi: deps.pathApi,
      });
      if (updated.length > 0) log(`updated shell integration path in ${updated.join(', ')}`);
    } catch (error) {
      log(`could not refresh shell integration: ${error.message}`);
    }
  })();

  orca.events.on('worktree.created', async ({ worktreeId, path }) => {
    try {
      await applyForWorktree({
        worktreeId,
        worktreePath: path,
        configFile,
        fs: deps.fs,
        git: deps.git,
        orcaCli: deps.orcaCli,
        waitForFirstTerminal: deps.waitForFirstTerminal,
        log,
      });
    } catch (error) {
      orca.log(`repo-layouts failed for ${path}: ${error.message}`);
      await notify('Repo Layouts failed', error.message);
    }
  });

  const readContext = () => orca.host.call('workspace.readContext');

  // The command carries no worktree args: the active worktree comes from workspace.readContext.
  orca.commands.register('apply-layout', async () => {
    try {
      const result = await applyForActiveWorktree({
        readContext,
        configFile,
        fs: deps.fs,
        git: deps.git,
        orcaCli: deps.orcaCli,
        log,
      });
      if (result.notice) await notify('Repo Layouts', result.notice);
      else if (result.applied) await notify('Repo Layouts', 'Layout applied');
    } catch (error) {
      orca.log(`repo-layouts apply-layout failed: ${error.message}`);
      await notify('Repo Layouts failed', error.message);
    }
  });

  // One server per worker, started on demand; it stops itself after idling.
  let server = null;
  orca.commands.register('edit-config', async () => {
    try {
      server ??= deps.createServer({ configFile });
      await openConfigEditor({
        server,
        readContext,
        orcaCli: deps.orcaCli,
        openExternal: deps.openExternal,
        notify,
        log,
      });
    } catch (error) {
      orca.log(`repo-layouts edit-config failed: ${error.message}`);
      await notify('Repo Layouts failed', error.message);
    }
  });

  const summarize = (results, verb) => {
    const done = results.filter((r) => !r.error && r.removed !== false).map((r) => r.profile);
    const errors = results.filter((r) => r.error).map((r) => `${r.profile}: ${r.error}`);
    const lines = [done.length > 0 ? `${verb}: ${done.join(', ')}` : 'Nothing to change'];
    return [...lines, ...errors].join('\n');
  };

  orca.commands.register('install-shell', async () => {
    try {
      const results = await installTargets({
        targets: await shellTargets(),
        script: deps.scriptPath,
        fs: deps.fs,
        pathApi: deps.pathApi,
      });
      await notify('Repo Layouts', `${summarize(results, 'Shell integration installed in')}\nOpen a new terminal to use \`layout\`.`);
    } catch (error) {
      orca.log(`repo-layouts install-shell failed: ${error.message}`);
      await notify('Repo Layouts failed', error.message);
    }
  });

  orca.commands.register('uninstall-shell', async () => {
    try {
      const results = await uninstallTargets({ targets: await shellTargets(), fs: deps.fs });
      await notify('Repo Layouts', summarize(results, 'Shell integration removed from'));
    } catch (error) {
      orca.log(`repo-layouts uninstall-shell failed: ${error.message}`);
      await notify('Repo Layouts failed', error.message);
    }
  });
}
