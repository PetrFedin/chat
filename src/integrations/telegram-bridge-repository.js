import { randomBytes, timingSafeEqual } from 'node:crypto';
import { seal, open, readVaultKey } from '../vault/vault-repository.js';

/**
 * Живой мост между беседой ChatX и чатом в Telegram.
 *
 * Не разбор вставленного текста (см. migration 041/`createExternalForward`
 * без моста): здесь сообщение действительно идёт через Telegram Bot API
 * в обе стороны, без участия человека, который иначе копировал бы текст
 * руками. Пришедшее из Telegram остаётся тем же путём атрибуции, что и у
 * ручного переноса — `message_external_origins`, source='telegram' — так
 * коллега видит «Из Telegram», а не сообщение, будто бы написанное тем,
 * кто мост завёл.
 *
 * Токен бота шифруется тем же примитивом, что и личный сейф паролей
 * (`seal`/`open`, AES-256-GCM под VAULT_KEY): тот же класс секрета, тот
 * же ключ, не повод заводить второй механизм ради одной таблицы.
 *
 * Только PostgreSQL, как и остальные функции этого класса — честный 503
 * в памяти, а не подделанный мост.
 */

// `expose:true` всегда: без него ответ 5xx показывает человеку
// «Internal server error» вместо того, что здесь написано, а
// «не задан VAULT_KEY» и «Telegram отказал» — это и есть то, что
// человеку нужно прочитать, не техническая деталь для логов.
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

const view = (row) => ({
  id: row.id,
  conversationId: row.conversationId,
  botUsername: row.botUsername,
  telegramChatId: row.telegramChatId,
  status: row.status,
  lastError: row.lastError,
  lastActivityAt: row.lastActivityAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const COLUMNS = `id,conversation_id "conversationId",bot_username "botUsername",telegram_chat_id "telegramChatId",
  status,last_error "lastError",last_activity_at "lastActivityAt",created_at "createdAt",updated_at "updatedAt"`;

/**
 * `store` — тот же PostgresStore, что и остальной сервер: мост
 * переиспользует `createExternalForward`, а не пишет в `messages`
 * напрямую, чтобы не разойтись с правилами видимости и упоминаний.
 *
 * `request` — весь HTTP к api.telegram.org идёт через один параметр с
 * умолчанием `fetch`: тест подменяет его без обращения к интернету и
 * без настоящего токена, который взять просто неоткуда.
 */
export function createTelegramBridgeRepository(pool, store, { request = fetch, env = process.env } = {}) {
  if (!pool) {
    const stop = () => { throw fail('Мост с Telegram работает только с базой данных PostgreSQL', 'TELEGRAM_UNAVAILABLE', 503); };
    return { enabled: false, reason: 'no-database', list: stop, create: stop, remove: stop, receiveUpdate: stop, deliverOutbound: async () => {} };
  }
  const key = readVaultKey(env);

  const api = (token, method, body) => request(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  }).then(async (response) => {
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const known = { Unauthorized: 'Telegram не принял токен бота', 'Bad Request: chat not found': 'Telegram не нашёл такой чат: проверьте ID и что бот добавлен в чат' }[data?.description];
      throw fail(known || data?.description || `Telegram API отказал на ${method}`, 'TELEGRAM_API_ERROR', 502);
    }
    return data.result;
  });

  return {
    enabled: true,

    async list(session) {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM telegram_bridges WHERE workspace_id=$1 ORDER BY created_at DESC`, [session.workspaceId]);
      return rows.map(view);
    },

    async create(session, { conversationId, botToken, chatId, publicBaseUrl }) {
      if (!key) throw fail('Мост с Telegram недоступен: не задан VAULT_KEY, которым шифруется токен бота', 'TELEGRAM_KEY_MISSING', 503);
      const token = String(botToken ?? '').trim();
      if (!token) throw fail('Укажите токен бота, выданный @BotFather', 'INVALID_BOT_TOKEN', 400);
      const chat = String(chatId ?? '').trim();
      if (!chat) throw fail('Укажите ID чата Telegram, куда бот уже добавлен', 'INVALID_CHAT_ID', 400);
      if (!conversationId) throw fail('Укажите беседу ChatX для моста', 'INVALID_CONVERSATION', 400);

      // Токен подтверждают настоящим вызовом, а не проверкой формата
      // строки: неверный, но правдоподобный токен иначе всплывает
      // только на первом реальном сообщении, когда чинить уже поздно.
      const me = await api(token, 'getMe');
      const webhookSecret = randomBytes(24).toString('hex');
      const webhookUrl = `${publicBaseUrl}/api/v1/integrations/telegram/webhook/${webhookSecret}`;
      await api(token, 'setWebhook', { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ['message'] });

      try {
        const { rows } = await pool.query(
          `INSERT INTO telegram_bridges(organization_id,workspace_id,conversation_id,bot_token_sealed,bot_username,telegram_chat_id,webhook_secret,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLUMNS}`,
          [session.organizationId, session.workspaceId, conversationId, seal(key, token), me.username ?? 'bot', chat, webhookSecret, session.userId],
        );
        return view(rows[0]);
      } catch (error) {
        if (error?.code === '23505') {
          await api(token, 'deleteWebhook', {}).catch(() => {});
          throw fail('В этой беседе уже есть мост с Telegram', 'TELEGRAM_BRIDGE_EXISTS', 409);
        }
        throw error;
      }
    },

    async remove(session, id) {
      const { rows } = await pool.query(`SELECT bot_token_sealed FROM telegram_bridges WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id]);
      if (!rows[0]) throw fail('Мост не найден', 'TELEGRAM_BRIDGE_NOT_FOUND', 404);
      // Отвязка — лучшее старание: боту могли отозвать доступ раньше
      // нас, и вебхук у Telegram к тому моменту уже мёртв сам по себе.
      if (key) await api(open(key, rows[0].bot_token_sealed), 'deleteWebhook', {}).catch(() => {});
      await pool.query(`DELETE FROM telegram_bridges WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id]);
    },

    /**
     * Входящее сообщение из Telegram.
     *
     * `secretHeader` сверяется с сохранённым секретом ДО того, как
     * что-либо читается из тела запроса: чужой, узнавший URL вебхука,
     * не должен получить даже подтверждение, что мост существует.
     */
    async receiveUpdate(webhookSecret, secretHeader, update) {
      const { rows } = await pool.query(`SELECT * FROM telegram_bridges WHERE webhook_secret=$1 AND status='active'`, [webhookSecret]);
      const bridge = rows[0];
      const headerBuf = Buffer.from(String(secretHeader ?? ''));
      const secretBuf = Buffer.from(String(bridge?.webhook_secret ?? ''));
      const headerMatches = bridge && secretHeader && headerBuf.length === secretBuf.length && timingSafeEqual(headerBuf, secretBuf);
      if (!bridge || !headerMatches) {
        throw fail('Неизвестный или неактивный мост', 'TELEGRAM_BRIDGE_NOT_FOUND', 404);
      }
      const message = update?.message;
      const text = String(message?.text ?? '').trim();
      if (!text) return { ok: true, ignored: true };
      const session = { organizationId: bridge.organization_id, workspaceId: bridge.workspace_id, userId: bridge.created_by };
      const authorName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.from?.username || 'Telegram';
      await store.createExternalForward(session, bridge.conversation_id, {
        body: text,
        origin: { source: 'telegram', authorName, sentAt: new Date((message.date ?? Date.now() / 1000) * 1000).toISOString(), lineCount: 1 },
      });
      await pool.query(`UPDATE telegram_bridges SET last_activity_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`, [bridge.id]);
      return { ok: true };
    },

    /**
     * Исходящая доставка. Лучшее старание, а не гарантия: если Telegram
     * сейчас недоступен, беседа в ChatX не должна из-за этого
     * остановиться — сообщение уже легло в базу и видно коллегам,
     * ошибка лишь оседает в `last_error` моста.
     */
    async deliverOutbound(session, conversationId, message) {
      if (message.kind !== 'text' || !message.body || message.externalOrigin) return;
      const { rows } = await pool.query(`SELECT * FROM telegram_bridges WHERE workspace_id=$1 AND conversation_id=$2 AND status='active'`, [session.workspaceId, conversationId]);
      const bridge = rows[0];
      if (!bridge || !key) return;
      try {
        const token = open(key, bridge.bot_token_sealed);
        const author = session.displayName ?? session.email ?? 'ChatX';
        await api(token, 'sendMessage', { chat_id: bridge.telegram_chat_id, text: `${author}: ${message.body}` });
        await pool.query(`UPDATE telegram_bridges SET last_activity_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`, [bridge.id]);
      } catch (error) {
        await pool.query(`UPDATE telegram_bridges SET last_error=$2,updated_at=now() WHERE id=$1`, [bridge.id, String(error.message ?? error).slice(0, 500)]).catch(() => {});
      }
    },
  };
}
