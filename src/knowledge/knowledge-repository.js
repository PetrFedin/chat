import { cleanText } from '../http/helpers.js';

/**
 * База знаний компании и поисковый HR-бот над ней.
 *
 * Статья — написанный человеком ответ («сколько дней отпуска», «как
 * оформить больничный»), а не что-то, что придумывает модель. Бот здесь
 * не генерирует ответ — он находит лучшую статью полнотекстовым поиском
 * (тем же `to_tsvector('russian', …)`, что и остальной поиск в
 * продукте) и возвращает её фрагмент через `ts_headline`, честно
 * подсвечивая совпавшие слова. Спросили о том, чего в базе нет, — бот
 * так и скажет, а не сочинит.
 *
 * Только PostgreSQL: как и сейф с паролями, это функциональность,
 * которая в памяти не эмулируется, а честно отвечает 503.
 */

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const MAX_CATEGORY = 100;

const view = (row) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  category: row.category ?? null,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const readTitle = (value) => cleanText(value, 200, 'Заголовок');
const readBody = (value) => {
  const body = String(value ?? '').trim();
  if (!body) throw fail('Заполните поле «Текст статьи»', 'INVALID_TEXT', 400);
  if (body.length > 20000) throw fail('Текст статьи длиннее 20000 символов', 'INVALID_TEXT', 400);
  return body;
};
const readCategory = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const category = String(value).trim();
  if (category.length > MAX_CATEGORY) throw fail(`Категория длиннее ${MAX_CATEGORY} символов`, 'INVALID_TEXT', 400);
  return category;
};

const COLUMNS = `id,title,body,category,created_by "createdBy",updated_by "updatedBy",
  created_at "createdAt",updated_at "updatedAt"`;

export function createKnowledgeRepository(pool) {
  if (!pool) {
    const stop = () => { throw fail('База знаний работает только с базой данных PostgreSQL', 'KNOWLEDGE_UNAVAILABLE', 503); };
    return { enabled: false, reason: 'no-database', list: stop, get: stop, create: stop, update: stop, remove: stop, ask: stop };
  }

  return {
    enabled: true,

    async list(session, { query = null, category = null, limit = 100 } = {}) {
      const max = Math.min(Math.max(Number(limit) || 100, 1), 200);
      const q = query ? String(query).trim() : '';
      if (q) {
        const { rows } = await pool.query(
          `SELECT ${COLUMNS}, ts_rank_cd(to_tsvector('russian',coalesce(title,'')||' '||coalesce(body,'')),plainto_tsquery('russian',$3)) score
             FROM knowledge_articles
            WHERE workspace_id=$1
              AND ($4::text IS NULL OR category=$4)
              AND (to_tsvector('russian',coalesce(title,'')||' '||coalesce(body,''))@@plainto_tsquery('russian',$3)
                   OR title ILIKE '%'||$3||'%')
            ORDER BY score DESC, updated_at DESC LIMIT $2`,
          [session.workspaceId, max, q, category],
        );
        return rows.map(view);
      }
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM knowledge_articles
          WHERE workspace_id=$1 AND ($3::text IS NULL OR category=$3)
          ORDER BY updated_at DESC LIMIT $2`,
        [session.workspaceId, max, category],
      );
      return rows.map(view);
    },

    async get(session, id) {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM knowledge_articles WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id]);
      if (!rows[0]) throw fail('Статья не найдена', 'KNOWLEDGE_NOT_FOUND', 404);
      return view(rows[0]);
    },

    async create(session, body = {}) {
      const title = readTitle(body.title);
      const text = readBody(body.body);
      const category = readCategory(body.category);
      const { rows } = await pool.query(
        `INSERT INTO knowledge_articles(organization_id,workspace_id,title,body,category,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING ${COLUMNS}`,
        [session.organizationId, session.workspaceId, title, text, category, session.userId],
      );
      return view(rows[0]);
    },

    async update(session, id, patch = {}) {
      const sets = [];
      const params = [session.workspaceId, id];
      const push = (column, value) => { params.push(value); sets.push(`${column}=$${params.length}`); };
      if (patch.title !== undefined) push('title', readTitle(patch.title));
      if (patch.body !== undefined) push('body', readBody(patch.body));
      if (patch.category !== undefined) push('category', readCategory(patch.category));
      if (!sets.length) throw fail('Нечего менять', 'EMPTY_KNOWLEDGE_PATCH', 400);
      params.push(session.userId);
      sets.push(`updated_by=$${params.length}`, 'updated_at=now()');
      const { rows } = await pool.query(
        `UPDATE knowledge_articles SET ${sets.join(',')} WHERE workspace_id=$1 AND id=$2 RETURNING ${COLUMNS}`,
        params,
      );
      if (!rows[0]) throw fail('Статья не найдена', 'KNOWLEDGE_NOT_FOUND', 404);
      return view(rows[0]);
    },

    async remove(session, id) {
      const { rowCount } = await pool.query(`DELETE FROM knowledge_articles WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id]);
      if (!rowCount) throw fail('Статья не найдена', 'KNOWLEDGE_NOT_FOUND', 404);
    },

    /**
     * HR-бот: ищет лучшую статью и возвращает её фрагмент с подсветкой.
     *
     * `ts_headline` — та же честность, что и у остального продукта:
     * человек видит ровно те слова источника, которые совпали, а не
     * пересказ. Несколько кандидатов возвращаются, чтобы было видно,
     * когда бот не уверен, какая из двух статей имелась в виду.
     *
     * `plainto_tsquery` сам по себе связывает слова вопроса через «И»:
     * «когда сдавать лист нетрудоспособности» находило бы только
     * статью, где есть все четыре слова разом. Живой вопрос почти
     * всегда содержит слово, которого в статье просто нет («когда»,
     * «мне», «положено») — и с «И» бот отвечал бы тишиной на любой
     * человеческий вопрос длиннее одного слова. Пересобираем то же
     * дерево лексем через «ИЛИ» (замена `&` на `|` в текстовом виде
     * запроса): совпадение хотя бы одного слова уже даёт кандидата, а
     * `ts_rank_cd` сам поднимает наверх статью, где совпало больше слов.
     */
    async ask(session, question) {
      const q = cleanText(question, 500, 'Вопрос');
      const orQuery = `to_tsquery('russian', replace(plainto_tsquery('russian',$2)::text, ' & ', ' | '))`;
      const { rows } = await pool.query(
        `SELECT id,title,category,
                ts_headline('russian',body,${orQuery},
                  'MaxFragments=1,MinWords=15,MaxWords=40,StartSel=<mark>,StopSel=</mark>') snippet,
                ts_rank_cd(to_tsvector('russian',coalesce(title,'')||' '||coalesce(body,'')),${orQuery}) score
           FROM knowledge_articles
          WHERE workspace_id=$1
            AND to_tsvector('russian',coalesce(title,'')||' '||coalesce(body,''))@@${orQuery}
          ORDER BY score DESC LIMIT 3`,
        [session.workspaceId, q],
      );
      return { question: q, matches: rows.map((row) => ({ id: row.id, title: row.title, category: row.category, snippet: row.snippet, score: Number(row.score) })) };
    },
  };
}
