import { cleanText } from '../http/helpers.js';
import { normalizePageDocument, plainTextPageDocument } from './page-document.js';
import { requireAccessibleCall } from '../meeting/access.js';
import { createWikiPageAccess } from './page-access.js';

/**
 * Вики: дерево совместных страниц компании.
 *
 * В отличие от базы знаний (knowledge-repository.js), где пишет
 * куратор, а читает компания, здесь читают и пишут одни и те же люди —
 * любой сотрудник. Правка не стирает прежний текст: снимок «как было
 * до этой правки» уходит в `wiki_page_versions`, а `version` на самой
 * странице — то же optimistic concurrency, что у задач: сохранение
 * поверх чужой правки, которую вы не видели, отклоняется честным 409,
 * а не тихой перезаписью.
 *
 * Только PostgreSQL, как и остальные недавние модули (база знаний,
 * сейф паролей, Telegram-мост): состояние, которому нельзя разойтись
 * между процессами памяти, не эмулируется — оно либо есть в базе, либо
 * модуль честно отвечает 503.
 */

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

const readTitle = (value) => cleanText(value, 200, 'Заголовок');
const readContent = (value) => {
  const content = String(value ?? '');
  if (content.length > 100000) throw fail('Текст страницы длиннее 100000 символов', 'INVALID_TEXT', 400);
  return content;
};

const COLUMNS = `id,parent_id "parentId",title,content,document,version,visibility,access_owner_id "accessOwnerId",created_by "createdBy",updated_by "updatedBy",
  created_at "createdAt",updated_at "updatedAt",archived_at "archivedAt"`;
const SUMMARY_COLUMNS = `id,parent_id "parentId",title,version,visibility,created_by "createdBy",updated_by "updatedBy",
  created_at "createdAt",updated_at "updatedAt"`;

const view = (row) => ({
  id: row.id, parentId: row.parentId ?? null, title: row.title, content: row.content, document: row.document??plainTextPageDocument(row.content), hasStructuredDocument: row.document !== null && row.document !== undefined, version: row.version,
  visibility: row.visibility ?? 'workspace', createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  archivedAt: row.archivedAt ?? null,
});
const summaryView = (row) => ({
  id: row.id, parentId: row.parentId ?? null, title: row.title, version: row.version,
  visibility: row.visibility ?? 'workspace', createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
});

export function createWikiRepository(pool, projects = null, store = null, meeting = null, calendar = null, calls = null, features = null) {
  if (!pool) {
    const stop = () => { throw fail('Вики работает только с базой данных PostgreSQL', 'WIKI_UNAVAILABLE', 503); };
    return { enabled: false, list: stop, get: stop, create: stop, update: stop, archive: stop, history: stop, search: stop, linkProject: stop, unlinkProject: stop, linkTask: stop, unlinkTask: stop, linkChannel: stop, unlinkChannel: stop, linkDecision: stop, unlinkDecision: stop, pagesForDecision: stop, linkCalendarMeeting: stop, unlinkCalendarMeeting: stop, linkCall: stop, unlinkCall: stop, getAccess: stop, setVisibility: stop, grantAccess: stop, revokeAccess: stop, transferAccessOwner: stop, recoverAccessOwner: stop, listAccessRecovery: stop };
  }

  const featureOn = async (session, id) => !features?.isEnabled || await features.isEnabled(session.workspaceId, id);

  const access = createWikiPageAccess(pool);

  const activeEmployee = async (db, session, userId) => {
    const { rows } = await db.query(
      `SELECT m.user_id "userId",m.role,COALESCE(p.display_name,p.email,m.user_id::text) "displayName"
         FROM memberships m
         JOIN users u ON u.id=m.user_id
         LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
        WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role<>'guest'
          AND u.disabled_at IS NULL
          AND (m.access_until IS NULL OR m.access_until>now())`,
      [session.workspaceId,userId],
    );
    return rows[0]??null;
  };

  const ensurePage = async (session, id, db = pool) => access.assertView(session, id, db);
  const ensureEditablePage = async (session, id, db = pool) => access.assertEdit(session, id, db);

  // Check Page edit admission before resolving target metadata, then again
  // under a row lock. Archive, ACL changes and relation admission therefore
  // serialize on the same Page row and hidden Pages never trigger target lookups.
  const ensureLinkablePage = async (session, id, client = null) => {
    const db = client ?? pool;
    await ensureEditablePage(session, id, db);
    const { rows } = await db.query(
      'SELECT id FROM wiki_pages WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL'
        + (client ? ' FOR UPDATE' : ''),
      [session.workspaceId, id],
    );
    if (!rows[0]) throw fail('Страница не найдена', 'WIKI_PAGE_NOT_FOUND', 404);
    if (client) await ensureEditablePage(session, id, client);
  };

  const visibleRows = async (session, rows) => {
    const visible = [];
    for (const row of rows) {
      const state = await access.evaluate(session, row.id);
      if (state?.canView) visible.push(row);
    }
    return visible;
  };

  const pageProjects = async (session, pageId) => {
    if (!projects?.get || !await featureOn(session, 'projects')) return [];
    const { rows } = await pool.query(
      `SELECT project_id "projectId", linked_by "linkedBy", linked_at "linkedAt"
         FROM wiki_page_projects
        WHERE workspace_id=$1 AND page_id=$2
        ORDER BY linked_at DESC,project_id`,
      [session.workspaceId, pageId],
    );
    const projected = await Promise.all(rows.map(async (link) => {
      try {
        const project = await projects.get(session, link.projectId);
        return {
          id: project.id,
          name: project.name,
          status: project.status,
          visibility: project.visibility,
          linkedBy: link.linkedBy,
          linkedAt: link.linkedAt,
        };
      } catch (error) {
        if (error?.code === 'PROJECT_NOT_FOUND') return null;
        throw error;
      }
    }));
    return projected.filter(Boolean);
  };

  // Page-to-Task is a reference only. Resolve each Task via canonical Task
  // Authority for the viewer; even relation counts must not reveal private work.
  const pageTasks = async (session, pageId) => {
    if (!store?.getTask || !await featureOn(session, 'tasks')) return [];
    const { rows } = await pool.query(
      `SELECT commitment_id "taskId", linked_by "linkedBy", linked_at "linkedAt"
         FROM wiki_page_tasks
        WHERE workspace_id=$1 AND page_id=$2
        ORDER BY linked_at DESC, commitment_id LIMIT 100`,
      [session.workspaceId, pageId],
    );
    const result = await Promise.all(rows.map(async link => {
      const task = await store.getTask(session, link.taskId);
      return task ? {
        id: task.id, title: task.title, status: task.status, priority: task.priority,
        linkedBy: link.linkedBy, linkedAt: link.linkedAt,
      } : null;
    }));
    return result.filter(Boolean);
  };

  const pageChannels = async (session, pageId) => {
    if (!store?.conversationPolicy) return [];
    const { rows } = await pool.query(
      `SELECT conversation_id "conversationId", linked_by "linkedBy", linked_at "linkedAt"
         FROM wiki_page_channels
        WHERE workspace_id=$1 AND page_id=$2
        ORDER BY linked_at DESC, conversation_id LIMIT 100`,
      [session.workspaceId, pageId],
    );
    const projected = await Promise.all(rows.map(async link => {
      // The relation grants no new access to an archived or private channel.
      const policy = await store.conversationPolicy(session, link.conversationId);
      if (!policy || policy.conversation.kind !== 'channel') return null;
      return {
        id: policy.conversation.id, title: policy.conversation.title,
        visibility: policy.conversation.visibility,
        kind: 'channel', linkedBy: link.linkedBy, linkedAt: link.linkedAt,
      };
    }));
    return projected.filter(Boolean);
  };

  // A Page stores only the identity of a decision; the Decision Authority
  // rechecks acceptance and source-meeting participation on every read.
  // Neither the number nor title of inaccessible decisions is exposed.
  const pageDecisions = async (session, pageId) => {
    if (!meeting?.getDecision || !await featureOn(session, 'decisions')) return [];
    const { rows } = await pool.query(
      `SELECT decision_id "decisionId", linked_at "linkedAt"
         FROM wiki_page_decisions
        WHERE workspace_id=$1 AND page_id=$2
        ORDER BY linked_at DESC, decision_id LIMIT 100`,
      [session.workspaceId, pageId],
    );
    const items = await Promise.all(rows.map(async link => {
      const decision = await meeting.getDecision(session, link.decisionId);
      return decision ? {
        id:decision.id, title:decision.title, acceptedAt:decision.acceptedAt,
        sourceKind:decision.sourceKind, linkedAt:link.linkedAt,
      } : null;
    }));
    return items.filter(Boolean);
  };


  const pageCalendarMeetings = async (session, pageId) => {
    if (!calendar?.getMeetingForRelation || !await featureOn(session, 'calendar')) return [];
    const { rows } = await pool.query(
      `SELECT calendar_event_id "eventId", linked_by "linkedBy", linked_at "linkedAt"
         FROM wiki_page_calendar_meetings
        WHERE workspace_id=$1 AND page_id=$2
        ORDER BY linked_at DESC, calendar_event_id LIMIT 100`,
      [session.workspaceId, pageId],
    );
    const projected = await Promise.all(rows.map(async (link) => {
      try {
        const event = await calendar.getMeetingForRelation(session, link.eventId);
        return {
          id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt,
          timezone: event.timezone, linkedBy: link.linkedBy, linkedAt: link.linkedAt,
        };
      } catch (error) {
        if (error?.statusCode === 404) return null;
        throw error;
      }
    }));
    return projected.filter(Boolean);
  };

  const pageCalls = async (session, pageId) => {
    if (!calls?.get || !store?.canAccessConversation || !await featureOn(session, 'meetings')) return [];
    const { rows } = await pool.query(
      `SELECT call_id "callId", linked_by "linkedBy", linked_at "linkedAt"
         FROM wiki_page_calls
        WHERE workspace_id=$1 AND page_id=$2
        ORDER BY linked_at DESC, call_id LIMIT 100`,
      [session.workspaceId, pageId],
    );
    const projected = await Promise.all(rows.map(async (link) => {
      try {
        const call = await requireAccessibleCall({
          store, calls, session, callId: link.callId,
          guestMustParticipate: true, message: 'Meeting not found',
        });
        if (!(call.recordings ?? []).length) return null;
        return {
          id: call.id, title: call.title ?? null, mode: call.mode, state: call.state,
          scheduledFor: call.scheduledFor ?? null, startedAt: call.startedAt ?? null,
          endedAt: call.endedAt ?? null, calendarEventId: call.calendarEventId ?? null,
          linkedBy: link.linkedBy, linkedAt: link.linkedAt,
        };
      } catch (error) {
        if (error?.statusCode === 404) return null;
        throw error;
      }
    }));
    return projected.filter(Boolean);
  };

  return {
    enabled: true,

    /** Дети заданной страницы, а без parentId — страницы верхнего уровня. */
    async list(session, { parentId = null } = {}) {
      if (parentId) await access.assertView(session, parentId);
      const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS} FROM wiki_pages
          WHERE workspace_id=$1 AND archived_at IS NULL AND parent_id IS NOT DISTINCT FROM $2
          ORDER BY title`,
        [session.workspaceId, parentId],
      );
      return (await visibleRows(session, rows)).map(summaryView);
    },

    async get(session, id) {
      const pageAccess = await access.assertView(session, id);
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM wiki_pages WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id]);
      if (!rows[0]) throw fail('Страница не найдена', 'WIKI_PAGE_NOT_FOUND', 404);
      const page = view(rows[0]);
      const { rows: children } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS} FROM wiki_pages WHERE workspace_id=$1 AND parent_id=$2 AND archived_at IS NULL ORDER BY title`,
        [session.workspaceId, id],
      );
      return {
        ...page,
        permissions: { canEdit: pageAccess.canEdit, canManageAccess: pageAccess.canManage },
        ...(pageAccess.canManage ? { accessOwnerId: rows[0].accessOwnerId } : {}),
        children: (await visibleRows(session, children)).map(summaryView),
        projects: await pageProjects(session, id),
        tasks: await pageTasks(session, id),
        channels: await pageChannels(session, id),
        decisions: await pageDecisions(session, id),
        meetings: await pageCalendarMeetings(session, id),
        calls: await pageCalls(session, id),
      };
    },

    async create(session, { title, parentId = null, content = '', document, visibility = 'workspace' } = {}) {
      const cleanTitle = readTitle(title);
      const normalized = document === undefined ? null : normalizePageDocument(document);
      const cleanContent = normalized ? normalized.content : readContent(content);
      let effectiveVisibility = visibility === 'restricted' ? 'restricted' : 'workspace';
      if (parentId) {
        try {
          await access.assertEdit(session, parentId);
        } catch (error) {
          // Parent admission has its own stable public contract. Hidden and
          // missing parents are intentionally indistinguishable, but callers
          // still receive the historical WIKI_PARENT_NOT_FOUND code.
          if (error?.code === 'WIKI_PAGE_NOT_FOUND') {
            throw fail('Родительская страница не найдена', 'WIKI_PARENT_NOT_FOUND', 404);
          }
          throw error;
        }
        const { rows } = await pool.query(
          'SELECT visibility FROM wiki_pages WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL',
          [session.workspaceId, parentId],
        );
        if (!rows[0]) throw fail('Родительская страница не найдена', 'WIKI_PARENT_NOT_FOUND', 404);
        if (rows[0].visibility === 'restricted') effectiveVisibility = 'restricted';
      }
      const { rows } = await pool.query(
        `INSERT INTO wiki_pages(organization_id,workspace_id,parent_id,title,content,document,visibility,created_by,updated_by,access_owner_id)
         VALUES($1,$2,$3,$4,$5,$7,$8,$6,$6,$6) RETURNING ${COLUMNS}`,
        [session.organizationId, session.workspaceId, parentId, cleanTitle, cleanContent, session.userId, normalized?.document??null, effectiveVisibility],
      );
      return { ...view(rows[0]), accessOwnerId: rows[0].accessOwnerId };
    },

    /**
     * `expectedVersion` обязателен: без него UPDATE отвечал бы всегда,
     * даже если страницу правил кто-то ещё, пока эта форма была открыта.
     * Прежний текст уходит в `wiki_page_versions` в той же транзакции,
     * что и сама правка, — история не может разойтись с фактом правки.
     */
    async update(session, id, { title, content, document, expectedVersion } = {}) {
      if (expectedVersion === undefined || expectedVersion === null) throw fail('Не указана версия страницы, которую вы редактировали', 'EXPECTED_VERSION_REQUIRED', 400);
      if (title === undefined && content === undefined && document === undefined) throw fail('Нечего менять', 'EMPTY_WIKI_PATCH', 400);
      const nextTitle = title !== undefined ? readTitle(title) : undefined;
      if (document !== undefined && content !== undefined) throw fail('Нельзя одновременно передать content и document','AMBIGUOUS_PAGE_CONTENT',400);
      const normalized = document === undefined ? null : normalizePageDocument(document);
      const nextContent = normalized ? normalized.content : content !== undefined ? readContent(content) : undefined;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: priorRows } = await client.query(
          'SELECT title,content,document,version FROM wiki_pages WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [session.workspaceId, id],
        );
        await access.assertEdit(session, id, client);
        const prior = priorRows[0];
        if (!prior) throw fail('Страница не найдена', 'WIKI_PAGE_NOT_FOUND', 404);
        if (prior.document && content !== undefined) throw fail('Страница содержит форматирование. Откройте структурированный редактор.', 'PAGE_STRUCTURED_EDITOR_REQUIRED', 409);
        if (prior.version !== Number(expectedVersion)) throw fail('Страницу успели изменить, пока вы её редактировали. Обновите её и повторите правку.', 'STALE_VERSION', 409);
        await client.query(
          `INSERT INTO wiki_page_versions(organization_id,workspace_id,page_id,version,title,content,document,edited_by)
           VALUES($1,$2,$3,$4,$5,$6,$8,$7)`,
          [session.organizationId, session.workspaceId, id, prior.version, prior.title, prior.content, session.userId, prior.document],
        );
        const { rows } = await client.query(
          `UPDATE wiki_pages SET title=COALESCE($3,title),content=COALESCE($4,content),
               document=CASE WHEN $6::boolean THEN $7::jsonb ELSE document END,
               version=version+1,updated_by=$5,updated_at=now()
             WHERE workspace_id=$1 AND id=$2 RETURNING ${COLUMNS}`,
          [session.workspaceId, id, nextTitle ?? null, nextContent ?? null, session.userId, normalized!==null||content!==undefined, normalized?.document??null],
        );
        await client.query('COMMIT');
        return view(rows[0]);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async linkProject(session, id, projectId) {
      await ensureLinkablePage(session, id);
      if (!projects?.get) throw fail('Проекты недоступны', 'PROJECTS_UNAVAILABLE', 503);
      await projects.get(session, projectId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await ensureLinkablePage(session, id, client);
        await client.query(
          `INSERT INTO wiki_page_projects(organization_id,workspace_id,page_id,project_id,linked_by)
           VALUES($1,$2,$3,$4,$5)`,
          [session.organizationId, session.workspaceId, id, projectId, session.userId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw fail('Проект уже связан со страницей', 'WIKI_PROJECT_ALREADY_LINKED', 409);
        if (error.code === '23503') throw fail('Проект не найден', 'PROJECT_NOT_FOUND', 404);
        throw error;
      } finally {
        client.release();
      }
      return this.get(session, id);
    },

    async unlinkProject(session, id, projectId) {
      await ensureEditablePage(session, id);
      if (!projects?.get) throw fail('Проекты недоступны', 'PROJECTS_UNAVAILABLE', 503);
      await projects.get(session, projectId);
      const { rowCount } = await pool.query(
        `DELETE FROM wiki_page_projects
          WHERE workspace_id=$1 AND page_id=$2 AND project_id=$3`,
        [session.workspaceId, id, projectId],
      );
      if (!rowCount) throw fail('Связь со страницей не найдена', 'WIKI_PROJECT_NOT_FOUND', 404);
      return this.get(session, id);
    },

    async linkTask(session, id, taskId) {
      await ensureLinkablePage(session, id);
      if (!store?.getTask) throw fail('Задачи недоступны', 'TASKS_UNAVAILABLE', 503);
      const task = await store.getTask(session, taskId);
      if (!task) throw fail('Задача не найдена', 'TASK_NOT_FOUND', 404);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Page lock serializes edits so the 100-relation UI cap stays honest.
        await ensureLinkablePage(session, id, client);
        const limit = await client.query(
          'SELECT count(*)::int count FROM wiki_page_tasks WHERE workspace_id=$1 AND page_id=$2',
          [session.workspaceId, id],
        );
        if (limit.rows[0].count >= 100) throw fail('На странице может быть не более 100 связанных задач', 'PAGE_TASK_LIMIT', 409);
        await client.query(
          `INSERT INTO wiki_page_tasks(organization_id,workspace_id,page_id,commitment_id,linked_by)
           VALUES($1,$2,$3,$4,$5)`,
          [session.organizationId, session.workspaceId, id, taskId, session.userId],
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.task_linked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { taskId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw fail('Задача уже связана со страницей', 'WIKI_TASK_ALREADY_LINKED', 409);
        if (error.code === '23503') throw fail('Задача не найдена', 'TASK_NOT_FOUND', 404);
        throw error;
      } finally {
        client.release();
      }
      return this.get(session, id);
    },

    async unlinkTask(session, id, taskId) {
      await ensureEditablePage(session, id);
      if (!store?.getTask) throw fail('Задачи недоступны', 'TASKS_UNAVAILABLE', 503);
      if (!await store.getTask(session, taskId)) throw fail('Задача не найдена', 'TASK_NOT_FOUND', 404);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `DELETE FROM wiki_page_tasks
            WHERE workspace_id=$1 AND page_id=$2 AND commitment_id=$3`,
          [session.workspaceId, id, taskId],
        );
        if (!rowCount) throw fail('Связь с задачей не найдена', 'WIKI_TASK_NOT_LINKED', 404);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.task_unlinked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { taskId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return this.get(session, id);
    },

    async linkChannel(session, id, conversationId) {
      await ensureLinkablePage(session, id);
      if (!store?.conversationPolicy) throw fail('Каналы недоступны', 'CHANNELS_UNAVAILABLE', 503);
      const policy = await store.conversationPolicy(session, conversationId);
      if (!policy || policy.conversation.kind !== 'channel') {
        throw fail('Канал не найден', 'CHANNEL_NOT_FOUND', 404);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await ensureLinkablePage(session, id, client);
        const limit = await client.query(
          'SELECT count(*)::int count FROM wiki_page_channels WHERE workspace_id=$1 AND page_id=$2',
          [session.workspaceId, id],
        );
        if (limit.rows[0].count >= 100) throw fail('На странице может быть не более 100 связанных каналов', 'PAGE_CHANNEL_LIMIT', 409);
        await client.query(
          `INSERT INTO wiki_page_channels(organization_id,workspace_id,page_id,conversation_id,linked_by)
           VALUES($1,$2,$3,$4,$5)`,
          [session.organizationId, session.workspaceId, id, conversationId, session.userId],
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.channel_linked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { conversationId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw fail('Канал уже связан со страницей', 'WIKI_CHANNEL_ALREADY_LINKED', 409);
        if (error.code === '23503') throw fail('Канал не найден', 'CHANNEL_NOT_FOUND', 404);
        throw error;
      } finally {
        client.release();
      }
      return this.get(session, id);
    },

    async unlinkChannel(session, id, conversationId) {
      await ensureEditablePage(session, id);
      if (!store?.conversationPolicy) throw fail('Каналы недоступны', 'CHANNELS_UNAVAILABLE', 503);
      const policy = await store.conversationPolicy(session, conversationId);
      if (!policy || policy.conversation.kind !== 'channel') {
        throw fail('Канал не найден', 'CHANNEL_NOT_FOUND', 404);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `DELETE FROM wiki_page_channels
            WHERE workspace_id=$1 AND page_id=$2 AND conversation_id=$3`,
          [session.workspaceId, id, conversationId],
        );
        if (!rowCount) throw fail('Связь с каналом не найдена', 'WIKI_CHANNEL_NOT_LINKED', 404);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.channel_unlinked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { conversationId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return this.get(session, id);
    },

    async linkCalendarMeeting(session, id, eventId) {
      await ensureLinkablePage(session, id);
      if (!calendar?.getMeetingForRelation) throw fail('Календарь недоступен', 'CALENDAR_UNAVAILABLE', 503);
      await calendar.getMeetingForRelation(session, eventId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await ensureLinkablePage(session, id, client);
        const { rows } = await client.query(
          'SELECT count(*)::int count FROM wiki_page_calendar_meetings WHERE workspace_id=$1 AND page_id=$2',
          [session.workspaceId, id],
        );
        if (rows[0].count >= 100) throw fail('На странице может быть не более 100 связанных встреч', 'PAGE_MEETING_LIMIT', 409);
        const { rows: latest } = await client.query(
          "SELECT id FROM calendar_events WHERE workspace_id=$1 AND id=$2 AND kind='meeting' FOR SHARE",
          [session.workspaceId, eventId],
        );
        if (!latest[0]) throw fail('Встреча не найдена', 'CALENDAR_EVENT_NOT_FOUND', 404);
        await client.query(
          `INSERT INTO wiki_page_calendar_meetings(organization_id,workspace_id,page_id,calendar_event_id,linked_by)
           VALUES($1,$2,$3,$4,$5)`,
          [session.organizationId, session.workspaceId, id, eventId, session.userId],
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.meeting_linked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { eventId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw fail('Встреча уже связана со страницей', 'WIKI_MEETING_ALREADY_LINKED', 409);
        if (error.code === '23503') throw fail('Встреча не найдена', 'CALENDAR_EVENT_NOT_FOUND', 404);
        throw error;
      } finally { client.release(); }
      return this.get(session, id);
    },

    async unlinkCalendarMeeting(session, id, eventId) {
      await ensureEditablePage(session, id);
      if (!calendar?.getMeetingForRelation) throw fail('Календарь недоступен', 'CALENDAR_UNAVAILABLE', 503);
      await calendar.getMeetingForRelation(session, eventId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          'DELETE FROM wiki_page_calendar_meetings WHERE workspace_id=$1 AND page_id=$2 AND calendar_event_id=$3',
          [session.workspaceId, id, eventId],
        );
        if (!rowCount) throw fail('Связь со встречей не найдена', 'WIKI_MEETING_NOT_LINKED', 404);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.meeting_unlinked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { eventId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
      return this.get(session, id);
    },

    async linkCall(session, id, callId) {
      await ensureLinkablePage(session, id);
      if (!calls?.get || !store?.canAccessConversation) throw fail('Записи встреч недоступны', 'CALLS_UNAVAILABLE', 503);
      const call = await requireAccessibleCall({
        store, calls, session, callId, guestMustParticipate: true, message: 'Meeting not found',
      });
      if (!(call.recordings ?? []).length) throw fail('У звонка нет записи', 'RECORDED_CALL_NOT_FOUND', 404);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await ensureLinkablePage(session, id, client);
        const { rows } = await client.query(
          'SELECT count(*)::int count FROM wiki_page_calls WHERE workspace_id=$1 AND page_id=$2',
          [session.workspaceId, id],
        );
        if (rows[0].count >= 100) throw fail('На странице может быть не более 100 связанных записей встреч', 'PAGE_CALL_LIMIT', 409);
        const { rows: latest } = await client.query(
          'SELECT id FROM call_sessions WHERE workspace_id=$1 AND id=$2 FOR SHARE',
          [session.workspaceId, callId],
        );
        if (!latest[0]) throw fail('Запись встречи не найдена', 'RECORDED_CALL_NOT_FOUND', 404);
        const recording = await client.query(
          'SELECT 1 FROM call_recordings WHERE workspace_id=$1 AND call_id=$2 LIMIT 1',
          [session.workspaceId, callId],
        );
        if (!recording.rowCount) throw fail('У звонка нет записи', 'RECORDED_CALL_NOT_FOUND', 404);
        await client.query(
          `INSERT INTO wiki_page_calls(organization_id,workspace_id,page_id,call_id,linked_by)
           VALUES($1,$2,$3,$4,$5)`,
          [session.organizationId, session.workspaceId, id, callId, session.userId],
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.call_linked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { callId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw fail('Запись встречи уже связана со страницей', 'WIKI_CALL_ALREADY_LINKED', 409);
        if (error.code === '23503') throw fail('Запись встречи не найдена', 'RECORDED_CALL_NOT_FOUND', 404);
        throw error;
      } finally { client.release(); }
      return this.get(session, id);
    },

    async unlinkCall(session, id, callId) {
      await ensureEditablePage(session, id);
      if (!calls?.get || !store?.canAccessConversation) throw fail('Записи встреч недоступны', 'CALLS_UNAVAILABLE', 503);
      await requireAccessibleCall({
        store, calls, session, callId, guestMustParticipate: true, message: 'Meeting not found',
      });
      // Cleanup remains possible even if the recording row was removed after
      // linking. A missing recording hides the projection but must not strand
      // the relation forever.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          'DELETE FROM wiki_page_calls WHERE workspace_id=$1 AND page_id=$2 AND call_id=$3',
          [session.workspaceId, id, callId],
        );
        if (!rowCount) throw fail('Связь с записью встречи не найдена', 'WIKI_CALL_NOT_LINKED', 404);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.call_unlinked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { callId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
      return this.get(session, id);
    },

    async pagesForDecision(session, decisionId) {
      // Decision Authority is checked *first*, so guessed/retracted UUIDs do
      // not reveal whether Page relations exist. Archived Pages stay hidden.
      if (!meeting?.getDecision) throw fail('Реестр решений недоступен', 'DECISIONS_UNAVAILABLE', 503);
      if (!await meeting.getDecision(session, decisionId)) {
        throw fail('Решение не найдено', 'DECISION_NOT_FOUND', 404);
      }
      const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS}
           FROM wiki_page_decisions link
           JOIN wiki_pages p ON p.workspace_id=link.workspace_id AND p.id=link.page_id
          WHERE link.workspace_id=$1 AND link.decision_id=$2 AND p.archived_at IS NULL
          ORDER BY link.linked_at DESC, p.id LIMIT 100`,
        [session.workspaceId, decisionId],
      );
      return (await visibleRows(session, rows)).map(summaryView);
    },

    async linkDecision(session, id, decisionId) {
      // Enforce Page admission before querying any target metadata.
      await ensureLinkablePage(session, id);
      if (!meeting?.getDecision) throw fail('Реестр решений недоступен', 'DECISIONS_UNAVAILABLE', 503);
      const decision = await meeting.getDecision(session, decisionId);
      if (!decision) throw fail('Решение не найдено', 'DECISION_NOT_FOUND', 404);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Lock Page to serialize concurrent additions and enforce the cap.
        await ensureLinkablePage(session, id, client);
        const { rows } = await client.query(
          'SELECT count(*)::int count FROM wiki_page_decisions WHERE workspace_id=$1 AND page_id=$2',
          [session.workspaceId, id],
        );
        if (rows[0].count >= 100) throw fail('На странице может быть не более 100 решений', 'PAGE_DECISION_LIMIT', 409);
        // A concurrent retraction between the initial access check and write
        // must not create a newly-linked retracted decision. Lock its row
        // after the Page lock, checking status against canonical DB state.
        const { rows: latest } = await client.query(
          "SELECT id FROM decisions WHERE workspace_id=$1 AND id=$2 AND status='active' FOR SHARE",
          [session.workspaceId, decisionId],
        );
        if (!latest[0]) throw fail('Решение не найдено', 'DECISION_NOT_FOUND', 404);
        await client.query(
          `INSERT INTO wiki_page_decisions(organization_id,workspace_id,page_id,decision_id,linked_by)
           VALUES($1,$2,$3,$4,$5)`,
          [session.organizationId, session.workspaceId, id, decisionId, session.userId],
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.decision_linked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { decisionId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw fail('Решение уже связано со страницей', 'WIKI_DECISION_ALREADY_LINKED', 409);
        if (error.code === '23503') throw fail('Решение не найдено', 'DECISION_NOT_FOUND', 404);
        throw error;
      } finally {
        client.release();
      }
      return this.get(session, id);
    },

    async unlinkDecision(session, id, decisionId) {
      await ensureEditablePage(session, id);
      if (!meeting?.getDecision) throw fail('Реестр решений недоступен', 'DECISIONS_UNAVAILABLE', 503);
      // Explicit non-disclosure: an inaccessible, retracted or fabricated
      // canonical decision can never be manipulated by guessing its UUID.
      if (!await meeting.getDecision(session, decisionId)) {
        throw fail('Решение не найдено', 'DECISION_NOT_FOUND', 404);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `DELETE FROM wiki_page_decisions
            WHERE workspace_id=$1 AND page_id=$2 AND decision_id=$3`,
          [session.workspaceId, id, decisionId],
        );
        if (!rowCount) throw fail('Связь с решением не найдена', 'WIKI_DECISION_NOT_LINKED', 404);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.decision_unlinked',$4,$5)`,
          [session.organizationId, session.workspaceId, id, session.userId, { decisionId }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return this.get(session, id);
    },

    async archive(session, id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT id FROM wiki_pages WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
          [session.workspaceId,id],
        );
        await access.assertEdit(session,id,client);
        const { rows } = await client.query(
          'UPDATE wiki_pages SET archived_at=now() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING id',
          [session.workspaceId,id],
        );
        if (!rows[0]) throw fail('Страница не найдена','WIKI_PAGE_NOT_FOUND',404);
        await client.query('COMMIT');
      } catch(error) {
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      } finally { client.release(); }
    },

    async history(session, id) {
      await access.assertView(session,id);
      const { rows } = await pool.query(
        `SELECT id,version,title,content,document,edited_by "editedBy",replaced_at "replacedAt"
           FROM wiki_page_versions WHERE workspace_id=$1 AND page_id=$2 ORDER BY replaced_at DESC`,
        [session.workspaceId, id],
      );
      return rows;
    },

    async getAccess(session,id){
      await access.assertManage(session,id);
      const {rows:pages}=await pool.query(
        'SELECT visibility,created_by "createdBy",access_owner_id "accessOwnerId" FROM wiki_pages WHERE workspace_id=$1 AND id=$2',
        [session.workspaceId,id],
      );
      if(!pages[0])throw fail('Страница не найдена','WIKI_PAGE_NOT_FOUND',404);
      const {rows}=await pool.query(
        `SELECT g.user_id "userId",g.access,g.granted_by "grantedBy",g.granted_at "grantedAt",g.updated_at "updatedAt",
                COALESCE(p.display_name,p.email,g.user_id::text) "displayName",p.title
           FROM wiki_page_grants g
           LEFT JOIN workspace_profiles p ON p.workspace_id=g.workspace_id AND p.user_id=g.user_id
          WHERE g.workspace_id=$1 AND g.page_id=$2
          ORDER BY COALESCE(p.display_name,p.email,g.user_id::text),g.user_id`,
        [session.workspaceId,id],
      );
      const ownerProfile=await pool.query(
        `SELECT COALESCE(p.display_name,p.email,$2::text) "displayName"
           FROM memberships m
           LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
          WHERE m.workspace_id=$1 AND m.user_id=$2`,
        [session.workspaceId,pages[0].accessOwnerId],
      );
      return {
        visibility:pages[0].visibility,createdBy:pages[0].createdBy,
        accessOwnerId:pages[0].accessOwnerId,
        accessOwnerName:ownerProfile.rows[0]?.displayName??pages[0].accessOwnerId,
        grants:rows,
      };
    },

    async setVisibility(session,id,visibility){
      const next=visibility==='restricted'?'restricted':visibility==='workspace'?'workspace':null;
      if(!next)throw fail('Неизвестный режим доступа','WIKI_VISIBILITY_INVALID',400);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(
          'SELECT id FROM wiki_pages WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [session.workspaceId,id],
        );
        await access.assertManage(session,id,client);
        const {rows}=await client.query(
          'UPDATE wiki_pages SET visibility=$3,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING visibility',
          [session.workspaceId,id,next,session.userId],
        );
        if(!rows[0])throw fail('Страница не найдена','WIKI_PAGE_NOT_FOUND',404);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.access_visibility_changed',$4,$5)`,
          [session.organizationId,session.workspaceId,id,session.userId,{visibility:next}],
        );
        await client.query('COMMIT');
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
      return this.getAccess(session,id);
    },

    async grantAccess(session,id,userId,level){
      const granted=level==='edit'?'edit':level==='view'?'view':null;
      if(!granted)throw fail('Неизвестный уровень доступа','WIKI_ACCESS_INVALID',400);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(
          'SELECT id FROM wiki_pages WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [session.workspaceId,id],
        );
        await access.assertManage(session,id,client);
        const member=await activeEmployee(client,session,userId);
        if(!member)throw fail('Сотрудник не найден','WIKI_GRANTEE_NOT_FOUND',404);
        const creator=await client.query(
          'SELECT created_by FROM wiki_pages WHERE workspace_id=$1 AND id=$2',
          [session.workspaceId,id],
        );
        if(creator.rows[0]?.created_by===userId)throw fail('Создателю страницы отдельный доступ не нужен','WIKI_CREATOR_GRANT_INVALID',409);
        await client.query(
          `INSERT INTO wiki_page_grants(organization_id,workspace_id,page_id,user_id,access,granted_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(page_id,user_id) DO UPDATE SET access=EXCLUDED.access,granted_by=EXCLUDED.granted_by,updated_at=now()`,
          [session.organizationId,session.workspaceId,id,userId,granted,session.userId],
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.access_granted',$4,$5)`,
          [session.organizationId,session.workspaceId,id,session.userId,{userId,access:granted}],
        );
        await client.query('COMMIT');
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        if(error.code==='23503')throw fail('Сотрудник не найден','WIKI_GRANTEE_NOT_FOUND',404);
        throw error;
      }finally{client.release();}
      return this.getAccess(session,id);
    },

    async revokeAccess(session,id,userId){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(
          'SELECT id FROM wiki_pages WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [session.workspaceId,id],
        );
        await access.assertManage(session,id,client);
        const {rowCount}=await client.query(
          'DELETE FROM wiki_page_grants WHERE workspace_id=$1 AND page_id=$2 AND user_id=$3',
          [session.workspaceId,id,userId],
        );
        if(!rowCount)throw fail('Доступ не найден','WIKI_GRANT_NOT_FOUND',404);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.access_revoked',$4,$5)`,
          [session.organizationId,session.workspaceId,id,session.userId,{userId}],
        );
        await client.query('COMMIT');
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
      return this.getAccess(session,id);
    },

    async transferAccessOwner(session,id,userId){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const locked=await client.query(
          'SELECT id,access_owner_id "accessOwnerId" FROM wiki_pages WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [session.workspaceId,id],
        );
        await access.assertManage(session,id,client);
        if(locked.rows[0]?.accessOwnerId===userId)throw fail('Этот сотрудник уже владелец доступа','WIKI_ACCESS_OWNER_UNCHANGED',409);
        const target=await activeEmployee(client,session,userId);
        if(!target)throw fail('Сотрудник не найден','WIKI_ACCESS_OWNER_NOT_FOUND',404);
        const {rows}=await client.query(
          'UPDATE wiki_pages SET access_owner_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING access_owner_id "accessOwnerId"',
          [session.workspaceId,id,userId],
        );
        if(!rows[0])throw fail('Страница не найдена','WIKI_PAGE_NOT_FOUND',404);
        // The new steward receives access to the current node, but must also
        // be able to traverse every restricted ancestor. Reject atomically.
        const targetAccess=await access.evaluate(
          {...session,userId:target.userId,role:target.role},id,client,
        );
        if(!targetAccess?.canView)throw fail(
          'Новый владелец доступа сначала должен получить доступ к закрытым родительским страницам',
          'WIKI_ACCESS_OWNER_ANCESTOR_REQUIRED',409,
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.access_owner_transferred',$4,$5)`,
          [session.organizationId,session.workspaceId,id,session.userId,{toUserId:userId}],
        );
        await client.query('COMMIT');
        return {pageId:id,accessOwnerId:userId,accessOwnerName:target.displayName};
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
    },

    async listAccessRecovery(session){
      if(session.role!=='owner')throw fail('Восстановление доступа доступно только владельцу пространства','WIKI_ACCESS_RECOVERY_FORBIDDEN',403);
      const {rows}=await pool.query(
        `SELECT p.id,p.title,p.updated_at "updatedAt",p.access_owner_id "accessOwnerId",
                COALESCE(wp.display_name,wp.email,p.access_owner_id::text) "accessOwnerName"
           FROM wiki_pages p
           JOIN memberships m ON m.workspace_id=p.workspace_id AND m.user_id=p.access_owner_id
           JOIN users u ON u.id=m.user_id
           LEFT JOIN workspace_profiles wp ON wp.workspace_id=p.workspace_id AND wp.user_id=p.access_owner_id
          WHERE p.workspace_id=$1 AND p.archived_at IS NULL
            AND (m.role='guest' OR u.disabled_at IS NOT NULL OR (m.access_until IS NOT NULL AND m.access_until<=now()))
          ORDER BY p.updated_at DESC,p.id
          LIMIT 200`,
        [session.workspaceId],
      );
      return rows;
    },

    async recoverAccessOwner(session,id,userId){
      if(session.role!=='owner')throw fail('Восстановление доступа доступно только владельцу пространства','WIKI_ACCESS_RECOVERY_FORBIDDEN',403);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const {rows}=await client.query(
          `SELECT p.access_owner_id "accessOwnerId",m.role,u.disabled_at "disabledAt",m.access_until "accessUntil"
             FROM wiki_pages p
             JOIN memberships m ON m.workspace_id=p.workspace_id AND m.user_id=p.access_owner_id
             JOIN users u ON u.id=m.user_id
            WHERE p.workspace_id=$1 AND p.id=$2
            FOR UPDATE OF p`,
          [session.workspaceId,id],
        );
        const page=rows[0];
        if(!page)throw fail('Страница не найдена','WIKI_PAGE_NOT_FOUND',404);
        const active=page.role!=='guest'&&!page.disabledAt&&(!page.accessUntil||Date.parse(page.accessUntil)>Date.now());
        if(active)throw fail('У страницы есть активный владелец доступа','WIKI_ACCESS_OWNER_ACTIVE',409);
        const target=await activeEmployee(client,session,userId);
        if(!target)throw fail('Сотрудник не найден','WIKI_ACCESS_OWNER_NOT_FOUND',404);
        await client.query(
          'UPDATE wiki_pages SET access_owner_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2',
          [session.workspaceId,id,userId],
        );
        const targetAccess=await access.evaluate({...session,userId:target.userId,role:target.role},id,client);
        if(!targetAccess?.canView)throw fail(
          'Сначала восстановите доступ к закрытым родительским страницам',
          'WIKI_ACCESS_OWNER_ANCESTOR_REQUIRED',409,
        );
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'wiki_page',$3,'wiki.access_owner_recovered',$4,$5)`,
          [session.organizationId,session.workspaceId,id,session.userId,{fromUserId:page.accessOwnerId,toUserId:userId}],
        );
        await client.query('COMMIT');
        return {pageId:id,accessOwnerId:userId,accessOwnerName:target.displayName};
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
    },

    async search(session, { query, limit = 30, from = null, to = null } = {}) {
      const q = String(query ?? '').trim();
      if (!q) return [];
      const max = Math.min(Math.max(Number(limit) || 30, 1), 100);
      const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS},
                ts_headline('russian',content,plainto_tsquery('russian',$3),'MaxFragments=1,MaxWords=20') snippet
           FROM wiki_pages
          WHERE workspace_id=$1 AND archived_at IS NULL
            AND (to_tsvector('russian',coalesce(title,'')||' '||coalesce(content,''))@@plainto_tsquery('russian',$3) OR title ILIKE '%'||$3||'%')
            AND ($4::timestamptz IS NULL OR updated_at >= $4)
            AND ($5::timestamptz IS NULL OR updated_at <= $5)
          ORDER BY ts_rank_cd(to_tsvector('russian',coalesce(title,'')||' '||coalesce(content,'')),plainto_tsquery('russian',$3)) DESC,
                   updated_at DESC
          LIMIT $2`,
        [session.workspaceId, Math.min(max*5,500), q, from, to],
      );
      const visible = await visibleRows(session, rows);
      return visible.slice(0,max).map((row) => ({ ...summaryView(row), snippet: row.snippet }));
    },
  };
}
