import { randomUUID } from 'node:crypto';
import { Permission, hasPermission, requirePermission } from '../rbac.js';
import { opaqueRoomName } from '../media/livekit-provider.js';
import { cleanText, json, readJson, toDateOrNull } from './helpers.js';

const CALL_ID = '([0-9a-f-]+)';

function callNotFound() {
  return Object.assign(new Error('Звонок не найден'), { code: 'NOT_FOUND', statusCode: 404 });
}

async function accessibleCall(store, calls, session, callId) {
  const call = await calls.get(session, callId);
  if (!call || !(await store.canAccessConversation(session, call.conversationId))) throw callNotFound();
  return call;
}

export function createCallHandler() {
  return async function handleCalls(req, res, ctx, path, method) {
    const { store, calls, meeting, requireSession, hub, mediaProvider, notifyUsers } = ctx;
    let match = path.match(new RegExp(`^/api/v1/conversations/${CALL_ID}/calls$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      requirePermission(session.role, Permission.CALL_START);
      const conversationId = match[1];
      if (!(await store.canAccessConversation(session, conversationId))) throw callNotFound();
      const body = await readJson(req);
      const mode = body.mode === 'audio' ? 'audio' : 'video';
      const audience = await store.conversationAudience(session, conversationId);
      const requested = Array.isArray(body.participantIds) && body.participantIds.length ? body.participantIds : audience;
      const participants = [...new Set([session.userId, ...requested])];
      if (participants.length < 2) throw Object.assign(new Error('Для звонка нужно минимум два участника'), { code: 'CALL_REQUIRES_PARTICIPANTS' });
      if (participants.length > 100 || participants.some((id) => !audience.includes(id))) {
        throw Object.assign(new Error('Участники звонка должны состоять в этой беседе'), { code: 'INVALID_CALL_PARTICIPANTS', statusCode: 400 });
      }
      const providerRoomName = opaqueRoomName(session.workspaceId, randomUUID());
      const call = await calls.create(session, {
        conversationId,
        calendarEventId: body.calendarEventId ?? null,
        title: body.title ? cleanText(body.title, 240) : null,
        mode,
        participantIds: participants,
        scheduledFor: body.scheduledFor ?? null,
        providerRoomName,
      });
      const recipients = participants.filter((id) => id !== session.userId);
      hub.broadcastUsers(session.workspaceId, participants, 'call.created', { call });
      // Звонок писался только в push. Кто отошёл от стола — не узнавал о
      // нём никогда: в списке уведомлений звонков не было как класса.
      if (!body.scheduledFor) {
        await store.projectCallNotification?.(session, call, {
          recipients,
          type: 'call.started',
          title: `${session.displayName} звонит`,
          body: call.title || (mode === 'video' ? 'Видеозвонок' : 'Аудиозвонок'),
        });
      }
      await notifyUsers(session.workspaceId, recipients, {
        title: `${session.displayName} начинает ${mode === 'video' ? 'видеозвонок' : 'звонок'}`,
        body: call.title || 'Входящий корпоративный звонок',
        url: `/#/calls/${call.id}`,
        // Входящий звонок — личное обращение: он проходит по тому же
        // переключателю, что и личная переписка.
        kind: 'call.incoming',
      });
      json(res, 201, { call, media: mediaProvider.status() });
      return true;
    }

    /**
     * Назначенные звонки.
     *
     * Стоит до маршрута звонка по идентификатору: иначе «scheduled»
     * разберётся как чей-то звонок и ответит «не найдено».
     */
    if (path === '/api/v1/calls/scheduled' && method === 'GET') {
      const session = await requireSession(req);
      if (!calls.listScheduled) {
        throw Object.assign(new Error('Назначенные звонки доступны в режиме с базой данных'),
          { code: 'SCHEDULED_CALLS_UNAVAILABLE', statusCode: 503, expose: true });
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      json(res, 200, {
        items: await calls.listScheduled(session, {
          from: url.searchParams.get('from') ?? new Date(Date.now() - 3600_000).toISOString(),
          to: url.searchParams.get('to'),
        }),
      });
      return true;
    }

    /**
     * Назначить звонок: тема, время, участники, документы.
     *
     * Звонок и встреча в календаре — одно и то же событие, а не два
     * похожих: иначе у назначенного разговора не будет ни напоминания,
     * ни места в сетке дня, ни ответа «приду / не приду», и всё это
     * пришлось бы строить второй раз рядом.
     */
    if (path === '/api/v1/calls/scheduled' && method === 'POST') {
      const session = await requireSession(req);
      requirePermission(session.role, Permission.CALL_START);
      if (!calls.listScheduled || !ctx.calendar) {
        throw Object.assign(new Error('Назначенные звонки доступны в режиме с базой данных'),
          { code: 'SCHEDULED_CALLS_UNAVAILABLE', statusCode: 503, expose: true });
      }
      const body = await readJson(req);
      const conversationId = body.conversationId;
      if (!conversationId || !(await store.canAccessConversation(session, conversationId))) throw callNotFound();
      const mode = body.mode === 'audio' ? 'audio' : 'video';
      const title = cleanText(body.title, 240);
      // Строгий разбор: назначенный на 31 февраля звонок создавался на
      // 3 марта — и никто не приходил.
      const startIso = toDateOrNull(body.startAt);
      if (!startIso) {
        throw Object.assign(new Error('Не разобрали дату и время'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
      }
      const startAt = new Date(startIso);
      const minutes = Math.min(Math.max(Number(body.minutes) || 30, 5), 8 * 60);
      const endIso = body.endAt ? toDateOrNull(body.endAt) : null;
      const endAt = endIso ? new Date(endIso) : new Date(startAt.getTime() + minutes * 60000);
      if (Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        throw Object.assign(new Error('Звонок заканчивается раньше, чем начинается'), { code: 'INVALID_RANGE', statusCode: 400, expose: true });
      }

      const audience = await store.conversationAudience(session, conversationId);
      const requested = Array.isArray(body.participantIds) && body.participantIds.length ? body.participantIds : audience;
      const participants = [...new Set([session.userId, ...requested])];
      if (participants.length < 2) throw Object.assign(new Error('Для звонка нужно минимум два участника'), { code: 'CALL_REQUIRES_PARTICIPANTS' });
      if (participants.length > 100 || participants.some((id) => !audience.includes(id))) {
        throw Object.assign(new Error('Участники звонка должны состоять в этой беседе'), { code: 'INVALID_CALL_PARTICIPANTS', statusCode: 400 });
      }

      const { event } = await ctx.calendar.createWithParticipants(session, {
        kind: 'meeting',
        title,
        description: body.agenda ? cleanText(body.agenda, 4000) : null,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        timezone: body.timezone || session.profile?.timezone || 'UTC',
        visibility: 'participants',
        conversationId,
      }, participants.filter((id) => id !== session.userId));

      // Документы прикладываем к событию: у звонка своего хранилища
      // вложений нет и заводить второе незачем — материалы к разговору
      // и материалы к встрече это одно и то же.
      const attached = [];
      for (const fileId of (Array.isArray(body.fileIds) ? body.fileIds : []).slice(0, 20)) {
        await ctx.calendar.attachFile(session, event.id, fileId);
        attached.push(fileId);
      }

      const providerRoomName = opaqueRoomName(session.workspaceId, randomUUID());
      const call = await calls.create(session, {
        conversationId,
        calendarEventId: event.id,
        title,
        mode,
        participantIds: participants,
        scheduledFor: startAt.toISOString(),
        providerRoomName,
      });

      const recipients = participants.filter((id) => id !== session.userId);
      hub.broadcastUsers(session.workspaceId, participants, 'call.scheduled', { call });
      await notifyUsers(session.workspaceId, recipients, {
        title: `${session.displayName} назначает ${mode === 'video' ? 'видеозвонок' : 'звонок'}`,
        body: title,
        url: `/#/calls/${call.id}`,
        // Назначенный звонок — не входящий: он не звонит сейчас, и
        // будить им человека ночью незачем.
        kind: 'calendar.invited',
      });
      json(res, 201, { call, event, attached: attached.length });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}$`, 'i'));
    if (match && method === 'GET') {
      const session = await requireSession(req);
      const call = await accessibleCall(store, calls, session, match[1]);
      json(res, 200, { call, media: mediaProvider.status() });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/cancel$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      if (!calls.cancelScheduled) {
        throw Object.assign(new Error('Назначенные звонки доступны в режиме с базой данных'),
          { code: 'SCHEDULED_CALLS_UNAVAILABLE', statusCode: 503, expose: true });
      }
      const call = await accessibleCall(store, calls, session, match[1]);
      const cancelled = await calls.cancelScheduled(session, call.id);
      // Отменить может только тот, кто назначил: срывать чужие
      // договорённости чужими руками продукт помогать не должен.
      if (!cancelled) {
        throw Object.assign(new Error('Отменить назначенный звонок может тот, кто его назначил'),
          { code: 'CALL_CANCEL_FORBIDDEN', statusCode: 403, expose: true });
      }
      // Событие в календаре снимаем тем же действием: звонок и встреча
      // здесь — одно и то же, и половина отмены хуже, чем её отсутствие.
      if (cancelled.calendarEventId) await ctx.calendar?.cancelEvent(session, cancelled.calendarEventId).catch(() => {});
      hub.broadcastUsers(session.workspaceId, call.participants.map((p) => p.userId), 'call.cancelled', { callId: call.id });
      json(res, 200, { cancelled: true });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/join$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      const call = await accessibleCall(store, calls, session, match[1]);
      if (['ended', 'cancelled'].includes(call.state)) throw Object.assign(new Error('Звонок завершён'), { code: 'CALL_ENDED', statusCode: 409 });
      const credentials = await mediaProvider.issueJoinCredential({
        workspaceId: session.workspaceId,
        callId: call.id,
        roomName: call.providerRoomName,
        userId: session.userId,
        displayName: session.displayName,
      });
      const updated = await calls.join(session, call.id);
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.participant.joined', { callId: call.id, userId: session.userId, call: updated });
      json(res, 200, { call: updated, credentials });
      return true;
    }

    // «Не сейчас» — отдельное действие, а не выход из звонка: звонящий
    // должен увидеть отказ, а не гадать, оборвалась ли связь.
    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/decline$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      const call = await accessibleCall(store, calls, session, match[1]);
      const updated = await calls.decline(session, call.id);
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.participant.declined', { callId: call.id, userId: session.userId, call: updated });
      if (call.createdBy && call.createdBy !== session.userId) {
        await store.projectCallNotification?.(session, call, {
          recipients: [call.createdBy],
          type: 'call.declined',
          title: `${session.displayName} не может говорить`,
          body: call.title || 'Отклонён входящий звонок',
        });
      }
      json(res, 200, { call: updated });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/leave$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      const call = await accessibleCall(store, calls, session, match[1]);
      const updated = await calls.leave(session, call.id);
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.participant.left', { callId: call.id, userId: session.userId, call: updated });
      json(res, 200, { call: updated });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/media$`, 'i'));
    if (match && method === 'PATCH') {
      const session = await requireSession(req);
      const call = await accessibleCall(store, calls, session, match[1]);
      const body = await readJson(req);
      const connectionState = ['connecting', 'connected', 'reconnecting', 'disconnected'].includes(body.connectionState)
        ? body.connectionState
        : undefined;
      const participant = await calls.setMedia(session, call.id, {
        audioEnabled: typeof body.audioEnabled === 'boolean' ? body.audioEnabled : undefined,
        videoEnabled: typeof body.videoEnabled === 'boolean' ? body.videoEnabled : undefined,
        screenSharing: typeof body.screenSharing === 'boolean' ? body.screenSharing : undefined,
        connectionState,
      });
      if (!participant) throw callNotFound();
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.media.updated', { callId: call.id, participant });
      json(res, 200, { participant });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/recording-consent$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      const call = await accessibleCall(store, calls, session, match[1]);
      const participant = await calls.consentRecording(session, call.id);
      if (!participant) throw callNotFound();
      const consentReady = await calls.recordingConsentReady(session, call.id);
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.recording.consent', { callId: call.id, userId: session.userId, consentReady });
      json(res, 200, { participant, consentReady });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/recording/start$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      requirePermission(session.role, Permission.CALL_RECORD);
      const call = await accessibleCall(store, calls, session, match[1]);
      if (call.state !== 'active') throw Object.assign(new Error('Запись требует активного звонка'), { code: 'CALL_NOT_ACTIVE', statusCode: 409 });
      if (!(await calls.recordingConsentReady(session, call.id))) {
        throw Object.assign(new Error('Все активные участники должны согласиться на запись'), { code: 'RECORDING_CONSENT_REQUIRED', statusCode: 409 });
      }
      const providerResult = await mediaProvider.startRecording({
        workspaceId: session.workspaceId,
        callId: call.id,
        roomName: call.providerRoomName || opaqueRoomName(session.workspaceId, call.id),
      });
      let recording;
      try {
        recording = await calls.startRecording(session, call.id, providerResult);
        await meeting?.registerRecording?.({
          ...recording,
          organizationId: session.organizationId,
          workspaceId: session.workspaceId,
          callId: call.id,
        });
      } catch (error) {
        await mediaProvider.stopRecording(providerResult.providerRecordingId, providerResult.transcriptionProviderRecordingId).catch(() => {});
        throw error;
      }
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.recording.started', { callId: call.id, recording });
      json(res, 201, { recording });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/recording/stop$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      requirePermission(session.role, Permission.CALL_RECORD);
      const call = await accessibleCall(store, calls, session, match[1]);
      const activeRecording = [...(call.recordings ?? [])].reverse().find((r) => r.status === 'recording');
      if (!activeRecording) throw Object.assign(new Error('Нет активной записи'), { code: 'NO_ACTIVE_RECORDING', statusCode: 409 });
      await mediaProvider.stopRecording(activeRecording.providerRecordingId, activeRecording.transcriptionProviderRecordingId);
      const recording = await calls.stopRecording(session, call.id);
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.recording.stopped', { callId: call.id, recording });
      json(res, 200, { recording });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/calls/${CALL_ID}/end$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      const call = await accessibleCall(store, calls, session, match[1]);
      if (call.createdBy !== session.userId && !hasPermission(session.role, Permission.CALL_MANAGE)) {
        throw Object.assign(new Error('Завершить звонок может только его создатель или руководитель'), { code: 'FORBIDDEN', statusCode: 403 });
      }
      const activeRecording = [...(call.recordings ?? [])].reverse().find((r) => r.status === 'recording');
      if (activeRecording) {
        await mediaProvider.stopRecording(activeRecording.providerRecordingId, activeRecording.transcriptionProviderRecordingId).catch(() => {});
        await calls.stopRecording(session, call.id).catch(() => {});
      }
      const ended = await calls.end(session, call.id);
      const audience = await store.conversationAudience(session, call.conversationId);
      hub.broadcastUsers(session.workspaceId, audience, 'call.ended', { callId: call.id, call: ended });
      json(res, 200, { call: ended });
      return true;
    }

    return false;
  };
}
