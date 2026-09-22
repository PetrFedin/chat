/**
 * Тексты писем.
 *
 * Письмо от рабочего пространства — это не рассылка: человек его ждёт и
 * действует по нему один раз. Поэтому в каждом одно действие, одна
 * ссылка и срок её жизни; ни картинок, ни отписки, ни подвала.
 */

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Оболочка письма: одна колонка, системный шрифт, читается и без стилей. */
const page = ({ heading, lead, action, url, footer }) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f2ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e1e1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px;background:#ffffff;border-radius:16px">
<h1 style="margin:0 0 12px;font-size:21px;letter-spacing:-.02em">${esc(heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#55534e">${esc(lead)}</p>
<a href="${esc(url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#1e1e1c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600">${esc(action)}</a>
<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#8a8780">${esc(footer)}</p>
<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#8a8780;word-break:break-all">${esc(url)}</p>
</td></tr></table></td></tr></table></body></html>`;

const plain = ({ heading, lead, action, url, footer }) =>
  `${heading}\n\n${lead}\n\n${action}:\n${url}\n\n${footer}\n`;

export function invitationMail({ workspaceName, inviterName, role, url, expiresAt }) {
  const roleWord = { guest: 'гостя', member: 'сотрудника', manager: 'руководителя', admin: 'администратора' }[role] ?? 'сотрудника';
  const parts = {
    heading: `${inviterName} приглашает вас в «${workspaceName}»`,
    lead: `Вас добавляют в рабочее пространство «${workspaceName}» с правами ${roleWord}. Осталось придумать пароль и указать имя — после этого переписка, задачи и календарь компании будут у вас под рукой.`,
    action: 'Принять приглашение',
    url,
    footer: `Ссылка действует до ${formatDate(expiresAt)}. Если приглашение пришло по ошибке, просто не переходите по ней — без вашего пароля она ничего не открывает.`,
  };
  return { subject: `Приглашение в «${workspaceName}»`, text: plain(parts), html: page(parts) };
}

export function passwordResetMail({ workspaceName, url, expiresAt }) {
  const parts = {
    heading: 'Новый пароль для входа',
    lead: `Кто-то запросил смену пароля для вашей учётной записи в «${workspaceName}». Если это были вы — задайте новый пароль по ссылке ниже.`,
    action: 'Задать новый пароль',
    url,
    footer: `Ссылка действует до ${formatDate(expiresAt)} и сработает один раз. Если вы ничего не запрашивали, ничего делать не нужно: старый пароль продолжает работать, пока по ссылке не перешли.`,
  };
  return { subject: `Смена пароля в «${workspaceName}»`, text: plain(parts), html: page(parts) };
}

/**
 * Сводка «что я пропустил» письмом.
 *
 * Не рассылка и не дайджест новостей: перечень того, что ждёт
 * конкретного человека и случилось без него. Одна ссылка — открыть
 * пространство; всё остальное просто читается с экрана почты, потому
 * что человек, который был два дня на объекте, читает её именно там.
 *
 * Разделы с нулём строк не печатаются: «просрочено: 0» — это шум,
 * из-за которого перестают читать и остальное.
 */
export function digestMail({ workspaceName, displayName, url, digest }) {
  const sections = [
    ['Вас упоминали', (digest.mentions ?? []).map((m) =>
      `${m.authorName} · ${m.conversationTitle || 'личная переписка'}: ${oneLine(m.snippet ?? m.body)}`)],
    ['Ждут вашего ответа', (digest.awaiting ?? []).map((t) => `${t.title} — просит ${t.requesterName}`)],
    ['Сроки прошли', (digest.slipped ?? []).map((t) => `${t.title} — ${formatDay(t.promisedAt)}`)],
    ['Сдвинулось без вас', (digest.moved ?? []).map((t) => `${t.title} — ${t.actorName}: ${t.to}`)],
    ['Встречи', (digest.meetings ?? []).map((e) => `${formatDate(e.startAt)} — ${e.title}`)],
    ['Приглашения на встречи', (digest.invitations ?? []).map((e) => `${formatDate(e.startAt)} — ${e.title}`)],
  ].filter(([, lines]) => lines.length);

  const total = sections.reduce((sum, [, lines]) => sum + lines.length, 0);
  const lead = total
    ? `Пока вас не было, накопилось: ${total}. Вот всё, что касается вас лично.`
    : 'Пока вас не было, ничего, что требует вашего участия, не накопилось.';

  const text = [
    `Здравствуйте, ${displayName}.`, '', lead, '',
    ...sections.flatMap(([title, lines]) => [`${title}:`, ...lines.map((line) => `  — ${line}`), '']),
    `Открыть «${workspaceName}»:`, url, '',
    'Письмо приходит раз в день. Выключить его можно в настройках уведомлений.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f2ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e1e1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px;background:#ffffff;border-radius:16px">
<h1 style="margin:0 0 12px;font-size:21px;letter-spacing:-.02em">Что было без вас</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#55534e">${esc(lead)}</p>
${sections.map(([title, lines]) => `<h2 style="margin:22px 0 8px;font-size:15px">${esc(title)}</h2>
<ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.6;color:#1e1e1c">${
  lines.map((line) => `<li style="margin:0 0 4px">${esc(line)}</li>`).join('')}</ul>`).join('')}
<p style="margin:24px 0 0"><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#1e1e1c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600">Открыть «${esc(workspaceName)}»</a></p>
<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#8a8780">Письмо приходит раз в день. Выключить его можно в настройках уведомлений.</p>
</td></tr></table></td></tr></table></body></html>`;

  return { subject: total ? `Что было без вас: ${total}` : 'Что было без вас', text, html };
}

/** Одна строка: в письме перенос внутри пункта читается как новый пункт. */
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** День без часов — для сроков, где время суток ничего не добавляет. */
function formatDay(value) {
  if (!value) return 'без срока';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'без срока';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(date);
}

/**
 * Срок в письме пишется словами по-русски и в московском времени: «до
 * 2026-09-28T11:20:31.004Z» человеку не говорит ничего.
 */
function formatDate(value) {
  if (!value) return 'конца недели';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'конца недели';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  }).format(date) + ' (МСК)';
}
