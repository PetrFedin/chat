/**
 * Фотография человека и обложка группы.
 *
 * Хранится ссылкой на файл, а не адресом: текстовый адрес — это
 * обещание, за которым никто не следит, и после удаления файла в
 * списке сотрудников повисают битые картинки. Адрес для клиента
 * собирается на чтении из идентификатора, и другого источника правды
 * нет.
 */

/**
 * Что годится в аватар.
 *
 * Список закрытый, а не «всё, что начинается с image/»: SVG — это
 * документ со скриптами, и показывать его как чужое лицо в списке
 * сотрудников означает пускать чужой код на страницу.
 */
export const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** Фотография тяжелее этого — это не фотография, а вложение. */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

/** Выражение, дающее адрес фотографии по столбцу со ссылкой на файл. */
export const avatarUrlSql = (column) => `CASE WHEN ${column} IS NOT NULL
  THEN '/api/v1/files/'||${column}||'/content' END`;

/**
 * Проверка перед тем, как записать ссылку.
 *
 * Заодно закрывает подстановку чужого файла: сюда доходит только то,
 * что видно в этом пространстве, потому что `getFile` спрашивает
 * именно его.
 */
export async function resolveAvatar(store, session, fileId) {
  if (fileId === null || fileId === undefined || fileId === '') return null;
  const file = await store.getFile?.(session, fileId);
  if (!file) throw Object.assign(new Error('Файл не найден'), { code: 'FILE_NOT_FOUND', statusCode: 404, expose: true });
  if (!AVATAR_TYPES.has(String(file.mimeType ?? '').toLowerCase())) {
    throw Object.assign(new Error('Для фотографии нужен jpeg, png, webp, gif или avif'),
      { code: 'INVALID_AVATAR_TYPE', statusCode: 400, expose: true });
  }
  if (Number(file.sizeBytes) > AVATAR_MAX_BYTES) {
    throw Object.assign(new Error('Фотография больше восьми мегабайт'),
      { code: 'AVATAR_TOO_LARGE', statusCode: 413, expose: true });
  }
  return file.id;
}
