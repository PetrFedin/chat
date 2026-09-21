import { isIP } from 'node:net';

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

function isPrivateV6(address) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fe80')) return true;         // link-local
  if (/^f[cd]/.test(value)) return true;             // unique local
  if (value.startsWith('::ffff:')) return isPrivateV4(value.slice(7)); // v4 в обёртке
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
