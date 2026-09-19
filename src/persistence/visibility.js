/**
 * Who a workspace-wide conversation is actually wide to.
 *
 * `visibility: 'workspace'` is a convenience for staff — a channel nobody has
 * to be invited to. A guest is an outside participant: a client, a contractor,
 * an auditor. Treating them as "part of the workspace" hands them the general
 * channel, the announcements and every other open room, which is how a payroll
 * reminder ends up in front of a customer.
 *
 * A guest therefore reaches a conversation only through an explicit membership
 * row. The clause below is inlined into SQL, and it is safe to inline: it
 * returns one of two fixed strings, chosen by a role that came from the
 * database, never from a request body.
 */
export const GUEST_ROLE = 'guest';

export const isGuest = (session) => session?.role === GUEST_ROLE;

export const openConversationSql = (session, alias = 'c') =>
  (isGuest(session) ? 'false' : `${alias}.visibility IN('workspace','organization')`);
