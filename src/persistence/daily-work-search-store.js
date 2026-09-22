import { openConversationSql, conversationTitleSql, visibleEventSql } from './visibility.js';

/**
 * Проценты и подчёркивания в запросе — это символы, которые человек ищет,
 * а не шаблон. Поиск «НДС 20%» возвращал всю доступную ленту.
 */
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
import { PostgresStore as DailyWorkPostgresStore } from './daily-work-store.js';

export class PostgresStore extends DailyWorkPostgresStore {
  /**
   * Поиск по рабочему пространству.
   *
   * Фильтра по времени не было вовсе: бухгалтер, ищущий договор
   * трёхмесячной давности, получал шестьдесят свежих совпадений и
   * упирался в потолок — второй страницы у поиска нет. Диапазон дат
   * сужает выдачу там, где слово встречается в сотне мест, а нужное
   * лежит в конкретном месяце.
   */
  async searchWorkspace(session,query,{types=null,limit=30,from=null,to=null}={}){
    const q=String(query??'').trim();
    if(q.length<2)return[];
    const wanted=new Set(types?.length?types:['message','conversation','task','file','person','event']);
    const each=Math.min(Math.max(Number(limit)||30,5),60),items=[],like=`%${escapeLike(q)}%`,jobs=[];
    const since=from?new Date(from).toISOString():null;
    const until=to?new Date(to).toISOString():null;
    // Одно и то же условие для всех видов: у каждой находки есть время.
    const inRange=(column,a,b)=>`($${a}::timestamptz IS NULL OR ${column}>=$${a}) AND ($${b}::timestamptz IS NULL OR ${column}<=$${b})`;

    // Поиск по сообщениям идёт двумя плечами, у каждого своя опора:
    // полнотекстовое — по хранимому body_tsv, подстрочное — по триграммам.
    // Раньше они стояли через OR в одном условии, и планировщик отбрасывал
    // индексы целиком: полный проход по таблице на каждый запрос, одинаково
    // дорогой и при трёх совпадениях, и при ста тысячах.
    if(wanted.has('message'))jobs.push(this.pool.query(`
      WITH found AS (
        (SELECT m.id FROM messages m WHERE m.workspace_id=$1 AND m.deleted_at IS NULL
           AND m.body_tsv @@ plainto_tsquery('russian',$3)
         ORDER BY m.created_at DESC LIMIT $5 * 4)
        UNION
        (SELECT m.id FROM messages m WHERE m.workspace_id=$1 AND m.deleted_at IS NULL
           AND m.body ILIKE $4
         ORDER BY m.created_at DESC LIMIT $5 * 4)
      )
      SELECT 'message' type,m.id,${conversationTitleSql('m.conversation_id','m.workspace_id','$2')} title,
             m.body snippet,m.conversation_id "conversationId",m.author_id "authorId",
             p.display_name "authorName",m.created_at "createdAt",
             ts_rank_cd(m.body_tsv,plainto_tsquery('russian',$3)) score
        FROM found
        JOIN messages m ON m.id=found.id
        JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id
        LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2
        LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.author_id
       WHERE c.archived_at IS NULL AND(${openConversationSql(session,'c')} OR cm.user_id IS NOT NULL)
         AND ${inRange('m.created_at',6,7)}
       ORDER BY score DESC,m.created_at DESC LIMIT $5`,
      [session.workspaceId,session.userId,q,like,each,since,until]).then(r=>items.push(...r.rows)));
    if(wanted.has('conversation'))jobs.push(this.pool.query(`SELECT 'conversation' type,c.id,${conversationTitleSql('c.id','c.workspace_id','$2')} title,COALESCE(c.purpose,'') snippet,c.id "conversationId",c.created_at "createdAt",ts_rank_cd(to_tsvector('russian',coalesce(c.title,'')||' '||coalesce(c.purpose,'')),plainto_tsquery('russian',$3)) score FROM conversations c LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2 WHERE c.workspace_id=$1 AND c.archived_at IS NULL AND(${openConversationSql(session,'c')} OR cm.user_id IS NOT NULL) AND(to_tsvector('russian',coalesce(c.title,'')||' '||coalesce(c.purpose,''))@@plainto_tsquery('russian',$3) OR c.title ILIKE $4 OR c.purpose ILIKE $4) AND ${inRange('c.created_at',6,7)} ORDER BY score DESC,c.created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each,since,until]).then(r=>items.push(...r.rows)));
    if(wanted.has('task'))jobs.push(this.pool.query(`SELECT 'task' type,id,title,outcome snippet,status,created_at "createdAt",ts_rank_cd(to_tsvector('russian',coalesce(title,'')||' '||coalesce(outcome,'')),plainto_tsquery('russian',$3)) score FROM commitments WHERE workspace_id=$1 AND(owner_id=$2 OR requester_id=$2 OR acceptor_id=$2) AND(to_tsvector('russian',coalesce(title,'')||' '||coalesce(outcome,''))@@plainto_tsquery('russian',$3) OR title ILIKE $4 OR outcome ILIKE $4) AND ${inRange('created_at',6,7)} ORDER BY score DESC,created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each,since,until]).then(r=>items.push(...r.rows)));

    // People search is workspace-scoped but not user-specific. Keep the parameter
    // list contiguous so PostgreSQL can infer every placeholder type.
    if(wanted.has('person'))jobs.push(this.pool.query(`SELECT 'person' type,m.user_id id,COALESCE(p.display_name,u.email) title,concat_ws(' · ',p.title,p.department) snippet,m.created_at "createdAt",ts_rank_cd(to_tsvector('russian',coalesce(p.display_name,'')||' '||coalesce(p.email,u.email)||' '||coalesce(p.title,'')||' '||coalesce(p.department,'')),plainto_tsquery('russian',$2)) score FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id WHERE m.workspace_id=$1 AND(to_tsvector('russian',coalesce(p.display_name,'')||' '||coalesce(p.email,u.email)||' '||coalesce(p.title,'')||' '||coalesce(p.department,''))@@plainto_tsquery('russian',$2) OR p.display_name ILIKE $3 OR COALESCE(p.email,u.email) ILIKE $3 OR p.title ILIKE $3 OR p.department ILIKE $3) AND ${inRange('m.created_at',5,6)} ORDER BY score DESC,m.created_at DESC LIMIT $4`,[session.workspaceId,q,like,each,since,until]).then(r=>items.push(...r.rows)));

    if(wanted.has('event'))jobs.push(this.pool.query(`SELECT 'event' type,e.id,e.title,COALESCE(e.description,e.kind) snippet,e.conversation_id "conversationId",e.created_at "createdAt",ts_rank_cd(to_tsvector('russian',coalesce(e.title,'')||' '||coalesce(e.description,'')),plainto_tsquery('russian',$3)) score FROM calendar_events e LEFT JOIN calendar_event_participants ep ON ep.workspace_id=e.workspace_id AND ep.calendar_event_id=e.id AND ep.user_id=$2 WHERE e.workspace_id=$1 AND ${visibleEventSql('e','$2','$6')} AND(to_tsvector('russian',coalesce(e.title,'')||' '||coalesce(e.description,''))@@plainto_tsquery('russian',$3) OR e.title ILIKE $4 OR e.description ILIKE $4) AND ${inRange('e.created_at',7,8)} ORDER BY score DESC,e.created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each,session.role,since,until]).then(r=>items.push(...r.rows)));
    if(wanted.has('file'))jobs.push(this.listFiles(session,{query:q,limit:each}).then(rows=>items.push(...rows.map(f=>({type:'file',id:f.id,title:f.name,snippet:f.mimeType,conversationId:f.context?.conversationId,messageId:f.context?.messageId,createdAt:f.createdAt,previewUrl:f.previewUrl,contentUrl:f.contentUrl,score:1})))));

    /**
     * Поиск внутри вложений.
     *
     * Отдельным плечом, а не вместе с именами: у содержимого свой
     * индекс, и смешивать их в одном запросе значит потерять его.
     * Находка показывает кусок текста вокруг слова — по имени
     * «скан_2026_09.docx» понять, то ли это, нельзя.
     */
    if(wanted.has('file'))jobs.push(this.pool.query(
      `SELECT 'file' type,f.id,f.name title,
              -- Выделение размечаем управляющими символами, а не «<b>»:
              -- в тексте документа угловые скобки встречаются, и тогда
              -- экранирование на клиенте либо съест выделение, либо
              -- превратит чужой текст в разметку.
              ts_headline('russian',t.body,plainto_tsquery('russian',$2),
                          'StartSel=\x02,StopSel=\x03,MaxWords=18,MinWords=6,ShortWord=2,MaxFragments=1,FragmentDelimiter= … ') snippet,
              f.created_at "createdAt",t.kind "textKind",
              ts_rank_cd(t.body_tsv,plainto_tsquery('russian',$2)) score
         FROM file_texts t
         JOIN files f ON f.workspace_id=t.workspace_id AND f.id=t.file_id AND f.deleted_at IS NULL
        WHERE t.workspace_id=$1 AND t.body_tsv @@ plainto_tsquery('russian',$2)
          -- Видимость та же, что у списка файлов: свой файл или файл,
          -- привязанный к беседе, которую человеку видно. Без этого
          -- поиск по содержимому доставал вложения из чужих переписок —
          -- то есть обходил границы, ради которых всё остальное и
          -- сделано.
          AND (f.uploaded_by=$6 OR EXISTS (
            SELECT 1 FROM file_links fl
              JOIN messages fm ON fm.workspace_id=fl.workspace_id
                   AND fl.entity_type='message' AND fm.id=fl.entity_id
              JOIN conversations fc ON fc.workspace_id=fm.workspace_id AND fc.id=fm.conversation_id
              LEFT JOIN conversation_members fcm ON fcm.workspace_id=fc.workspace_id
                   AND fcm.conversation_id=fc.id AND fcm.user_id=$6
             WHERE fl.workspace_id=f.workspace_id AND fl.file_id=f.id
               AND fm.deleted_at IS NULL AND fc.archived_at IS NULL
               AND(${openConversationSql(session,'fc')} OR fcm.user_id IS NOT NULL)))
          AND ${inRange('f.created_at',3,4)}
        ORDER BY score DESC,f.created_at DESC LIMIT $5`,
      // Свой список параметров: лишний placeholder, который запрос не
      // использует, — это «could not determine data type of parameter»,
      // и узнаётся такое в бою.
      [session.workspaceId,q,since,until,each,session.userId])
      .then(r=>items.push(...r.rows.map(row=>({
        ...row,
        // Ссылки те же, что у находки по имени: человеку всё равно,
        // каким плечом его нашли.
        contentUrl:`/api/v1/files/${row.id}/content`,
        insideFile:true,
      })))));

    await Promise.all(jobs);
    // Файл может найтись дважды: по имени и по содержимому. Человеку
    // это одна находка, и показывать её лучше той, у которой есть
    // кусок текста вокруг слова.
    const best=new Map();
    for(const item of items){
      const key=`${item.type}:${item.id}`;
      const kept=best.get(key);
      if(!kept||(item.insideFile&&!kept.insideFile)||Number(item.score||0)>Number(kept.score||0))best.set(key,item);
    }
    items.length=0;items.push(...best.values());
    return items.sort((a,b)=>(Number(b.score||0)-Number(a.score||0))||String(b.createdAt??'').localeCompare(String(a.createdAt??''))).slice(0,Math.min(Math.max(Number(limit)||30,1),60));
  }
}
