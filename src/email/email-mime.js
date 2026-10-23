import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { simpleParser } from 'mailparser';
import addressparser from 'nodemailer/lib/addressparser';
import MailComposer from 'nodemailer/lib/mail-composer';

export const EMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const fail = (message, code = 'EMAIL_INVALID_MESSAGE') => Object.assign(new Error(message), { code, statusCode: 400, expose: true });
const noControls = value => !/[\x00-\x1f\x7f]/.test(value);

function address(value) {
  if (!value || typeof value.address !== 'string') throw fail('Укажите полный адрес электронной почты', 'EMAIL_INVALID_ADDRESS');
  const candidate = value.address.trim();
  const at = candidate.lastIndexOf('@');
  const local = candidate.slice(0, at);
  const domain = domainToASCII(candidate.slice(at + 1)).toLowerCase();
  if (at < 1 || local.length > 64 || candidate.length > 320 || !noControls(candidate) || /[\s<>@(),;:"\\]/.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || !domain || domain.length > 253 || !domain.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p))) {
    throw fail('Некорректный адрес электронной почты', 'EMAIL_INVALID_ADDRESS');
  }
  const name = String(value.name ?? '');
  if (name.length > 200 || !noControls(name)) throw fail('Некорректное имя адресата', 'EMAIL_INVALID_ADDRESS');
  return { address: `${local}@${domain}`, name };
}

/** RFC address parser, with a strict boundary before MIME header construction. */
export function normalizeEmailAddresses(value, { max = 100 } = {}) {
  if (value == null || value === '') return [];
  const input = Array.isArray(value) ? value : [value];
  const result = [];
  const add = item => {
    if (item?.group) { for (const member of item.group) add(member); return; }
    result.push(address(item));
    if (result.length > max) throw fail('Слишком много адресатов', 'EMAIL_TOO_MANY_RECIPIENTS');
  };
  for (const item of input) {
    if (typeof item === 'string') {
      if (item.length > 32768 || !noControls(item)) throw fail('Некорректный адрес электронной почты', 'EMAIL_INVALID_ADDRESS');
      for (const parsed of addressparser(item)) add(parsed);
    } else add(item);
  }
  return result;
}

export function normalizeMessageId(value, { required = false } = {}) {
  let id = typeof value === 'string' ? value.trim() : '';
  if (id.startsWith('<') && id.endsWith('>')) id = id.slice(1, -1);
  if (!id || id.length > 950 || !/^[^\s<>@\x00-\x1f\x7f]+@[^\s<>@\x00-\x1f\x7f]+$/.test(id)) {
    if (required) throw fail('Для отправки нужен сохранённый Message-ID', 'EMAIL_MESSAGE_ID_REQUIRED');
    return null;
  }
  return `<${id}>`;
}

const parsedAddresses = value => {
  const result = [];
  const walk = entries => {
    for (const entry of entries ?? []) {
      if (entry.group) walk(entry.group);
      else {
        try { result.push(address(entry)); } catch { /* Preserve malformed originals in raw MIME, not UI headers. */ }
      }
    }
  };
  for (const field of Array.isArray(value) ? value : [value]) walk(field?.value);
  return result;
};

const referenceIds = value => {
  const parts = Array.isArray(value) ? value : (typeof value === 'string' ? (value.match(/<[^<>]+>/g) ?? [value]) : []);
  return [...new Set(parts.map(v => normalizeMessageId(v)).filter(Boolean))].slice(-100);
};

/** HTML is untrusted source content. Render text, or sanitize in the presentation layer. */
export async function parseEmail(raw, { maxBytes = EMAIL_MAX_MESSAGE_BYTES } = {}) {
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw) || raw instanceof Uint8Array)) throw fail('Нужен исходный MIME письма');
  const source = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (!source.length || source.length > maxBytes) throw fail('Письмо превышает допустимый размер', 'EMAIL_MESSAGE_TOO_LARGE');
  const parsed = await simpleParser(source, {
    keepCidLinks: true, skipTextToHtml: true, skipTextLinks: true,
    maxHtmlLengthToParse: maxBytes, checksumAlgo: 'sha256', keepDeliveryStatus: true,
  });
  const from = parsedAddresses(parsed.from);
  return {
    internetMessageId: normalizeMessageId(parsed.messageId),
    inReplyTo: normalizeMessageId(parsed.inReplyTo),
    references: referenceIds(parsed.references),
    from: from[0] ?? null,
    fromAddresses: from,
    to: parsedAddresses(parsed.to), cc: parsedAddresses(parsed.cc), bcc: parsedAddresses(parsed.bcc),
    replyTo: parsedAddresses(parsed.replyTo),
    subject: String(parsed.subject ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 2000),
    text: typeof parsed.text === 'string' ? parsed.text : '',
    html: typeof parsed.html === 'string' ? parsed.html : null,
    htmlIsUnsafe: true,
    sentAt: parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    attachments: (parsed.attachments ?? []).map(a => ({
      name: String(a.filename ?? 'attachment').replace(/[\x00-\x1f\x7f]/g, '').split(/[/\\]/).pop().slice(0, 255) || 'attachment',
      mimeType: a.contentType || 'application/octet-stream',
      size: a.content.length, content: a.content,
      contentId: a.cid ?? null, contentDisposition: a.contentDisposition ?? 'attachment',
      sha256: createHash('sha256').update(a.content).digest('hex'),
    })),
    raw: source,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
  };
}

/** Only in-memory attachment bytes are accepted; file/URL descriptors never cross this boundary. */
export async function composeEmail(payload, { maxBytes = EMAIL_MAX_MESSAGE_BYTES } = {}) {
  const messageId = normalizeMessageId(payload?.messageId, { required: true });
  const from = normalizeEmailAddresses(payload.from, { max: 1 });
  const to = normalizeEmailAddresses(payload.to), cc = normalizeEmailAddresses(payload.cc), bcc = normalizeEmailAddresses(payload.bcc);
  if (from.length !== 1) throw fail('Нужен один отправитель', 'EMAIL_INVALID_ADDRESS');
  const recipients = [...to, ...cc, ...bcc];
  if (!recipients.length) throw fail('Укажите адресата', 'EMAIL_RECIPIENT_REQUIRED');
  if (recipients.length > 100) throw fail('Слишком много адресатов', 'EMAIL_TOO_MANY_RECIPIENTS');
  const subject = String(payload.subject ?? '');
  if (!noControls(subject) || subject.length > 2000) throw fail('Некорректная тема письма');
  if (payload.text != null && typeof payload.text !== 'string' || payload.html != null && typeof payload.html !== 'string') throw fail('Тело письма должно быть текстом');
  const text = payload.text ?? '', html = payload.html ?? undefined;
  const sentAt = new Date(payload.sentAt ?? payload.date ?? Date.now());
  if (Number.isNaN(sentAt.getTime())) throw fail('Некорректная дата письма');
  let totalBytes = Buffer.byteLength(text) + Buffer.byteLength(html ?? '');
  if (!Array.isArray(payload.attachments ?? [])) throw fail('Некорректные вложения');
  if ((payload.attachments ?? []).length > 50) throw fail('Слишком много вложений', 'EMAIL_TOO_MANY_ATTACHMENTS');
  const attachments = (payload.attachments ?? []).map(item => {
    if (!item || ['path', 'href', 'raw', 'headers'].some(k => Object.hasOwn(item, k))) throw fail('Вложения принимаются только как байты', 'EMAIL_ATTACHMENT_SOURCE_FORBIDDEN');
    let content;
    if (Buffer.isBuffer(item.content) || item.content instanceof Uint8Array) content = Buffer.from(item.content);
    else if (typeof item.content === 'string') content = Buffer.from(item.content, item.encoding === 'base64' ? 'base64' : 'utf8');
    else throw fail('Вложение не содержит байтов', 'EMAIL_INVALID_ATTACHMENT');
    totalBytes += content.length;
    const filename = String(item.name ?? item.filename ?? 'attachment');
    const contentType = String(item.mimeType ?? item.contentType ?? 'application/octet-stream');
    const cid = item.contentId ?? item.cid ?? undefined;
    if (!noControls(filename) || filename.length > 255 || !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(contentType)
      || cid != null && (typeof cid !== 'string' || !noControls(cid) || cid.length > 255)) throw fail('Некорректные метаданные вложения', 'EMAIL_INVALID_ATTACHMENT');
    return { filename: filename.split(/[/\\]/).pop(), content, contentType, cid, contentDisposition: item.contentDisposition === 'inline' ? 'inline' : 'attachment' };
  });
  if (totalBytes > maxBytes) throw fail('Письмо превышает допустимый размер', 'EMAIL_MESSAGE_TOO_LARGE');
  const envelope = { from: from[0].address, to: [...new Map(recipients.map(a => [a.address.toLowerCase(), a.address])).values()] };
  const node = new MailComposer({
    from: from[0], to, cc, bcc, subject, text, html, attachments, messageId,
    date: sentAt, inReplyTo: normalizeMessageId(payload.inReplyTo), references: referenceIds(payload.references),
    replyTo: payload.replyTo ? normalizeEmailAddresses(payload.replyTo) : undefined,
    envelope, disableFileAccess: true, disableUrlAccess: true, newline: '\r\n',
  }).compile();
  node.keepBcc = false;
  const raw = await node.build();
  if (raw.length > maxBytes) throw fail('Письмо с MIME-кодированием превышает допустимый размер', 'EMAIL_MESSAGE_TOO_LARGE');
  return { raw, messageId, envelope, sentAt: sentAt.toISOString(), from: from[0], to, cc, bcc, subject, text, html: html ?? null };
}
