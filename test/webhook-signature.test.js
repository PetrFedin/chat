import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, createEndpointSecret, parseSignature, signPayload, topicMatches, verifySignature } from '../src/integrations/webhook-signature.js';

const SECRET = 'whsec_test_secret_value_0123456789';
const BODY = JSON.stringify({ topic: 'task.transitioned', data: { id: 'x' } });

test('a signature this signer produces verifies with the documented verifier', () => {
  const header = signPayload(SECRET, BODY);
  assert.match(header, /^v1,t=\d+,s=[0-9a-f]{64}$/);
  assert.equal(verifySignature(SECRET, BODY, header).valid, true);
});

test('a tampered body, a wrong secret and a malformed header all fail', () => {
  const header = signPayload(SECRET, BODY);
  assert.equal(verifySignature(SECRET, `${BODY} `, header).reason, 'SIGNATURE_MISMATCH');
  assert.equal(verifySignature('whsec_other_secret_0123456789ab', BODY, header).reason, 'SIGNATURE_MISMATCH');
  assert.equal(verifySignature(SECRET, BODY, 'v2,t=1,s=abc').reason, 'MALFORMED_SIGNATURE');
  assert.equal(verifySignature(SECRET, BODY, '').reason, 'MALFORMED_SIGNATURE');
});

test('a captured delivery cannot be replayed once its timestamp ages out', () => {
  const now = Date.now();
  const header = signPayload(SECRET, BODY, Math.floor(now / 1000));
  assert.equal(verifySignature(SECRET, BODY, header, { now: now + 299_000 }).valid, true);
  assert.equal(verifySignature(SECRET, BODY, header, { now: now + 301_000 }).reason, 'TIMESTAMP_OUT_OF_TOLERANCE');
  // The timestamp is signed, so moving it invalidates the digest rather than
  // buying the attacker a fresh window.
  const moved = header.replace(/t=\d+/, `t=${Math.floor(now / 1000) + 600}`);
  assert.equal(verifySignature(SECRET, BODY, moved, { now: now + 600_000 }).reason, 'SIGNATURE_MISMATCH');
});

test('secrets are long, prefixed and unique', () => {
  const secrets = new Set(Array.from({ length: 200 }, createEndpointSecret));
  assert.equal(secrets.size, 200);
  for (const secret of secrets) {
    assert.match(secret, /^whsec_/);
    assert.ok(secret.length >= 32, 'the schema rejects anything shorter');
  }
});

test('backoff grows, stays jittered and is capped', () => {
  assert.ok(backoffMs(1, { random: () => 1 }) <= 2000);
  assert.ok(backoffMs(5, { random: () => 1 }) > backoffMs(2, { random: () => 1 }));
  assert.ok(backoffMs(30, { random: () => 1 }) <= 3_600_000, 'an hour is the ceiling');
  const low = backoffMs(6, { random: () => 0 });
  const high = backoffMs(6, { random: () => 0.999 });
  assert.ok(high > low, 'without jitter every pending delivery retries in the same second');
});

test('topic patterns select the right events', () => {
  assert.equal(topicMatches(['meeting.*'], 'meeting.transcript.ready'), true);
  assert.equal(topicMatches(['meeting.*'], 'task.transitioned'), false);
  assert.equal(topicMatches(['*'], 'anything.at.all'), true);
  assert.equal(topicMatches([], 'anything.at.all'), true, 'no filter means every topic');
  assert.equal(topicMatches(['task.transitioned'], 'task.transitioned'), true);
});

test('parseSignature rejects anything that is not a 64-char hex digest', () => {
  assert.equal(parseSignature('v1,t=123,s=zzzz'), null);
  assert.equal(parseSignature('v1,t=notanumber,s=' + 'a'.repeat(64)), null);
  assert.deepEqual(parseSignature('v1,t=123,s=' + 'a'.repeat(64)), { timestamp: 123, digest: 'a'.repeat(64) });
});
