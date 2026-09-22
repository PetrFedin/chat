import { createHash, timingSafeEqual } from 'node:crypto';
import { open, readVaultKey, readVaultKeys, seal } from '../vault/vault-repository.js';
import { newRecoveryCodes, newSecret, otpauthUrl, verifyCode } from './totp.js';

/**
 * Второй множитель: хранение и проверка.
 *
 * Секрет запечатан тем же ключом, что и сейф паролей: украденный дамп
 * базы не должен давать возможность выпускать чужие коды. Поэтому без
 * `VAULT_KEY` второй множитель не включается — и говорит об этом
 * прямо, а не притворяется работающим.
 *
 * Запасные коды хранятся отпечатками. Список запасных кодов открытым
 * текстом в базе — это тот же пароль, записанный десять раз.
 */

const digest = (code) => createHash('sha256')
  .update(String(code ?? '').toLowerCase().replace(/[\s-]/g, ''))
  .digest('hex');

const unavailable = () => Object.assign(
  new Error('Второй множитель требует настроенного ключа шифрования'),
  { code: 'TWO_FACTOR_UNAVAILABLE', statusCode: 503, expose: true },
);

const equal = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

export function createTwoFactor(pool, { key = readVaultKey(), previous = readVaultKeys().previous } = {}) {
  // См. сейф: во время смены ключа часть секретов ещё запечатана
  // прежним, и вход по коду не должен на это время ломаться.
  const readers = [key, previous].filter(Boolean);
  if (!pool) return null;

  const enabledFor = async (userId) => {
    const { rows } = await pool.query(
      'SELECT secret, confirmed_at, last_counter FROM auth_totp WHERE user_id = $1',
      [userId],
    );
    const row = rows[0];
    return row?.confirmed_at ? row : null;
  };

  return {
    configured: () => Boolean(key),

    /** Что показать человеку в настройках. */
    async state(userId) {
      const { rows } = await pool.query(
        'SELECT confirmed_at, last_used_at FROM auth_totp WHERE user_id = $1',
        [userId],
      );
      const { rows: [left] } = await pool.query(
        'SELECT count(*)::int n FROM auth_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
        [userId],
      );
      return {
        available: Boolean(key),
        enabled: Boolean(rows[0]?.confirmed_at),
        startedAt: rows[0] ? !rows[0].confirmed_at : false,
        lastUsedAt: rows[0]?.last_used_at ?? null,
        recoveryCodesLeft: left?.n ?? 0,
      };
    },

    /**
     * Начать настройку: новый секрет и ссылка для аутентификатора.
     *
     * Пока код не подтверждён, вход не меняется. Иначе человек включает
     * второй множитель, ошибается при настройке приложения и запирает
     * себя снаружи собственного пространства.
     */
    async begin(userId, account) {
      if (!key) throw unavailable();
      const secret = newSecret();
      await pool.query(
        `INSERT INTO auth_totp(user_id, secret, confirmed_at, last_counter)
         VALUES($1, $2, NULL, NULL)
         ON CONFLICT (user_id) DO UPDATE
            SET secret = EXCLUDED.secret, confirmed_at = NULL, last_counter = NULL, created_at = now()`,
        [userId, seal(key, secret)],
      );
      return { secret, otpauth: otpauthUrl({ secret, account }) };
    },

    /**
     * Подтвердить настройку кодом из приложения.
     *
     * Возвращает запасные коды — единственный раз, когда их видно.
     */
    async confirm(userId, code) {
      if (!key) throw unavailable();
      const { rows } = await pool.query('SELECT secret, confirmed_at FROM auth_totp WHERE user_id = $1', [userId]);
      if (!rows[0]) {
        throw Object.assign(new Error('Настройка не начата'), { code: 'TWO_FACTOR_NOT_STARTED', statusCode: 409, expose: true });
      }
      if (rows[0].confirmed_at) {
        throw Object.assign(new Error('Второй множитель уже включён'), { code: 'TWO_FACTOR_ALREADY_ON', statusCode: 409, expose: true });
      }
      if (!verifyCode(open(readers, rows[0].secret), code)) {
        throw Object.assign(new Error('Код не подошёл'), { code: 'TWO_FACTOR_BAD_CODE', statusCode: 400, expose: true });
      }
      const codes = newRecoveryCodes();
      await pool.query('UPDATE auth_totp SET confirmed_at = now() WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM auth_recovery_codes WHERE user_id = $1', [userId]);
      for (const recovery of codes) {
        await pool.query('INSERT INTO auth_recovery_codes(user_id, code_hash) VALUES($1, $2)', [userId, digest(recovery)]);
      }
      return { recoveryCodes: codes };
    },

    /**
     * Выключить — но только предъявив текущий код или пароль.
     *
     * Иначе украденный сеанс снимает второй множитель одним запросом, и
     * весь смысл теряется.
     */
    async disable(userId) {
      await pool.query('DELETE FROM auth_recovery_codes WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM auth_totp WHERE user_id = $1', [userId]);
      return { enabled: false };
    },

    /** Выдать новые запасные коды взамен израсходованных. */
    async reissue(userId) {
      if (!key) throw unavailable();
      if (!await enabledFor(userId)) {
        throw Object.assign(new Error('Второй множитель выключен'), { code: 'TWO_FACTOR_OFF', statusCode: 409, expose: true });
      }
      const codes = newRecoveryCodes();
      await pool.query('DELETE FROM auth_recovery_codes WHERE user_id = $1', [userId]);
      for (const recovery of codes) {
        await pool.query('INSERT INTO auth_recovery_codes(user_id, code_hash) VALUES($1, $2)', [userId, digest(recovery)]);
      }
      return { recoveryCodes: codes };
    },

    /** Нужен ли этому человеку второй множитель при входе. */
    async required(userId) {
      if (!key) return false;
      return Boolean(await enabledFor(userId));
    },

    /**
     * Проверка при входе: код из приложения или один из запасных.
     *
     * Использованное окно запоминается: один и тот же код нельзя
     * предъявить дважды, иначе подсмотренный через плечо код работает
     * все тридцать секунд, а не до первого входа.
     */
    async check(userId, code) {
      const row = await enabledFor(userId);
      if (!row) return { ok: true, method: null };
      const given = String(code ?? '').trim();
      if (!given) return { ok: false, reason: 'missing' };

      if (/^\d{6}$/.test(given)) {
        const secret = open(readers, row.secret);
        if (!verifyCode(secret, given)) return { ok: false, reason: 'bad_code' };
        const counter = Math.floor(Date.now() / 1000 / 30);
        // Окно уже могло быть использовано — но сдвиг на секунду не
        // должен ломать честный вход, поэтому сравниваем с последним
        // принятым, а не с текущим.
        if (row.last_counter !== null && Number(row.last_counter) >= counter) {
          return { ok: false, reason: 'code_used' };
        }
        await pool.query('UPDATE auth_totp SET last_used_at = now(), last_counter = $2 WHERE user_id = $1', [userId, counter]);
        return { ok: true, method: 'totp' };
      }

      const hash = digest(given);
      const { rows } = await pool.query(
        'SELECT id, code_hash FROM auth_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
        [userId],
      );
      // Сравниваем постоянным временем и перебираем все: ранний выход
      // по совпадению измеримо отличается от отсутствия совпадения.
      let hit = null;
      for (const candidate of rows) if (equal(candidate.code_hash, hash)) hit = candidate.id;
      if (!hit) return { ok: false, reason: 'bad_code' };
      await pool.query('UPDATE auth_recovery_codes SET used_at = now() WHERE id = $1', [hit]);
      await pool.query('UPDATE auth_totp SET last_used_at = now() WHERE user_id = $1', [userId]);
      const left = rows.length - 1;
      return { ok: true, method: 'recovery', recoveryCodesLeft: left };
    },
  };
}
