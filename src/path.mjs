import nodePath from 'node:path';

export const looksAbsolute = (d) =>
  nodePath.posix.isAbsolute(d) || nodePath.win32.isAbsolute(d) || /^[a-zA-Z]:/.test(d) || d.startsWith('\\');
