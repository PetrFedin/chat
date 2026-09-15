import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PASSWORD_BYTES = 64;
const MIN_PASSWORD_LENGTH = 12;

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('A valid email is required');
    error.code = 'INVALID_EMAIL';
    throw error;
  }
  return email;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    const error = new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters`);
    error.code = 'WEAK_PASSWORD';
    throw error;
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) {
    const error = new Error('Password must contain letters and a number');
    error.code = 'WEAK_PASSWORD';
    throw error;
  }
  return password;
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  validatePassword(password);
  const hash = scryptSync(password, salt, PASSWORD_BYTES).toString('hex');
  return Object.freeze({ salt, hash });
}

export function verifyPassword(password, salt, expectedHash) {
  if (typeof password !== 'string' || !salt || !expectedHash) return false;
  const actual = Buffer.from(scryptSync(password, salt, PASSWORD_BYTES).toString('hex'), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

export function createSessionExpiry(now = Date.now(), days = 30) {
  return new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
}
