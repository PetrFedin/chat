import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/postgres-store.js';
import { createCalendarRepository } from '../src/calendar/calendar-repository.js';
import { createEmailRepository } from '../src/email/email-repository.js';
import { createEmailLinkResources } from '../src/email/email-links.js';
import { createEmailExtras } from '../src/email/email-extras.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const day = days => new Date(Math.floor(Date.now() / 86400000) * 86400000 + days * 86400000 + 10 * 3600000).toISOString();
const slot = days => ({ startAt: day(days), endAt: new Date(Date.parse(day(days)) + 1800000).toISOString() });

async function harness(t) {
  const applicationName = 'email-calendar-race-' + randomUUID();
  const pool = new pg.Pool({ connectionString: databaseUrl, application_name: applicationName, max: 8,
    connectionTimeoutMillis: 2000, options: '-c statement_timeout=15000 -c lock_timeout=10000' });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const company = await store.createCompany({ companyName: 'Calendar booking race ' + randomUUID(), ownerName: 'Owner',
    email: randomUUID() + '@example.test', passwordHash: 'a'.repeat(128), passwordSalt: 'b'.repeat(32) });
  const owner = { organizationId: company.organization.id, workspaceId: company.workspace.id, userId: company.user.id, role: 'owner' };
  async function member() {
    const userId = randomUUID();
    await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [userId,userId + '@example.test']);
    await pool.query("INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,'member')", [owner.organizationId,owner.workspaceId,userId]);
    return { ...owner,userId,role:'member' };
  }
  const colleague = await member(), calendar = createCalendarRepository(pool,store);
  const linkResources = createEmailLinkResources({pool,store,calendar});
  const email = createEmailRepository({pool,store,linkResources});
  const extras = createEmailExtras({pool,email,calendar,linkResources,key:randomBytes(32).toString('base64')});
  const box = (await email.createMailbox(owner,{address:'owner@example.test',kind:'personal',providerId:'local'})).mailbox;
  const source = await email.importMessage(owner,box.id,{raw:
    `From: supplier@example.test\r\nTo: owner@example.test\r\nSubject: Choose a meeting\r\nMessage-ID: <${randomUUID()}@example.test>\r\n\r\nPlease choose a time.`});
  async function offer(interval) {
    const created = await extras.createBooking(owner,source.message.id,{title:'External meeting',timezone:'UTC',slots:[interval],confirmDisclosure:true});
    return created.url.split('/').at(-1);
  }
  const book = (token,interval) => extras.book(token,{name:'Visitor',email:'visitor@example.test',startAt:interval.startAt,submissionId:randomUUID(),allowConflict:true});
  const create = (session,interval,participants=[],extra={}) => calendar.createWithParticipants(session,{
    title:'Calendar event',kind:'meeting',visibility:'participants',timezone:'UTC',...interval,...extra,
  },participants).then(result=>result.event);
  async function raceOnOwner(first,second) {
    // Hold the real schedule lock, then wait until both independent writers
    // have reached an advisory lock. This deterministically exercises their
    // transaction ordering instead of relying on coincidental request timing.
    const gate = await pool.connect();
    let pending;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`calendar:${owner.workspaceId}:${owner.userId}`]);
      pending = [first,second].map(run=>Promise.resolve().then(run).then(value=>({ok:true,value}),error=>({ok:false,error})));
      const deadline = Date.now()+5000;
      let blocked = 0;
      do {
        const {rows} = await pool.query(`SELECT count(*)::int n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
          WHERE a.application_name=$1 AND l.locktype='advisory' AND NOT l.granted`,[applicationName]);
        blocked=rows[0].n;
        if (blocked>=2) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      } while(Date.now()<deadline);
      assert.equal(blocked,2,'both Calendar and booking must participate in the shared schedule lock');
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
    }
    return Promise.all(pending);
  }
  return {pool,owner,colleague,calendar,extras,member,offer,book,create,raceOnOwner};
}

test('Email booking races every Calendar occupancy writer for invited people', {skip:!databaseUrl,timeout:60000}, async t=>{
  const h=await harness(t);
  const scenarios=[
    ['create with participants',8,async interval=>()=>h.create(h.colleague,interval,[h.owner.userId])],
    ['new invitation',14,async interval=>{
      const event=await h.create(h.colleague,interval);
      return ()=>h.calendar.invite(h.colleague,event.id,[h.owner.userId]);
    }],
    ['declined RSVP becomes accepted',20,async interval=>{
      const event=await h.create(h.colleague,interval,[h.owner.userId]);
      await h.calendar.respond(h.owner,event.id,'declined');
      return ()=>h.calendar.respond(h.owner,event.id,'accepted');
    }],
    ['move re-invites a declined participant',26,async interval=>{
      const event=await h.create(h.colleague,slot(24),[h.owner.userId]);
      await h.calendar.respond(h.owner,event.id,'declined');
      return ()=>h.calendar.updateEvent(h.colleague,event.id,interval);
    }],
    ['rule-only change adds an occurrence',33,async()=>{
      const event=await h.create(h.colleague,slot(32),[h.owner.userId],{recurrenceRule:'FREQ=DAILY;INTERVAL=2;COUNT=2'});
      return ()=>h.calendar.updateEvent(h.colleague,event.id,{recurrenceRule:'FREQ=DAILY;COUNT=3'});
    }],
    ['move a recurring occurrence',40,async interval=>{
      const event=await h.create(h.colleague,slot(38),[h.owner.userId],{recurrenceRule:'FREQ=DAILY;COUNT=2'});
      return ()=>h.calendar.amendOccurrence(h.colleague,event.id,day(38),interval);
    }],
    ['restore a cancelled occurrence',46,async()=>{
      const event=await h.create(h.colleague,slot(46),[h.owner.userId],{recurrenceRule:'FREQ=DAILY;COUNT=2'});
      await h.calendar.amendOccurrence(h.colleague,event.id,day(46),{cancelled:true});
      return ()=>h.calendar.restoreOccurrence(h.colleague,event.id,day(46));
    }],
  ];
  for(const [name,days,prepare] of scenarios) await t.test(name,async()=>{
    const interval=slot(days), mutate=await prepare(interval), token=await h.offer(interval);
    assert.equal((await h.extras.getBooking(token)).slots.length,1,'the offered slot starts available');
    const results=await h.raceOnOwner(()=>h.book(token,interval),mutate);
    assert.equal(results.filter(result=>result.ok).length,1,results.map(r=>r.error?.code||'success').join(','));
    const denied=results.find(result=>!result.ok).error;
    assert.ok(['CALENDAR_CONFLICT','EMAIL_BOOKING_SLOT_UNAVAILABLE'].includes(denied.code),denied.stack);
    assert.equal((await h.calendar.findConflicts(h.owner,interval)).length,1,'only one competing interval may occupy the person');
  });
});

test('Calendar private conflicts stay private and editor override remains explicit', {skip:!databaseUrl,timeout:30000}, async t=>{
  const h=await harness(t), other=await h.member(), interval=slot(10);
  const secretTitle='PRIVATE-MEDICAL-'+randomUUID();
  await h.create(h.colleague,interval,[],{title:secretTitle,visibility:'private'});
  await assert.rejects(h.create(other,interval,[h.colleague.userId]),error=>{
    assert.equal(error.code,'CALENDAR_CONFLICT');
    assert.equal(error.message.includes(secretTitle),false);
    return true;
  });
  // Re-inviting an existing participant preserves their answer and does not
  // turn an explicit editor override into a new accidental claim on the slot.
  const deliberate=await h.create(other,interval,[h.colleague.userId],{allowConflict:true});
  await h.calendar.respond(h.colleague,deliberate.id,'declined');
  await h.calendar.invite(other,deliberate.id,[h.colleague.userId]);
  assert.equal((await h.calendar.getEvent(other,deliberate.id)).participants[0].response,'declined');
  await assert.rejects(h.calendar.respond(h.colleague,deliberate.id,'tentative'),{code:'CALENDAR_CONFLICT'});

  const bookedSlot=slot(53), token=await h.offer(bookedSlot);
  await h.book(token,bookedSlot);
  const series=await h.create(h.owner,slot(52),[],{recurrenceRule:'FREQ=DAILY;INTERVAL=2;COUNT=2'});
  await assert.rejects(h.calendar.updateEvent(h.owner,series.id,{recurrenceRule:'FREQ=DAILY;COUNT=3'}),{code:'CALENDAR_CONFLICT'});
  await h.calendar.updateEvent(h.owner,series.id,{recurrenceRule:'FREQ=DAILY;COUNT=3',allowConflict:true});
  const distant=slot(75);
  await h.create(h.owner,distant);
  await assert.rejects(h.create(h.owner,distant,[],{recurrenceRule:'FREQ=WEEKLY;COUNT=2'}),{code:'CALENDAR_CONFLICT'},'the first interval is checked outside the booking horizon too');
});

test('Opposite organisers lock the same invitees in a stable order', {skip:!databaseUrl,timeout:20000}, async t=>{
  const h=await harness(t), interval=slot(12);
  const results=await h.raceOnOwner(
    ()=>h.create(h.owner,interval,[h.colleague.userId]),
    ()=>h.create(h.colleague,interval,[h.owner.userId]),
  );
  assert.equal(results.filter(result=>result.ok).length,1);
  assert.equal(results.find(result=>!result.ok).error.code,'CALENDAR_CONFLICT','a conflict, not a deadlock or double reservation');
});
