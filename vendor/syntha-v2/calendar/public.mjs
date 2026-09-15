import { invariant } from '../../core/errors.mjs';

export function createCalendarMilestone({ id, ownerOrganisationId, cycleId, type, title, startsAt, visibility = 'private' }) {
  invariant(id && ownerOrganisationId && cycleId, 'CALENDAR_LINK_REQUIRED', 'Calendar milestone must be linked to owner and cycle');
  invariant(['buying', 'order', 'deal'].includes(type), 'CALENDAR_TYPE_INVALID', 'Unsupported calendar milestone type', { type });
  invariant(['private', 'shared'].includes(visibility), 'CALENDAR_VISIBILITY_INVALID', 'Invalid calendar visibility');
  return Object.freeze({ id, ownerOrganisationId, cycleId, type, title, startsAt, visibility });
}
