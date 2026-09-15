import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, normalizeEmail, createOpaqueToken, hashToken } from '../src/security.js';
import { Permission, hasPermission, requirePermission } from '../src/rbac.js';

test('passwords are salted and verified with scrypt', () => {
  const first=hashPassword('CorrectHorse42');
  const second=hashPassword('CorrectHorse42');
  assert.notEqual(first.salt,second.salt);
  assert.notEqual(first.hash,second.hash);
  assert.equal(verifyPassword('CorrectHorse42',first.salt,first.hash),true);
  assert.equal(verifyPassword('WrongHorse42',first.salt,first.hash),false);
});

test('email normalization and opaque token hashing are deterministic at boundary', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM '),'owner@example.com');
  const token=createOpaqueToken();
  assert.equal(hashToken(token).length,64);
  assert.equal(hashToken(token),hashToken(token));
});

test('RBAC gives managers operational control but reserves organization ownership', () => {
  assert.equal(hasPermission('manager',Permission.MEMBER_INVITE),true);
  assert.equal(hasPermission('manager',Permission.ORGANIZATION_MANAGE),false);
  assert.equal(hasPermission('member',Permission.MESSAGE_SEND),true);
  assert.throws(()=>requirePermission('guest',Permission.CHANNEL_CREATE),{code:'FORBIDDEN'});
});
