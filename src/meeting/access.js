function notFound(message = 'Meeting not found') {
  return Object.assign(new Error(message), { code: 'NOT_FOUND', statusCode: 404 });
}

/**
 * Canonical call/meeting access check reused by Calls, Meeting Intelligence
 * and Page relations. Conversation membership is necessary for every call.
 * Meeting surfaces may additionally require a guest to have been an explicit
 * participant: access to a shared channel is not access to every recorded call.
 */
export async function requireAccessibleCall({ store, calls, session, callId, guestMustParticipate = false, message = 'Meeting not found' }) {
  const call = await calls?.get?.(session, callId);
  if (!call || !(await store?.canAccessConversation?.(session, call.conversationId))) throw notFound(message);
  if (guestMustParticipate && session.role === 'guest'
      && !(call.participants ?? []).some((p) => p.userId === session.userId)) {
    throw notFound(message);
  }
  return call;
}

export async function canAccessMeetingCall(args) {
  try {
    return await requireAccessibleCall({ ...args, guestMustParticipate: true });
  } catch (error) {
    if (error?.statusCode === 404) return null;
    throw error;
  }
}
