import { createOpaqueToken, hashPassword, hashToken } from '../security.js';

export const DEMO_EMAIL = 'demo@northstar.example';
export const DEMO_PASSWORD = 'DemoWorkspace2026';

const plusMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

function actor(base, userId, displayName, role = 'member') {
  return { ...base, userId, displayName, role };
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
  const profileKey = store.membershipKey?.(ownerSession.workspaceId, accepted.user.id);
  const profile = profileKey ? store.profiles?.get(profileKey) : null;
  if (profile) profile.title = title;
  return accepted.user.id;
}

function setTaskState(store, taskId, status, forecastAt = null) {
  const row = store.tasks?.get(taskId);
  if (!row) return;
  row.status = status;
  if (forecastAt) row.forecastAt = forecastAt;
  row.updatedAt = new Date().toISOString();
}

export async function seedDemoWorkspace(store) {
  const existing = await store.findAuthByEmail(DEMO_EMAIL);
  if (existing) return { email: DEMO_EMAIL };

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
  await store.createMessage(anna, product.id, {
    kind: 'file',
    body: null,
    metadata: {
      name: 'mobile-call-review.pdf',
      mimeType: 'application/pdf',
      size: 1_840_000,
      demo: true,
    },
  });
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

  setTaskState(store, tasks[0].id, 'in_progress', plusMinutes(150));
  setTaskState(store, tasks[1].id, 'in_review');
  setTaskState(store, tasks[2].id, 'scheduled');
  setTaskState(store, tasks[3].id, 'accepted');
  setTaskState(store, tasks[4].id, 'blocked', plusMinutes(36 * 60));
  setTaskState(store, tasks[5].id, 'proposed');

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

  return { email: DEMO_EMAIL };
}
