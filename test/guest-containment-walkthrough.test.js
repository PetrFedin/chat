import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function fixture(t) {
  const app = await createChatServer({ store: new MemoryStore() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: 'Северная Верфь', ownerName: 'Владелец', email: 'owner@verf.test', password: 'OwnerPassword42' },
  });

  const join = async (email, displayName, role) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email, role },
    });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName, password: 'OwnerPassword42' },
    });
    const boot = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, userId: boot.payload.session.userId };
  };

  return { base, owner, join };
}

// A guest is the customer's representative, invited into one room. The company
// chart — its departments, headcount plan and who runs each unit — is not
// theirs to read.
test('a guest cannot read the company org chart', async (t) => {
  const { base, owner, join } = await fixture(t);
  const guest = await join('client@zakazchik.test', 'Представитель заказчика', 'guest');
  const staff = await join('worker@verf.test', 'Сотрудник', 'member');

  const built = await request(base, '/api/v1/org/units', {
    cookie: owner.cookie, method: 'POST', body: { name: 'Производство', kind: 'department', seatLimit: 18 },
  });
  // Without a database the org module is unavailable; the guest rule still has
  // to be the thing that answers first.
  const forGuest = await request(base, '/api/v1/org/units', { cookie: guest.cookie });
  assert.equal(forGuest.response.status, 404, 'гость получил оргструктуру');
  assert.equal(forGuest.payload?.error?.code, 'NOT_FOUND');

  if (built.response.status === 201) {
    const forStaff = await request(base, '/api/v1/org/units', { cookie: staff.cookie });
    assert.equal(forStaff.response.status, 200, 'сотрудник должен читать дерево');
  }
});

// canViewTask refuses a guest, so naming one as owner or acceptor creates a
// commitment that person can never see, accept, decline or deliver: it sits in
// proposed until somebody cancels it.
test('a guest cannot be made to carry a commitment', async (t) => {
  const { base, owner, join } = await fixture(t);
  const guest = await join('client@zakazchik.test', 'Представитель заказчика', 'guest');
  const staff = await join('worker@verf.test', 'Сотрудник', 'member');

  const asOwner = await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Гость как ответственный', ownerId: guest.userId },
  });
  assert.equal(asOwner.response.status, 400, 'задачу повесили на гостя');
  assert.equal(asOwner.payload?.error?.code, 'GUEST_CANNOT_HOLD_TASK');

  const asAcceptor = await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Гость принимает результат', ownerId: staff.userId, acceptorId: guest.userId },
  });
  assert.equal(asAcceptor.response.status, 400, 'гостя назначили приёмщиком');
  assert.equal(asAcceptor.payload?.error?.code, 'GUEST_CANNOT_HOLD_TASK');

  const normal = await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Обычная задача', ownerId: staff.userId },
  });
  assert.equal(normal.response.status, 201, 'штатная задача должна создаваться');
});
