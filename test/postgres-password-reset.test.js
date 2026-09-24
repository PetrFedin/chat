import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

// Recovery normally means «we email you a link», and this product has no
// channel to send one — which is why the feature did not exist and a person
// who forgot their password had no way back in at all. A corporate workspace
// has something a consumer product does not: an administrator who already
// knows who works here.
test('password recovery', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);

  const build = async () => {
    const pass = hashPassword('RecoveryPass2026');
    const company = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `owner-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const tokenHash = hashToken(`session-${randomUUID()}`);
    await store.createSession({ userId: company.user.id, workspaceId: company.workspace.id, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const owner = await store.getSession(tokenHash);

    const invite = randomUUID();
    await store.createInvitation(owner, { email: `worker-${randomUUID()}@test.local`, role: 'member', tokenHash: hashToken(invite), expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const p = hashPassword('RecoveryPass2026');
    const accepted = await store.acceptInvitation({ tokenHash: hashToken(invite), displayName: 'Сотрудник', passwordHash: p.hash, passwordSalt: p.salt });
    return { owner, workerId: accepted.user.id, workerEmail: accepted.user.email };
  };

  await t.test('a link changes the password once, and the old one stops working', async () => {
    const { owner, workerId, workerEmail } = await build();
    const token = randomUUID();
    const reset = await store.createPasswordReset(owner, { userId: workerId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
    assert.equal(reset.status, 'pending');

    const next = hashPassword('BrandNewPass2026');
    await store.redeemPasswordReset({ tokenHash: hashToken(token), passwordHash: next.hash, passwordSalt: next.salt });

    const auth = await store.findAuthByEmail(workerEmail);
    assert.equal(auth.passwordHash, next.hash, 'пароль не сменился');

    // Single use: the same link must not work twice.
    await assert.rejects(
      () => store.redeemPasswordReset({ tokenHash: hashToken(token), passwordHash: next.hash, passwordSalt: next.salt }),
      (error) => error.code === 'RESET_NOT_FOUND',
    );
  });

  await t.test('open sessions die with the old password', async () => {
    const { owner, workerId } = await build();
    const sessionToken = hashToken(`worker-session-${randomUUID()}`);
    await store.createSession({ userId: workerId, workspaceId: owner.workspaceId, tokenHash: sessionToken, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    assert.ok(await store.getSession(sessionToken), 'сессия не создалась');

    const token = randomUUID();
    await store.createPasswordReset(owner, { userId: workerId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const next = hashPassword('BrandNewPass2026');
    await store.redeemPasswordReset({ tokenHash: hashToken(token), passwordHash: next.hash, passwordSalt: next.salt });

    // A recovered password is worth nothing if whoever was signed in stays in.
    assert.equal(await store.getSession(sessionToken), null, 'старая сессия пережила смену пароля');
  });

  await t.test('an expired link is refused and marked', async () => {
    const { owner, workerId } = await build();
    const token = randomUUID();
    await store.createPasswordReset(owner, { userId: workerId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 1000).toISOString() });
    await pool.query(
      "UPDATE password_resets SET created_at=now() - interval '2 hours', expires_at=now() - interval '1 hour' WHERE token_hash=$1",
      [hashToken(token)]);
    const next = hashPassword('BrandNewPass2026');
    await assert.rejects(
      () => store.redeemPasswordReset({ tokenHash: hashToken(token), passwordHash: next.hash, passwordSalt: next.salt }),
      (error) => error.code === 'RESET_EXPIRED',
    );
    const { rows } = await pool.query('SELECT status FROM password_resets WHERE token_hash=$1', [hashToken(token)]);
    assert.equal(rows[0].status, 'expired');
  });

  await t.test('issuing a second link retires the first', async () => {
    const { owner, workerId } = await build();
    const first = randomUUID();
    await store.createPasswordReset(owner, { userId: workerId, tokenHash: hashToken(first), expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const second = randomUUID();
    await store.createPasswordReset(owner, { userId: workerId, tokenHash: hashToken(second), expiresAt: new Date(Date.now() + 864e5).toISOString() });

    const next = hashPassword('BrandNewPass2026');
    // Two keys to the same door is exactly what the partial unique index is
    // there to prevent.
    await assert.rejects(
      () => store.redeemPasswordReset({ tokenHash: hashToken(first), passwordHash: next.hash, passwordSalt: next.salt }),
      (error) => error.code === 'RESET_NOT_FOUND',
    );
    await store.redeemPasswordReset({ tokenHash: hashToken(second), passwordHash: next.hash, passwordSalt: next.salt });
  });

  await t.test('a link cannot be issued for somebody outside the workspace', async () => {
    const { owner } = await build();
    await assert.rejects(
      () => store.createPasswordReset(owner, { userId: randomUUID(), tokenHash: hashToken(randomUUID()), expiresAt: new Date(Date.now() + 864e5).toISOString() }),
      (error) => error.code === 'PERSON_NOT_FOUND',
    );
  });
});
