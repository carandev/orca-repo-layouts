/** [file, args] that opens `url` in the OS default browser (no shell: the url is one argv entry). */
export function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}
