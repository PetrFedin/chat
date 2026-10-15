import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'public/app.js'), 'utf8');
const start = app.indexOf('async function wikiModal(pageId=null)');
const end = app.indexOf('async function wikiHistoryModal', start);
const wiki = app.slice(start, end);
const linksStart = app.indexOf('async function wikiProjectLinkModal(', start);
const linksEnd = app.indexOf('function wikiPageFormModal(', linksStart);
const relations = app.slice(linksStart, linksEnd);

test('Wiki relation dialogs must not redraw a different modal from delayed callbacks', () => {
  assert.ok(start !== -1 && end > start && linksStart > start && linksEnd > linksStart,
    'Wiki relation modal section must exist');
  assert.doesNotMatch(relations, /setTimeout\(\s*\(\)\s*=>\s*after\?\.\(\)/,
    'Linking must return via popstate/resumeTop, never by a detached 200ms refresh');
  assert.doesNotMatch(relations, /window\.addEventListener\('popstate',\s*\(\)\s*=>\s*\{?\s*void after\?\.\(\)/,
    'Linking must not register an independent one-off navigation listener');
  assert.match(wiki, /if\(overlayStack\[overlayStack\.length-1\]!==top\)return/,
    'An async wiki refresh must verify that the same overlay is still current');
});

test('Page Channel navigation uses the shared sheet-to-chat transition', () => {
  assert.match(wiki, /openChatFromSheet\(id\)/,
    'Page-to-Channel must use route-aware navigation rather than clear the overlay and race');
});
