import { readFile } from 'node:fs/promises';
import { json, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const BOOKING_PAGE = /^\/email-booking\/[A-Za-z0-9_-]{43}$/;
const PUBLIC = /^\/api\/v1\/email-booking\/([A-Za-z0-9_-]{43})$/;
const RULES = new RegExp(`^/api/v1/email/mailboxes/${ID}/rules$`, 'i');
const PREVIEW = new RegExp(`^/api/v1/email/mailboxes/${ID}/rules/preview$`, 'i');
const RULE = new RegExp(`^/api/v1/email/rules/${ID}$`, 'i');
const ASSISTANT = new RegExp(`^/api/v1/email/threads/${ID}/assistant$`, 'i');
const BOOKING = new RegExp(`^/api/v1/email/messages/${ID}/booking-links$`, 'i');
const REVOKE = new RegExp(`^/api/v1/email/booking-links/${ID}$`, 'i');

export function createEmailExtrasHandler() {
  return async function handleEmailExtras(req, res, ctx, url, path, method) {
    if (BOOKING_PAGE.test(path) && method === 'GET') {
      const page = await readFile(new URL('../../public/email-booking.html', import.meta.url));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end(page); return true;
    }
    const publicMatch = path.match(PUBLIC);
    if (publicMatch && ['GET', 'POST'].includes(method)) {
      const value = method === 'GET' ? await ctx.emailExtras.getBooking(publicMatch[1]) : await ctx.emailExtras.book(publicMatch[1], await readJson(req));
      res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer');
      json(res, 200, value); return true;
    }
    const match = path.match(RULES) || path.match(PREVIEW) || path.match(RULE) || path.match(ASSISTANT) || path.match(BOOKING) || path.match(REVOKE);
    if (!match) return false;
    const session = await ctx.requireSession(req), extras = ctx.emailExtras;
    if(session.readOnly&&!['GET','HEAD'].includes(method))throw Object.assign(new Error('Ключ разрешает только чтение'),{code:'READ_ONLY_API_KEY',statusCode:403});
    let value, code = 200;
    if (RULES.test(path) && method === 'GET') value = await extras.listRules(session, match[1]);
    else if (RULES.test(path) && method === 'POST') { value = await extras.saveRule(session, match[1], await readJson(req)); code = 201; }
    else if (PREVIEW.test(path) && method === 'POST') value = await extras.previewRule(session, match[1], await readJson(req));
    else if (RULE.test(path) && method === 'PATCH') value = await extras.saveRule(session, await extras.ruleMailbox(session, match[1]), await readJson(req), match[1]);
    else if (RULE.test(path) && method === 'DELETE') value = await extras.deleteRule(session, match[1], await readJson(req));
    else if (ASSISTANT.test(path) && method === 'POST') value = await extras.assist(session, match[1], await readJson(req));
    else if (BOOKING.test(path) && method === 'POST') { value = await extras.createBooking(session, match[1], await readJson(req), String(req.headers['idempotency-key'] || '').trim() || null); code = 201; }
    else if (REVOKE.test(path) && method === 'DELETE') value = await extras.revokeBooking(session, match[1]);
    else return false;
    res.setHeader('cache-control', 'no-store'); json(res, code, value); return true;
  };
}
