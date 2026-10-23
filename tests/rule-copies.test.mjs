import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// SKILL.md is the source of the five rules. The global rule snippet and the landing page restate
// them in shorter words, so they cannot be compared byte for byte. Instead each rule pins a few
// phrases that must survive in every copy: rewording a rule in one place trips this test, which
// is the reminder to carry the change to the other copies.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const INVARIANTS = [
  ['search', 'whole file'],
  ['re-read', 'success'],
  ['proportional', 'specific risk'],
  ['reuse', 're-fetch'],
  ['match output length to the question', 'restate'],
];

const skill = [...read('skills', 'token-efficient-work', 'SKILL.md').matchAll(/^\*\*(\d+)\. (.+?)\*\*(.*)$/gm)].map(
  ([, n, title, rest]) => ({ n: Number(n), title: title.replace(/\.$/, ''), text: `${title} ${rest}` }),
);

const snippet = [...read('hooks', 'global-rule.snippet.md').matchAll(/^(\d+)\. (.+)$/gm)].map(([, n, text]) => ({
  n: Number(n),
  text,
}));

const rulesList = read('docs', 'index.html').match(/<ol class="rules">([\s\S]*?)<\/ol>/);
const landing = rulesList
  ? [...rulesList[1].matchAll(/<p class="t">(.*?)<\/p>\s*<p class="d">(.*?)<\/p>/g)].map(([, title, desc], i) => ({
      n: i + 1,
      title,
      text: `${title} ${desc}`,
    }))
  : [];

const copies = { 'SKILL.md': skill, 'hooks/global-rule.snippet.md': snippet, 'docs/index.html': landing };

test('every copy has the same rules, numbered 1 to N', () => {
  for (const [name, rules] of Object.entries(copies)) {
    assert.deepEqual(
      rules.map((r) => r.n),
      INVARIANTS.map((_, i) => i + 1),
      `${name} rule numbers`,
    );
  }
});

test('each landing page title is the SKILL.md title or its start', () => {
  landing.forEach((rule, i) => {
    assert.ok(skill[i].title.startsWith(rule.title), `rule ${rule.n}: "${rule.title}" vs "${skill[i].title}"`);
  });
});

test('each rule keeps its key phrases in every copy', () => {
  for (const [name, rules] of Object.entries(copies)) {
    INVARIANTS.forEach((phrases, i) => {
      const text = (rules[i]?.text ?? '').toLowerCase();
      for (const phrase of phrases) {
        assert.ok(text.includes(phrase), `${name} rule ${i + 1} is missing "${phrase}"`);
      }
    });
  }
});
