import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// plugin/ is the folder submitted to the Claude plugin directory. The directory accepts only
// Markdown, text, JSON, YAML and images there from an organization that is not Verified, so it
// holds a copy of the skill rather than the repository root. These checks keep it a faithful copy.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('plugin/ carries the same SKILL.md as skills/', () => {
  assert.equal(
    read('plugin', 'skills', 'token-efficient-work', 'SKILL.md'),
    read('skills', 'token-efficient-work', 'SKILL.md'),
  );
});

test('plugin/ manifest matches the root manifest', () => {
  assert.deepEqual(JSON.parse(read('plugin', '.claude-plugin', 'plugin.json')), JSON.parse(read('.claude-plugin', 'plugin.json')));
});

test('plugin/ holds only file types the directory accepts, and no download-and-run command', () => {
  const allowed = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
  for (const file of files(join(root, 'plugin'))) {
    const rel = relative(root, file);
    assert.ok(allowed.has(extname(file).toLowerCase()), `${rel} type`);
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(extname(file).toLowerCase())) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.startsWith('#!'), `${rel} starts with #!`);
    assert.ok(!/\|\s*(ba|z)?sh\b|\|\s*iex\b|Invoke-Expression/i.test(text), `${rel} download-and-run`);
  }
});
