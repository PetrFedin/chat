/**
 * Журнал эксплуатации.
 *
 * До сих пор во всём приложении было двадцать два вызова `console.*`, и ни
 * один из них не был записью о запросе: двадцать успешных обращений подряд
 * давали ноль строк. У строк не было ни времени, ни уровня, ни признака
 * запроса, пространства и человека — по такому журналу нельзя ни
 * сопоставить жалобу с записью, ни понять, когда началось, ни назвать
 * шумного арендатора.
 *
 * Правила простые: одна строка — одно событие; `ts` и `lvl` всегда; `ev` —
 * короткое имя через точку; `reqId` во всём, что порождено запросом;
 * `wsId` и `userId` везде, где известны. Стек — только полем `err`, а не
 * объектом Error: объект печатается на восемь строк и ломает построчный
 * разбор, которым эти логи и читают.
 */

const WRITER = { error: console.error, warn: console.warn, info: console.log };

export function log(level, event, fields = {}) {
  const write = WRITER[level] ?? console.log;
  write(JSON.stringify({ ts: new Date().toISOString(), lvl: level, ev: event, ...fields }));
}

/** Ошибка в строке журнала: сообщение и код всегда, стек — по требованию. */
export const errorFields = (error, { stack = false } = {}) => ({
  err: String(error?.message ?? error ?? 'unknown'),
  code: error?.code ?? undefined,
  ...(stack && error?.stack ? { stack: String(error.stack).split('\n').slice(0, 6).join(' | ') } : {}),
});

/** Путь без идентификаторов: иначе маршруты не сгруппировать. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const routeOf = (path) => String(path ?? '').split('?')[0].replace(UUID, ':id');
