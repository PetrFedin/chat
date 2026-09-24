import { generateKeyPairSync, sign } from 'node:crypto';

/**
 * Самоподписанный сертификат на 127.0.0.1 — прямо здесь, в DER.
 *
 * Готовый ключ в репозитории — это ключ в репозитории, даже игрушечный:
 * его найдёт любой сканер секретов и будет прав. Внешнего пакета ради
 * одного теста тоже не хочется. Сертификат — это подписанная
 * последовательность полей, и собрать её короче, чем объяснять, почему
 * в проекте лежит чужой закрытый ключ.
 */
export function selfSigned(host = '127.0.0.1') {
  const der = (tag, ...chunks) => {
    const body = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
    if (body.length < 0x80) return Buffer.concat([Buffer.from([tag, body.length]), body]);
    const size = [];
    for (let left = body.length; left > 0; left >>>= 8) size.unshift(left & 0xff);
    return Buffer.concat([Buffer.from([tag, 0x80 | size.length, ...size]), body]);
  };
  const sequence = (...chunks) => der(0x30, ...chunks);
  const integer = (value) => {
    const bytes = [];
    for (let left = value; left > 0; left = Math.floor(left / 256)) bytes.unshift(left % 256);
    if (bytes.length === 0) bytes.push(0);
    // Старший бит — знак: перед ним нужен нулевой байт.
    if (bytes[0] & 0x80) bytes.unshift(0);
    return der(0x02, Buffer.from(bytes));
  };
  const oid = (dotted) => {
    const parts = dotted.split('.').map(Number);
    const bytes = [parts[0] * 40 + parts[1]];
    for (const part of parts.slice(2)) {
      const chunk = [part & 0x7f];
      for (let left = part >>> 7; left > 0; left >>>= 7) chunk.unshift((left & 0x7f) | 0x80);
      bytes.push(...chunk);
    }
    return der(0x06, Buffer.from(bytes));
  };
  // ГГММДДЧЧММССZ — без разделителей и без «T» посередине.
  const moment = (date) => der(0x17, Buffer.from(
    date.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}/, '').slice(2), 'ascii'));

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const algorithm = sequence(oid('1.2.840.113549.1.1.11'), der(0x05));
  const name = sequence(der(0x31, sequence(oid('2.5.4.3'), der(0x13, Buffer.from(host, 'ascii')))));
  const yes = der(0x01, Buffer.from([0xff]));
  const extensions = der(0xa3, sequence(
    // Сам себе удостоверяющий центр — иначе своей же подписи не верят.
    sequence(oid('2.5.29.19'), yes, der(0x04, sequence(yes))),
    // Имя, на которое выдан: для адреса это отдельное поле, не строка.
    sequence(oid('2.5.29.17'), der(0x04, sequence(der(0x87, Buffer.from(host.split('.').map(Number)))))),
  ));
  const now = Date.now();
  const tbs = sequence(
    der(0xa0, integer(2)),
    integer(now % 1_000_000_007),
    algorithm,
    name,
    sequence(moment(new Date(now - 3600_000)), moment(new Date(now + 86_400_000))),
    name,
    spki,
    extensions,
  );
  const signature = sign('sha256', tbs, privateKey);
  // Перенос строки каждые 64 знака; хвостовой — лишний, и пустая строка
  // перед концовкой делает файл нечитаемым для OpenSSL.
  const body = sequence(tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature])))
    .toString('base64').replace(/(.{64})/g, '$1\n').trim();
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`,
  };
}
