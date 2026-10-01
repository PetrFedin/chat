import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Проверка адреса, по которому сервер пойдёт сам.
 *
 * Подписка на события — это исходящий запрос, который делает наш сервер
 * из нашей сети. Владелец рабочего пространства, указав в ней
 * `http://127.0.0.1:3000/api/v1/...` или `http://169.254.169.254/`,
 * получает чужими руками доступ туда, куда снаружи ходу нет: к соседним
 * службам на той же машине, к служебному адресу облачных метаданных, к
 * внутренней сети.
 *
 * Поэтому наружу разрешён только публичный адрес. Проверка идёт по
 * литералу в адресе; имя, которое разрешится во внутренний адрес, здесь
 * не поймать — это делается при самой отправке (см. сноску ниже).
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata', 'metadata.google.internal', 'instance-data',
]);

/** Внутренние диапазоны IPv4, в которые исходящий запрос ходить не должен. */
function isPrivateV4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;                    // текущая сеть
  if (a === 10) return true;                   // 10/8
  if (a === 127) return true;                  // петля
  if (a === 169 && b === 254) return true;     // link-local и метаданные облака
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;       // 192.0.0/24 и 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                   // multicast и зарезервированное
  return false;
}

/** IPv6 в восемь шестнадцатибитных групп (понимает «::» и хвост a.b.c.d); null — не разобрали. */
function expandV6(value) {
  let text = value;
  const tail = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = `${text.slice(0, -tail[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest, ...extra] = text.split('::');
  if (extra.length) return null;
  const left = head ? head.split(':') : [];
  let groups;
  if (rest === undefined) {
    groups = left;
  } else {
    const right = rest ? rest.split(':') : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill('0'), ...right];
  }
  if (groups.length !== 8) return null;
  const numbers = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return numbers.some(Number.isNaN) ? null : numbers;
}

function isPrivateV6(address) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  const g = expandV6(value);
  // Не разобрали — считаем внутренним: лучше отказать, чем отправить внутрь сети.
  if (!g) return true;
  const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.every((n) => n === 0)) return true;                       // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true;                    // link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true;                    // site-local
  if ((g[0] & 0xfe00) === 0xfc00) return true;                    // unique local
  if ((g[0] & 0xff00) === 0xff00) return true;                    // multicast
  // v4 внутри v6: ::ffff:a.b.c.d (обёртка), ::a.b.c.d (устаревшая «совместимая» запись),
  // 64:ff9b::/96 (NAT64) и 2002::/16 (6to4) — во всех случаях решает сам v4-адрес.
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(v4);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return isPrivateV4(v4);
  if (g[0] === 0x2002) return isPrivateV4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`);
  return false;
}

export function checkOutboundUrl(raw) {
  let url;
  try { url = new URL(String(raw ?? '')); }
  catch { return { ok: false, reason: 'Адрес неразборчив' }; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Адрес должен начинаться с http:// или https://' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Адрес с логином и паролем не принимается' };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'В адресе нет узла' };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Этот адрес ведёт внутрь сервера, а не наружу' };
  }
  const kind = isIP(host.replace(/^\[|\]$/g, ''));
  // Имя без точки («intranet», «nohost») разрешается через домены поиска
  // и почти всегда указывает внутрь сети. У публичной подписки домен есть.
  if (!kind && !host.includes('.')) {
    return { ok: false, reason: 'В адресе нет домена: такое имя разрешается только внутри сети' };
  }
  if (kind === 4 && isPrivateV4(host)) return { ok: false, reason: 'Этот адрес ведёт во внутреннюю сеть' };
  if (kind === 6 && isPrivateV6(host)) return { ok: false, reason: 'Этот адрес ведёт во внутреннюю сеть' };
  return { ok: true, url };
}

/**
 * Та же проверка, но перед самой отправкой и с разрешением имени.
 *
 * Адрес принимается один раз, а живёт годами: имя, указывавшее наружу,
 * назавтра может указывать на 127.0.0.1 или на служебный адрес облака —
 * менять для этого подписку не нужно. Поэтому перед каждой отправкой имя
 * разрешается и все полученные адреса проверяются.
 *
 * Гонка между разрешением и соединением этим не закрывается: между ними
 * ответ DNS может смениться. Полностью её снимает только соединение по уже
 * проверенному адресу; здесь мы честно закрываем массовый случай, а не
 * прицельную подмену в миллисекундном окне.
 */
export async function checkOutboundTarget(raw, { resolve = lookup } = {}) {
  const checked = checkOutboundUrl(raw);
  if (!checked.ok) return checked;
  const host = checked.url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return checked;
  let addresses;
  try {
    addresses = await resolve(host, { all: true });
  } catch {
    return { ok: false, reason: 'Имя в адресе не разрешается' };
  }
  if (!addresses?.length) return { ok: false, reason: 'Имя в адресе не разрешается' };
  for (const { address, family } of addresses) {
    const privateAddress = family === 6 ? isPrivateV6(address) : isPrivateV4(address);
    if (privateAddress) return { ok: false, reason: 'Имя в адресе указывает во внутреннюю сеть' };
  }
  return checked;
}
