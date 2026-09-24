import { createZipWriter } from './zip.js';

/**
 * Выгрузка рабочего пространства одним архивом.
 *
 * Пространство хранит переписку компании, её обязательства, календарь и
 * все вложения — и до сих пор не было ни одного способа забрать это
 * наружу. Пока такого способа нет, продукт держит данные заложником:
 * переезд, проверка, спор с подрядчиком, требование закона — всё
 * упирается в «выгрузите нам из базы руками».
 *
 * Собирается потоком: строки читаются страницами по курсору, файлы
 * отдаются кусками, в память не попадает ни таблица целиком, ни
 * вложение целиком. Иначе выгрузка компании за пять лет кладёт процесс
 * ровно в тот момент, когда она нужнее всего.
 *
 * Формат — JSON Lines, по строке на запись: его читает и человек, и что
 * угодно ещё, и строку можно дописать в поток, не держа в руках весь
 * массив.
 */

const PAGE = 500;

/** Имя внутри архива: без разделителей каталогов и без пустоты. */
function safeName(name, fallback) {
  const value = String(name ?? '')
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 31 && ch !== '/' && ch !== '\\')
    .join('')
    .replace(/^\.+/, '')
    .trim();
  return value.slice(0, 120) || fallback;
}

/**
 * Страницы по курсору.
 *
 * `OFFSET` на миллионе сообщений заставляет базу пролистывать всё
 * прочитанное заново на каждой странице; курсор по ключу — нет.
 *
 * Число параметров курсора задаётся явно: лишний параметр в запросе —
 * это «bind message supplies N parameters», и узнаётся такое в бою.
 */
async function* paged(pool, text, params, { keys, cursorOf }) {
  let cursor = new Array(keys).fill(null);
  for (;;) {
    const { rows } = await pool.query(text, [...params, ...cursor]);
    if (!rows.length) return;
    for (const row of rows) yield row;
    if (rows.length < PAGE) return;
    cursor = cursorOf(rows[rows.length - 1]);
  }
}

/** Строки как JSON Lines. */
function jsonl(source, shape) {
  return (async function* lines() {
    for await (const row of source) yield Buffer.from(`${JSON.stringify(shape(row))}\n`, 'utf8');
  })();
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function createWorkspaceExport(pool, objectStore) {
  if (!pool) return null;

  return {
    /**
     * Пишет архив в поток и возвращает опись того, что в нём.
     *
     * `withFiles` можно выключить: иногда нужна только переписка, а
     * вложения — это гигабайты и часы.
     */
    async stream(session, sink, { withFiles = true } = {}) {
      const zip = createZipWriter(sink);
      const scope = [session.organizationId, session.workspaceId];
      const counted = {};
      const counting = (name, shape) => {
        counted[name] = 0;
        return (row) => { counted[name] += 1; return shape(row); };
      };

      // Запись в журнал — до выгрузки, а не после: попытка забрать
      // переписку компании целиком должна остаться следом даже тогда,
      // когда выгрузка оборвалась на середине.
      await pool.query(
        `INSERT INTO audit_events(organization_id, workspace_id, aggregate_type, aggregate_id,
                                  event_type, actor_id, payload)
         VALUES($1, $2, 'workspace', $2, 'workspace.exported', $3, $4)`,
        [...scope, session.userId, { withFiles }],
      );

      const { rows: [space] } = await pool.query(
        `SELECT w.id, w.name, w.created_at, o.id organization_id, o.name organization_name
           FROM workspaces w JOIN organizations o ON o.id = w.organization_id
          WHERE w.organization_id = $1 AND w.id = $2`,
        scope,
      );

      await zip.add('README.txt', [
        `Выгрузка рабочего пространства «${space?.name ?? ''}».`,
        `Организация: ${space?.organization_name ?? ''}.`,
        `Снята: ${new Date().toISOString()}.`,
        '',
        'Что где:',
        '  пространство.json — о самом пространстве',
        '  люди.jsonl        — участники и их профили',
        '  беседы.jsonl      — беседы, каналы и личные переписки',
        '  сообщения.jsonl   — все сообщения, по строке на сообщение',
        '  задачи.jsonl      — обязательства',
        '  календарь.jsonl   — события календаря',
        '  журнал.jsonl      — журнал действий',
        '  файлы.jsonl       — опись вложений',
        '  файлы/            — сами вложения',
        '  опись.json        — сколько чего выгружено',
        '',
        'Формат JSON Lines: одна запись — одна строка.',
        'Удалённое сообщение выгружается с пометкой deletedAt и без текста:',
        'запись о том, что оно было и было удалено, сохраняется.',
        '',
      ].join('\n'));

      await zip.add('пространство.json', `${JSON.stringify({
        organization: { id: space?.organization_id ?? null, name: space?.organization_name ?? null },
        workspace: { id: space?.id ?? null, name: space?.name ?? null, createdAt: iso(space?.created_at) },
        exportedAt: new Date().toISOString(),
        exportedBy: session.userId,
      }, null, 2)}\n`);

      await zip.add('люди.jsonl', jsonl(paged(
        pool,
        `SELECT m.user_id, m.role, m.created_at, m.access_until, u.email, u.disabled_at,
                p.display_name, p.title, p.department, p.phone, p.about, p.location,
                p.started_on, p.timezone, p.birth_day, p.birth_month
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN workspace_profiles p
             ON p.workspace_id = m.workspace_id AND p.user_id = m.user_id
          WHERE m.organization_id = $1 AND m.workspace_id = $2
            AND ($3::uuid IS NULL OR m.user_id > $3::uuid)
          ORDER BY m.user_id LIMIT ${PAGE}`,
        scope,
        { keys: 1, cursorOf: (row) => [row.user_id] },
      ), counting('люди', (row) => ({
        userId: row.user_id,
        email: row.email,
        role: row.role,
        joinedAt: iso(row.created_at),
        accessUntil: iso(row.access_until),
        disabledAt: iso(row.disabled_at),
        displayName: row.display_name,
        title: row.title,
        department: row.department,
        phone: row.phone,
        about: row.about,
        location: row.location,
        startedOn: row.started_on,
        timezone: row.timezone,
        birthday: row.birth_day && row.birth_month ? { day: row.birth_day, month: row.birth_month } : null,
      }))), { compress: false });

      await zip.add('беседы.jsonl', jsonl(paged(
        pool,
        `SELECT c.*,
                (SELECT json_agg(json_build_object('userId', cm.user_id, 'role', cm.role, 'joinedAt', cm.joined_at))
                   FROM conversation_members cm
                  WHERE cm.workspace_id = c.workspace_id AND cm.conversation_id = c.id) members
           FROM conversations c
          WHERE c.organization_id = $1 AND c.workspace_id = $2
            AND ($3::uuid IS NULL OR c.id > $3::uuid)
          ORDER BY c.id LIMIT ${PAGE}`,
        scope,
        { keys: 1, cursorOf: (row) => [row.id] },
      ), counting('беседы', (row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        purpose: row.purpose,
        slug: row.slug,
        visibility: row.visibility,
        announcementOnly: row.announcement_only,
        createdBy: row.created_by,
        createdAt: iso(row.created_at),
        archivedAt: iso(row.archived_at),
        members: row.members ?? [],
      }))), { compress: false });

      // Сообщений больше всего, и ключ у них составной: время плюс
      // идентификатор. По одному времени страницы разъезжаются на
      // сообщениях, отправленных в одну миллисекунду.
      await zip.add('сообщения.jsonl', jsonl(paged(
        pool,
        `SELECT m.*,
                (SELECT f.source_message_id FROM message_forwards f
                  WHERE f.workspace_id = m.workspace_id AND f.forwarded_message_id = m.id) forwarded_from
           FROM messages m
          WHERE m.organization_id = $1 AND m.workspace_id = $2
            AND ($3::timestamptz IS NULL OR (m.created_at, m.id) > ($3::timestamptz, $4::uuid))
          ORDER BY m.created_at, m.id LIMIT ${PAGE}`,
        scope,
        { keys: 2, cursorOf: (row) => [row.created_at, row.id] },
      ), counting('сообщения', (row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        threadRootId: row.thread_root_id,
        replyToId: row.reply_to_id,
        authorId: row.author_id,
        kind: row.kind,
        // Удалённое сообщение остаётся строкой без текста: отметка о
        // том, что оно было, — тоже часть переписки.
        body: row.deleted_at ? null : row.body,
        createdAt: iso(row.created_at),
        editedAt: iso(row.edited_at),
        deletedAt: iso(row.deleted_at),
        scheduledFor: iso(row.scheduled_for),
        forwardedFrom: row.forwarded_from ?? null,
        metadata: row.metadata ?? null,
      }))), { compress: false });

      await zip.add('задачи.jsonl', jsonl(paged(
        pool,
        `SELECT * FROM commitments
          WHERE organization_id = $1 AND workspace_id = $2
            AND ($3::uuid IS NULL OR id > $3::uuid)
          ORDER BY id LIMIT ${PAGE}`,
        scope,
        { keys: 1, cursorOf: (row) => [row.id] },
      ), counting('задачи', (row) => ({
        id: row.id,
        title: row.title,
        outcome: row.outcome,
        status: row.status,
        priority: row.priority,
        ownerId: row.owner_id,
        requesterId: row.requester_id,
        acceptorId: row.acceptor_id,
        parentId: row.parent_commitment_id,
        sourceMessageId: row.source_message_id,
        promisedAt: iso(row.promised_at),
        forecastAt: iso(row.forecast_at),
        closedAt: iso(row.closed_at),
        estimateMinutes: row.estimate_minutes,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      }))), { compress: false });

      await zip.add('календарь.jsonl', jsonl(paged(
        pool,
        `SELECT * FROM calendar_events
          WHERE organization_id = $1 AND workspace_id = $2
            AND ($3::uuid IS NULL OR id > $3::uuid)
          ORDER BY id LIMIT ${PAGE}`,
        scope,
        { keys: 1, cursorOf: (row) => [row.id] },
      ), counting('календарь', (row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        ownerId: row.owner_id,
        startAt: iso(row.start_at),
        endAt: iso(row.end_at),
        timezone: row.timezone,
        allDay: row.all_day,
        visibility: row.visibility,
        recurrenceRule: row.recurrence_rule,
        commitmentId: row.commitment_id,
        conversationId: row.conversation_id,
      }))), { compress: false });

      // У журнала единственный монотонный ключ во всей схеме, и курсор
      // по нему самый дешёвый из возможных.
      await zip.add('журнал.jsonl', jsonl(paged(
        pool,
        `SELECT * FROM audit_events
          WHERE organization_id = $1 AND workspace_id = $2
            AND ($3::bigint IS NULL OR sequence > $3::bigint)
          ORDER BY sequence LIMIT ${PAGE}`,
        scope,
        { keys: 1, cursorOf: (row) => [row.sequence] },
      ), counting('журнал', (row) => ({
        sequence: Number(row.sequence),
        id: row.id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        actorId: row.actor_id,
        payload: row.payload,
        createdAt: iso(row.created_at),
      }))), { compress: false });

      // Опись вложений отдельно от самих вложений: по ней видно, что
      // должно было попасть в архив, даже если файла в хранилище уже нет.
      const pathOf = (row) => `файлы/${row.id}__${safeName(row.name, 'файл')}`;
      const { rows: fileRows } = await pool.query(
        `SELECT id, name, mime_type, size_bytes, storage_key, sha256, status,
                uploaded_by, created_at, deleted_at
           FROM files WHERE organization_id = $1 AND workspace_id = $2
          ORDER BY created_at, id`,
        scope,
      );
      counted['файлы'] = fileRows.length;
      await zip.add('файлы.jsonl', fileRows.map((row) => `${JSON.stringify({
        id: row.id,
        name: row.name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
        status: row.status,
        uploadedBy: row.uploaded_by,
        createdAt: iso(row.created_at),
        deletedAt: iso(row.deleted_at),
        path: row.deleted_at ? null : pathOf(row),
      })}\n`).join(''), { compress: false });

      let saved = 0;
      let missing = 0;
      if (withFiles && objectStore) {
        for (const row of fileRows) {
          if (row.deleted_at || row.status === 'deleted') continue;
          try {
            // Поток, а не буфер: одно вложение не должно определять
            // потребление памяти всей выгрузки.
            const body = objectStore.readStream
              ? await objectStore.readStream(row.storage_key)
              : await objectStore.get(row.storage_key);
            await zip.add(pathOf(row), body, { modified: new Date(row.created_at), compress: false });
            saved += 1;
          } catch {
            // Пропавшее вложение не повод обрывать выгрузку компании:
            // отмечаем в описи и идём дальше.
            missing += 1;
          }
        }
      }

      const manifest = {
        exportedAt: new Date().toISOString(),
        withFiles,
        counts: { ...counted, 'выгружено файлов': saved, 'файлов не найдено в хранилище': missing },
      };
      await zip.add('опись.json', `${JSON.stringify(manifest, null, 2)}\n`);
      const done = await zip.finish();
      return { ...manifest, entries: done.entries, bytes: done.bytes };
    },
  };
}
