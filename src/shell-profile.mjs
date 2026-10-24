export const BEGIN = '# >>> orca-repo-layouts >>>';
export const END = '# <<< orca-repo-layouts <<<';

const psQuote = (s) => `'${s.replaceAll("'", "''")}'`;
const shQuote = (s) => `'${s.replaceAll("'", `'\''`)}'`;

/** The delimited profile block for `shell` (powershell | pwsh | bash | zsh); ends with a newline. */
export function renderBlock({ shell, script }) {
  let body;
  if (shell === 'powershell' || shell === 'pwsh') {
    body = [
      '# Managed by orca-repo-layouts (bin/install-shell.mjs); re-running the installer replaces this block.',
      `function layout { node ${psQuote(script)} @args }`,
      'if ($env:ORCA_WORKTREE_ID) {',
      `  Start-Process -WindowStyle Hidden -FilePath node -ArgumentList @(${psQuote(`"${script}"`)}, '--auto')`,
      '}',
    ];
  } else if (shell === 'bash' || shell === 'zsh') {
    body = [
      '# Managed by orca-repo-layouts (bin/install-shell.mjs); re-running the installer replaces this block.',
      `layout() { node ${shQuote(script)} "$@"; }`,
      `[ -n "$ORCA_WORKTREE_ID" ] && ( node ${shQuote(script)} --auto >/dev/null 2>&1 & )`,
    ];
  } else {
    throw new Error(`Unsupported shell: ${shell} (use powershell, pwsh, bash or zsh)`);
  }
  return [BEGIN, ...body, END, ''].join('\n');
}

function findBlock(text) {
  const start = text.indexOf(BEGIN);
  if (start === -1) return null;
  const endAt = text.indexOf(END, start);
  if (endAt === -1) return null;
  let end = endAt + END.length;
  if (text.startsWith('\r\n', end)) end += 2;
  else if (text[end] === '\n') end += 1;
  return { start, end };
}

/** Replaces the existing block in place, or appends `block` (creating the text when `text` is null). */
export function upsertBlock(text, block) {
  if (text == null || text === '') return block;
  const found = findBlock(text);
  if (found) return text.slice(0, found.start) + block + text.slice(found.end);
  const sep = text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}\n${block}`;
}

/** Removes the block when present. */
export function removeBlock(text) {
  const found = findBlock(text);
  return found ? text.slice(0, found.start) + text.slice(found.end) : text;
}

/** The existing block text (delimiters included), or null. */
export function getBlock(text) {
  const found = text == null ? null : findBlock(text);
  return found ? text.slice(found.start, found.end) : null;
}
