import { Permission, requirePermission } from '../rbac.js';
import { isGuest } from '../persistence/visibility.js';

/**
 * Выгрузка пространства наружу.
 *
 * Отдаётся потоком прямо в ответ: держать архив компании на диске
 * сервера, чтобы потом отдать ссылкой, — это лишняя копия всей
 * переписки в месте, за которым никто не следит.
 *
 * Права — управление организацией. Не «прочитать всё, что мне видно», а
 * именно право на пространство целиком: выгрузка обходит видимость
 * бесед, потому что в ней и смысл, и поэтому её нельзя давать никому,
 * кроме того, кто пространством и распоряжается.
 */
export function createExportHandler() {
  return async function handleExport(req, res, ctx, url, path, method) {
    if (path !== '/api/v1/export') return false;
    if (method !== 'GET') return false;

    const session = await ctx.requireSession(req);
    // Гость — чужой сотрудник в одной комнате. Даже знать о наличии
    // выгрузки ему незачем.
    if (isGuest(session)) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND', statusCode: 404 });
    requirePermission(session.role, Permission.ORGANIZATION_MANAGE);

    if (!ctx.workspaceExport) {
      throw Object.assign(
        new Error('Выгрузка доступна в режиме с базой данных'),
        { code: 'EXPORT_UNAVAILABLE', statusCode: 503, expose: true },
      );
    }

    const withFiles = url.searchParams.get('files') !== '0';
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `выгрузка-${stamp}.zip`;

    // Заголовки уходят до первого байта архива: длину мы не знаем и
    // знать не можем — она становится известна только когда всё
    // дописано. Поэтому без content-length, обычной цепочкой кусков.
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    });

    try {
      await ctx.workspaceExport.stream(session, res, { withFiles });
      ctx.metrics?.count('chat_export_total', { files: String(withFiles) });
      res.end();
      return true;
    } catch (error) {
      // Ответ уже начался — сказать «500 и вот вам JSON» поздно.
      // Обрываем соединение: недокачанный архив клиент заметит по
      // отсутствию оглавления, а молча отдать половину переписки как
      // «готово» нельзя.
      ctx.metrics?.count('chat_export_failed_total', {});
      res.destroy(error);
      return true;
    }
  };
}
