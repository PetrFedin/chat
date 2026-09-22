import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_VERSION = 'v1';
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Signature format: `v1,t=<unix seconds>,s=<hex hmac>` over `<t>.<raw body>`.
 *
 * The timestamp is inside the signed string, not merely alongside it, so a
 * captured delivery cannot be replayed later under a fresh timestamp.
 * Receivers reject anything older than their tolerance and de-duplicate on the
 * delivery id, which is what makes our retries safe for them to accept.
 */
export function signPayload(secret, rawBody, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`, 'utf8').digest('hex');
  return `${SIGNATURE_VERSION},t=${timestampSeconds},s=${digest}`;
}

export function parseSignature(header) {
  const parts = String(header ?? '').split(',').map((part) => part.trim());
  if (parts[0] !== SIGNATURE_VERSION) return null;
  const timestamp = Number(parts.find((p) => p.startsWith('t='))?.slice(2));
  const digest = parts.find((p) => p.startsWith('s='))?.slice(2) ?? '';
  if (!Number.isFinite(timestamp) || !/^[0-9a-f]{64}$/.test(digest)) return null;
  return { timestamp, digest };
}

/**
 * Reference verifier. ChatX never calls it — receivers do — but shipping it
 * beside the signer keeps the documented contract and the implementation from
 * drifting, and the tests exercise the same code an integrator will write.
 */
export function verifySignature(secret, rawBody, header, { toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, now = Date.now() } = {}) {
  const parsed = parseSignature(header);
  if (!parsed) return { valid: false, reason: 'MALFORMED_SIGNATURE' };
  const age = Math.abs(Math.floor(now / 1000) - parsed.timestamp);
  if (age > toleranceSeconds) return { valid: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${parsed.timestamp}.${rawBody}`, 'utf8').digest('hex'), 'hex');
  const actual = Buffer.from(parsed.digest, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  return { valid: true };
}

export const createEndpointSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/**
 * Exponential backoff with full jitter, capped at an hour. The jitter matters:
 * without it a receiver that recovers from an outage is hit by every pending
 * delivery in the same second.
 */
export function backoffMs(attempt, { baseMs = 2000, capMs = 3600_000, random = Math.random } = {}) {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const floor = baseMs / 2;
  return Math.floor(floor + random() * Math.max(0, ceiling - floor));
}

/** `meeting.*` matches `meeting.transcript.ready`; `*` and an empty list match everything. */
export function topicMatches(patterns, topic) {
  if (!Array.isArray(patterns) || !patterns.length) return true;
  return patterns.some((pattern) => {
    if (pattern === '*' || pattern === topic) return true;
    return pattern.endsWith('.*') && topic.startsWith(pattern.slice(0, -1));
  });
}
