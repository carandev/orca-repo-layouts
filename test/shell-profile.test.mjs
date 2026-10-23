import test from 'node:test';
import assert from 'node:assert/strict';
import { BEGIN, END, removeBlock, renderBlock, upsertBlock } from '../src/shell-profile.mjs';

const SCRIPT = 'C:\\Users\\me\\orca repo\\bin\\apply-layout.mjs';

test('powershell block defines `layout` and a guarded background --auto launch', () => {
  const block = renderBlock({ shell: 'powershell', script: SCRIPT });
  assert.ok(block.startsWith(BEGIN) && block.trimEnd().endsWith(END));
  assert.ok(block.includes(`function layout { node '${SCRIPT}' @args }`));
  assert.ok(block.includes('if ($env:ORCA_WORKTREE_ID) {'));
  assert.ok(
    block.includes(`Start-Process -WindowStyle Hidden -FilePath node -ArgumentList @('"${SCRIPT}"', '--auto')`),
  );
});

test('powershell block doubles single quotes in the script path', () => {
  const block = renderBlock({ shell: 'powershell', script: "C:\\o'k\\a.mjs" });
  assert.ok(block.includes("node 'C:\\o''k\\a.mjs' @args"));
});

test('bash/zsh block defines `layout` and backgrounds --auto only inside Orca', () => {
  const script = '/home/me/orca repo/bin/apply-layout.mjs';
  const block = renderBlock({ shell: 'bash', script });
  assert.ok(block.includes(`layout() { node '${script}' "$@"; }`));
  assert.ok(block.includes(`[ -n "$ORCA_WORKTREE_ID" ] && ( node '${script}' --auto >/dev/null 2>&1 & )`));
  assert.equal(renderBlock({ shell: 'zsh', script: '/a' }), renderBlock({ shell: 'bash', script: '/a' }));
});

test('unknown shell is an error', () => {
  assert.throws(() => renderBlock({ shell: 'fish', script: '/a' }), /unsupported shell/i);
});

test('upsertBlock appends to an existing profile, creates one, and is idempotent', () => {
  const block = renderBlock({ shell: 'powershell', script: SCRIPT });
  const once = upsertBlock('Invoke-Expression x\r\n', block);
  assert.ok(once.startsWith('Invoke-Expression x\r\n'));
  assert.equal(once.split(BEGIN).length, 2);
  assert.equal(upsertBlock(once, block), once);
  assert.equal(upsertBlock(null, block), block);
});

test('upsertBlock replaces a stale block in place and keeps surrounding text', () => {
  const oldBlock = renderBlock({ shell: 'powershell', script: 'C:\\old\\a.mjs' });
  const newBlock = renderBlock({ shell: 'powershell', script: 'C:\\new\\a.mjs' });
  assert.equal(upsertBlock(`before\n${oldBlock}after\n`, newBlock), `before\n${newBlock}after\n`);
});

test('removeBlock strips the block and leaves the rest', () => {
  const block = renderBlock({ shell: 'powershell', script: SCRIPT });
  assert.equal(removeBlock(`before\n${block}after\n`), 'before\nafter\n');
  assert.equal(removeBlock('nothing here\n'), 'nothing here\n');
});
