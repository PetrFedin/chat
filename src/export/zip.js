import { deflateRawSync } from 'node:zlib';

/**
 * Потоковый ZIP без зависимостей.
 *
 * Архив рабочего пространства — это переписка компании за годы и все её
 * файлы. Собрать такое в памяти нельзя: на тысяче вложений процесс
 * просто кончится. Поэтому записи отдаются кусками по мере чтения из
 * базы и с диска, а размеры и контрольные суммы дописываются после
 * данных — тем самым «дескриптором», ради которого в формате и
 * заведён третий бит флагов.
 *
 * Своей реализацией, а не библиотекой, по той же причине, по которой во
 * всём проекте шесть зависимостей: нужная часть формата — это три
 * структуры и таблица CRC.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buffer, seed = 0) {
  let c = ~seed;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** Время в формате MS-DOS: в ZIP оно хранится так с 1989 года. */
function dosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

/**
 * Пишет ZIP в поток.
 *
 * `add` принимает имя и содержимое — строку, буфер или асинхронный
 * источник кусков. `finish` дописывает оглавление, без которого архив
 * не откроется ничем.
 */
export function createZipWriter(sink) {
  const entries = [];
  let offset = 0;

  // Ошибку потока ловим один раз, а не подписываемся на каждую запись:
  // иначе на тысяче файлов набегает тысяча слушателей, и Node
  // справедливо жалуется на утечку.
  let failure = null;
  sink.on('error', (error) => { failure = error; });

  const write = (chunk) => new Promise((done, fail) => {
    if (failure) return fail(failure);
    offset += chunk.length;
    // Ждём слива: без этого большой архив копится в буфере потока, и мы
    // возвращаемся к тому, от чего уходили.
    if (sink.write(chunk)) done();
    else sink.once('drain', done);
  });

  return {
    async add(name, content, { modified = new Date(), compress = true } = {}) {
      const nameBytes = Buffer.from(name, 'utf8');
      const { time, date } = dosTime(modified);
      const start = offset;

      // Данные готовим заранее, когда это буфер или строка: тогда
      // размеры известны и дескриптор не нужен.
      const known = typeof content === 'string' || Buffer.isBuffer(content);
      const raw = known ? Buffer.from(content) : null;
      const body = known && compress ? deflateRawSync(raw) : raw;
      const method = compress && known ? 8 : 0;
      // Третий бит: размеры идут после данных. Для потока иначе никак.
      const flags = known ? 0x0800 : 0x0808;

      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(flags, 6);
      header.writeUInt16LE(known ? method : 0, 8);
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt32LE(known ? crc32(raw) : 0, 14);
      header.writeUInt32LE(known ? body.length : 0, 18);
      header.writeUInt32LE(known ? raw.length : 0, 22);
      header.writeUInt16LE(nameBytes.length, 26);
      header.writeUInt16LE(0, 28);
      await write(header);
      await write(nameBytes);

      let crc = 0;
      let size = 0;
      if (known) {
        await write(body);
        crc = crc32(raw);
        size = raw.length;
        entries.push({ nameBytes, time, date, crc, compressed: body.length, size, start, method });
        return;
      }

      // Поток: пишем как есть, без сжатия — сжимать на лету значит
      // держать состояние deflate и терять возможность отдать кусок
      // сразу.
      for await (const chunk of content) {
        const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        crc = crc32(piece, crc);
        size += piece.length;
        await write(piece);
      }
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      await write(descriptor);
      entries.push({ nameBytes, time, date, crc, compressed: size, size, start, method: 0 });
    },

    async finish() {
      const directoryStart = offset;
      for (const entry of entries) {
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0);
        record.writeUInt16LE(20, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt16LE(0x0800, 8);
        record.writeUInt16LE(entry.method, 10);
        record.writeUInt16LE(entry.time, 12);
        record.writeUInt16LE(entry.date, 14);
        record.writeUInt32LE(entry.crc, 16);
        record.writeUInt32LE(entry.compressed, 20);
        record.writeUInt32LE(entry.size, 24);
        record.writeUInt16LE(entry.nameBytes.length, 28);
        record.writeUInt32LE(entry.start, 42);
        await write(record);
        await write(entry.nameBytes);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(offset - directoryStart, 12);
      end.writeUInt32LE(directoryStart, 16);
      await write(end);
      return { entries: entries.length, bytes: offset };
    },
  };
}
