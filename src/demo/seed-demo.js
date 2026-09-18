import { createHash, randomUUID } from 'node:crypto';
import { createOpaqueToken, hashPassword, hashToken } from '../security.js';
import { DEMO_FILE_FIXTURES } from './demo-file-fixtures.js';

export const DEMO_EMAIL = 'demo@northstar.example';
export const DEMO_PASSWORD = 'DemoWorkspace2026';

const plusMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

function actor(base, userId, displayName, role = 'member') {
  return { ...base, userId, displayName, role };
}

async function postgresDemoSeedCompleted(store, workspaceId) {
  if (!store.pool?.query) return true;
  const { rows } = await store.pool.query(`SELECT EXISTS(
    SELECT 1 FROM audit_events
    WHERE workspace_id=$1 AND aggregate_type='demo_seed' AND aggregate_id=$1 AND event_type='demo.seed.completed'
  ) complete`, [workspaceId]);
  return Boolean(rows[0]?.complete);
}

async function resetIncompletePostgresDemo(store, existing) {
  if (!store.pool?.connect || !existing?.workspaceId) return false;
  const client = await store.pool.connect();
  try {
    await client.query('BEGIN');
    const workspace = (await client.query('SELECT organization_id FROM workspaces WHERE id=$1 FOR UPDATE', [existing.workspaceId])).rows[0];
    if (!workspace) { await client.query('COMMIT'); return false; }
    const users = (await client.query('SELECT user_id FROM memberships WHERE workspace_id=$1', [existing.workspaceId])).rows.map((row) => row.user_id);
    await client.query('DELETE FROM organizations WHERE id=$1', [workspace.organization_id]);
    if (users.length) {
      await client.query(`DELETE FROM users u WHERE u.id=ANY($1::uuid[])
        AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id)`, [users]);
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function markPostgresDemoSeedCompleted(store, owner) {
  if (!store.pool?.query) return;
  await store.pool.query(`INSERT INTO audit_events(
    organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
    SELECT $1,$2,'demo_seed',$2,'demo.seed.completed',$3,$4
    WHERE NOT EXISTS(
      SELECT 1 FROM audit_events
      WHERE workspace_id=$2 AND aggregate_type='demo_seed' AND aggregate_id=$2 AND event_type='demo.seed.completed'
    )`, [owner.organizationId, owner.workspaceId, owner.userId, { version:1, demo:'northstar' }]);
}

async function setProfileTitle(store, workspaceId, userId, title) {
  if (store.pool?.query) {
    await store.pool.query('UPDATE workspace_profiles SET title=$3,updated_at=now() WHERE workspace_id=$1 AND user_id=$2', [workspaceId, userId, title]);
    return;
  }
  const profileKey = store.membershipKey?.(workspaceId, userId);
  const profile = profileKey ? store.profiles?.get(profileKey) : null;
  if (profile) profile.title = title;
}

async function inviteDemoMember(store, ownerSession, { displayName, email, role, title }) {
  const token = createOpaqueToken();
  const tokenHash = hashToken(token);
  await store.createInvitation(ownerSession, {
    email,
    role,
    tokenHash,
    expiresAt: plusMinutes(7 * 24 * 60),
  });
  const password = hashPassword(DEMO_PASSWORD);
  const accepted = await store.acceptInvitation({
    tokenHash,
    displayName,
    passwordHash: password.hash,
    passwordSalt: password.salt,
  });
  await setProfileTitle(store, ownerSession.workspaceId, accepted.user.id, title);
  return accepted.user.id;
}

async function setTaskState(store, workspaceId, taskId, status, forecastAt = null) {
  if (store.pool?.query) {
    await store.pool.query(`UPDATE commitments SET status=$3,forecast_at=COALESCE($4,forecast_at),updated_at=now()
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, taskId, status, forecastAt]);
    return;
  }
  const row = store.tasks?.get(taskId);
  if (!row) return;
  row.status = status;
  if (forecastAt) row.forecastAt = forecastAt;
  row.updatedAt = new Date().toISOString();
}

async function rehydrateDemoFiles(store, objectStore, workspaceId) {
  if (!objectStore?.head || !objectStore?.put || !store.pool?.query || !workspaceId) return { checked:0, restored:0 };
  const names = DEMO_FILE_FIXTURES.map((fixture) => fixture.name);
  const { rows } = await store.pool.query(`SELECT name,storage_key "storageKey" FROM files
    WHERE workspace_id=$1 AND deleted_at IS NULL AND name=ANY($2::text[])`, [workspaceId, names]);
  const fixtures = new Map(DEMO_FILE_FIXTURES.map((fixture) => [fixture.name, fixture]));
  let restored = 0;
  for (const row of rows) {
    const fixture = fixtures.get(row.name);
    if (!fixture) continue;
    const state = await objectStore.head(row.storageKey);
    if (state?.exists) continue;
    await objectStore.put(row.storageKey, Buffer.from(fixture.body, 'utf8'), fixture.mimeType);
    restored++;
  }
  return { checked:rows.length, restored };
}

async function seedDemoFile(store, objectStore, session, conversationId, { name, mimeType, body }) {
  if (!objectStore) return null;
  const id = randomUUID();
  const buffer = Buffer.from(body, 'utf8');
  const extension = name.includes('.') ? `.${name.split('.').pop().slice(0,10)}` : '';
  const storageKey = `${session.workspaceId}/${id}${extension}`;
  await objectStore.put(storageKey, buffer, mimeType);
  const file = await store.saveFile(session, {
    id,
    name,
    mimeType,
    sizeBytes: buffer.length,
    storageKey,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    status: 'ready',
  });
  await store.createMessage(session, conversationId, {
    kind: 'file',
    body: null,
    metadata: { fileId:file.id, name:file.name, mimeType, size:file.sizeBytes ?? buffer.length },
  });
  return file;
}

export async function seedDemoWorkspace(store, objectStore = null) {
  let existing = await store.findAuthByEmail(DEMO_EMAIL);
  if (existing) {
    if (await postgresDemoSeedCompleted(store, existing.workspaceId)) {
      const files = await rehydrateDemoFiles(store, objectStore, existing.workspaceId);
      return { email:DEMO_EMAIL, existing:true, complete:true, files };
    }
    if (store.pool?.connect) {
      await resetIncompletePostgresDemo(store, existing);
      existing = null;
    } else {
      return { email:DEMO_EMAIL, existing:true, complete:true };
    }
  }

  const password = hashPassword(DEMO_PASSWORD);
  const created = await store.createCompany({
    companyName: 'Northstar Studio',
    workspaceName: 'Главное пространство',
    ownerName: 'Алексей Воронцов',
    email: DEMO_EMAIL,
    passwordHash: password.hash,
    passwordSalt: password.salt,
  });

  const base = {
    organizationId: created.organization.id,
    workspaceId: created.workspace.id,
  };
  const owner = actor(base, created.user.id, 'Алексей Воронцов', 'owner');

  const marinaId = await inviteDemoMember(store, owner, {
    displayName: 'Марина Орлова',
    email: 'marina@northstar.example',
    role: 'manager',
    title: 'Руководитель продукта',
  });
  const ilyaId = await inviteDemoMember(store, owner, {
    displayName: 'Илья Соколов',
    email: 'ilya@northstar.example',
    role: 'manager',
    title: 'Операционный руководитель',
  });
  const annaId = await inviteDemoMember(store, owner, {
    displayName: 'Анна Белова',
    email: 'anna@northstar.example',
    role: 'member',
    title: 'Дизайнер',
  });
  const maximId = await inviteDemoMember(store, owner, {
    displayName: 'Максим Лебедев',
    email: 'maxim@northstar.example',
    role: 'member',
    title: 'Разработчик',
  });
  const elenaId = await inviteDemoMember(store, owner, {
    displayName: 'Елена Волкова',
    email: 'elena@northstar.example',
    role: 'admin',
    title: 'Администратор пространства',
  });

  const marina = actor(base, marinaId, 'Марина Орлова', 'manager');
  const ilya = actor(base, ilyaId, 'Илья Соколов', 'manager');
  const anna = actor(base, annaId, 'Анна Белова');
  const maxim = actor(base, maximId, 'Максим Лебедев');
  const elena = actor(base, elenaId, 'Елена Волкова', 'admin');

  const initial = await store.listConversations(owner);
  const general = initial.find((item) => item.slug === 'general');
  const announcements = initial.find((item) => item.slug === 'announcements');

  const product = await store.createConversation(owner, {
    kind: 'channel',
    title: 'Продукт',
    slug: 'product',
    visibility: 'workspace',
    purpose: 'Релизы, UX и продуктовые решения',
  });
  const operations = await store.createConversation(owner, {
    kind: 'channel',
    title: 'Операции',
    slug: 'operations',
    visibility: 'workspace',
    purpose: 'Сроки, риски и исполнение',
  });
  const launch = await store.createConversation(owner, {
    kind: 'group',
    title: 'Запуск мобильной версии',
    visibility: 'private',
    purpose: 'Рабочая группа релиза',
    participantIds: [marinaId, annaId, maximId],
  });
  const direct = await store.createConversation(owner, {
    kind: 'direct',
    title: 'Марина Орлова',
    visibility: 'private',
    participantIds: [marinaId],
  });

  if (announcements) {
    await store.createMessage(owner, announcements.id, {
      body: 'Сегодня показываем обновлённое рабочее пространство: сообщения, задачи, календарь и встречи связаны между собой.',
    });
  }
  if (general) {
    const first = await store.createMessage(marina, general.id, {
      body: 'Команда, собрала финальный список приоритетов на неделю. Главный фокус — мобильный сценарий и скорость принятия решений.',
      mentionedUserIds: [owner.userId, maximId],
    });
    await store.createMessage(owner, general.id, {
      body: 'Принято. Всё, что требует решения, переводим из обсуждения в задачу с владельцем и сроком.',
      replyToId: first.id,
    });
    await store.toggleReaction(anna, first.id, '👍');
    await store.toggleReaction(maxim, first.id, '🔥');
  }

  const productAsk = await store.createMessage(marina, product.id, {
    body: 'Максим, проверь адаптивность новой панели звонка на iPhone. Анна, после этого нужен финальный visual QA.',
    mentionedUserIds: [maximId, annaId],
  });
  await store.createMessage(maxim, product.id, {
    body: 'WebRTC-панель уже адаптирована под safe-area. Сегодня закрываю поведение при reconnect и переключении камеры.',
    replyToId: productAsk.id,
  });

  if (objectStore) {
    const actors = { anna, ilya };
    const conversations = { product, operations };
    for (const fixture of DEMO_FILE_FIXTURES) {
      const uploader = actors[fixture.uploader];
      const conversation = conversations[fixture.conversationSlug];
      if (!uploader || !conversation) throw new Error(`Invalid demo file fixture: ${fixture.name}`);
      await seedDemoFile(store, objectStore, uploader, conversation.id, fixture);
    }
  } else {
    await store.createMessage(anna, product.id, {
      kind: 'file', body: null,
      metadata: { name:'mobile-call-review.pdf', mimeType:'application/pdf', size:1_840_000, demo:true },
    });
  }

  await store.createMessage(anna, product.id, {
    kind: 'voice',
    body: null,
    metadata: { durationMs: 27_000, demo: true },
  });

  await store.createMessage(ilya, operations.id, {
    body: 'Риск недели: не оставляем задачи без владельца. Просрочки и блокеры фиксируем в одном месте, без параллельных Excel.',
  });
  await store.createMessage(elena, operations.id, {
    body: 'Права доступа проверены. Гости не видят приватные диалоги, руководители могут управлять командными задачами.',
  });
  await store.createMessage(owner, operations.id, {
    kind: 'call',
    body: 'Итоги созвона: согласовали релизный контур и следующий набор проверок.',
    metadata: { durationMs: 1_980_000, participantCount: 5, demo: true },
  });

  await store.createMessage(marina, launch.id, {
    body: 'В этом чате ведём только запуск: критичные дефекты, решения и задачи до релиза.',
  });
  await store.createMessage(maxim, launch.id, {
    body: 'Сборка стабильна. Осталось проверить входящий звонок после повторной авторизации и фоновые push.',
  });
  await store.createMessage(owner, direct.id, {
    body: 'Марина, подготовь короткий статус для общего созвона: что готово, что блокирует, какие решения нужны от меня.',
  });
  await store.createMessage(marina, direct.id, {
    body: 'Да. Сведу в три блока и привяжу каждый открытый вопрос к конкретной задаче.',
  });

  const tasks = [];
  tasks.push(await store.createTask(owner, {
    title: 'Закрыть mobile QA звонков',
    outcome: 'Проверены iPhone-сценарии: камера, микрофон, screen share и reconnect',
    ownerId: maximId,
    acceptorId: owner.userId,
    sourceMessageId: productAsk.id,
    priority: 'urgent',
    promisedAt: plusMinutes(180),
  }));
  tasks.push(await store.createTask(owner, {
    title: 'Подготовить финальный UX review',
    ownerId: annaId,
    acceptorId: marinaId,
    priority: 'high',
    promisedAt: plusMinutes(360),
  }));
  tasks.push(await store.createTask(owner, {
    title: 'Собрать статус запуска для руководителя',
    ownerId: marinaId,
    acceptorId: owner.userId,
    priority: 'high',
    promisedAt: plusMinutes(90),
  }));
  tasks.push(await store.createTask(owner, {
    title: 'Проверить RBAC приватных каналов',
    ownerId: elenaId,
    acceptorId: owner.userId,
    priority: 'normal',
    promisedAt: plusMinutes(24 * 60),
  }));
  tasks.push(await store.createTask(owner, {
    title: 'Подготовить operational checklist релиза',
    ownerId: ilyaId,
    acceptorId: owner.userId,
    priority: 'normal',
    promisedAt: plusMinutes(30 * 60),
  }));
  tasks.push(await store.createTask(owner, {
    title: 'Утвердить состав следующего спринта',
    ownerId: owner.userId,
    acceptorId: owner.userId,
    priority: 'normal',
    promisedAt: plusMinutes(2 * 24 * 60),
  }));

  await setTaskState(store, owner.workspaceId, tasks[0].id, 'in_progress', plusMinutes(150));
  await setTaskState(store, owner.workspaceId, tasks[1].id, 'in_review');
  await setTaskState(store, owner.workspaceId, tasks[2].id, 'scheduled');
  await setTaskState(store, owner.workspaceId, tasks[3].id, 'accepted');
  await setTaskState(store, owner.workspaceId, tasks[4].id, 'blocked', plusMinutes(36 * 60));
  await setTaskState(store, owner.workspaceId, tasks[5].id, 'proposed');

  await store.createCalendarEvent(owner, {
    kind: 'meeting',
    title: 'Ежедневный статус команды',
    description: 'Решения, блокеры и следующие действия',
    ownerId: owner.userId,
    startAt: plusMinutes(45),
    endAt: plusMinutes(75),
    timezone: 'Europe/Moscow',
    conversationId: general?.id ?? null,
  });
  await store.createCalendarEvent(owner, {
    kind: 'focus',
    title: 'Фокус: продуктовый review',
    ownerId: owner.userId,
    startAt: plusMinutes(120),
    endAt: plusMinutes(210),
    timezone: 'Europe/Moscow',
  });
  await store.createCalendarEvent(owner, {
    kind: 'meeting',
    title: 'Релизный созвон',
    ownerId: marinaId,
    startAt: plusMinutes(300),
    endAt: plusMinutes(345),
    timezone: 'Europe/Moscow',
    conversationId: launch.id,
  });
  await store.createCalendarEvent(owner, {
    kind: 'deadline',
    title: 'Готовность мобильного релиза',
    ownerId: maximId,
    startAt: plusMinutes(24 * 60),
    timezone: 'Europe/Moscow',
  });

  await store.setPresence(owner, { state: 'online', statusText: 'В демо-пространстве' });
  await store.setPresence(marina, { state: 'busy', statusText: 'Подготовка релиза' });
  await store.setPresence(ilya, { state: 'online' });
  await store.setPresence(anna, { state: 'away' });
  await store.setPresence(maxim, { state: 'online' });
  await store.setPresence(elena, { state: 'do_not_disturb', statusText: 'Проверка доступов' });

  await markPostgresDemoSeedCompleted(store, owner);
  return { email:DEMO_EMAIL, existing:false, complete:true };
}
