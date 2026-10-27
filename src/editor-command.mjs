import { resolveActiveWorktree } from './apply.mjs';

/**
 * Edit config command: starts (or reuses) the editor server, opens it in an Orca browser tab of the active
 * worktree (brought to the front), else in the OS browser, and always notifies the url.
 * Ports: server {start() -> {url}}, readContext(), orcaCli(args), openExternal(url), notify(title, body), log(message).
 * Returns { url, opened: 'orca' | 'browser' | 'none' }.
 */
export async function openConfigEditor({ server, readContext, orcaCli, openExternal, notify, log }) {
  const { url } = await server.start();
  let opened = 'none';
  try {
    const active = await resolveActiveWorktree({ readContext, orcaCli });
    if (active) {
      const worktree = `id:${active.worktreeId}`;
      const created = await orcaCli(['tab', 'create', '--worktree', worktree, '--url', url]);
      opened = 'orca';
      // Orca creates the tab in the background; without a switch the user keeps seeing the terminal.
      if (created?.browserPageId) {
        try {
          await orcaCli(['tab', 'switch', '--page', created.browserPageId, '--worktree', worktree, '--focus']);
        } catch (error) {
          log(`could not focus the editor tab: ${error.message}`);
        }
      }
    }
  } catch (error) {
    log(`could not open the editor in Orca: ${error.message}`);
  }
  if (opened === 'none') {
    try {
      await openExternal(url);
      opened = 'browser';
    } catch (error) {
      log(`could not open the OS browser: ${error.message}`);
    }
  }
  await notify('Repo Layouts: config editor', `Open ${url}`);
  return { url, opened };
}
