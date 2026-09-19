// Both stores answer GET /api/v1/tasks, so the page order and the cursor that
// walks it live here rather than being written twice.
//
// The order is (promised_at ASC NULLS LAST, created_at DESC, id DESC): the
// soonest promise first, undated work last, and newest-first within a tie.

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function compareTasks(a, b) {
  const ap = iso(a.promisedAt);
  const bp = iso(b.promisedAt);
  if (ap !== bp) {
    if (ap === null) return 1;
    if (bp === null) return -1;
    return ap < bp ? -1 : 1;
  }
  const ac = iso(a.createdAt) ?? '';
  const bc = iso(b.createdAt) ?? '';
  if (ac !== bc) return ac > bc ? -1 : 1;
  return String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0;
}

// «-» stands for a task with no promised date, which sorts after every dated
// one. All three components travel so the keyset can resume exactly.
export const encodeTaskCursor = (row) =>
  `${iso(row.promisedAt) ?? '-'}|${iso(row.createdAt)}|${row.id}`;

const malformed = () =>
  Object.assign(new Error('Malformed cursor'), { code: 'INVALID_CURSOR', statusCode: 400 });

export function decodeTaskCursor(raw) {
  if (!raw) return null;
  const [promised, created, id] = String(raw).split('|');
  if (!promised || !created || !id) throw malformed();
  if (Number.isNaN(Date.parse(created))) throw malformed();
  if (promised !== '-' && Number.isNaN(Date.parse(promised))) throw malformed();
  return {
    promisedAt: promised === '-' ? null : new Date(promised).toISOString(),
    createdAt: new Date(created).toISOString(),
    id,
  };
}

export const taskPageSize = (limit) => Math.min(Math.max(Number(limit) || 50, 1), 200);
