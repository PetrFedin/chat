import { createHash } from 'node:crypto';
import { digestMail } from '../mail/templates.js';

/**
 * Сводка «что я пропустил» письмом.
 *
 * Сводка уже была — но только внутри продукта: чтобы её увидеть, надо
 * туда зайти. Человек, который два дня провёл на объекте, туда как раз
 * и не заходил и узнаёт о прошедшем сроке тогда же, когда о нём
 * узнаёт заказчик.
 *
 * Раз в день и по своей воле: по умолчанию выключено. Рабочее
 * пространство, которое начинает писать письма само, — это то, от чего
 * потом ставят фильтр в почте, и вместе с рассылкой в папку уходит всё
 * остальное, включая приглашения и сброс пароля.
 */

const DEFAULT_TICK_MS = 5 * 60 * 1000;

/**
 * Один и тот же день — один и тот же ключ.
 *
 * Столбец под ключ в очереди писем — uuid, поэтому «кто и когда»
 * сворачивается в него хешем. Отметку об отправке можно не успеть
 * записать, и тогда от второго письма спасает только уникальность
 * этого ключа.
 */
const digestKey = (userId, date) => {
  const hex = createHash('sha256').update(`digest:${userId}:${date}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/** Который час и какое число у человека в его поясе. */
export function localNow(at, timezone) {
  const zone = timezone || 'UTC';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    }).formatToParts(at);
  } catch {
    // Пояс в карточке может быть каким угодно текстом: человек его
    // вписывал руками. Непонятный пояс — это UTC, а не отказ слать.
    return localNow(at, 'UTC');
  }
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

export function createDigestMailer({ pool, digest, mail, env = process.env, now = () => new Date() }) {
  if (!pool || !digest || !mail) return null;
  const baseUrl = (env.PUBLIC_URL || '').replace(/\/+$/, '');

  const runOnce = async () => {
    const at = now();
    const { rows } = await pool.query(
      `SELECT n.organization_id "organizationId", n.workspace_id "workspaceId", n.user_id "userId",
              n.digest_hour "digestHour", n.digest_sent_on "sentOn",
              COALESCE(p.timezone,'UTC') timezone, COALESCE(p.display_name, u.email) "displayName",
              u.email, w.name "workspaceName", m.role
         FROM notification_preferences n
         JOIN memberships m ON m.workspace_id=n.workspace_id AND m.user_id=n.user_id
         JOIN users u ON u.id=n.user_id
         JOIN workspaces w ON w.id=n.workspace_id
         LEFT JOIN workspace_profiles p ON p.workspace_id=n.workspace_id AND p.user_id=n.user_id
        WHERE n.daily_digest
          AND u.disabled_at IS NULL
          AND (m.access_until IS NULL OR m.access_until > now())`,
    );

    let sent = 0;
    for (const row of rows) {
      const local = localNow(at, row.timezone);
      if (local.hour < row.digestHour) continue;
      // Дата, а не отметка времени: письмо в день, и сравнивать надо
      // именно дни — иначе повторный проход шлёт второе письмо.
      if (row.sentOn && String(row.sentOn).slice(0, 10) >= local.date) continue;

      // Сводку собираем от имени самого человека: она обязана быть
      // ровно той, что он увидит в продукте, включая границы видимости.
      const session = {
        organizationId: row.organizationId, workspaceId: row.workspaceId,
        userId: row.userId, role: row.role, email: row.email, displayName: row.displayName,
      };
      let built;
      try { built = await digest.build(session); }
      catch { continue; }

      const letter = digestMail({
        workspaceName: row.workspaceName,
        displayName: row.displayName,
        url: baseUrl || '/',
        digest: built,
      });
      await mail.enqueue({
        organizationId: row.organizationId, workspaceId: row.workspaceId,
        kind: 'digest', to: row.email, actorId: row.userId,
        subject: letter.subject, text: letter.text, html: letter.html,
        // Один и тот же день — одно письмо, даже если рассылка прошла
        // дважды: отметку в предпочтениях можно не успеть записать.
        sourceId: digestKey(row.userId, local.date),
      });
      await pool.query(
        'UPDATE notification_preferences SET digest_sent_on=$3 WHERE workspace_id=$1 AND user_id=$2',
        [row.workspaceId, row.userId, local.date],
      );
      sent += 1;
    }
    return { considered: rows.length, sent };
  };

  let timer = null;
  return {
    runOnce,
    start(intervalMs = Number(env.DIGEST_TICK_MS ?? DEFAULT_TICK_MS)) {
      if (timer) return;
      timer = setInterval(() => { runOnce().catch(() => {}); }, intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
}
