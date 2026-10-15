import { avatarUrlSql } from '../media/avatar.js';
import { Permission, hasPermission } from '../rbac.js';
const PROFILE_FIELDS = ['displayName', 'title', 'department', 'phone', 'about', 'location', 'startedOn', 'timezone', 'statusText', 'birthDay', 'birthMonth', 'avatarFileId', 'workingDays', 'workdayStart', 'workdayEnd'];

const COLUMN = {
  displayName: 'display_name', title: 'title', department: 'department', phone: 'phone',
  about: 'about', location: 'location', startedOn: 'started_on', timezone: 'timezone', statusText: 'status_text',
  birthDay: 'birth_day', birthMonth: 'birth_month', avatarFileId: 'avatar_file_id',
  workingDays: 'working_days', workdayStart: 'workday_start', workdayEnd: 'workday_end',
};

// Audit rows are machine names; a person's page needs a sentence.
const ACTIVITY_LABEL = {
  'commitment.created': 'поставил(а) задачу',
  'commitment.transitioned': 'перевёл(а) задачу',
  'evidence.added': 'приложил(а) доказательство',
  'commitment.rescheduled': 'перенёс(ла) срок',
  'conversation.created': 'создал(а) беседу',
  'member.joined': 'присоединился(ась)',
  'invitation.issued': 'позвал(а) человека в компанию',
  'invitation.accepted': 'принял(а) приглашение и вышел(шла) на работу',
  'member.deactivated': 'проводил(а) сотрудника',
  'member.reactivated': 'вернул(а) сотрудника на работу',
  'password.reset.issued': 'выписал(а) ссылку для смены пароля',
  'password.reset.used': 'сменил(а) пароль по ссылке',
  'vault.created': 'добавил(а) пароль в сейф',
  'vault.updated': 'изменил(а) запись в сейфе',
  'vault.revealed': 'раскрыл(а) пароль из сейфа',
  'vault.deleted': 'удалил(а) запись из сейфа',
  'profile.updated': 'изменил(а) карточку сотрудника',
  'commitment.reassigned': 'передал(а) задачу другому',
  'conversation.ownership_claimed': 'принял(а) беседу, оставшуюся без владельца',
  'message.edited': 'поправил(а) своё сообщение',
  'invitation.revoked': 'отозвал(а) приглашение',
  'conversation.member_added': 'позвал(а) человека в беседу',
  'conversation.member_removed': 'вывел(а) человека из беседы',
  'org.unit.created': 'завёл(а) подразделение',
  'org.unit.renamed': 'переименовал(а) подразделение',
  'org.unit.deleted': 'распустил(а) подразделение',
  'org.unit.member_added': 'принял(а) человека в подразделение',
  'org.unit.member_removed': 'вывел(а) человека из подразделения',
  'org.unit.head_set': 'назначил(а) руководителя подразделения',
  'workspace.renamed': 'переименовал(а) компанию',
  'ownership.transferred': 'передал(а) владение компанией',
  'workspace.exported': 'выгрузил(а) архив пространства',
  'calendar.event_created': 'назначил(а) встречу',
  'calendar.event_cancelled': 'отменил(а) встречу',
  'meeting.processing_started': 'отправил(а) встречу на расшифровку',
  'meeting.notes_published': 'опубликовал(а) протокол встречи',
};

/**
 * Что показывать на карточке человека, а что — только в журнале.
 *
 * Лента задумана как «чем человек занимался», а не как выписка из
 * журнала действий. Пока она отдавала всё подряд, по ней читались чужие
 * пароли из сейфа, смены паролей и входы в систему — причём кому угодно,
 * включая подрядчика-гостя, которому и карточку-то не открывают.
 *
 * Безопасность и хозяйские дела остаются журналу: у него своё право и
 * свой экран. Сюда идёт только работа.
 */
const PRIVATE_TO_JOURNAL = new Set([
  'auth.login.succeeded', 'auth.login.failed', 'auth.logout',
  'auth.second_factor.enabled', 'auth.second_factor.disabled', 'auth.second_factor.failed',
  'password.changed', 'password.reset.issued', 'password.reset.requested', 'password.reset.used',
  'session.revoked', 'session.revoked.others',
  'vault.created', 'vault.updated', 'vault.revealed', 'vault.deleted',
  'workspace.exported', 'ownership.transferred',
]);

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export function createPeopleRepository(pool, org = null) {
  if (!pool) return null;

  const profileRow = async (session, userId) => {
    const { rows } = await pool.query(
      `SELECT m.user_id "userId", m.role "workspaceRole", m.created_at "joinedAt", u.email, u.disabled_at "disabledAt",
              p.display_name "displayName", p.title, p.department, p.phone, p.about, p.location,
              -- Дата выхода на работу — именно дата, без часа. Драйвер
              -- превращал её в момент по местному поясу сервера, и в
              -- ответе 1 марта становилось 29 февраля 21:00, а карточка
              -- печатала первые десять знаков — то есть день раньше.
              to_char(p.started_on,'YYYY-MM-DD') "startedOn", p.timezone, p.locale, p.status_text "statusText",
              p.working_days "workingDays", to_char(p.workday_start,'HH24:MI') "workdayStart", to_char(p.workday_end,'HH24:MI') "workdayEnd",
              ${avatarUrlSql('p.avatar_file_id')} "avatarUrl",
              p.birth_day "birthDay", p.birth_month "birthMonth", m.access_until "accessUntil",
              pr.state "presenceState", pr.last_seen_at "lastSeenAt",
              -- Объявленная доступность гаснет сама: «на обеде до 14:00»
              -- не должно висеть в карточке до вечера.
              CASE WHEN pr.back_at IS NOT NULL AND pr.back_at<=now() THEN 'available'
                   ELSE COALESCE(pr.availability,'available') END "availability",
              CASE WHEN pr.back_at IS NOT NULL AND pr.back_at<=now() THEN NULL ELSE pr.back_at END "backAt"
       FROM memberships m
       JOIN users u ON u.id=m.user_id
       LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
       LEFT JOIN user_presence pr ON pr.workspace_id=m.workspace_id AND pr.user_id=m.user_id
       WHERE m.workspace_id=$1 AND m.user_id=$2`,
      [session.workspaceId, userId],
    );
    return rows[0] ?? null;
  };

  return {
    /**
     * One person's card: who they are, where they sit in the company, what
     * they are accountable for and what they have been doing.
     *
     * A guest may only look up somebody they share a room with; the staff
     * directory is not a customer-facing asset.
     */
    async getPerson(session, userId) {
      if (session.role === 'guest') {
        const { rowCount } = await pool.query(
          `SELECT 1 FROM conversation_members a JOIN conversation_members b
             ON b.conversation_id=a.conversation_id AND b.workspace_id=a.workspace_id
           WHERE a.workspace_id=$1 AND a.user_id=$2 AND b.user_id=$3 LIMIT 1`,
          [session.workspaceId, session.userId, userId],
        );
        if (!rowCount && userId !== session.userId) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);
      }
      const profile = await profileRow(session, userId);
      if (!profile) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);

      const [units, chain, work] = await Promise.all([
        org ? org.unitsOf(session, userId) : [],
        org ? org.reportingChain(session, userId) : [],
        pool.query(
          `SELECT status, count(*)::int count FROM commitments
           WHERE workspace_id=$1 AND owner_id=$2 GROUP BY status`,
          [session.workspaceId, userId],
        ),
      ]);

      const byStatus = Object.fromEntries(work.rows.map((r) => [r.status, r.count]));
      const open = Object.entries(byStatus)
        .filter(([status]) => !['closed', 'cancelled', 'rejected'].includes(status))
        .reduce((sum, [, count]) => sum + count, 0);

      return {
        ...profile,
        isSelf: userId === session.userId,
        units,
        reportsTo: chain.filter((c) => c.headUserId && c.headUserId !== userId).map((c) => ({ unit: c.unitName, headUserId: c.headUserId, headName: c.headName })),
        chain,
        workload: { byStatus, open, total: Object.values(byStatus).reduce((a, b) => a + b, 0) },
      };
    },

    /**
     * A person edits their own card. A workspace admin may edit anyone's,
     * because job titles and departments are company facts, not self-declared
     * ones — but nobody silently edits somebody else without it being an
     * audited act.
     */
    /**
     * Срок доступа человека.
     *
     * Проверяется не сборщиком, а на каждом обращении к серверу: сборщик
     * может не запуститься, а этот запрос выполняется всегда. Поэтому
     * здесь только запись, и она действует немедленно.
     */
    async setAccessUntil(session, userId, accessUntil) {
      if (userId === session.userId) {
        throw fail('Себе срок доступа не ставят', 'ACCESS_SELF_FORBIDDEN', 409);
      }
      const { rows } = await pool.query(
        `UPDATE memberships SET access_until=$3
          WHERE workspace_id=$1 AND user_id=$2 AND role<>'owner'
          RETURNING user_id, role, access_until "accessUntil"`,
        [session.workspaceId, userId, accessUntil]);
      // Владельцу срок не ставится: компания не должна однажды остаться
      // без того, кто ею распоряжается.
      if (!rows[0]) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);
      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'membership',$3,'access.limited',$4,$5)`,
        [session.organizationId, session.workspaceId, userId, session.userId, { accessUntil }]);
      return { userId: rows[0].user_id, accessUntil: rows[0].accessUntil };
    },

    async updateProfile(session, userId, patch, { canManageMembers = false } = {}) {
      if (userId !== session.userId && !canManageMembers) throw fail('You may only edit your own profile', 'PROFILE_FORBIDDEN', 403);
      const fields = PROFILE_FIELDS.filter((f) => patch[f] !== undefined);
      if (!fields.length) throw fail('Nothing to update', 'EMPTY_PATCH');
      if (patch.displayName !== undefined && !String(patch.displayName).trim()) throw fail('A display name is required', 'INVALID_DISPLAY_NAME');

      const setters = fields.map((f, i) => `${COLUMN[f]}=$${i + 3}`).join(',');
      const values = fields.map((f) => (typeof patch[f] === 'string' ? patch[f].trim() || null : patch[f]));
      const { rows } = await pool.query(
        `UPDATE workspace_profiles SET ${setters}, updated_at=now() WHERE workspace_id=$1 AND user_id=$2 RETURNING user_id`,
        [session.workspaceId, userId, ...values],
      );
      if (!rows[0]) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);

      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'profile',$3,'profile.updated',$4,$5)`,
        [session.organizationId, session.workspaceId, userId, session.userId, { fields, onBehalfOf: userId !== session.userId }],
      );
      return this.getPerson(session, userId);
    },

    /**
     * Увольнение.
     *
     * До сих пор ушедший сотрудник сохранял доступ навсегда: механизм в
     * схеме был (`users.disabled_at` проверяется и при входе, и при каждом
     * запросе), а выставить признак было нечем. Это и есть та самая
     * незакрытая дверь, о которой в компании вспоминают последней.
     *
     * Кто провожает: тот, кто зовёт, — по праву `member.invite`, и только
     * человека ниже себя по лестнице. Владельца не увольняет никто, себя —
     * тоже: компанию нельзя оставить без хозяина случайным нажатием.
     *
     * Что происходит: признак выставляется, все живые сессии обрываются в
     * той же транзакции, запись уходит в журнал. Данные остаются на месте —
     * задачи, сообщения и доказательства ушедшего никуда не деваются, иначе
     * увольнение стирало бы историю работы компании.
     */
    async setActive(session, userId, active, { rank = () => 0, seatState = null } = {}) {
      if (userId === session.userId) throw fail('Себя уволить нельзя', 'CANNOT_DEACTIVATE_SELF', 400);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Роль читается под блокировкой и уже внутри транзакции. Раньше она
        // читалась до неё — и человек, которому в этот же миг передавали
        // компанию, успевал стать владельцем и уволенным разом: войти он не
        // мог, а вернуть компанию было уже некому.
        const { rows: member } = await client.query(
          `SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id
            WHERE m.workspace_id=$1 AND m.user_id=$2 FOR UPDATE OF m,u`,
          [session.workspaceId, userId],
        );
        if (!member[0]) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);
        if (member[0].role === 'owner') throw fail('Владельца компании уволить нельзя', 'CANNOT_DEACTIVATE_OWNER', 403);
        // Возвращение занимает место так же, как приглашение: иначе увольнение и новый найм обходили предел мест.
        if (active && member[0].role !== 'guest' && seatState) {
          const { rows: gone } = await client.query('SELECT disabled_at FROM users WHERE id=$1', [userId]);
          if (gone[0]?.disabled_at) {
            // Два возвращения подряд видели одно свободное место: очередь выстраиваем замком на организации.
            await client.query('SELECT 1 FROM organizations WHERE id=$1 FOR UPDATE', [session.organizationId]);
            const seats = await seatState();
            if (seats?.full) {
              throw fail(`Свободных мест нет: занято ${seats.used} из ${seats.limit}. Добавьте мест, прежде чем возвращать сотрудника.`, 'NO_FREE_SEATS', 409);
            }
          }
        }
        if (rank(member[0].role) >= rank(session.role)) {
          throw fail('Увольнять можно только тех, кто ниже вас по лестнице', 'ROLE_TOO_HIGH', 403);
        }
        const { rows: who } = await client.query('SELECT email FROM users WHERE id=$1', [userId]);
        const profile = { email: who[0]?.email ?? null, workspaceRole: member[0].role };
        const { rows } = await client.query(
          `UPDATE users SET disabled_at=$2 WHERE id=$1 RETURNING id, disabled_at "disabledAt"`,
          [userId, active ? null : new Date().toISOString()],
        );
        if (!rows[0]) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);
        if (!active) {
          await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
          // Ключи программного доступа не оживают при возвращении: новый ключ человек выпустит сам.
          await client.query('UPDATE api_keys SET revoked_at=now() WHERE user_id=$1 AND workspace_id=$2 AND revoked_at IS NULL', [userId, session.workspaceId]);
          // Хвосты увольнения: подписки на события, заведённые им, продолжали слать данные
          // компании наружу, а подразделение оставалось с «руководителем», который не войдёт.
          await client.query('UPDATE webhook_endpoints SET enabled=false, updated_at=now() WHERE workspace_id=$1 AND created_by=$2', [session.workspaceId, userId]);
          await client.query('UPDATE org_units SET head_user_id=NULL WHERE workspace_id=$1 AND head_user_id=$2', [session.workspaceId, userId]);
          // Открытые задачи сами не перейдут к другому: говорим тому, кто увольняет, что их надо передать.
          const { rows: [left] } = await client.query(
            `SELECT count(*)::int n FROM commitments
              WHERE workspace_id=$1 AND owner_id=$2 AND status NOT IN ('closed','cancelled','rejected','accepted_result')`,
            [session.workspaceId, userId]);
          if (left?.n > 0) {
            await client.query(
              `INSERT INTO notifications(organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,url,priority)
               VALUES($1,$2,$3,gen_random_uuid(),$4,'task.updated','У ушедшего сотрудника остались открытые задачи',$5,'/#/tasks','high')
               ON CONFLICT (workspace_id,dedupe_key) DO NOTHING`,
              [session.organizationId, session.workspaceId, session.userId, `offboard:${userId}:${Date.now()}`,
               `${profile.email ?? 'Сотрудник'}: открытых задач — ${left.n}. Передайте их другим исполнителям.`]);
          }
        }
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'membership',$3,$4,$5,$6)`,
          [session.organizationId, session.workspaceId, userId,
           active ? 'member.reactivated' : 'member.deactivated', session.userId,
           { email: profile.email, role: profile.workspaceRole }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return this.getPerson(session, userId);
    },

    /**
     * Повысить или понизить сотрудника.
     *
     * Сменить роль было нечем: ни маршрута, ни кнопки. Повысить человека
     * до руководителя можно было только одним способом — пригласить его
     * заново с нужной ролью, потеряв всё, что за ним числится. В живой
     * компании роли меняются чаще, чем люди.
     *
     * Лестница та же, что у увольнения: трогать можно тех, кто ниже
     * тебя, и ставить роль ниже своей. Владение передаётся отдельно —
     * это не смена роли, а смена хозяина.
     *
     * Место в компании занимает сотрудник, а не гость: превращение
     * гостя в сотрудника проверяется по счёту мест, обратное — освобождает.
     */
    async setRole(session, userId, role, { rank = () => 0, seatState = null } = {}) {
      if (userId === session.userId) throw fail('Свою роль не меняют', 'CANNOT_CHANGE_OWN_ROLE', 400);
      if (!['guest', 'member', 'manager', 'admin'].includes(role)) {
        throw fail('Роль бывает guest, member, manager или admin. Владение передаётся отдельно.', 'INVALID_ROLE', 400);
      }
      if (rank(role) >= rank(session.role)) {
        throw fail('Назначить можно только роль ниже своей', 'ROLE_TOO_HIGH', 403);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: member } = await client.query(
          `SELECT m.role, u.disabled_at FROM memberships m JOIN users u ON u.id=m.user_id
            WHERE m.workspace_id=$1 AND m.user_id=$2 FOR UPDATE OF m,u`,
          [session.workspaceId, userId],
        );
        if (!member[0]) throw fail('Человек не найден', 'PERSON_NOT_FOUND', 404);
        const was = member[0].role;
        if (was === 'owner') throw fail('Владельца компании роль не меняет — компания передаётся отдельно', 'CANNOT_CHANGE_OWNER', 403);
        if (rank(was) >= rank(session.role)) throw fail('Менять роль можно только тем, кто ниже вас по лестнице', 'ROLE_TOO_HIGH', 403);
        if (member[0].disabled_at) throw fail('Уволенному роль не меняют: сначала верните его на работу', 'PERSON_INACTIVE', 409);
        if (was === role) throw fail('Эта роль у человека уже есть', 'ROLE_UNCHANGED', 409);

        // Гость мест не занимает; сотрудник занимает. Повышение гостя —
        // это наём, и упираться в предел мест оно должно так же.
        if (was === 'guest' && role !== 'guest' && seatState) {
          const seats = await seatState();
          if (seats?.full) {
            throw fail(`Свободных мест нет: занято ${seats.used} из ${seats.limit}. Добавьте мест или отзовите лишние приглашения.`,
              'NO_FREE_SEATS', 409);
          }
        }

        await client.query('UPDATE memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2', [session.workspaceId, userId, role]);
        // Роль живёт и в сеансе: без отзыва человек доработал бы день с
        // прежними правами, а на экране у него были бы новые кнопки.
        await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'membership',$3,'member.role_changed',$4,$5)`,
          [session.organizationId, session.workspaceId, userId, session.userId, { from: was, to: role }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return this.getPerson(session, userId);
    },

    /**
     * The people this person actually deals with, which is not the same list
     * as the staff directory.
     *
     * Two sources, because they answer two different questions. «Кто уже
     * пишет мне» comes from shared rooms. «Кто со мной в отделе» comes from
     * the chart an administrator filled in — those colleagues may not have
     * written a line yet and still belong on the list.
     *
     * An open channel is not a relationship: everybody is in it by visibility
     * alone, so it would make the whole company look like your contacts. Only
     * rooms with an explicit membership row count.
     */
    async contacts(session) {
      const [talking, unitRows] = await Promise.all([
        pool.query(
          // Соединение с сообщениями стояло внутри самосоединения по
          // участникам: каждая пара «я ↔ коллега» умножалась на каждое
          // сообщение в общей беседе. Двести коллег, сорок бесед и сто
          // пятьдесят тысяч сообщений давали двадцать три миллиона
          // промежуточных строк ради двухсот в ответе — экран «Контакты»
          // открывался шестнадцать секунд и с каждым сообщением дольше.
          //
          // Время последнего сообщения — свойство беседы, а не пары людей,
          // поэтому считается отдельно, по одному разу на беседу.
          `WITH mine AS (
             SELECT a.conversation_id FROM conversation_members a
              WHERE a.workspace_id=$1 AND a.user_id=$2
           ), conv AS (
             SELECT c.id, c.kind, c.title,
                    (SELECT max(m.created_at) FROM messages m
                      WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id
                        AND m.deleted_at IS NULL) last_at
               FROM conversations c
               JOIN mine ON mine.conversation_id=c.id
              WHERE c.workspace_id=$1 AND c.archived_at IS NULL
           )
           SELECT b.user_id "userId", count(DISTINCT conv.id)::int "sharedCount",
                  max(conv.title) FILTER (WHERE conv.kind='direct') "directTitle",
                  bool_or(conv.kind='direct') "hasDirect",
                  max(conv.last_at) "lastMessageAt"
             FROM conv
             JOIN conversation_members b
               ON b.workspace_id=$1 AND b.conversation_id=conv.id AND b.user_id<>$2
            GROUP BY b.user_id`,
          [session.workspaceId, session.userId],
        ),
        // A guest has no place in the chart, so they get no unit groups.
        session.role === 'guest'
          ? Promise.resolve({ rows: [] })
          : pool.query(
              `SELECT u.id "unitId", u.name "unitName", u.kind "unitKind", u.depth,
                      om.user_id "userId", om.role "unitRole"
                 FROM org_unit_members mine
                 JOIN org_units u ON u.workspace_id=mine.workspace_id AND u.id=mine.unit_id
                 JOIN org_unit_members om ON om.workspace_id=u.workspace_id AND om.unit_id=u.id
                WHERE mine.workspace_id=$1 AND mine.user_id=$2
                ORDER BY u.depth, u.name, om.role`,
              [session.workspaceId, session.userId],
            ),
      ]);

      const wanted = new Set([...talking.rows, ...unitRows.rows].map((r) => r.userId));
      wanted.delete(session.userId);
      const people = new Map();
      if (wanted.size) {
        const { rows } = await pool.query(
          `SELECT m.user_id "userId", m.role "workspaceRole", u.email,
                  p.display_name "displayName", p.title, p.department,
                  pr.state "presenceState"
             FROM memberships m
             JOIN users u ON u.id=m.user_id
             LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
             LEFT JOIN user_presence pr ON pr.workspace_id=m.workspace_id AND pr.user_id=m.user_id
            WHERE m.workspace_id=$1 AND m.user_id = ANY($2::uuid[]) AND u.disabled_at IS NULL`,
          [session.workspaceId, [...wanted]],
        );
        for (const row of rows) people.set(row.userId, row);
      }

      const talkingTo = talking.rows
        .filter((row) => row.userId !== session.userId && people.has(row.userId))
        .map((row) => ({
          ...people.get(row.userId),
          sharedCount: row.sharedCount,
          hasDirect: row.hasDirect,
          lastMessageAt: row.lastMessageAt ?? null,
        }))
        .sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')) || b.sharedCount - a.sharedCount);

      const units = [];
      for (const row of unitRows.rows) {
        if (row.userId === session.userId || !people.has(row.userId)) continue;
        let unit = units.find((u) => u.unitId === row.unitId);
        if (!unit) { unit = { unitId: row.unitId, name: row.unitName, kind: row.unitKind, depth: row.depth, members: [] }; units.push(unit); }
        unit.members.push({ ...people.get(row.userId), unitRole: row.unitRole });
      }

      return { talkingTo, units };
    },

    /**
     * What a person actually did, newest first, straight from the append-only
     * audit log. Nothing is written here to build the feed — the events were
     * already being recorded, they simply had no reader.
     */
    async activity(session, userId, { limit = 40, before = null } = {}) {
      // Лента — часть карточки человека, и закрыта ровно так же: если
      // карточку смотрящему не открывают, ленту тем более. Проверки не
      // было вовсе, и гость читал по ней состав закрытых каналов,
      // адреса приглашённых и записи сейфа.
      await this.getPerson(session, userId);
      const journalReader = hasPermission(session.role, Permission.AUDIT_READ);
      const { rows } = await pool.query(
        `SELECT a.sequence, a.event_type "eventType", a.aggregate_type "aggregateType", a.aggregate_id "aggregateId",
                a.payload, a.created_at "createdAt",
                CASE WHEN a.aggregate_type='commitment' THEN (SELECT title FROM commitments c WHERE c.workspace_id=a.workspace_id AND c.id=a.aggregate_id
                  -- Название чужой задачи, которой смотрящий не видит, в ленте не показываем: сама задача для него 404.
                  AND ($5::boolean OR c.owner_id=$6 OR c.requester_id=$6 OR c.acceptor_id=$6
                       OR EXISTS(SELECT 1 FROM task_collaborators tc WHERE tc.workspace_id=c.workspace_id AND tc.commitment_id=c.id AND tc.user_id=$6))) END subject
         FROM audit_events a
         WHERE a.workspace_id=$1 AND a.actor_id=$2 AND ($3::bigint IS NULL OR a.sequence < $3)
         ORDER BY a.sequence DESC LIMIT $4`,
        [session.workspaceId, userId, before, Math.min(Number(limit) || 40, 100), hasPermission(session.role, Permission.TASK_MANAGE_TEAM), session.userId],
      );
      return rows
        .filter((row) => !PRIVATE_TO_JOURNAL.has(row.eventType))
        .map((row) => ({
          ...row,
          sequence: Number(row.sequence),
          // Содержимое события — это внутренности журнала: состав канала,
          // адреса, роли. Человеку без права на журнал остаётся то, что
          // карточка и обещает: кто, что и когда.
          payload: journalReader ? row.payload : null,
          // Если события в словаре нет, показывать его машинное имя —
          // значит печатать «auth.login.succeeded» там, где человек ждёт
          // русскую фразу. Лучше честное «сделал(а) что-то в системе»,
          // чем строка из лога.
          label: ACTIVITY_LABEL[row.eventType] ?? 'отметился(ась) в работе',
        }));
    },
  };
}
