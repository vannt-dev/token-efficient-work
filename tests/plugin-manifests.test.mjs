import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The Claude Code marketplace lists three plugins from this repo: the skill (repo root), the
// opt-in read guard (hooks/claude-code) and the opt-in cost band (hooks/claude-code-band).
// These checks keep the manifests and files in step.
const root = fileURLToPath(new URL('..', import.meta.url));
const json = (...parts) => JSON.parse(readFileSync(join(root, ...parts), 'utf8'));

const marketplace = json('.claude-plugin', 'marketplace.json');
const releaseVersion = json('.release-please-manifest.json')['.'];
const byName = Object.fromEntries(marketplace.plugins.map((p) => [p.name, p]));

test('every marketplace entry points at a plugin with the same name and the release version', () => {
  assert.deepEqual(Object.keys(byName).sort(), [
    'token-efficient-work',
    'token-efficient-work-band',
    'token-efficient-work-read-guard',
  ]);
  for (const entry of marketplace.plugins) {
    const manifest = json(entry.source, '.claude-plugin', 'plugin.json');
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, releaseVersion, `${entry.name} version`);
    assert.equal(entry.version, undefined, 'the version lives in plugin.json only');
  }
});

test('release-please bumps every plugin manifest', () => {
  const extra = json('release-please-config.json').packages['.']['extra-files'];
  for (const entry of marketplace.plugins) {
    const path = join(entry.source, '.claude-plugin', 'plugin.json').replaceAll('\\', '/').replace(/^\.\//, '');
    assert.ok(
      extra.some((f) => typeof f === 'object' && f.path === path && f.jsonpath === '$.version'),
      `extra-files has ${path}`,
    );
  }
});

test('the skill plugin ships the skill and no hook, so the read guard stays opt-in', () => {
  const source = byName['token-efficient-work'].source;
  assert.ok(existsSync(join(root, source, 'skills', 'token-efficient-work', 'SKILL.md')));
  assert.ok(!existsSync(join(root, source, 'hooks', 'hooks.json')));
  assert.equal(json(source, '.claude-plugin', 'plugin.json').hooks, undefined);
});

test('the read guard plugin runs the guard script that the tests cover', () => {
  const source = byName['token-efficient-work-read-guard'].source;
  const manifest = json(source, '.claude-plugin', 'plugin.json');
  const hooks = json(source, manifest.hooks);
  const [entry] = hooks.hooks.PreToolUse;
  assert.equal(entry.matcher, 'Read');
  assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/guard-full-read.mjs"');
  assert.ok(existsSync(join(root, source, 'guard-full-read.mjs')));
});

test('the cost band plugin loads its hooks module and declares its state', () => {
  const source = byName['token-efficient-work-band'].source;
  const manifest = json(source, '.claude-plugin', 'plugin.json');
  assert.deepEqual(json(source, 'hooks', 'hooks.json').modules, ['./register.tsx']);
  assert.ok(existsSync(join(root, source, 'hooks', 'register.tsx')));
  assert.ok(existsSync(join(root, source, manifest.types)));
});
