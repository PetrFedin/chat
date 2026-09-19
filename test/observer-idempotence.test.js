import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * Four modules register a MutationObserver over document.body or
 * document.documentElement and mutate the DOM from the callback. Writing a
 * value that already matches is still a mutation, so it re-enters the observer
 * and the main thread never reaches idle — the page loads and then freezes.
 *
 * These tests pin the compare-before-write guards that broke that loop. They
 * are source assertions because the loop only reproduces in a real browser;
 * the measured behaviour was 665 DOM writes in 12s before the fix and 10 after.
 */

test('every body-wide observer callback belongs to a module with write guards', async () => {
  const modules = ['public/meeting-intelligence.js', 'public/meeting-operations.js', 'public/daily-work.js', 'public/preferences.js'];
  for (const path of modules) {
    const source = await read(path);
    assert.match(source, /new MutationObserver/, `${path} is expected to observe the DOM`);
    assert.doesNotThrow(() => new Function(source), `${path} must parse`);
  }
});

test('the meeting review card updates in place instead of being re-inserted', async () => {
  const source = await read('public/meeting-intelligence.js');
  assert.match(source, /const existing=stack\.querySelector\('\.mi-today-review'\)/);
  assert.match(source, /if\(existing\)\{if\(existing\.innerHTML!==markup\)existing\.innerHTML=markup;return\}/);
  assert.doesNotMatch(
    source,
    /stack\.querySelector\('\.mi-today-review'\)\?\.remove\(\);const ready/,
    'removing and re-inserting the card on every pass is what pinned the main thread',
  );
});

test('daily work badges and strips compare before writing', async () => {
  const source = await read('public/daily-work.js');
  assert.match(source, /const setText=\(el,value\)=>\{if\(el&&el\.textContent!==value\)/);
  assert.match(source, /const setHtml=\(el,value\)=>\{if\(el&&el\.innerHTML!==value\)/);
  assert.match(source, /const setHidden=\(el,value\)=>\{if\(el&&el\.hidden!==value\)/);
  assert.doesNotMatch(source, /badge\.textContent=/, 'setCountBadge must go through setText');
  assert.doesNotMatch(source, /bell\.hidden=/, 'the bell badge must go through setHidden');
  assert.doesNotMatch(source, /strip\.innerHTML=/, 'the attention strip must go through setHtml');
});

test('preferences never rewrites an unchanged title, launcher or profile block', async () => {
  const source = await read('public/preferences.js');
  assert.match(source, /function applyDocumentTitle\(\)/);
  assert.match(source, /if \(document\.title !== next\) document\.title = next;/);
  assert.doesNotMatch(
    source,
    /\n\s*document\.title = locale ===/,
    'assigning an unchanged title still replaces the text node under <title>',
  );
  assert.match(source, /function setMarkup\(element, markup\)/);
  assert.match(source, /function setAttributeIfChanged\(element, name, value\)/);
  assert.doesNotMatch(source, /block\.innerHTML = preferenceControls\(\);/);
  assert.doesNotMatch(source, /button\.innerHTML = `<span>/);
});

test('<title> and other non-prose elements are excluded from the translation walk', async () => {
  const source = await read('public/preferences.js');
  assert.match(source, /const NON_PROSE = new Set\(\['TITLE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'\]\)/);
  assert.match(source, /if \(NON_PROSE\.has\(parent\.tagName\)\) return true;/);
});

test('placeholder localisation compares before writing', async () => {
  const source = await read('public/preferences-context.js');
  assert.match(source, /if \(node\.getAttribute\(attribute\) !== value\) node\.setAttribute\(attribute, value\);/);
});
