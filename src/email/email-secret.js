import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });
const MAX_BYTES = 64 * 1024;

function readKey(value) {
  if (Buffer.isBuffer(value)) return value.length === 32 ? Buffer.from(value) : null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 && key.toString('base64') === value ? key : null;
}

function associatedData({ workspaceId, accountId } = {}) {
  if (![workspaceId, accountId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\x00-\x1f]/.test(v))) {
    throw fail('Для шифрования нужны пространство и почтовый ящик', 'EMAIL_SECRET_CONTEXT_REQUIRED');
  }
  return Buffer.from(JSON.stringify(['chatx-email-credentials', 1, workspaceId, accountId]));
}

/** Credentials are bound to their mailbox and tenant. No implicit vault-key fallback. */
export function createEmailSecretBox({ key = process.env.EMAIL_ENCRYPTION_KEY, previousKeys = [] } = {}) {
  const current = readKey(key);
  const readers = [current, ...previousKeys.map(readKey)].filter(Boolean);
  const requireKey = () => {
    if (!current) throw fail('Почта не настроена: нужен EMAIL_ENCRYPTION_KEY из 32 случайных байт в base64', 'EMAIL_ENCRYPTION_NOT_CONFIGURED', 503);
  };
  return {
    configured: Boolean(current),
    encrypt(value, context) {
      requireKey();
      const aad = associatedData(context);
      const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
      if (!plaintext.length || plaintext.length > MAX_BYTES) throw fail('Слишком большой почтовый секрет', 'EMAIL_SECRET_TOO_LARGE');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      plaintext.fill(0);
      return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
    },
    decrypt(envelope, context) {
      requireKey();
      const aad = associatedData(context);
      if (typeof envelope !== 'string' || !/^v1\.[A-Za-z0-9_-]+$/.test(envelope) || envelope.length > MAX_BYTES * 2) {
        throw fail('Почтовый секрет не читается', 'EMAIL_SECRET_UNREADABLE', 503);
      }
      const bytes = Buffer.from(envelope.slice(3), 'base64url');
      if (bytes.length <= 28 || bytes.length > MAX_BYTES + 28) throw fail('Почтовый секрет не читается', 'EMAIL_SECRET_UNREADABLE', 503);
      for (const candidate of readers) {
        let plaintext;
        try {
          const decipher = createDecipheriv('aes-256-gcm', candidate, bytes.subarray(0, 12));
          decipher.setAAD(aad);
          decipher.setAuthTag(bytes.subarray(12, 28));
          plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
          return JSON.parse(plaintext.toString('utf8'));
        } catch { /* Wrong key, corrupted value, or wrong mailbox: same public error. */ }
        finally { plaintext?.fill(0); }
      }
      throw fail('Почтовый секрет не читается настроенным ключом', 'EMAIL_SECRET_UNREADABLE', 503);
    },
  };
}
