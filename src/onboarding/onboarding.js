import { isGuest } from '../persistence/visibility.js';

/**
 * Первые шаги нового человека.
 *
 * В первый день сотрудник видел боковую панель с чужими каналами, экран
 * «Сегодня» с нулями и ничего, что объяснило бы, куда смотреть. С
 * устройством продукта — задача как обещание одного человека другому —
 * он знакомился единственным способом: спрашивал коллегу.
 *
 * Шаги не отмечаются нажатием: каждый выводится из настоящего состояния.
 * Мастер настройки, где галочки ставит сам пользователь, врёт с первого
 * экрана — человек «прошёл онбординг», не сделав ничего.
 */

/** Сколько дней человек считается новым, если подсказку не закрывал. */
const NEW_FOR_DAYS = 14;

export function createOnboarding(pool) {
  if (!pool) return null;

  return {
    /**
     * Состояние первых шагов. `null` — показывать нечего: человек здесь
     * давно, всё сделал или закрыл подсказку сам.
     */
    async state(session) {
      // Гость пришёл в чужое пространство на один проект. Рассказывать
      // ему, как устроена работа компании, незачем.
      if (isGuest(session)) return null;
      const { rows } = await pool.query(
        `SELECT
           m.created_at "joinedAt",
           p.onboarding_dismissed_at "dismissedAt",
           NULLIF(btrim(COALESCE(p.display_name,'')),'') "displayName",
           NULLIF(btrim(COALESCE(p.title,'')),'') "title",
           -- Не «состоит в канале», а «открывал хоть один».
           --
           -- Членство в открытых каналах компании выдаётся само в момент
           -- появления человека, поэтому шаг «зайдите в каналы» был бы
           -- отмечен ещё до того, как новичок увидел первый экран. А вот
           -- отметка о прочтении появляется, только когда он туда зашёл.
           (SELECT count(*)::int FROM conversation_members cm
             JOIN conversations c ON c.workspace_id=cm.workspace_id AND c.id=cm.conversation_id
            WHERE cm.workspace_id=m.workspace_id AND cm.user_id=m.user_id
              AND c.kind='channel' AND c.archived_at IS NULL
              AND cm.last_read_at IS NOT NULL) "channelsOpened",
           (SELECT count(*)::int FROM messages msg
             WHERE msg.workspace_id=m.workspace_id AND msg.author_id=m.user_id
               AND msg.deleted_at IS NULL) "messages",
           (SELECT count(*)::int FROM commitments c
             WHERE c.workspace_id=m.workspace_id
               AND (c.owner_id=m.user_id OR c.requester_id=m.user_id OR c.acceptor_id=m.user_id)) "commitments",
           (SELECT count(*)::int FROM commitments c
             WHERE c.workspace_id=m.workspace_id AND c.owner_id=m.user_id AND c.status='proposed') "proposed",
           (SELECT count(*)::int FROM conversations c
             WHERE c.workspace_id=m.workspace_id AND c.kind='channel'
               AND c.archived_at IS NULL AND c.visibility IN('workspace','organization')) "openChannels",
           (SELECT count(*)::int FROM memberships x
             WHERE x.workspace_id=m.workspace_id AND x.role <> 'guest') "colleagues"
         FROM memberships m
         LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
        WHERE m.workspace_id=$1 AND m.user_id=$2`,
        [session.workspaceId, session.userId],
      );
      const row = rows[0];
      if (!row || row.dismissedAt) return null;

      const steps = [
        {
          id: 'profile',
          title: 'Расскажите, чем вы занимаетесь',
          // Должность — не украшение карточки: по ней человека находят,
          // когда ищут, кого спросить про смету.
          hint: 'Имя и должность видны коллегам в поиске и в списке людей.',
          action: 'profile',
          done: Boolean(row.displayName && row.title),
        },
        {
          id: 'channels',
          title: 'Осмотритесь в каналах',
          hint: row.openChannels > 1
            ? `В компании ${row.openChannels} ${plural(row.openChannels, 'открытый канал', 'открытых канала', 'открытых каналов')} — в каталоге видно, зачем нужен каждый и где сейчас живо.`
            : 'Открытые каналы компании собраны в каталоге.',
          action: 'catalogue',
          done: Number(row.channelsOpened) > 0,
        },
        {
          id: 'hello',
          title: 'Напишите первое сообщение',
          hint: 'Проще всего — представиться там, где вы будете работать.',
          action: 'chats',
          done: Number(row.messages) > 0,
        },
        {
          id: 'commitments',
          title: 'Здесь задача — это обещание',
          hint: Number(row.proposed) > 0
            ? `Вас уже о чём-то попросили: ${row.proposed} ${plural(row.proposed, 'обязательство ждёт', 'обязательства ждут', 'обязательств ждут')} вашего ответа. Пока вы не ответили, обязательства нет — это и есть разница с обычным списком дел.`
            : 'У каждой задачи есть тот, кто просит, и тот, кто обещает. Пока человек не согласился, обязательства нет.',
          action: 'tasks',
          done: Number(row.commitments) > 0,
        },
      ];

      const left = steps.filter((step) => !step.done).length;
      const joinedAt = new Date(row.joinedAt);
      const fresh = Date.now() - joinedAt.getTime() < NEW_FOR_DAYS * 86400000;
      // Всё сделано — подсказке здесь больше нечего делать, и закрывать
      // её вручную человек не должен.
      if (!left) return null;
      // Через две недели подсказка уходит сама: кто не заполнил
      // должность за это время, не заполнит её и по напоминанию, а
      // карточка «первые шаги» на третьей неделе выглядит упрёком.
      if (!fresh) return null;

      return {
        joinedAt: row.joinedAt,
        colleagues: Number(row.colleagues),
        openChannels: Number(row.openChannels),
        steps,
        left,
      };
    },

    /** Закрыть подсказку насовсем. */
    async dismiss(session) {
      // Только UPDATE: карточка профиля заводится в момент появления
      // человека в пространстве, и вставлять её здесь значило бы
      // придумывать обязательное имя за того, у кого его почему-то нет.
      const { rowCount } = await pool.query(
        'UPDATE workspace_profiles SET onboarding_dismissed_at=now() WHERE workspace_id=$1 AND user_id=$2',
        [session.workspaceId, session.userId],
      );
      return { dismissed: rowCount > 0 };
    },
  };
}

/** Русское склонение — то же правило, что в интерфейсе. */
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
