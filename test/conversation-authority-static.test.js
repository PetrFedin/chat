import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('conversation authority browser surface parses and exposes group/member flows',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/data-q="group"/);
  assert.match(source,/data-action="members"/);
  assert.match(source,/function groupModal\(/);
  assert.match(source,/async function membersModal\(/);
  assert.match(source,/announcementOnly/);
  assert.doesNotMatch(source,/WebRTC\/SFU медиаслой — следующий технический этап/);
  assert.doesNotMatch(source,/Аудиозвонок будет подключён/);
  assert.doesNotMatch(source,/Видеозвонок будет подключён/);
});
