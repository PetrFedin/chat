import { json, noContent, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const ENTRY = new RegExp(`^/api/v1/vault/${ID}$`, 'i');
const REVEAL = new RegExp(`^/api/v1/vault/${ID}/secret$`, 'i');

export function createVaultHandler() {
  return async function handleVault(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/vault')) return false;
    const session = await ctx.requireSession(req);
    const vault = ctx.vault;
    if (!vault?.enabled) {
      // Причина важна: без базы это одно, без ключа — другое, и второе
      // чинится одной переменной окружения.
      const noKey = vault?.reason === 'no-key';
      throw Object.assign(
        new Error(noKey
          ? 'The vault is not configured: set VAULT_KEY to 32 random bytes in base64'
          : 'The vault requires a database deployment'),
        { code: noKey ? 'VAULT_KEY_MISSING' : 'VAULT_UNAVAILABLE', statusCode: 503, expose: true },
      );
    }

    if (path === '/api/v1/vault' && method === 'GET') {
      json(res, 200, { items: await vault.list(session) });
      return true;
    }
    if (path === '/api/v1/vault' && method === 'POST') {
      json(res, 201, { entry: await vault.create(session, await readJson(req)) });
      return true;
    }

    let m = path.match(REVEAL);
    // Раскрытие — POST, а не GET: его не кешируют, не повторяют по ссылке
    // и не сохраняют в истории.
    if (m && method === 'POST') {
      res.setHeader('cache-control', 'no-store');
      json(res, 200, { entry: await vault.reveal(session, m[1]) });
      return true;
    }

    m = path.match(ENTRY);
    if (m && method === 'PATCH') {
      json(res, 200, { entry: await vault.update(session, m[1], await readJson(req)) });
      return true;
    }
    if (m && method === 'DELETE') {
      await vault.remove(session, m[1]);
      noContent(res);
      return true;
    }

    throw Object.assign(new Error('Vault route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
