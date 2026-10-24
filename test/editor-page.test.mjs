import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/editor/index.html', import.meta.url), 'utf8');

test('editor page is self-contained: one inline script that parses, no external resources', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+href=/i.test(html));
  assert.ok(!/@import|url\(/i.test(html));
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /name="viewport"/);
});

test('editor page shows the entry-0 hint and never exposes ratio as a field', () => {
  assert.match(html, /give entry 0 only a label/);
  assert.ok(!/textField\('[^']*[Rr]atio/.test(html));
});
