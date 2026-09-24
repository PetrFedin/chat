import { createHash } from 'node:crypto';

const TTL_HOURS = 24;

/**
 * Idempotency-Key for mutating commands.
 *
 * The table has existed since migration 001 and nothing ever wrote to it, so
 * a retried POST created a second task. That is not a nicety: any inbound
 * integration retries, and without this every timeout becomes duplicate work
 * somebody has to notice and undo by hand.
 *
 * The stored response is keyed on (workspace, actor, key). A replay with the
 * same key but a different body is a client bug — two different commands
 * under one key — and is refused rather than silently answered with the first
 * one's result.
 */
export function createIdempotencyGuard(pool) {
  if (!pool) return null;

  const fingerprint = (method, path, rawBody) =>
    createHash('sha256').update(`${method} ${path}\n${rawBody ?? ''}`, 'utf8').digest('hex');

  return {
    /**
     * Claims the key. Returns a stored response to replay, or a `finish`
     * callback to record this attempt's outcome.
     */
    async begin(session, key, { method, path, rawBody }) {
      const hash = fingerprint(method, path, rawBody);
      const { rows } = await pool.query(
        `INSERT INTO idempotency_keys(organization_id,workspace_id,actor_id,key,request_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now() + interval '${TTL_HOURS} hours')
         ON CONFLICT (workspace_id,actor_id,key) DO UPDATE SET key=EXCLUDED.key
         RETURNING request_hash "requestHash", response_code "responseCode", response_body "responseBody",
                   (xmax = 0) AS inserted`,
        [session.organizationId, session.workspaceId, session.userId, key, hash],
      );
      const row = rows[0];

      if (!row.inserted) {
        if (row.requestHash !== hash) {
          throw Object.assign(
            new Error('This Idempotency-Key was already used for a different request'),
            { code: 'IDEMPOTENCY_KEY_REUSED', statusCode: 409 },
          );
        }
        // A key claimed but not yet finished means the first attempt is still
        // running, or died. Answering "in progress" beats running the command
        // twice.
        if (row.responseCode === null) {
          throw Object.assign(
            new Error('An identical request is still being processed'),
            { code: 'IDEMPOTENCY_IN_PROGRESS', statusCode: 409 },
          );
        }
        return { replay: { status: row.responseCode, body: row.responseBody } };
      }

      return {
        replay: null,
        finish: async (status, body) => {
          // Only a settled outcome is worth replaying; a 5xx should be
          // retriable, so the key is released instead of caching a failure.
          if (status >= 500) {
            await pool.query('DELETE FROM idempotency_keys WHERE workspace_id=$1 AND actor_id=$2 AND key=$3',
              [session.workspaceId, session.userId, key]).catch(() => {});
            return;
          }
          await pool.query(
            'UPDATE idempotency_keys SET response_code=$4, response_body=$5 WHERE workspace_id=$1 AND actor_id=$2 AND key=$3',
            [session.workspaceId, session.userId, key, status, body ?? null],
          ).catch(() => {});
        },
      };
    },

    /** Expired keys are not history; they are litter. */
    async prune() {
      const { rowCount } = await pool.query('DELETE FROM idempotency_keys WHERE expires_at < now()');
      return { removed: rowCount };
    },
  };
}

/** Header name, lower-cased as Node delivers it. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
