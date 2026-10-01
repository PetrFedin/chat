import { inflateRawSync } from 'node:zlib';

/** Потолок на развёрнутую запись: архив-бомба иначе исчерпывает память единственного процесса. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/**
 * Чтение ZIP — ровно настолько, насколько нужно.
 *
 * Нужно оно затем, что docx и xlsx — это zip с XML внутри, а без
 * заглядывания внутрь поиск по документам компании видит только имена
 * файлов: «акт.docx» находится, слово «щебень» из него — нет.
 *
 * Читаем по оглавлению в конце, как и все настоящие распаковщики: по
 * локальным заголовкам поток может врать о размерах, а оглавление —
 * это то, чем архив себя описывает.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Ищем оглавление с конца: за ним может быть комментарий до 64 КБ. */
function findEocd(buffer) {
  const floor = Math.max(0, buffer.length - 66 * 1024);
  for (let at = buffer.length - 22; at >= floor; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD) return at;
  }
  return -1;
}

/**
 * Перечень того, что лежит в архиве.
 *
 * Возвращает записи без данных: читать содержимое всех файлов, чтобы
 * достать один, незачем.
 */
export function listZip(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw Object.assign(new Error('Это не ZIP: нет оглавления'), { code: 'NOT_A_ZIP' });
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL) break;
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    entries.push({
      name: buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      method, compressedSize, size, offset,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Содержимое одной записи. Поддержаны «как есть» и deflate — больше в офисных форматах не встречается. */
export function readZipEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.offset) !== LOCAL) throw Object.assign(new Error('Повреждённая запись архива'), { code: 'BAD_ZIP_ENTRY' });
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) {
    try { return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }); }
    catch (error) {
      if (error?.code === 'ERR_BUFFER_TOO_LARGE') throw Object.assign(new Error('Запись архива слишком велика после распаковки'), { code: 'ZIP_ENTRY_TOO_LARGE' });
      throw error;
    }
  }
  throw Object.assign(new Error(`Неизвестный способ сжатия: ${entry.method}`), { code: 'UNSUPPORTED_ZIP_METHOD' });
}

/** Содержимое записи по имени, или null. */
export function readZipFile(buffer, name) {
  const entry = listZip(buffer).find((item) => item.name === name);
  return entry ? readZipEntry(buffer, entry) : null;
}
