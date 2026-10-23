import { lookup as systemLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { composeEmail, parseEmail, normalizeEmailAddresses, normalizeMessageId, EMAIL_MAX_MESSAGE_BYTES } from './email-mime.js';

const fail = (message, code, statusCode = 400, retryable = false) => Object.assign(new Error(message), { code, statusCode, expose: true, retryable });

// Provider documentation checked 2026-10-20. These are protocol presets, not OAuth clients.
export const EMAIL_PROVIDER_PRESETS = Object.freeze({
  gmail: Object.freeze({
    name: 'Gmail', supported: true, auth: 'app_password',
    imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    helpUrl: 'https://support.google.com/accounts/answer/185833',
  }),
  yandex: Object.freeze({
    name: 'Яндекс Почта', supported: true, auth: 'app_password',
    imap: { host: 'imap.yandex.ru', port: 993, secure: true }, smtp: { host: 'smtp.yandex.ru', port: 465, secure: true },
    helpUrl: 'https://yandex.ru/support/yandex-360/customers/mail/ru/mail-clients/others',
  }),
  mailru: Object.freeze({
    name: 'Mail.ru', supported: true, auth: 'app_password',
    imap: { host: 'imap.mail.ru', port: 993, secure: true }, smtp: { host: 'smtp.mail.ru', port: 465, secure: true },
    helpUrl: 'https://help.mail.ru/mail/login/mailer/',
  }),
  outlook: Object.freeze({
    name: 'Outlook.com', supported: false, auth: 'oauth2_required',
    imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    helpUrl: 'https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com',
  }),
  custom: Object.freeze({ name: 'IMAP / SMTP', supported: true, auth: 'password' }),
});

const privateV4 = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) privateV4.addSubnet(ip, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const reservedV6 = new BlockList();
for (const [ip, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20],
]) reservedV6.addSubnet(ip, prefix, 'ipv6');

export function isPublicEmailAddress(ip) {
  const family = isIP(ip);
  if (family === 4) return !privateV4.check(ip, 'ipv4');
  // Deny mapped IPv4, NAT64, loopback, ULA, link-local and multicast by default.
  if (family === 6) return globalV6.check(ip, 'ipv6') && !reservedV6.check(ip, 'ipv6');
  return false;
}

function hostname(value) {
  if (typeof value !== 'string' || value.length > 253 || /[\s\x00-\x1f\x7f/@?#%\\]/.test(value)) throw fail('Некорректный почтовый сервер', 'EMAIL_INVALID_HOST');
  const host = domainToASCII(value.toLowerCase().replace(/\.$/, ''));
  if (isIP(value)) return value;
  if (!host || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)
    || !host.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) throw fail('Нужен публичный почтовый сервер', 'EMAIL_INVALID_HOST');
  return host;
}

function endpoint(value, kind) {
  if (!value || typeof value !== 'object') throw fail('Нужны настройки IMAP и SMTP', 'EMAIL_INVALID_CONFIG');
  const allowed = new Set(['host', 'port', 'secure']);
  if (Object.keys(value).some(k => !allowed.has(k))) throw fail('Недопустимые параметры почтового соединения', 'EMAIL_INVALID_CONFIG');
  const defaultPort = kind === 'imap' ? (value.secure === false ? 143 : 993) : (value.secure === false ? 587 : 465);
  const port = Number(value.port ?? defaultPort);
  const secure = value.secure ?? (port === 993 || port === 465);
  if (typeof secure !== 'boolean' || (kind === 'imap' ? ![143, 993].includes(port) : ![465, 587].includes(port))
    || secure !== (port === 993 || port === 465)) throw fail('Используйте IMAP 993/STARTTLS 143 и SMTP 465/STARTTLS 587', 'EMAIL_TLS_REQUIRED');
  return { host: hostname(value.host), port, secure };
}

function folderName(value = 'INBOX') {
  if (typeof value !== 'string' || !value || value.length > 1000 || /[\x00-\x1f\x7f]/.test(value)) throw fail('Некорректная папка почты', 'EMAIL_INVALID_FOLDER');
  return value;
}

export function normalizeEmailConfig(value) {
  if (!value || typeof value !== 'object') throw fail('Нужны настройки почты', 'EMAIL_INVALID_CONFIG');
  const provider = value.provider === 'mail.ru' ? 'mailru' : String(value.provider ?? 'custom').toLowerCase();
  const preset = EMAIL_PROVIDER_PRESETS[provider];
  if (!preset) throw fail('Неизвестный почтовый провайдер', 'EMAIL_PROVIDER_UNSUPPORTED');
  if (!preset.supported || value.auth === 'oauth2' || value.accessToken) throw fail('Для этого подключения требуется OAuth, который ещё не настроен', 'EMAIL_OAUTH_REQUIRED');
  const email = normalizeEmailAddresses(value.email, { max: 1 });
  if (email.length !== 1) throw fail('Укажите адрес почтового ящика', 'EMAIL_INVALID_ADDRESS');
  const username = value.username ?? email[0].address;
  const password = value.password;
  if (typeof username !== 'string' || !username || username.length > 320 || /[\x00-\x1f\x7f]/.test(username)
    || typeof password !== 'string' || !password || password.length > 4000 || /[\x00\r\n]/.test(password)) throw fail('Укажите логин и пароль приложения', 'EMAIL_CREDENTIALS_REQUIRED');
  const displayName = String(value.displayName ?? email[0].name ?? '');
  if (displayName.length > 200 || /[\x00-\x1f\x7f]/.test(displayName)) throw fail('Некорректное имя отправителя', 'EMAIL_INVALID_CONFIG');
  // Gmail owns its Sent filing. Custom servers can explicitly delegate filing
  // too; otherwise CHATX appends only after checking for an existing copy.
  const sentCopyMode = value.sentCopyMode ?? (provider === 'gmail' ? 'provider' : 'append_if_missing');
  if (!['provider', 'append_if_missing'].includes(sentCopyMode)) throw fail('Некорректный режим папки отправленных', 'EMAIL_INVALID_CONFIG');
  let imap, smtp;
  if (provider === 'custom') {
    imap = endpoint(value.imap, 'imap'); smtp = endpoint(value.smtp, 'smtp');
  } else {
    imap = endpoint(preset.imap, 'imap'); smtp = endpoint(preset.smtp, 'smtp');
    for (const kind of ['imap', 'smtp']) {
      if (value[kind] && JSON.stringify(endpoint(value[kind], kind)) !== JSON.stringify(kind === 'imap' ? imap : smtp)) {
        throw fail('Для своего сервера выберите IMAP / SMTP', 'EMAIL_INVALID_CONFIG');
      }
    }
  }
  return { provider, email: email[0].address, displayName, username, password, imap, smtp,
    folder: folderName(value.folder ?? 'INBOX'), sentFolder: value.sentFolder ? folderName(value.sentFolder) : null, sentCopyMode };
}

/** Validate every DNS answer, then pin the chosen IP; libraries never re-resolve the hostname. */
export async function resolveEmailEndpoint(value, { lookup = systemLookup, timeoutMs = 5000 } = {}) {
  const host = hostname(value.host);
  let timer;
  let answers;
  try {
    answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), timeoutMs); timer.unref?.(); }),
    ]);
  } catch { throw fail('Не удалось найти почтовый сервер', 'EMAIL_DNS_FAILED', 502, true); }
  finally { clearTimeout(timer); }
  if (!Array.isArray(answers) || !answers.length || answers.length > 64 || answers.some(a => !isPublicEmailAddress(a.address))) {
    throw fail('Почтовый сервер указывает на закрытую или служебную сеть', 'EMAIL_HOST_FORBIDDEN');
  }
  const selected = answers.find(a => isIP(a.address) === 4) ?? answers[0];
  return { ...value, host: selected.address, servername: isIP(host) ? undefined : host, originalHost: host };
}

function providerError(error) {
  if (typeof error?.code === 'string' && error.code.startsWith('EMAIL_')) return error;
  if (error?.authenticationFailed || /AUTH/i.test(String(error?.code ?? ''))) return fail('Провайдер отклонил вход. Проверьте пароль приложения и доступ по IMAP/SMTP', 'EMAIL_AUTH_FAILED', 400);
  if (/LiteralTooLarge|ResponseTooLarge|LineTooLarge/.test(String(error?.code ?? ''))) return fail('Ответ почтового сервера превышает допустимый размер', 'EMAIL_MESSAGE_TOO_LARGE', 502);
  return fail('Не удалось выполнить операцию на почтовом сервере', 'EMAIL_CONNECTION_FAILED', 502, true);
}

const iso = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const uid = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 0xffffffff ? Number(value) : null;
const remoteId = (folder, validity, id) => `imap:${encodeURIComponent(folder)}:${validity}:${id}`;
const safeAddresses = entries => { try { return normalizeEmailAddresses(entries ?? []); } catch { return []; } };

function metadataMessage(item, folder, validity) {
  const e = item.envelope ?? {};
  return {
    providerMessageId: remoteId(folder, validity, item.uid), remoteUid: item.uid, folder, uidValidity: validity,
    internetMessageId: normalizeMessageId(e.messageId), inReplyTo: normalizeMessageId(e.inReplyTo), references: [],
    from: safeAddresses(e.from)[0] ?? null, to: safeAddresses(e.to), cc: safeAddresses(e.cc), bcc: safeAddresses(e.bcc),
    subject: String(e.subject ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 2000),
    sentAt: iso(e.date), receivedAt: iso(item.internalDate), flags: Array.from(item.flags ?? []),
    size: Number(item.size) || 0, text: '', html: null, raw: null, attachments: [],
  };
}

/**
 * Injected factories are trusted application/test code, never request fields or environment URLs.
 * Even factory tests receive validated, pinned public options; controlled test sockets can be
 * installed inside those factories without weakening production host or certificate checks.
 */
export function createEmailProvider({
  lookup = systemLookup,
  imapClientFactory = options => new ImapFlow(options),
  smtpTransportFactory = options => nodemailer.createTransport(options),
  connectionTimeout = 15000, socketTimeout = 30000,
  maxMessageBytes = EMAIL_MAX_MESSAGE_BYTES, maxBatchBytes = 32 * 1024 * 1024,
} = {}) {
  async function imap(config, action) {
    const address = await resolveEmailEndpoint(config.imap, { lookup });
    const client = await imapClientFactory({
      host: address.host, port: address.port, secure: address.secure, servername: address.servername,
      ...(!address.secure ? { doSTARTTLS: true } : {}),
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(address.servername ? { servername: address.servername } : {}) },
      auth: { user: config.username, pass: config.password }, logger: false, emitLogs: false, logRaw: false,
      disableAutoIdle: true, disableCompression: true, connectionTimeout, greetingTimeout: connectionTimeout, socketTimeout,
      maxLineLength: 1024 * 1024, maxLiteralSize: maxMessageBytes + 1024, maxResponseSize: maxMessageBytes + 1024 * 1024,
    });
    client.on?.('error', () => {});
    try { await client.connect(); return await action(client); }
    catch (error) { throw providerError(error); }
    finally { try { await client.logout(); } catch { client.close?.(); } }
  }

  async function smtp(config) {
    const address = await resolveEmailEndpoint(config.smtp, { lookup });
    return smtpTransportFactory({
      host: address.host, port: address.port, secure: address.secure,
      requireTLS: !address.secure, ignoreTLS: false,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(address.servername ? { servername: address.servername } : {}) },
      auth: { user: config.username, pass: config.password },
      connectionTimeout, greetingTimeout: connectionTimeout, socketTimeout,
      logger: false, debug: false, pool: false, disableFileAccess: true, disableUrlAccess: true,
    });
  }

  async function saveSentCopy(config, message) {
    try {
      return await imap(config, async client => {
        const sentFolder = config.sentFolder ?? (await client.list()).find(f => f.specialUse === '\\Sent')?.path;
        if (!sentFolder) return { status: 'unavailable', errorCode: 'EMAIL_SENT_FOLDER_UNAVAILABLE' };
        const lock = await client.getMailboxLock(sentFolder, { readOnly: true, acquireTimeout: connectionTimeout });
        try {
          const matches = await client.search({ header: { 'Message-ID': message.messageId } }, { uid: true }) || [];
          const candidates = matches.length ? await client.fetchAll(matches.slice(0, 50), { uid: true, envelope: true }, { uid: true }) : [];
          const exact = candidates.find(item => normalizeMessageId(item.envelope?.messageId) === message.messageId
            && safeAddresses(item.envelope?.from).some(a => a.address.toLowerCase() === config.email.toLowerCase()));
          if (exact) return { status: 'already_present', folder: sentFolder,
            providerMessageId: remoteId(sentFolder, String(client.mailbox.uidValidity), exact.uid) };
          if (matches.length > 50) return { status: 'unknown', folder: sentFolder, errorCode: 'EMAIL_SENT_SEARCH_INCOMPLETE' };
          if (config.sentCopyMode === 'provider') return { status: 'provider_pending', folder: sentFolder };
          const appended = await client.append(sentFolder, message.raw, ['\\Seen'], new Date(message.sentAt));
          if (!appended) return { status: 'unknown', folder: sentFolder, errorCode: 'EMAIL_SENT_COPY_UNKNOWN' };
          return { status: 'saved', folder: sentFolder,
            ...(appended.uid ? { providerMessageId: remoteId(sentFolder, String(appended.uidValidity ?? client.mailbox.uidValidity), appended.uid) } : {}) };
        } finally { lock.release(); }
      });
    } catch (error) {
      // SMTP acceptance is already irreversible. A failed APPEND can never
      // convert it into an SMTP failure or authorize another send.
      return { status: 'unknown', errorCode: providerError(error).code };
    }
  }

  return {
    async verify(value) {
      const config = normalizeEmailConfig(value);
      // Validate both endpoints before authenticating against either one.
      await Promise.all([resolveEmailEndpoint(config.imap, { lookup }), resolveEmailEndpoint(config.smtp, { lookup })]);
      const folders = await imap(config, async client => (await client.list()).map(f => ({ path: f.path, specialUse: f.specialUse ?? null })));
      const transport = await smtp(config);
      try { await transport.verify(); }
      catch (error) { throw providerError(error); }
      finally { try { transport.close?.(); } catch {} }
      const loginMatches = config.username.toLowerCase() === config.email.toLowerCase();
      return {
        address: config.email, displayName: config.displayName,
        capabilities: { read: true, send: loginMatches, oauth: false },
        aliases: loginMatches ? [config.email] : [],
        fromVerification: loginMatches ? 'authenticated_login' : 'unverified',
        folders, sentFolder: config.sentFolder ?? folders.find(f => f.specialUse === '\\Sent')?.path ?? null,
      };
    },

    async sync(value, { cursor = null, limit = 50, folder = null, knownMessages = [] } = {}) {
      const config = normalizeEmailConfig(value);
      const wantedFolder = folderName(folder ?? config.folder);
      const batchLimit = Math.min(100, Math.max(1, Number.isInteger(Number(limit)) ? Number(limit) : 50));
      if (!Array.isArray(knownMessages)) throw fail('Некорректный список известных писем', 'EMAIL_INVALID_CURSOR');
      return imap(config, async client => {
        const lock = await client.getMailboxLock(wantedFolder, { readOnly: true, acquireTimeout: connectionTimeout });
        try {
          const validity = String(client.mailbox.uidValidity ?? '');
          if (!/^[1-9][0-9]{0,9}$/.test(validity) || uid(validity) === null) throw fail('Сервер не сообщил UIDVALIDITY', 'EMAIL_IMAP_STATE_INVALID', 502);
          const exists = Number(client.mailbox.exists ?? 0);
          const snapshotLastUid = uid(Number(client.mailbox.uidNext) - 1);
          if (snapshotLastUid === null) throw fail('Сервер не сообщил UIDNEXT', 'EMAIL_IMAP_STATE_INVALID', 502);
          const reset = Boolean(cursor && (String(cursor.uidValidity) !== validity || cursor.folder && cursor.folder !== wantedFolder));
          const initial = !cursor || reset;
          let lastUid = initial ? 0 : uid(cursor.lastUid);
          if (lastUid === null) throw fail('Некорректный курсор синхронизации', 'EMAIL_INVALID_CURSOR');
          if (!initial && lastUid > snapshotLastUid) throw fail('UIDNEXT изменился без смены UIDVALIDITY', 'EMAIL_IMAP_STATE_INVALID', 502);
          // Two independent watermarks: backfill never moves the new-mail cursor
          // backwards. Old cursors without this field are safely backfilled too.
          let backfillBefore = initial ? null : (Object.hasOwn(cursor, 'backfillBefore') ? cursor.backfillBefore : (lastUid ? lastUid + 1 : null));
          if (backfillBefore != null && (!Number.isSafeInteger(Number(backfillBefore)) || Number(backfillBefore) < 1 || Number(backfillBefore) > 0x100000000)) throw fail('Некорректный курсор истории', 'EMAIL_INVALID_CURSOR');
          backfillBefore = backfillBefore == null ? null : Number(backfillBefore);
          let flagsAfterUid = initial ? 0 : uid(cursor.flagsAfterUid ?? 0);
          if (flagsAfterUid === null) throw fail('Некорректный курсор состояния писем', 'EMAIL_INVALID_CURSOR');
          const window = Math.max(batchLimit, Math.min(5000, batchLimit * 20));
          const fields = { uid: true, size: true, envelope: true, internalDate: true, flags: true };
          const messages = [], missingUids = [], changes = [], tombstones = [];
          let bytes = 0;
          async function consume(item) {
            if (messages.length >= batchLimit) return false;
            const base = metadataMessage(item, wantedFolder, validity);
            if (base.size > maxMessageBytes) {
              messages.push({ ...base, bodyStatus: 'too_large', errorCode: 'EMAIL_MESSAGE_TOO_LARGE' });
            } else {
              if (messages.length && bytes + base.size > maxBatchBytes) return false;
              const fetched = await client.fetchOne(item.uid, { source: true }, { uid: true });
              if (!fetched || !fetched.source) missingUids.push(item.uid);
              else {
                const raw = Buffer.from(fetched.source);
                if (messages.length && bytes + raw.length > maxBatchBytes) return false;
                bytes += raw.length;
                try { messages.push({ ...base, ...await parseEmail(raw, { maxBytes: maxMessageBytes }), bodyStatus: 'complete' }); }
                catch (error) {
                  if (error?.code === 'EMAIL_MESSAGE_TOO_LARGE') messages.push({ ...base, bodyStatus: 'too_large', errorCode: error.code });
                  else messages.push({ ...base, raw, bodyStatus: 'unparseable', errorCode: 'EMAIL_MIME_INVALID' });
                }
              }
            }
            return true;
          }

          if (exists && (initial || lastUid < snapshotLastUid)) {
            const endUid = initial ? snapshotLastUid : Math.min(snapshotLastUid, lastUid + window);
            const range = initial ? `${Math.max(1, exists - batchLimit + 1)}:${exists}` : `${lastUid + 1}:${endUid}`;
            const metadata = (await client.fetchAll(range, fields, { uid: !initial }))
              .filter(m => uid(m.uid) !== null && m.uid > lastUid && m.uid <= endUid).sort((a, b) => a.uid - b.uid);
            if (initial && exists > metadata.length) backfillBefore = metadata[0]?.uid ?? (snapshotLastUid + 1);
            const headLimit = !initial && backfillBefore != null && batchLimit > 1
              ? batchLimit - Math.min(10, Math.max(1, Math.floor(batchLimit / 4))) : batchLimit;
            let processed = 0;
            for (const item of metadata.slice(0, headLimit)) {
              if (!await consume(item)) break;
              lastUid = item.uid; processed++;
            }
            if (processed === metadata.length) lastUid = Math.max(lastUid, endUid);
          } else if (!exists) {
            lastUid = Math.max(lastUid, snapshotLastUid); backfillBefore = null;
          }

          if (backfillBefore != null && backfillBefore <= 1) backfillBefore = null;
          if (backfillBefore != null && messages.length < batchLimit) {
            const lower = Math.max(1, backfillBefore - window);
            const metadata = (await client.fetchAll(`${lower}:${backfillBefore - 1}`, fields, { uid: true }))
              .filter(m => uid(m.uid) !== null && m.uid >= lower && m.uid < backfillBefore).sort((a, b) => b.uid - a.uid);
            let processed = 0;
            for (const item of metadata) {
              if (!await consume(item)) break;
              backfillBefore = item.uid; processed++;
            }
            // Empty UID gaps are safe to skip; expunged UIDs will never be reused
            // within this UIDVALIDITY. An interrupted body never advances here.
            if (processed === metadata.length) backfillBefore = lower > 1 ? lower : null;
            if (backfillBefore != null && backfillBefore <= 1) backfillBefore = null;
          }

          const prefix = `imap:${encodeURIComponent(wantedFolder)}:${validity}:`;
          const known = [...new Map(knownMessages.flatMap(item => {
            const identity = typeof item === 'string' ? item : item?.providerMessageId;
            if (typeof identity !== 'string' || !identity.startsWith(prefix)) return [];
            const id = uid(identity.slice(prefix.length));
            return id ? [[id, { uid: id, identity, flags: item?.providerFlags ?? item?.flags }]] : [];
          })).values()].sort((a, b) => a.uid - b.uid);
          if (known.some(item => item.uid > snapshotLastUid)) throw fail('Известный UID превышает UIDNEXT', 'EMAIL_IMAP_STATE_INVALID', 502);
          let candidates = known.filter(item => item.uid > flagsAfterUid);
          if (!candidates.length) { candidates = known; flagsAfterUid = 0; }
          const checked = candidates.slice(0, 100);
          const flagsHasMore = candidates.length > checked.length;
          if (checked.length) {
            const fetched = await client.fetchAll(checked.map(item => item.uid), { uid: true, flags: true }, { uid: true });
            const byUid = new Map(fetched.map(item => [Number(item.uid), item]));
            for (const item of checked) {
              const current = byUid.get(item.uid);
              const identity = { providerMessageId: item.identity, remoteUid: item.uid, folder: wantedFolder, uidValidity: validity };
              if (!current) tombstones.push({ ...identity, reason: 'expunged' });
              else {
                const flags = Array.from(current.flags ?? []).sort();
                if (!Array.isArray(item.flags) || JSON.stringify([...item.flags].sort()) !== JSON.stringify(flags)) changes.push({ ...identity, flags });
              }
            }
            flagsAfterUid = flagsHasMore ? checked.at(-1).uid : 0;
          }
          const historyLimited = backfillBefore != null;
          return { messages, missingUids, changes, tombstones,
            cursor: { folder: wantedFolder, uidValidity: validity, lastUid, backfillBefore, flagsAfterUid },
            reset, initial, historyLimited, hasMore: lastUid < snapshotLastUid || historyLimited || flagsHasMore };
        } finally { lock.release(); }
      });
    },

    async send(value, payload) {
      let config, message;
      try {
        config = normalizeEmailConfig(value);
        if (config.username.toLowerCase() !== config.email.toLowerCase()) throw fail('Адрес отправителя не подтверждён почтовым логином', 'EMAIL_SENDER_UNVERIFIED');
        const from = payload?.from ? normalizeEmailAddresses(payload.from, { max: 1 }) : [{ address: config.email, name: config.displayName }];
        if (from.length !== 1 || from[0].address.toLowerCase() !== config.email.toLowerCase()) throw fail('Нельзя отправить письмо от другого адреса', 'EMAIL_SENDER_NOT_ALLOWED', 403);
        message = await composeEmail({ ...payload, from: from[0] }, { maxBytes: maxMessageBytes });
      } catch (error) {
        // A rejected draft has not reached any transport. Calling it unknown
        // would lock the user's unsent draft behind impossible reconciliation.
        return { status: 'failed', phase: 'preflight', errorCode: providerError(error).code,
          retryable: false, messageId: normalizeMessageId(payload?.messageId) };
      }
      // Repository storage must preserve these exact bytes, including MIME boundaries.
      // Re-composition after SMTP acceptance would create a different source artifact.
      const evidence = { raw: message.raw, sentAt: message.sentAt, from: message.from, to: message.to, cc: message.cc, bcc: message.bcc };
      let transport;
      try { transport = await smtp(config); }
      catch (error) { const e = providerError(error); return { status: 'failed', errorCode: e.code, retryable: e.retryable, messageId: message.messageId }; }
      try {
        const result = await transport.sendMail({ envelope: message.envelope, raw: message.raw, disableFileAccess: true, disableUrlAccess: true });
        const expected = new Map(message.envelope.to.map(a => [a.toLowerCase(), a]));
        const accepted = [...new Set((result.accepted ?? []).map(a => typeof a === 'string' ? a : a.address).map(a => expected.get(String(a).toLowerCase())).filter(Boolean))];
        if (!accepted.length) return { ...evidence, status: 'unknown_outcome', errorCode: 'EMAIL_SEND_UNKNOWN', retryable: false, messageId: message.messageId };
        const rejected = message.envelope.to.filter(a => !accepted.some(b => b.toLowerCase() === a.toLowerCase()));
        const sentCopy = await saveSentCopy(config, message);
        return { ...evidence, status: 'provider_accepted', providerMessageId: message.messageId, messageId: message.messageId,
          accepted, rejected, partial: rejected.length > 0, retryable: false, sentAt: message.sentAt, sentCopy,
          ...(rejected.length ? { errorCode: 'EMAIL_RECIPIENTS_PARTIALLY_REJECTED' } : {}) };
      } catch (error) {
        // Only an explicit SMTP rejection or a known pre-transfer failure permits a retry.
        // A timeout/disconnect can happen after DATA was accepted but before its reply arrived.
        const code = String(error?.code ?? '');
        const responseCode = Number(error?.responseCode);
        const rejected = responseCode >= 400 && responseCode <= 599;
        const beforeData = ['EAUTH', 'ETLS', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
          || ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.originalCode);
        if (rejected || beforeData) return {
          status: 'failed', errorCode: code === 'EAUTH' ? 'EMAIL_AUTH_FAILED' : 'EMAIL_SEND_REJECTED',
          retryable: rejected ? responseCode < 500 : code !== 'EAUTH' && code !== 'ETLS', messageId: message.messageId,
          ...(rejected ? { responseCode } : {}),
        };
        return { ...evidence, status: 'unknown_outcome', errorCode: 'EMAIL_SEND_UNKNOWN', retryable: false, messageId: message.messageId };
      } finally { try { transport.close?.(); } catch {} }
    },

    async reconcileSent(value, { messageId, since = null } = {}) {
      const config = normalizeEmailConfig(value);
      const wantedId = normalizeMessageId(messageId, { required: true });
      const after = since ? new Date(since) : null;
      if (after && Number.isNaN(after.getTime())) throw fail('Некорректная дата поиска отправки', 'EMAIL_INVALID_DATE');
      try {
        return await imap(config, async client => {
          const sentFolder = config.sentFolder ?? (await client.list()).find(f => f.specialUse === '\\Sent')?.path;
          if (!sentFolder) return { status: 'unknown_outcome', found: null, errorCode: 'EMAIL_SENT_FOLDER_UNAVAILABLE', retryable: false };
          const lock = await client.getMailboxLock(sentFolder, { readOnly: true, acquireTimeout: connectionTimeout });
          try {
            const matches = await client.search({ header: { 'Message-ID': wantedId }, ...(after ? { since: after } : {}) }, { uid: true }) || [];
            if (!matches.length) return { status: 'not_found', found: false, retryable: false };
            const candidates = await client.fetchAll(matches.slice(0, 50), { uid: true, envelope: true, internalDate: true }, { uid: true });
            // IMAP HEADER searches are substring searches. Never treat a substring hit as proof.
            const exact = candidates.find(m => normalizeMessageId(m.envelope?.messageId) === wantedId
              && safeAddresses(m.envelope?.from).some(a => a.address.toLowerCase() === config.email.toLowerCase()));
            if (exact) return { status: 'provider_accepted', found: true, evidence: 'imap_sent', retryable: false,
              providerMessageId: remoteId(sentFolder, String(client.mailbox.uidValidity), exact.uid), messageId: wantedId };
            return matches.length > 50
              ? { status: 'unknown_outcome', found: null, retryable: false, errorCode: 'EMAIL_SENT_SEARCH_INCOMPLETE' }
              : { status: 'not_found', found: false, retryable: false };
          } finally { lock.release(); }
        });
      } catch (error) {
        return { status: 'unknown_outcome', found: null, retryable: false, errorCode: providerError(error).code };
      }
    },
  };
}
