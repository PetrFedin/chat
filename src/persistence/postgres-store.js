import { openConversationSql, isGuest, GUEST_ROLE, conversationListSql } from './visibility.js';
import { avatarUrlSql } from '../media/avatar.js';
import { randomUUID } from 'node:crypto';
import { ACTIVE_TASK_STATUSES, allowedTaskTransitions, assertChecklistAuthority, assertTaskEvidenceAuthority, assertTaskStructureAuthority, assertTaskReassignAuthority, assertTaskScheduleAuthority, assertTaskTransition, canViewTask, managesTeamTasks } from '../task/task-authority.js';

import { encodeTaskCursor, decodeTaskCursor, taskPageSize } from '../task/task-page.js';

/**
 * Колонки одного сообщения ленты.
 *
 * Список повторялся в четырёх запросах дословно; когда к нему добавили
 * скрытие удалённого тела, одна из копий про это не узнала.
 * $1 — рабочее пространство, $2 — переписка, $3 — читатель.
 */
const messageColumnsSql = (s) => `m.id,m.conversation_id "conversationId",m.kind,m.author_id "authorId",CASE WHEN m.deleted_at IS NULL THEN m.body ELSE NULL END body,m.reply_to_id "replyToId",m.thread_root_id "threadRootId",CASE WHEN m.deleted_at IS NULL THEN m.metadata ELSE '{}'::jsonb END metadata,m.created_at "createdAt",m.edited_at "editedAt",m.deleted_at "deletedAt",CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',r.user_id,'reaction',r.reaction)) FROM message_reactions r WHERE r.workspace_id=m.workspace_id AND r.message_id=m.id),'[]') ELSE '[]'::jsonb END reactions,COALESCE((SELECT jsonb_agg(mm.mentioned_user_id) FROM message_mentions mm WHERE mm.workspace_id=m.workspace_id AND mm.message_id=m.id),'[]') "mentionedUserIds",EXISTS(SELECT 1 FROM saved_messages sm WHERE sm.workspace_id=m.workspace_id AND sm.message_id=m.id AND sm.user_id=$3) saved,EXISTS(SELECT 1 FROM message_pins mp WHERE mp.workspace_id=m.workspace_id AND mp.message_id=m.id) pinned,(SELECT jsonb_build_object('source',eo.source,'authorName',eo.author_name,'sentAt',eo.sent_at,'lineCount',eo.line_count) FROM message_external_origins eo WHERE eo.workspace_id=m.workspace_id AND eo.message_id=m.id) "externalOrigin",(SELECT count(*)::int FROM messages tr WHERE tr.workspace_id=m.workspace_id AND tr.thread_root_id=m.id AND tr.deleted_at IS NULL) "replyCount",(SELECT max(tr.created_at) FROM messages tr WHERE tr.workspace_id=m.workspace_id AND tr.thread_root_id=m.id AND tr.deleted_at IS NULL) "lastReplyAt",EXISTS(SELECT 1 FROM message_forwards mf WHERE mf.workspace_id=m.workspace_id AND mf.forwarded_message_id=m.id) forwarded,(SELECT CASE WHEN ${openConversationSql(s,'sc')} OR scm.user_id IS NOT NULL THEN jsonb_build_object('messageId',src.id,'conversationId',src.conversation_id,'conversationTitle',sc.title,'authorId',src.author_id,'createdAt',src.created_at) ELSE jsonb_build_object('restricted',true) END FROM message_forwards mf JOIN messages src ON src.workspace_id=mf.workspace_id AND src.id=mf.source_message_id JOIN conversations sc ON sc.workspace_id=src.workspace_id AND sc.id=src.conversation_id LEFT JOIN conversation_members scm ON scm.workspace_id=sc.workspace_id AND scm.conversation_id=sc.id AND scm.user_id=$3 WHERE mf.workspace_id=m.workspace_id AND mf.forwarded_message_id=m.id LIMIT 1) "forwardedFrom"`;


export class PostgresStore {
  constructor(pool){this.pool=pool}
  async tx(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}}
  async createCompany(v){return this.tx(async c=>{const userId=randomUUID(),organizationId=randomUUID(),workspaceId=randomUUID();try{await c.query('INSERT INTO users(id,email) VALUES($1,$2)',[userId,v.email])}catch(e){if(e.code==='23505')throw Object.assign(new Error('Email already registered'),{code:'EMAIL_EXISTS',statusCode:409});throw e}await c.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[organizationId,v.companyName]);await c.query('INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)',[workspaceId,organizationId,v.workspaceName||v.companyName]);await c.query("INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,'owner')",[organizationId,workspaceId,userId]);await c.query("INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email,title) VALUES($1,$2,$3,$4,$5,'Владелец')",[organizationId,workspaceId,userId,v.ownerName,v.email]);await c.query('INSERT INTO auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,$3)',[userId,v.passwordHash,v.passwordSalt]);for(const [slug,title,announcement] of [['general','Общий',false],['announcements','Объявления',true]]){const id=randomUUID();await c.query("INSERT INTO conversations(id,organization_id,workspace_id,kind,title,slug,visibility,announcement_only,created_by) VALUES($1,$2,$3,'channel',$4,$5,'workspace',$6,$7)",[id,organizationId,workspaceId,title,slug,announcement,userId]);await c.query("INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES($1,$2,$3,$4,'owner')",[organizationId,workspaceId,id,userId])}return{user:{id:userId,email:v.email},organization:{id:organizationId,name:v.companyName},workspace:{id:workspaceId,organizationId,name:v.workspaceName||v.companyName},membership:{organizationId,workspaceId,userId,role:'owner'}}})}
  async findAuthByEmail(email){const{rows}=await this.pool.query(`SELECT u.id,u.email,c.password_hash,c.password_salt,m.workspace_id FROM users u JOIN auth_credentials c ON c.user_id=u.id JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=lower($1) AND u.disabled_at IS NULL ORDER BY m.created_at LIMIT 1`,[email]);const r=rows[0];return r?{id:r.id,email:r.email,passwordHash:r.password_hash,passwordSalt:r.password_salt,workspaceId:r.workspace_id}:null}
  async hasMembership(userId,workspaceId){const{rowCount}=await this.pool.query('SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.workspace_id=$2 AND u.disabled_at IS NULL',[userId,workspaceId]);return rowCount>0}
  async createSession(v){const id=randomUUID();await this.pool.query('INSERT INTO user_sessions(id,user_id,workspace_id,token_hash,expires_at,user_agent,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,v.userId,v.workspaceId,v.tokenHash,v.expiresAt,v.userAgent,v.ipAddress]);return{id,expiresAt:v.expiresAt}}
  async getSession(tokenHash){const{rows}=await this.pool.query(`SELECT s.id session_id,s.user_id,s.workspace_id,w.organization_id,m.role,u.email,p.display_name,w.name workspace_name,o.name organization_name,p.title,p.department,${avatarUrlSql('p.avatar_file_id')} avatar_url,p.locale,p.timezone FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id JOIN workspaces w ON w.id=s.workspace_id JOIN organizations o ON o.id=w.organization_id LEFT JOIN workspace_profiles p ON p.workspace_id=s.workspace_id AND p.user_id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.disabled_at IS NULL AND (m.access_until IS NULL OR m.access_until>now())`,[tokenHash]);const r=rows[0];return r?{sessionId:r.session_id,userId:r.user_id,workspaceId:r.workspace_id,organizationId:r.organization_id,role:r.role,email:r.email,displayName:r.display_name||r.email,workspaceName:r.workspace_name,organizationName:r.organization_name,profile:{displayName:r.display_name,email:r.email,title:r.title,department:r.department,avatarUrl:r.avatar_url,locale:r.locale,timezone:r.timezone}}:null}
  async revokeSession(tokenHash){await this.pool.query('UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[tokenHash])}
  /**
   * Справочник людей рабочего пространства.
   *
   * Жил внутри /bootstrap и собственного адреса не имел: клиент, которому
   * нужен список коллег, спрашивал /people и получал 404. Теперь это один
   * метод на два входа, и правило для гостя — видеть только тех, с кем он
   * в одной комнате, — записано один раз.
   */
  async listPeople(s){const {rows}=await this.pool.query(`SELECT m.user_id,m.role,p.display_name,p.email,p.title,p.department,${avatarUrlSql('p.avatar_file_id')} avatar_url,u.disabled_at,COALESCE(pr.state,'offline') state,pr.status_emoji,pr.status_text,CASE WHEN pr.back_at IS NOT NULL AND pr.back_at<=now() THEN 'available' ELSE COALESCE(pr.availability,'available') END availability,CASE WHEN pr.back_at IS NOT NULL AND pr.back_at<=now() THEN NULL ELSE pr.back_at END back_at FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id LEFT JOIN user_presence pr ON pr.workspace_id=m.workspace_id AND pr.user_id=m.user_id WHERE m.workspace_id=$1 AND($2::uuid IS NULL OR m.user_id=$2 OR m.user_id=ANY(SELECT cm2.user_id FROM conversation_members cm1 JOIN conversation_members cm2 ON cm2.conversation_id=cm1.conversation_id AND cm2.workspace_id=cm1.workspace_id WHERE cm1.workspace_id=$1 AND cm1.user_id=$2)) ORDER BY p.display_name NULLS LAST`,[s.workspaceId,s.role==='guest'?s.userId:null]);return rows.map(r=>({userId:r.user_id,role:r.role,displayName:r.display_name,email:r.email,title:r.title,department:r.department,avatarUrl:r.avatar_url,active:!r.disabled_at,presence:{state:r.disabled_at?'offline':r.state,statusEmoji:r.status_emoji,statusText:r.status_text,availability:r.disabled_at?'available':r.availability,backAt:r.back_at}}))}

  /**
   * Журнал рабочего пространства.
   *
   * Запись велась с первого дня — приглашения, смены ролей, выдача ссылок на
   * восстановление пароля, раскрытие паролей из сейфа, — но прочитать её было
   * нельзя ниоткуда. Журнал, в который нельзя заглянуть, не журнал.
   *
   * Листается по возрастающему `sequence` в обратную сторону: курсор — номер
   * последней показанной записи, поэтому вставка новых страниц не сдвигает.
   */
  async listAuditEvents(s,{limit=50,cursor=null,aggregateType=null,actorId=null,personal=false}={}){
    const size=Math.min(Math.max(Number(limit)||50,1),200);
    const params=[s.workspaceId];
    const where=['a.workspace_id=$1'];
    /**
     * Личное — только хозяину компании и самому человеку.
     *
     * Сейф заявлен как личное хранилище, а в журнале видно, кто и когда
     * оттуда доставал пароль; там же чужие неудачные входы и вся
     * возня со вторым множителем. Руководителю отдела это знать незачем:
     * его дело — работа отдела, а не чужие замки. Владельцу и
     * администратору видно всё: им отвечать за безопасность компании.
     */
    if(!personal){
      params.push(s.userId);
      where.push(`(a.event_type NOT LIKE 'vault.%' AND a.event_type NOT LIKE 'auth.%'
                   AND a.event_type NOT LIKE 'password.%' AND a.event_type NOT LIKE 'session.%'
                   OR a.actor_id = $${params.length})`);
    }
    if(cursor){params.push(Number(cursor));where.push(`a.sequence < $${params.length}`)}
    if(aggregateType){params.push(String(aggregateType));where.push(`a.aggregate_type = $${params.length}`)}
    if(actorId){params.push(String(actorId));where.push(`a.actor_id = $${params.length}`)}
    params.push(size+1);
    const {rows}=await this.pool.query(
      `SELECT a.sequence,a.id,a.aggregate_type,a.aggregate_id,a.event_type,a.actor_id,a.payload,a.created_at,
              p.display_name actor_name
         FROM audit_events a
         LEFT JOIN workspace_profiles p ON p.workspace_id=a.workspace_id AND p.user_id=a.actor_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.sequence DESC LIMIT $${params.length}`,params);
    const page=rows.slice(0,size);
    return{
      items:page.map(r=>({
        id:r.id,sequence:Number(r.sequence),aggregateType:r.aggregate_type,aggregateId:r.aggregate_id,
        eventType:r.event_type,actorId:r.actor_id,actorName:r.actor_name??null,payload:r.payload,createdAt:r.created_at,
      })),
      nextCursor:rows.length>size?String(page[page.length-1].sequence):null,
    };
  }

  /**
   * Имя компании и имя рабочего пространства.
   *
   * Компании переименовываются, сливаются и меняют бренд, а название было
   * вписано один раз при регистрации и оставалось навсегда.
   */
  async renameWorkspace(s,{companyName=null,workspaceName=null,showBirthdays=undefined,showHolidays=undefined,details=undefined}={}){
    return this.tx(async c=>{
      if(companyName)await c.query('UPDATE organizations SET name=$2 WHERE id=$1',[s.organizationId,companyName]);
      // Реквизиты: пустая строка — это «стереть», а не «не трогать»,
      // поэтому пишем ровно те поля, что пришли.
      if(details&&Object.keys(details).length){
        const map={legalName:'legal_name',taxId:'tax_id',address:'address',website:'website',phone:'phone',
          emailDomain:'email_domain',seatLimit:'seat_limit',domainJoin:'domain_join'};
        const sets=[],values=[s.organizationId];
        for(const[key,column]of Object.entries(map)){
          if(details[key]===undefined)continue;
          // Ноль и false — законные значения, а не «пусто»: число мест и
          // переключатель домена нельзя стирать проверкой на истинность.
          const value=key==='domainJoin'?Boolean(details[key]):(details[key]===''?null:details[key]??null);
          values.push(value);sets.push(`${column}=$${values.length}`);
        }
        if(sets.length)await c.query(`UPDATE organizations SET ${sets.join(',')} WHERE id=$1`,values);
      }
      if(workspaceName)await c.query('UPDATE workspaces SET name=$2 WHERE id=$1',[s.workspaceId,workspaceName]);
      // Слои календаря: их включают и выключают там же, где меняют имя
      // компании, — это настройки пространства, и маршрут у них один.
      if(showBirthdays!==undefined)await c.query('UPDATE workspaces SET show_birthdays=$2 WHERE id=$1',[s.workspaceId,showBirthdays]);
      if(showHolidays!==undefined)await c.query('UPDATE workspaces SET show_holidays=$2 WHERE id=$1',[s.workspaceId,showHolidays]);
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'workspace',$2,'workspace.renamed',$3,$4)`,
        [s.organizationId,s.workspaceId,s.userId,{companyName,workspaceName}]);
      const{rows}=await c.query(`SELECT w.id,w.name workspace_name,o.name organization_name,
          w.show_birthdays "showBirthdays",w.show_holidays "showHolidays"
        FROM workspaces w JOIN organizations o ON o.id=w.organization_id WHERE w.id=$1`,[s.workspaceId]);
      return{workspaceId:rows[0].id,workspaceName:rows[0].workspace_name,organizationName:rows[0].organization_name,
        showBirthdays:rows[0].showBirthdays,showHolidays:rows[0].showHolidays};
    });
  }

  /**
   * Передача владения.
   *
   * Владелец один, и до сих пор это было навсегда: человек уходил из
   * компании, а компания оставалась привязанной к его учётной записи —
   * ни уволить его, ни передать дела было нельзя. Передача меняет обе
   * стороны в одной транзакции: новый владелец получает права, прежний
   * становится администратором и остаётся работать.
   */
  async transferOwnership(s,userId){
    try{
      return await this.transferOwnershipTx(s,userId);
    }catch(error){
      // Уникальный индекс поймал вторую одновременную передачу. Для человека
      // это не сбой базы, а «вас опередили».
      if(error?.code==='23505'&&String(error.constraint??'').includes('single_owner')){
        throw Object.assign(new Error('Компанию уже передали другому'),{code:'NOT_OWNER_ANYMORE',statusCode:409});
      }
      throw error;
    }
  }

  async transferOwnershipTx(s,userId){
    return this.tx(async c=>{
      if(userId===s.userId)throw Object.assign(new Error('Вы уже владелец'),{code:'ALREADY_OWNER',statusCode:400});
      // Строка нынешнего владельца берётся под блокировку первой: два
      // одновременных перевода шли по устаревшему снимку и оба проходили,
      // оставляя компанию с двумя хозяевами.
      const{rows:current}=await c.query(
        "SELECT user_id FROM memberships WHERE workspace_id=$1 AND role='owner' FOR UPDATE",[s.workspaceId]);
      if(current[0]&&current[0].user_id!==s.userId){
        throw Object.assign(new Error('Компанию уже передали другому'),{code:'NOT_OWNER_ANYMORE',statusCode:409});
      }
      // И строка того, кому передаём: пока мы решаем, его могут увольнять.
      const{rows:member}=await c.query(
        `SELECT m.role,u.disabled_at FROM memberships m JOIN users u ON u.id=m.user_id
          WHERE m.workspace_id=$1 AND m.user_id=$2 FOR UPDATE OF m,u`,[s.workspaceId,userId]);
      if(!member[0])throw Object.assign(new Error('Person not found'),{code:'PERSON_NOT_FOUND',statusCode:404});
      if(member[0].disabled_at)throw Object.assign(new Error('Уволенному сотруднику компанию не передают'),{code:'PERSON_INACTIVE',statusCode:409});
      if(member[0].role==='guest')throw Object.assign(new Error('Компанию не передают внешнему участнику'),{code:'CANNOT_TRANSFER_TO_GUEST',statusCode:403});
      // Сначала снимаем прежнего: владелец в пространстве ровно один, и
      // уникальный индекс не даст поставить второго до освобождения места.
      await c.query("UPDATE memberships SET role='admin' WHERE workspace_id=$1 AND user_id=$2",[s.workspaceId,s.userId]);
      await c.query("UPDATE memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2",[s.workspaceId,userId]);
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'membership',$3,'ownership.transferred',$4,$5)`,
        [s.organizationId,s.workspaceId,userId,s.userId,{from:s.userId,to:userId,previousRole:member[0].role}]);
      return{ownerId:userId,previousOwnerId:s.userId};
    });
  }

  /**
   * Событие входа в журнале рабочего пространства.
   *
   * В журнале велось двадцать четыре вида событий — и ни одного об
   * аутентификации: ни удачного входа, ни провального, ни выхода. Служба
   * безопасности после ночного подбора паролей не видела там ничего.
   *
   * Для неизвестной почты пространство неизвестно, поэтому такие попытки
   * остаются только в журнале эксплуатации: писать их некуда.
   */
  async recordAuthEvent({workspaceId,userId,eventType,payload={}}){
    const{rows}=await this.pool.query(
      'SELECT organization_id FROM memberships WHERE workspace_id=$1 AND user_id=$2',[workspaceId,userId]);
    if(!rows[0])return null;
    await this.pool.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
      VALUES($1,$2,'membership',$3,$4,$3,$5)`,[rows[0].organization_id,workspaceId,userId,eventType,payload]);
    return true;
  }

  async getBootstrap(s){
    const[conversations,people,workspace,company]=await Promise.all([
      this.listConversations(s),this.listPeople(s),
      // Настройки слоёв календаря нужны первому же экрану: без них
      // клиент не знает, показывать ли дни рождения, и мигает ими.
      this.pool.query('SELECT show_birthdays "showBirthdays",show_holidays "showHolidays" FROM workspaces WHERE id=$1',[s.workspaceId]),
      // Реквизиты компании: их показывают в «Компании» и подставляют в
      // письма, поэтому приходят сразу, а не отдельным запросом.
      this.pool.query(`SELECT o.name,o.legal_name "legalName",o.tax_id "taxId",o.address,o.website,o.phone,
          o.email_domain "emailDomain",o.seat_limit "seatLimit",o.domain_join "domainJoin",
          (SELECT count(*)::int FROM memberships m WHERE m.organization_id=o.id AND m.role<>'guest') "seatsUsed"
        FROM organizations o WHERE o.id=$1`,[s.organizationId]),
    ]);
    return{session:s,conversations,people,workspace:workspace.rows[0]??{showBirthdays:true,showHolidays:true},
      company:company.rows[0]??null};
  }
  /**
   * Password recovery without a mail server.
   *
   * A corporate workspace has something a consumer product does not: an
   * administrator who already knows who works here. They issue the link and
   * hand it over. Only one live link per person — a second replaces the
   * first rather than leaving two keys to the same door.
   */
  /**
   * «Я забыл пароль» — без входа и без администратора.
   *
   * Раньше ссылку выписывал только тот, кто уже внутри: человек,
   * забывший пароль в пятницу вечером, ждал понедельника. С почтовым
   * каналом просьбу можно принять от кого угодно — но отвечать одинаково
   * и на существующий адрес, и на чужой, иначе маршрут превращается в
   * проверку «есть ли у вас такой сотрудник».
   *
   * Возвращает null, если такого человека нет: вызывающий обязан ответить
   * тем же самым «письмо отправлено».
   */
  async createSelfPasswordReset({email,tokenHash,expiresAt}){
    return this.tx(async c=>{
      const{rows:found}=await c.query(
        `SELECT u.id,m.organization_id,m.workspace_id,w.name workspace_name,
                COALESCE(p.display_name,u.email) display_name
           FROM users u
           JOIN auth_credentials a ON a.user_id=u.id
           JOIN memberships m ON m.user_id=u.id
           JOIN workspaces w ON w.id=m.workspace_id
           LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=u.id
          WHERE lower(u.email)=lower($1) AND u.disabled_at IS NULL
          ORDER BY m.created_at LIMIT 1`,[email]);
      const person=found[0];
      if(!person)return null;
      await c.query("UPDATE password_resets SET status='revoked' WHERE workspace_id=$1 AND user_id=$2 AND status='pending'",
        [person.workspace_id,person.id]);
      const{rows}=await c.query(
        `INSERT INTO password_resets(organization_id,workspace_id,user_id,issued_by,token_hash,expires_at)
         VALUES($1,$2,$3,$3,$4,$5) RETURNING id,user_id "userId",status,expires_at "expiresAt",created_at "createdAt"`,
        [person.organization_id,person.workspace_id,person.id,tokenHash,expiresAt]);
      // Просьбу о сбросе видно в журнале наравне с выданной администратором:
      // череда таких строк на один адрес — первый признак подбора.
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'membership',$3,'password.reset.requested',$3,$4)`,
        [person.organization_id,person.workspace_id,person.id,{expiresAt,self:true}]);
      return{...rows[0],organizationId:person.organization_id,workspaceId:person.workspace_id,
        workspaceName:person.workspace_name,displayName:person.display_name,email};
    });
  }
  async createPasswordReset(s,{userId,tokenHash,expiresAt}){
    return this.tx(async c=>{
      const{rows:member}=await c.query('SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2',[s.workspaceId,userId]);
      if(!member.length)throw Object.assign(new Error('Person not found'),{code:'PERSON_NOT_FOUND',statusCode:404});
      await c.query("UPDATE password_resets SET status='revoked' WHERE workspace_id=$1 AND user_id=$2 AND status='pending'",[s.workspaceId,userId]);
      const{rows}=await c.query(
        `INSERT INTO password_resets(organization_id,workspace_id,user_id,issued_by,token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id,user_id "userId",status,expires_at "expiresAt",created_at "createdAt"`,
        [s.organizationId,s.workspaceId,userId,s.userId,tokenHash,expiresAt]);
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'membership',$3,'password.reset.issued',$4,$5)`,[s.organizationId,s.workspaceId,userId,s.userId,{expiresAt}]);
      return rows[0];
    });
  }

  /** Single use, and the clock decides when it stops working. */
  /**
   * Устройства, с которых человек вошёл.
   *
   * Утёкший сеанс отозвать было нечем: список не показывался нигде, а
   * «выйти» отзывал ровно тот сеанс, из которого нажали. Украденный
   * ноутбук оставался внутри до истечения срока — тридцать дней.
   */
  async listSessions(s){
    const{rows}=await this.pool.query(
      `SELECT id,user_agent "userAgent",ip_address "ipAddress",created_at "createdAt",last_seen_at "lastSeenAt",expires_at "expiresAt"
         FROM user_sessions
        WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
        ORDER BY last_seen_at DESC`,[s.userId]);
    return rows.map(row=>({...row,current:row.id===s.sessionId}));
  }
  /** Отозвать один чужой сеанс — свой отзывается обычным выходом. */
  async revokeSessionById(s,id){
    const{rowCount}=await this.pool.query(
      'UPDATE user_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',[id,s.userId]);
    if(!rowCount)throw Object.assign(new Error('Session not found'),{code:'SESSION_NOT_FOUND',statusCode:404});
    await this.recordAuthEvent({workspaceId:s.workspaceId,userId:s.userId,eventType:'session.revoked',payload:{sessionId:id}});
    return{revoked:true};
  }
  /**
   * Выйти везде, кроме текущего места.
   *
   * Именно «кроме текущего»: человек, который нажимает это после кражи
   * телефона, не должен вылететь сам и остаться без доступа к компании.
   */
  async revokeOtherSessions(s){
    const{rowCount}=await this.pool.query(
      'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL AND expires_at>now()',
      [s.userId,s.sessionId]);
    await this.recordAuthEvent({workspaceId:s.workspaceId,userId:s.userId,eventType:'session.revoked.others',payload:{count:rowCount}});
    return{revoked:rowCount};
  }
  /**
   * Сменить свой пароль.
   *
   * Сменить пароль изнутри было нельзя вовсе: единственным способом
   * оставалось «я забыл пароль» — то есть выйти, попросить письмо и
   * дождаться его. Человек, которому пароль подсмотрели через плечо,
   * ничего не мог сделать прямо сейчас.
   *
   * Старый пароль спрашивается не для формальности: без него всякий, кто
   * добрался до незапертого ноутбука, меняет пароль и запирает хозяина
   * снаружи.
   */
  async changePassword(s,{verify,passwordHash,passwordSalt,keepSessionId}){
    return this.tx(async c=>{
      const{rows}=await c.query(
        'SELECT password_hash "passwordHash",password_salt "passwordSalt" FROM auth_credentials WHERE user_id=$1 FOR UPDATE',[s.userId]);
      const current=rows[0];
      if(!current)throw Object.assign(new Error('No credentials for this account'),{code:'NO_CREDENTIALS',statusCode:409});
      if(!verify(current))throw Object.assign(new Error('Current password is wrong'),{code:'WRONG_PASSWORD',statusCode:403,expose:true});
      await c.query(
        `UPDATE auth_credentials SET password_hash=$2,password_salt=$3,password_changed_at=now(),failed_attempts=0,locked_until=NULL
         WHERE user_id=$1`,[s.userId,passwordHash,passwordSalt]);
      // Смена пароля стоит немного, если у чужого остаётся живой сеанс.
      const{rowCount}=await c.query(
        'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',[s.userId,keepSessionId]);
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'membership',$3,'password.changed',$3,$4)`,
        [s.organizationId,s.workspaceId,s.userId,{sessionsRevoked:rowCount}]);
      return{changed:true,sessionsRevoked:rowCount};
    });
  }
  async redeemPasswordReset({tokenHash,passwordHash,passwordSalt}){
    // The expiry is settled before the transaction opens. Marking a link
    // expired and then throwing inside one transaction rolls the mark back
    // with everything else, so the link stayed «pending» for ever; and a
    // second connection cannot do the marking while the first holds the row
    // locked.
    const{rows:found}=await this.pool.query(
      `SELECT id,expires_at "expiresAt" FROM password_resets WHERE token_hash=$1 AND status='pending'`,[tokenHash]);
    if(!found[0])throw Object.assign(new Error('This recovery link is not valid'),{code:'RESET_NOT_FOUND',statusCode:404});
    if(Date.parse(found[0].expiresAt)<=Date.now()){
      await this.pool.query("UPDATE password_resets SET status='expired' WHERE id=$1 AND status='pending'",[found[0].id]);
      throw Object.assign(new Error('This recovery link has expired'),{code:'RESET_EXPIRED',statusCode:410});
    }

    return this.tx(async c=>{
      const{rows}=await c.query(
        `SELECT id,organization_id "organizationId",workspace_id "workspaceId",user_id "userId",expires_at "expiresAt"
         FROM password_resets WHERE token_hash=$1 AND status='pending' FOR UPDATE`,[tokenHash]);
      const row=rows[0];
      // Two people redeeming the same link at once: the loser finds it gone.
      if(!row||Date.parse(row.expiresAt)<=Date.now()){
        throw Object.assign(new Error('This recovery link is not valid'),{code:'RESET_NOT_FOUND',statusCode:404});
      }
      // Credentials live beside the user, not on it. Recovery also clears the
      // failed-attempt lock: an account locked by someone guessing at it is
      // exactly the account whose owner is asking for a new password.
      await c.query(
        `UPDATE auth_credentials SET password_hash=$2,password_salt=$3,password_changed_at=now(),failed_attempts=0,locked_until=NULL
         WHERE user_id=$1`,[row.userId,passwordHash,passwordSalt]);
      await c.query("UPDATE password_resets SET status='used',used_at=now() WHERE id=$1",[row.id]);
      // A recovered password is worth nothing if the old sessions keep working.
      await c.query('DELETE FROM user_sessions WHERE user_id=$1',[row.userId]);
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'membership',$3,'password.reset.used',$3,$4)`,[row.organizationId,row.workspaceId,row.userId,{}]);
      return {userId:row.userId,workspaceId:row.workspaceId};
    });
  }

  // Кого позвали в компанию и кто вошёл — первое, что спрашивают у журнала.
  /**
   * Компания, готовая принять человека с таким адресом.
   *
   * Ищем по домену почты и только среди тех, кто это разрешил. Заодно
   * считаем занятые места: приглашать в переполненную компанию нечестно —
   * человек получит ссылку и упрётся в отказ на последнем шаге.
   */
  async findCompanyForEmail(email){
    const domain=String(email||'').split('@')[1]?.toLowerCase();
    if(!domain)return null;
    const{rows}=await this.pool.query(
      `SELECT o.id organization_id,o.name,o.seat_limit "seatLimit",w.id workspace_id,
         (SELECT count(*)::int FROM memberships m WHERE m.organization_id=o.id AND m.role<>'guest') seats_used
       FROM organizations o JOIN workspaces w ON w.organization_id=o.id
       WHERE o.domain_join AND lower(o.email_domain)=$1
       ORDER BY w.created_at LIMIT 1`,[domain]);
    if(!rows.length)return null;
    const row=rows[0];
    return{organizationId:row.organization_id,workspaceId:row.workspace_id,name:row.name,
      seatLimit:row.seatLimit,seatsUsed:row.seats_used,
      full:row.seatLimit!==null&&row.seats_used>=row.seatLimit};
  }

  /**
   * Владелец пространства.
   *
   * Нужен в двух местах самостоятельного заведения: от его имени
   * выписывается приглашение (ссылка обязана быть кем-то выдана — это
   * решение компании, а не человека с улицы), и ему же уходит письмо,
   * когда мест не осталось.
   */
  async workspaceOwner(workspaceId){
    const{rows}=await this.pool.query(
      `SELECT m.user_id "userId",u.email FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.workspace_id=$1 AND m.role='owner' ORDER BY m.created_at LIMIT 1`,[workspaceId]);
    return rows[0]??null;
  }

  /** Почтовый домен компании — по нему видно чужой адрес в списке. */
  async findCompanyDomain(organizationId){
    const{rows}=await this.pool.query('SELECT email_domain FROM organizations WHERE id=$1',[organizationId]);
    return rows[0]?.email_domain??null;
  }

  /** Уже здесь или уже позван — второй раз звать не надо. */
  async emailKnownInWorkspace(workspaceId,email){
    const{rows}=await this.pool.query(
      `SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.workspace_id=$1 AND lower(u.email)=lower($2)
       UNION ALL
       SELECT 1 FROM workspace_invitations WHERE workspace_id=$1 AND lower(email)=lower($2) AND status='pending'`,
      [workspaceId,email]);
    return rows.length>0;
  }

  async createInvitation(s,v){return this.tx(async c=>{
    const id=randomUUID();
    const{rows}=await c.query(`INSERT INTO workspace_invitations(id,organization_id,workspace_id,email,role,invited_by,token_hash,expires_at,access_until,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,email,role,status,expires_at "expiresAt",access_until "accessUntil",created_at "createdAt",unit_id "unitId"`,[id,s.organizationId,s.workspaceId,v.email,v.role,s.userId,v.tokenHash,v.expiresAt,v.accessUntil??null,v.unitId??null]);
    await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
      VALUES($1,$2,'membership',$3,'invitation.issued',$4,$5)`,[s.organizationId,s.workspaceId,id,s.userId,{email:v.email,role:v.role,expiresAt:v.expiresAt}]);
    return rows[0];
  })}
  async acceptInvitation(v){return this.tx(async c=>{const{rows}=await c.query("SELECT * FROM workspace_invitations WHERE token_hash=$1 AND status='pending' FOR UPDATE",[v.tokenHash]);const i=rows[0];if(!i)throw Object.assign(new Error('Invitation is not available'),{code:'INVITATION_NOT_FOUND',statusCode:404});if(Date.parse(i.expires_at)<=Date.now()){await c.query("UPDATE workspace_invitations SET status='expired' WHERE id=$1",[i.id]);throw Object.assign(new Error('Invitation has expired'),{code:'INVITATION_EXPIRED',statusCode:410})}if((await c.query('SELECT 1 FROM users WHERE lower(email)=lower($1)',[i.email])).rowCount)throw Object.assign(new Error('This email already has an account; sign in before joining another workspace'),{code:'EXISTING_ACCOUNT_LOGIN_REQUIRED',statusCode:409});const userId=randomUUID();
    // Два приглашения на одну почту, принятые в один миг: проверка выше
    // смотрит на снимок до вставки, поэтому второму отвечает уникальный
    // индекс — и ответ должен быть тем же человеческим, а не сырым 23505.
    try{await c.query('INSERT INTO users(id,email) VALUES($1,$2)',[userId,i.email])}
    catch(error){
      if(error?.code==='23505')throw Object.assign(new Error('This email already has an account; sign in before joining another workspace'),{code:'EXISTING_ACCOUNT_LOGIN_REQUIRED',statusCode:409});
      throw error;
    }await c.query('INSERT INTO memberships(organization_id,workspace_id,user_id,role,access_until) VALUES($1,$2,$3,$4,$5)',[i.organization_id,i.workspace_id,userId,i.role,i.access_until??null]);await c.query('INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email) VALUES($1,$2,$3,$4,$5)',[i.organization_id,i.workspace_id,userId,v.displayName,i.email]);await c.query('INSERT INTO auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,$3)',[userId,v.passwordHash,v.passwordSalt]);await c.query(`INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) SELECT organization_id,workspace_id,id,$2,'member' FROM conversations WHERE workspace_id=$1 AND kind='channel' AND visibility='workspace' AND $3<>'guest' AND archived_at IS NULL ON CONFLICT DO NOTHING`,[i.workspace_id,userId,i.role]);
    // Отдел из приглашения. Ставим бережно: за неделю, пока ссылка шла,
    // отдел могли распустить или набить до отказа. Тогда человек всё
    // равно входит в компанию — просто без отдела, и об этом остаётся
    // запись: молча потерять распределение хуже, чем сказать.
    if(i.unit_id&&i.role!=='guest'){
      const{rows:units}=await c.query('SELECT id,seat_limit,conversation_id FROM org_units WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[i.workspace_id,i.unit_id]);
      const unit=units[0];
      let placed=false,reason='unit_gone';
      if(unit){
        const{rows:used}=await c.query('SELECT count(*)::int c FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2',[i.workspace_id,i.unit_id]);
        if(unit.seat_limit!==null&&used[0].c>=unit.seat_limit)reason='no_seats';
        else{
          await c.query(`INSERT INTO org_unit_members(organization_id,workspace_id,unit_id,user_id,role,assigned_by)
            VALUES($1,$2,$3,$4,'member',$5) ON CONFLICT DO NOTHING`,[i.organization_id,i.workspace_id,i.unit_id,userId,i.invited_by]);
          if(unit.conversation_id)await c.query(`INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role)
            VALUES($1,$2,$3,$4,'member') ON CONFLICT DO NOTHING`,[i.organization_id,i.workspace_id,unit.conversation_id,userId]);
          placed=true;
        }
      }
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'org_unit',$3,$4,$5,$6)`,
        [i.organization_id,i.workspace_id,i.unit_id,placed?'org.unit.member_added':'org.unit.placement_skipped',userId,
         placed?{userId,role:'member',viaInvitation:i.id}:{userId,reason,viaInvitation:i.id}]);
    }
    await c.query("UPDATE workspace_invitations SET status='accepted',accepted_by=$2,accepted_at=now() WHERE id=$1",[i.id,userId]);await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
      VALUES($1,$2,'membership',$3,'invitation.accepted',$3,$4)`,[i.organization_id,i.workspace_id,userId,{email:i.email,role:i.role,invitationId:i.id,invitedBy:i.invited_by}]);const w=(await c.query('SELECT id,organization_id,name FROM workspaces WHERE id=$1',[i.workspace_id])).rows[0];return{user:{id:userId,email:i.email},workspace:{id:w.id,organizationId:w.organization_id,name:w.name},membership:{organizationId:i.organization_id,workspaceId:i.workspace_id,userId,role:i.role}}})}
  async listConversations(s,{archived=false}={}){
    const{rows}=await this.pool.query(conversationListSql(s),[s.workspaceId,s.userId,Boolean(archived)]);
    return rows;
  }
  async canAccessConversation(s,id){return(await this.pool.query(`SELECT 1 FROM conversations c LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$3 WHERE c.workspace_id=$1 AND c.id=$2 AND c.archived_at IS NULL AND(${openConversationSql(s,'c')} OR cm.user_id IS NOT NULL)`,[s.workspaceId,id,s.userId])).rowCount>0}
  async conversationPolicy(s,id){const{rows}=await this.pool.query(`SELECT c.id,c.kind,c.title,c.slug,c.purpose,c.visibility,c.announcement_only "announcementOnly",${avatarUrlSql('c.avatar_file_id')} "avatarUrl",c.created_by "createdBy",c.created_at "createdAt",cm.role "memberRole",cm.archived_at "archivedAt",cm.muted_until "mutedUntil" FROM conversations c LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$3 WHERE c.workspace_id=$1 AND c.id=$2 AND c.archived_at IS NULL AND(${openConversationSql(s,'c')} OR cm.user_id IS NOT NULL)`,[s.workspaceId,id,s.userId]);const r=rows[0];return r?{conversation:{id:r.id,kind:r.kind,title:r.title,slug:r.slug,purpose:r.purpose,visibility:r.visibility,announcementOnly:r.announcementOnly,createdBy:r.createdBy,createdAt:r.createdAt,avatarUrl:r.avatarUrl},memberRole:r.memberRole??null,preferences:{archivedAt:r.archivedAt??null,mutedUntil:r.mutedUntil??null}}:null}
  async setConversationPreferences(s,id,{archived,mutedUntil}={}){if(!await this.canAccessConversation(s,id))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});return this.tx(async c=>{await c.query(`INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) SELECT organization_id,workspace_id,id,$3,'member' FROM conversations WHERE workspace_id=$1 AND id=$2 ON CONFLICT(workspace_id,conversation_id,user_id) DO NOTHING`,[s.workspaceId,id,s.userId]);if(archived!==undefined)await c.query('UPDATE conversation_members SET archived_at=CASE WHEN $4::boolean THEN now() ELSE NULL END WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3',[s.workspaceId,id,s.userId,Boolean(archived)]);if(mutedUntil!==undefined)await c.query('UPDATE conversation_members SET muted_until=$4::timestamptz WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3',[s.workspaceId,id,s.userId,mutedUntil||null]);const r=(await c.query('SELECT archived_at "archivedAt",muted_until "mutedUntil" FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3',[s.workspaceId,id,s.userId])).rows[0];return r??{archivedAt:null,mutedUntil:null}})}
  async conversationNotificationAudience(s,id){const{rows}=await this.pool.query(`SELECT DISTINCT m.user_id FROM conversations c JOIN memberships m ON m.workspace_id=c.workspace_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=m.user_id WHERE c.workspace_id=$1 AND c.id=$2 AND c.archived_at IS NULL AND(${openConversationSql(s,'c')} OR cm.user_id IS NOT NULL) AND(cm.muted_until IS NULL OR cm.muted_until<=now())`,[s.workspaceId,id]);return rows.map(r=>r.user_id)}
  async listConversationMembers(s,id){if(!await this.canAccessConversation(s,id))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});return(await this.pool.query(`SELECT cm.user_id "userId",cm.role,COALESCE(p.display_name,p.email,cm.user_id::text) "displayName",p.email,p.title,m.role "workspaceRole" FROM conversation_members cm JOIN memberships m ON m.workspace_id=cm.workspace_id AND m.user_id=cm.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=cm.workspace_id AND p.user_id=cm.user_id WHERE cm.workspace_id=$1 AND cm.conversation_id=$2 ORDER BY COALESCE(p.display_name,p.email,cm.user_id::text)`,[s.workspaceId,id])).rows}
  async addConversationMembers(s,id,userIds,role='member'){const guard=await this.pool.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND role='guest'",[s.workspaceId,userIds]);if(guard.rowCount&&['owner','moderator'].includes(role))throw Object.assign(new Error('A guest cannot run a conversation'),{code:'GUEST_CANNOT_OWN_ROOM',statusCode:409});return this.tx(async c=>{const conv=(await c.query('SELECT kind,visibility FROM conversations WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',[s.workspaceId,id])).rows[0];/* A room whose visibility is «the whole company» is exactly the room an outsider must not be in: everyone writing there is addressing colleagues. Put the client in a room made for them instead. */if(guard.rowCount&&conv&&['workspace','organization'].includes(conv.visibility))throw Object.assign(new Error('A guest cannot be placed in a company-wide room'),{code:'GUEST_NOT_IN_OPEN_ROOM',statusCode:409});if(!conv)throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});if(conv.kind==='direct')throw Object.assign(new Error('Direct conversation membership is immutable'),{code:'DIRECT_MEMBERSHIP_IMMUTABLE',statusCode:409});for(const userId of new Set(userIds)){if(!(await c.query('SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2',[s.workspaceId,userId])).rowCount)throw Object.assign(new Error('Conversation participant must belong to the workspace'),{code:'INVALID_CONVERSATION_MEMBER',statusCode:400});await c.query('INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,conversation_id,user_id) DO NOTHING',[s.organizationId,s.workspaceId,id,userId,role])}return(await c.query(`SELECT cm.user_id "userId",cm.role,COALESCE(p.display_name,p.email,cm.user_id::text) "displayName",p.email,p.title,m.role "workspaceRole" FROM conversation_members cm JOIN memberships m ON m.workspace_id=cm.workspace_id AND m.user_id=cm.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=cm.workspace_id AND p.user_id=cm.user_id WHERE cm.workspace_id=$1 AND cm.conversation_id=$2 ORDER BY COALESCE(p.display_name,p.email,cm.user_id::text)`,[s.workspaceId,id])).rows})}
  async setConversationMemberRole(s,id,userId,role){const guard=await this.pool.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND role='guest'",[s.workspaceId,[userId]]);if(guard.rowCount&&['owner','moderator'].includes(role))throw Object.assign(new Error('A guest cannot run a conversation'),{code:'GUEST_CANNOT_OWN_ROOM',statusCode:409});return this.tx(async c=>{const conv=(await c.query('SELECT kind FROM conversations WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',[s.workspaceId,id])).rows[0];if(!conv)throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});if(conv.kind==='direct')throw Object.assign(new Error('Direct conversation membership is immutable'),{code:'DIRECT_MEMBERSHIP_IMMUTABLE',statusCode:409});const member=(await c.query('SELECT role FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3 FOR UPDATE',[s.workspaceId,id,userId])).rows[0];if(!member)throw Object.assign(new Error('Conversation member not found'),{code:'CONVERSATION_MEMBER_NOT_FOUND',statusCode:404});if(member.role==='owner'&&role!=='owner'){const owners=await c.query("SELECT 1 FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND role='owner' FOR UPDATE",[s.workspaceId,id]);if(owners.rowCount<=1)throw Object.assign(new Error('Conversation must keep at least one owner'),{code:'LAST_CONVERSATION_OWNER',statusCode:409})}await c.query('UPDATE conversation_members SET role=$4 WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3',[s.workspaceId,id,userId,role]);return(await c.query(`SELECT cm.user_id "userId",cm.role,COALESCE(p.display_name,p.email,cm.user_id::text) "displayName",p.email,p.title,m.role "workspaceRole" FROM conversation_members cm JOIN memberships m ON m.workspace_id=cm.workspace_id AND m.user_id=cm.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=cm.workspace_id AND p.user_id=cm.user_id WHERE cm.workspace_id=$1 AND cm.conversation_id=$2 ORDER BY COALESCE(p.display_name,p.email,cm.user_id::text)`,[s.workspaceId,id])).rows})}
  /**
   * Recovery for a room whose owners are all gone — somebody left the company,
   * or an owner removed the others. Deliberately narrow: it works only when no
   * reachable owner remains, so it restores a room rather than opening a
   * backdoor into private conversations, and it writes an audit event because
   * an administrator taking a private room is exactly the act that should be
   * on the record.
   */
  async claimOrphanedConversation(s,id){
    return this.tx(async c=>{
      const conv=(await c.query('SELECT kind,title FROM conversations WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',[s.workspaceId,id])).rows[0];
      if(!conv)throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});
      if(conv.kind==='direct')throw Object.assign(new Error('A direct conversation has no owner to restore'),{code:'DIRECT_MEMBERSHIP_IMMUTABLE',statusCode:409});
      const owners=await c.query(`SELECT 1 FROM conversation_members cm
        JOIN memberships m ON m.workspace_id=cm.workspace_id AND m.user_id=cm.user_id
        WHERE cm.workspace_id=$1 AND cm.conversation_id=$2 AND cm.role='owner'`,[s.workspaceId,id]);
      if(owners.rowCount)throw Object.assign(new Error('This conversation still has an owner'),{code:'CONVERSATION_HAS_OWNER',statusCode:409});
      await c.query(`INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role)
        VALUES($1,$2,$3,$4,'owner')
        ON CONFLICT(workspace_id,conversation_id,user_id) DO UPDATE SET role='owner'`,
        [s.organizationId,s.workspaceId,id,s.userId]);
      await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'conversation',$3,'conversation.ownership_claimed',$4,$5)`,
        [s.organizationId,s.workspaceId,id,s.userId,{title:conv.title,reason:'no remaining owner'}]);
      return {claimed:true,conversationId:id};
    });
  }

  // See the memory store: a room could never be renamed or repurposed.
  async updateConversation(s,id,patch){
    const sets=[],params=[s.workspaceId,id];
    for(const [key,column] of [['title','title'],['purpose','purpose'],['announcementOnly','announcement_only'],['avatarFileId','avatar_file_id']]){
      if(patch[key]===undefined)continue;
      params.push(patch[key]);
      sets.push(`${column}=$${params.length}`);
    }
    if(!sets.length)return this.getConversation?.(s,id)??null;
    const{rows}=await this.pool.query(
      `UPDATE conversations SET ${sets.join(',')} WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL
       RETURNING id,kind,title,slug,purpose,visibility,announcement_only "announcementOnly",created_at "createdAt",
                 ${avatarUrlSql('avatar_file_id')} "avatarUrl"`,params);
    if(!rows[0])throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});
    return rows[0];
  }
  async removeConversationMember(s,id,userId){return this.tx(async c=>{const conv=(await c.query('SELECT kind FROM conversations WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',[s.workspaceId,id])).rows[0];if(!conv)throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});if(conv.kind==='direct')throw Object.assign(new Error('Direct conversation membership is immutable'),{code:'DIRECT_MEMBERSHIP_IMMUTABLE',statusCode:409});const member=(await c.query('SELECT role FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3 FOR UPDATE',[s.workspaceId,id,userId])).rows[0];if(!member)throw Object.assign(new Error('Conversation member not found'),{code:'CONVERSATION_MEMBER_NOT_FOUND',statusCode:404});if(member.role==='owner'){const owners=await c.query("SELECT 1 FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND role='owner' FOR UPDATE",[s.workspaceId,id]);if(owners.rowCount<=1)throw Object.assign(new Error('Conversation must keep at least one owner'),{code:'LAST_CONVERSATION_OWNER',statusCode:409})}await c.query('DELETE FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3',[s.workspaceId,id,userId]);
    // Уведомления по закрытой беседе оставались в колокольчике у того, кого
    // из неё вывели: нажатие давало «беседа не найдена», а заголовок
    // приватной комнаты продолжал светиться в списке.
    await c.query(`UPDATE notifications SET archived_at=now(),updated_at=now()
      WHERE workspace_id=$1 AND conversation_id=$2 AND recipient_user_id=$3 AND archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM conversations c2
          WHERE c2.workspace_id=$1 AND c2.id=$2 AND c2.visibility IN ('workspace','organization'))`,
      [s.workspaceId,id,userId]);
    await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
      VALUES($1,$2,'conversation',$3,'conversation.member_removed',$4,$5)`,
      [s.organizationId,s.workspaceId,id,s.userId,{userId,role:member.role}]);
    return(await c.query(`SELECT cm.user_id "userId",cm.role,COALESCE(p.display_name,p.email,cm.user_id::text) "displayName",p.email,p.title,m.role "workspaceRole" FROM conversation_members cm JOIN memberships m ON m.workspace_id=cm.workspace_id AND m.user_id=cm.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=cm.workspace_id AND p.user_id=cm.user_id WHERE cm.workspace_id=$1 AND cm.conversation_id=$2 ORDER BY COALESCE(p.display_name,p.email,cm.user_id::text)`,[s.workspaceId,id])).rows})}
  /**
   * Каталог каналов.
   *
   * Каналы компании видно в боковой панели, и этого достаточно, пока их
   * восемь. На тридцати новый сотрудник не понимает ни что здесь есть,
   * ни зачем каждый из них нужен: список названий — не ответ. Каталог
   * отвечает описанием, размером и тем, живой канал или брошенный.
   *
   * Приватные каналы сюда не попадают: их существование — тоже
   * сведения, которых снаружи знать не полагается.
   */
  async listChannelCatalogue(s,{query=null,limit=100}={}){
    if(isGuest(s))return[];
    const{rows}=await this.pool.query(
      `SELECT c.id,c.title,c.slug,c.purpose,c.visibility,c.announcement_only "announcementOnly",
              c.created_at "createdAt",
              (cm.user_id IS NOT NULL) "member",
              (SELECT count(*)::int FROM conversation_members x
                WHERE x.workspace_id=c.workspace_id AND x.conversation_id=c.id) "memberCount",
              (SELECT count(*)::int FROM messages m
                WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id
                  AND m.deleted_at IS NULL AND m.created_at > now() - interval '30 days') "recentMessages",
              (SELECT max(m.created_at) FROM messages m
                WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND m.deleted_at IS NULL) "lastAt"
         FROM conversations c
         LEFT JOIN conversation_members cm
           ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2
        WHERE c.workspace_id=$1 AND c.kind='channel' AND c.archived_at IS NULL
          AND c.visibility IN('workspace','organization')
          AND ($3::text IS NULL OR c.title ILIKE '%'||$3||'%' OR c.purpose ILIKE '%'||$3||'%' OR c.slug ILIKE '%'||$3||'%')
        ORDER BY (cm.user_id IS NOT NULL) DESC, "recentMessages" DESC, c.title
        LIMIT $4`,
      [s.workspaceId,s.userId,query?String(query).slice(0,120):null,Math.min(Number(limit)||100,200)]);
    return rows;
  }
  /**
   * Войти в открытый канал.
   *
   * Уйти из канала было можно, вернуться — нет: маршрута не существовало,
   * и человек оставался «здесь по видимости», без строки участника, без
   * счётчика непрочитанного и без уведомлений.
   */
  async joinChannel(s,id){
    if(isGuest(s))throw Object.assign(new Error('A guest joins only where they were invited'),{code:'FORBIDDEN',statusCode:403});
    const{rows}=await this.pool.query(
      `SELECT id,kind,visibility,title FROM conversations
        WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL`,[s.workspaceId,id]);
    const conversation=rows[0];
    // Приватного канала для непосвящённого не существует — и отказ
    // должен звучать так же, как для несуществующего.
    if(!conversation||conversation.kind!=='channel'||!['workspace','organization'].includes(conversation.visibility))
      throw Object.assign(new Error('Channel not found'),{code:'NOT_FOUND',statusCode:404});
    await this.pool.query(
      `INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role)
       VALUES($1,$2,$3,$4,'member') ON CONFLICT DO NOTHING`,
      [s.organizationId,s.workspaceId,id,s.userId]);
    return{joined:true,conversationId:id};
  }
  /**
   * Беседа по идентификатору.
   *
   * Метода не существовало, хотя `updateConversation` вызывала его
   * через `?.` на случай пустой правки — то есть в этом случае честно
   * отвечала `null` вместо беседы, которую не меняли.
   */
  async getConversation(s,id){
    const{rows}=await this.pool.query(
      `SELECT c.id,c.kind,c.title,c.slug,c.purpose,c.visibility,c.announcement_only "announcementOnly",
              c.created_at "createdAt",c.archived_at "archivedAt"
         FROM conversations c
         LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$3
        WHERE c.workspace_id=$1 AND c.id=$2 AND(${openConversationSql(s,'c')} OR cm.user_id IS NOT NULL)`,
      [s.workspaceId,id,s.userId]);
    return rows[0]??null;
  }
  async conversationAudience(s,id){const{rows}=await this.pool.query(`SELECT DISTINCT m.user_id FROM conversations c JOIN memberships m ON m.workspace_id=c.workspace_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=m.user_id WHERE c.workspace_id=$1 AND c.id=$2 AND c.archived_at IS NULL AND(${openConversationSql(s,'c')} OR cm.user_id IS NOT NULL)`,[s.workspaceId,id]);return rows.map(r=>r.user_id)}
  async createConversation(s,v){return this.tx(async c=>{const id=randomUUID();for(const userId of new Set([s.userId,...(v.participantIds??[])]))if(!(await c.query('SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2',[s.workspaceId,userId])).rowCount)throw Object.assign(new Error('Conversation participant must belong to the workspace'),{code:'INVALID_CONVERSATION_MEMBER',statusCode:400});await c.query('INSERT INTO conversations(id,organization_id,workspace_id,kind,title,slug,purpose,visibility,announcement_only,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,s.organizationId,s.workspaceId,v.kind,v.title,v.slug,v.purpose,v.visibility,Boolean(v.announcementOnly),s.userId]);if(v.visibility==='workspace'&&v.kind==='channel')await c.query(`INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) SELECT organization_id,workspace_id,$2,user_id,CASE WHEN user_id=$3 THEN 'owner' ELSE 'member' END FROM memberships WHERE workspace_id=$1 AND role<>'guest' ON CONFLICT DO NOTHING`,[s.workspaceId,id,s.userId]);else for(const userId of new Set([s.userId,...(v.participantIds??[])]))await c.query('INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES($1,$2,$3,$4,$5)',[s.organizationId,s.workspaceId,id,userId,userId===s.userId?'owner':'member']);
    // Кто завёл беседу и какую — в журнал: удаление участника и
    // передача владения туда попадали, а само появление комнаты — нет.
    await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
       VALUES($1,$2,'conversation',$3,'conversation.created',$4,$5)`,
      [s.organizationId,s.workspaceId,id,s.userId,{kind:v.kind,title:v.title??null,visibility:v.visibility??null}]);
    return{id,kind:v.kind,title:v.title,slug:v.slug,purpose:v.purpose,visibility:v.visibility,announcementOnly:Boolean(v.announcementOnly),createdBy:s.userId,createdAt:new Date().toISOString()}})}
  /**
   * Страница переписки.
   *
   * `before` листает назад. `around` — окно вокруг конкретного
   * сообщения: переход из поиска к реплике трёхмесячной давности
   * подгружал последние сто сообщений, не находил её в них и молча
   * сдавался — человек оказывался внизу ленты без объяснений.
   */
  /**
   * Лента беседы и ветка под сообщением.
   *
   * Столбец `thread_root_id` писался с самого начала и не читался ни
   * разу: ответ в ветке падал в общий поток вперемешку с остальным, и
   * разговор, ради которого ветку и заводят, ничем не отличался от
   * реплики посреди беседы. Поэтому в ленте веток нет — только их
   * корни со счётчиком, а сами ответы открываются отдельно.
   */
  async listMessages(s,id,limit=100,before=null,around=null,{threadRootId=null}={}){
    if(!await this.canAccessConversation(s,id))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});
    const size=Math.min(Number(limit)||100,200);
    if(threadRootId){
      const root=(await this.pool.query(
        'SELECT id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3 AND thread_root_id IS NULL',
        [s.workspaceId,id,threadRootId])).rows[0];
      // Ветка ветки — это не разговор, а лабиринт: корнем бывает только
      // сообщение из самой ленты.
      if(!root)throw Object.assign(new Error('Message not found'),{code:'MESSAGE_NOT_FOUND',statusCode:404});
      const{rows}=await this.pool.query(
        `SELECT ${messageColumnsSql(s)} FROM messages m
          WHERE m.workspace_id=$1 AND m.conversation_id=$2 AND (m.id=$5::uuid OR m.thread_root_id=$5::uuid)
          ORDER BY m.created_at ASC,m.id ASC LIMIT $4`,
        [s.workspaceId,id,s.userId,size,threadRootId]);
      return rows;
    }
    if(around){
      const anchor=(await this.pool.query(
        'SELECT created_at FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3',
        [s.workspaceId,id,around])).rows[0];
      if(!anchor)throw Object.assign(new Error('Message not found'),{code:'MESSAGE_NOT_FOUND',statusCode:404});
      const half=Math.max(1,Math.floor(size/2));
      const{rows:older}=await this.pool.query(
        `SELECT ${messageColumnsSql(s)} FROM messages m WHERE m.workspace_id=$1 AND m.conversation_id=$2
           AND m.thread_root_id IS NULL AND (m.created_at,m.id) <= ($5::timestamptz,$6::uuid)
         ORDER BY m.created_at DESC,m.id DESC LIMIT $4`,
        [s.workspaceId,id,s.userId,half,anchor.created_at,around]);
      const{rows:newer}=await this.pool.query(
        `SELECT ${messageColumnsSql(s)} FROM messages m WHERE m.workspace_id=$1 AND m.conversation_id=$2
           AND m.thread_root_id IS NULL AND (m.created_at,m.id) > ($5::timestamptz,$6::uuid)
         ORDER BY m.created_at ASC,m.id ASC LIMIT $4`,
        [s.workspaceId,id,s.userId,size-half,anchor.created_at,around]);
      return [...older.reverse(),...newer];
    }
    const{rows}=await this.pool.query(`SELECT ${messageColumnsSql(s)} FROM messages m WHERE m.workspace_id=$1 AND m.conversation_id=$2 AND m.thread_root_id IS NULL AND($5::timestamptz IS NULL OR (m.created_at,m.id) < ($5::timestamptz,$6::uuid)) ORDER BY m.created_at DESC,m.id DESC LIMIT $4`,[s.workspaceId,id,s.userId,size,before?.at??null,before?.id??null]);
    return rows.reverse();
  }
  /**
   * Повторная отправка с тем же clientRequestId должна возвращать то же
   * сообщение, а не конфликт: смысл идентификатора запроса ровно в этом.
   * Проверка «уже есть?» и вставка шли двумя шагами, и при одновременном
   * повторе второй получал сырой отказ уникального индекса.
   */
  async createMessage(s,id,v={}){
    try{
      return await this.createMessageOnce(s,id,v);
    }catch(error){
      // Индекс зовётся messages_sender_request_idx; достаточно кода отказа
      // и того, что у отправки вообще был идентификатор запроса.
      const duplicate=error?.code==='23505';
      if(duplicate&&v?.clientRequestId){
        const{rows}=await this.pool.query(
          'SELECT id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND author_id=$3 AND client_request_id=$4',
          [s.workspaceId,id,s.userId,v.clientRequestId]);
        if(rows[0])return this.getMessage(s,rows[0].id);
      }
      throw error;
    }
  }

  async createMessageOnce(s,id,v={}){if(!await this.canAccessConversation(s,id))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});const value={kind:'text',body:null,replyToId:null,threadRootId:null,metadata:{},mentionedUserIds:[],clientRequestId:null,...v};if(value.clientRequestId){const{rows:prior}=await this.pool.query('SELECT id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND author_id=$3 AND client_request_id=$4',[s.workspaceId,id,s.userId,value.clientRequestId]);if(prior[0])return this.getMessage(s,prior[0].id);}return this.tx(async c=>{for(const messageId of [value.replyToId,value.threadRootId].filter(Boolean)){const valid=await c.query('SELECT thread_root_id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3 AND deleted_at IS NULL',[s.workspaceId,id,messageId]);if(!valid.rowCount)throw Object.assign(new Error('Message reference is not available in this conversation'),{code:'INVALID_MESSAGE_REFERENCE',statusCode:400});
      // Ветка ветки — не разговор, а лабиринт: корнем бывает только
      // сообщение из самой ленты.
      if(messageId===value.threadRootId&&valid.rows[0].thread_root_id)throw Object.assign(new Error('A thread cannot start inside another thread'),{code:'NESTED_THREAD',statusCode:409,expose:true})}const messageId=randomUUID(),mentions=[...new Set(value.mentionedUserIds??[])],{rows}=await c.query(`INSERT INTO messages(id,organization_id,workspace_id,conversation_id,kind,author_id,body,reply_to_id,thread_root_id,metadata,client_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,conversation_id "conversationId",kind,author_id "authorId",body,reply_to_id "replyToId",thread_root_id "threadRootId",metadata,created_at "createdAt",edited_at "editedAt",deleted_at "deletedAt"`,[messageId,s.organizationId,s.workspaceId,id,value.kind??'text',s.userId,value.body??null,value.replyToId??null,value.threadRootId??null,value.metadata??{},value.clientRequestId??null]);for(const userId of mentions)await c.query('INSERT INTO message_mentions(organization_id,workspace_id,message_id,mentioned_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[s.organizationId,s.workspaceId,messageId,userId]);return{...rows[0],mentionedUserIds:mentions,reactions:[],saved:false,pinned:false,forwarded:false,forwardedFrom:null}})}
  async messageConversation(s,id){const{rows}=await this.pool.query('SELECT conversation_id FROM messages WHERE workspace_id=$1 AND id=$2',[s.workspaceId,id]);return rows[0]?.conversation_id||null}
  async getMessage(s,id){const conversationId=await this.messageConversation(s,id);if(!conversationId||!await this.canAccessConversation(s,conversationId))return null;const{rows}=await this.pool.query(`SELECT ${messageColumnsSql(s)} FROM messages m WHERE m.workspace_id=$1 AND m.id=$2`,[s.workspaceId,id,s.userId]);return rows[0]??null}
  async setMessageSaved(s,id,saved=true){const message=await this.getMessage(s,id);if(!message||message.deletedAt)throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});if(saved)await this.pool.query('INSERT INTO saved_messages(organization_id,workspace_id,message_id,user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[s.organizationId,s.workspaceId,id,s.userId]);else await this.pool.query('DELETE FROM saved_messages WHERE workspace_id=$1 AND message_id=$2 AND user_id=$3',[s.workspaceId,id,s.userId]);return{saved:Boolean(saved)}}
  async listSavedMessages(s){const{rows}=await this.pool.query(`SELECT m.id,m.conversation_id "conversationId",m.kind,m.author_id "authorId",m.body,m.metadata,m.created_at "createdAt",m.edited_at "editedAt",m.deleted_at "deletedAt",c.title "conversationTitle",sm.saved_at "savedAt",true saved,EXISTS(SELECT 1 FROM message_pins mp WHERE mp.workspace_id=m.workspace_id AND mp.message_id=m.id) pinned,EXISTS(SELECT 1 FROM message_forwards mf WHERE mf.workspace_id=m.workspace_id AND mf.forwarded_message_id=m.id) forwarded,(SELECT CASE WHEN ${openConversationSql(s,'sc')} OR scm.user_id IS NOT NULL THEN jsonb_build_object('messageId',src.id,'conversationId',src.conversation_id,'conversationTitle',sc.title,'authorId',src.author_id,'createdAt',src.created_at) ELSE jsonb_build_object('restricted',true) END FROM message_forwards mf JOIN messages src ON src.workspace_id=mf.workspace_id AND src.id=mf.source_message_id JOIN conversations sc ON sc.workspace_id=src.workspace_id AND sc.id=src.conversation_id LEFT JOIN conversation_members scm ON scm.workspace_id=sc.workspace_id AND scm.conversation_id=sc.id AND scm.user_id=$2 WHERE mf.workspace_id=m.workspace_id AND mf.forwarded_message_id=m.id LIMIT 1) "forwardedFrom",COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',r.user_id,'reaction',r.reaction)) FROM message_reactions r WHERE r.workspace_id=m.workspace_id AND r.message_id=m.id),'[]') reactions FROM saved_messages sm JOIN messages m ON m.workspace_id=sm.workspace_id AND m.id=sm.message_id JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2 WHERE sm.workspace_id=$1 AND sm.user_id=$2 AND m.deleted_at IS NULL AND c.archived_at IS NULL AND(${openConversationSql(s,'c')} OR cm.user_id IS NOT NULL) ORDER BY sm.saved_at DESC,m.id DESC`,[s.workspaceId,s.userId]);return rows}
  async setMessagePinned(s,id,pinned=true){const message=await this.getMessage(s,id);if(!message||message.deletedAt)throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});if(pinned)await this.pool.query(`INSERT INTO message_pins(organization_id,workspace_id,message_id,pinned_by) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,message_id) DO UPDATE SET pinned_by=EXCLUDED.pinned_by,pinned_at=now()`,[s.organizationId,s.workspaceId,id,s.userId]);else await this.pool.query('DELETE FROM message_pins WHERE workspace_id=$1 AND message_id=$2',[s.workspaceId,id]);return{pinned:Boolean(pinned)}}
  async listPinnedMessages(s,conversationId){if(!await this.canAccessConversation(s,conversationId))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});const{rows}=await this.pool.query(`SELECT m.id,m.conversation_id "conversationId",m.kind,m.author_id "authorId",m.body,m.metadata,m.created_at "createdAt",m.edited_at "editedAt",m.deleted_at "deletedAt",mp.pinned_by "pinnedBy",mp.pinned_at "pinnedAt",true pinned,EXISTS(SELECT 1 FROM saved_messages sm WHERE sm.workspace_id=m.workspace_id AND sm.message_id=m.id AND sm.user_id=$3) saved,EXISTS(SELECT 1 FROM message_forwards mf WHERE mf.workspace_id=m.workspace_id AND mf.forwarded_message_id=m.id) forwarded,(SELECT CASE WHEN ${openConversationSql(s,'sc')} OR scm.user_id IS NOT NULL THEN jsonb_build_object('messageId',src.id,'conversationId',src.conversation_id,'conversationTitle',sc.title,'authorId',src.author_id,'createdAt',src.created_at) ELSE jsonb_build_object('restricted',true) END FROM message_forwards mf JOIN messages src ON src.workspace_id=mf.workspace_id AND src.id=mf.source_message_id JOIN conversations sc ON sc.workspace_id=src.workspace_id AND sc.id=src.conversation_id LEFT JOIN conversation_members scm ON scm.workspace_id=sc.workspace_id AND scm.conversation_id=sc.id AND scm.user_id=$3 WHERE mf.workspace_id=m.workspace_id AND mf.forwarded_message_id=m.id LIMIT 1) "forwardedFrom",COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',r.user_id,'reaction',r.reaction)) FROM message_reactions r WHERE r.workspace_id=m.workspace_id AND r.message_id=m.id),'[]') reactions FROM message_pins mp JOIN messages m ON m.workspace_id=mp.workspace_id AND m.id=mp.message_id WHERE mp.workspace_id=$1 AND m.conversation_id=$2 AND m.deleted_at IS NULL ORDER BY mp.pinned_at DESC,m.id DESC`,[s.workspaceId,conversationId,s.userId]);return rows}
  /**
   * Перенос из чужого мессенджера.
   *
   * Сообщение обычное, отметка о происхождении — отдельной строкой:
   * автор там не наш сотрудник, времени там своё, и подмешивать это в
   * поля сообщения значит однажды посчитать подрядчика участником
   * пространства.
   */
  async createExternalForward(s,conversationId,{body,origin}){
    if(!await this.canAccessConversation(s,conversationId))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});
    return this.tx(async c=>{
      const id=randomUUID();
      await c.query(`INSERT INTO messages(id,organization_id,workspace_id,conversation_id,kind,author_id,body,client_request_id)
        VALUES($1,$2,$3,$4,'text',$5,$6,$7)`,
        [id,s.organizationId,s.workspaceId,conversationId,s.userId,body,randomUUID()]);
      await c.query(`INSERT INTO message_external_origins(organization_id,workspace_id,message_id,source,author_name,sent_at,line_count,forwarded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.organizationId,s.workspaceId,id,origin.source,origin.authorName,origin.sentAt,origin.lineCount,s.userId]);
      return id;
    }).then(id=>this.getMessage(s,id));
  }

  /**
   * Архив беседы: фото, видео, ссылки, переносы.
   *
   * Материалы копятся в ленте и находятся только прокруткой: «где та
   * фотография акта» на полугодовой переписке — это десять минут
   * листания. Разбор по виду, а не единый список, потому что искать
   * приходят именно за видом.
   */
  async conversationArchive(s,conversationId,{kind='all',source=null,limit=60}={}){
    if(!await this.canAccessConversation(s,conversationId))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});
    const size=Math.min(Number(limit)||60,200);
    // Ссылку узнаём по началу адреса: разбирать разметку ради фильтра
    // незачем, а «http» в тексте — это и есть ссылка.
    const LINK = `m.body ~* '(https?://|www\\.)'`;
    const FILE = `m.kind='file' AND (m.metadata->>'fileId') IS NOT NULL`;
    const where={
      photo:`${FILE} AND f.mime_type LIKE 'image/%'`,
      video:`${FILE} AND f.mime_type LIKE 'video/%'`,
      file:`${FILE} AND f.mime_type NOT LIKE 'image/%' AND f.mime_type NOT LIKE 'video/%'`,
      voice:`m.kind='voice'`,
      link:LINK,
      forward:`(eo.message_id IS NOT NULL OR mf.forwarded_message_id IS NOT NULL)`,
      external:`eo.message_id IS NOT NULL`,
      all:`(${FILE} OR m.kind='voice' OR ${LINK} OR eo.message_id IS NOT NULL OR mf.forwarded_message_id IS NOT NULL)`,
    }[kind]??null;
    if(!where)throw Object.assign(new Error('Такого вида материалов нет'),{code:'INVALID_ARCHIVE_KIND',statusCode:400,expose:true});
    const{rows}=await this.pool.query(`SELECT m.id,m.kind,m.author_id "authorId",m.body,m.created_at "createdAt",m.metadata,
        f.id "fileId",f.name "fileName",f.mime_type "mimeType",f.size_bytes "sizeBytes",
        CASE WHEN eo.message_id IS NOT NULL THEN jsonb_build_object('source',eo.source,'authorName',eo.author_name,'sentAt',eo.sent_at,'lineCount',eo.line_count) END "externalOrigin",
        (mf.forwarded_message_id IS NOT NULL) "forwardedInside"
      FROM messages m
      LEFT JOIN files f ON f.workspace_id=m.workspace_id AND f.id=(m.metadata->>'fileId')::uuid AND f.deleted_at IS NULL
      LEFT JOIN message_external_origins eo ON eo.workspace_id=m.workspace_id AND eo.message_id=m.id
      LEFT JOIN message_forwards mf ON mf.workspace_id=m.workspace_id AND mf.forwarded_message_id=m.id
      WHERE m.workspace_id=$1 AND m.conversation_id=$2 AND m.deleted_at IS NULL
        AND ($4::text IS NULL OR eo.source=$4)
        AND (${where})
      ORDER BY m.created_at DESC,m.id DESC LIMIT $3`,[s.workspaceId,conversationId,size,source]);
    return rows;
  }

  async forwardMessage(s,sourceMessageId,targetConversationId){const source=await this.getMessage(s,sourceMessageId);if(!source||source.deletedAt)throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});if(!await this.canAccessConversation(s,targetConversationId))throw Object.assign(new Error('Target conversation not found'),{code:'NOT_FOUND',statusCode:404});return this.tx(async c=>{const id=randomUUID(),{rows}=await c.query(`INSERT INTO messages(id,organization_id,workspace_id,conversation_id,kind,author_id,body,metadata,client_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,conversation_id "conversationId",kind,author_id "authorId",body,metadata,created_at "createdAt",edited_at "editedAt",deleted_at "deletedAt"`,[id,s.organizationId,s.workspaceId,targetConversationId,source.kind,s.userId,source.body,source.metadata??{},randomUUID()]);await c.query('INSERT INTO message_forwards(organization_id,workspace_id,forwarded_message_id,source_message_id,forwarded_by) VALUES($1,$2,$3,$4,$5)',[s.organizationId,s.workspaceId,id,sourceMessageId,s.userId]);if(source.kind==='voice'){const voice=(await c.query('SELECT file_id,duration_ms,waveform,transcript_status,transcript FROM voice_messages WHERE workspace_id=$1 AND message_id=$2',[s.workspaceId,sourceMessageId])).rows[0];if(voice)await c.query('INSERT INTO voice_messages(id,organization_id,workspace_id,message_id,file_id,duration_ms,waveform,transcript_status,transcript) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),s.organizationId,s.workspaceId,id,voice.file_id,voice.duration_ms,JSON.stringify(voice.waveform??[]),voice.transcript_status,voice.transcript])}const origin=(await c.query(`SELECT src.id "messageId",src.conversation_id "conversationId",sc.title "conversationTitle",src.author_id "authorId",src.created_at "createdAt" FROM messages src JOIN conversations sc ON sc.workspace_id=src.workspace_id AND sc.id=src.conversation_id WHERE src.workspace_id=$1 AND src.id=$2`,[s.workspaceId,sourceMessageId])).rows[0]??null;return{...rows[0],replyToId:null,threadRootId:null,mentionedUserIds:[],reactions:[],saved:false,pinned:false,forwarded:true,forwardedFrom:origin}})}
  /**
   * Правка сообщения с сохранением прежнего текста.
   *
   * Раньше текст просто перезаписывался. В продукте, чей журнал
   * показывает, кто раскрыл пароль из сейфа, это значит, что переписку
   * можно переписать задним числом: обещание «отправлю до пятницы»
   * превращается в «посмотрю на неделе», и доказать обратное нечем.
   *
   * Прежний текст и запись в журнал — в одной транзакции с самой
   * правкой: след, который можно потерять отдельно от изменения, не
   * след.
   */
  async editMessage(s,id,body){
    const message=await this.getMessage(s,id);
    if(!message||message.deletedAt)throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});
    // Правка, ничего не меняющая, не должна плодить версии: иначе
    // история засоряется до нечитаемости повторными нажатиями.
    if(String(message.body??'')===String(body??''))return message;
    await this.tx(async c=>{
      await c.query(
        `INSERT INTO message_versions(organization_id,workspace_id,message_id,body,edited_by)
         VALUES($1,$2,$3,$4,$5)`,[s.organizationId,s.workspaceId,id,message.body,s.userId]);
      await c.query('UPDATE messages SET body=$3,edited_at=now() WHERE workspace_id=$1 AND id=$2',[s.workspaceId,id,body]);
      await c.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'message',$3,'message.edited',$4,$5)`,
        [s.organizationId,s.workspaceId,id,s.userId,
          // В журнал — факт и размер правки, но не сам текст: журнал
          // читают те, кому переписка не адресована.
          {conversationId:message.conversationId,wasLength:String(message.body??'').length,nowLength:String(body??'').length}]);
    });
    return this.getMessage(s,id);
  }
  /**
   * Прежние редакции сообщения.
   *
   * Видит тот, кто видит саму беседу: история правок — часть
   * переписки, а не отдельная тайна.
   */
  async listMessageVersions(s,id){
    const conversationId=await this.messageConversation(s,id);
    if(!conversationId||!await this.canAccessConversation(s,conversationId))
      throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});
    const{rows}=await this.pool.query(
      `SELECT v.id,v.body,v.replaced_at "replacedAt",v.edited_by "editedBy",
              COALESCE(p.display_name,u.email) "editedByName"
         FROM message_versions v
         LEFT JOIN users u ON u.id=v.edited_by
         LEFT JOIN workspace_profiles p ON p.workspace_id=v.workspace_id AND p.user_id=v.edited_by
        WHERE v.workspace_id=$1 AND v.message_id=$2
        ORDER BY v.replaced_at DESC`,[s.workspaceId,id]);
    return rows;
  }
  async deleteMessage(s,id){const message=await this.getMessage(s,id);if(!message||message.deletedAt)throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});await this.tx(async c=>{// Удалённое сообщение исчезало из чата, но его полный текст оставался
      // в центре уведомлений навсегда — там, где «удалить у всех» уже ничего
      // не значило. Гасим тело вместе с самим сообщением.
      await c.query(`UPDATE notifications SET body='Сообщение удалено',updated_at=now()
        WHERE workspace_id=$1 AND message_id=$2`,[s.workspaceId,id]);
      await c.query('UPDATE messages SET deleted_at=now() WHERE workspace_id=$1 AND id=$2',[s.workspaceId,id]);await c.query('DELETE FROM message_pins WHERE workspace_id=$1 AND message_id=$2',[s.workspaceId,id])});return this.getMessage(s,id)}
  async toggleReaction(s,id,reaction){const message=await this.getMessage(s,id);if(!message||message.deletedAt)throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});const deleted=await this.pool.query('DELETE FROM message_reactions WHERE workspace_id=$1 AND message_id=$2 AND user_id=$3 AND reaction=$4 RETURNING reaction',[s.workspaceId,id,s.userId,reaction]);if(!deleted.rowCount)await this.pool.query('INSERT INTO message_reactions(organization_id,workspace_id,message_id,user_id,reaction) VALUES($1,$2,$3,$4,$5)',[s.organizationId,s.workspaceId,id,s.userId,reaction]);const{rows}=await this.pool.query('SELECT user_id "userId",reaction,created_at "createdAt" FROM message_reactions WHERE workspace_id=$1 AND message_id=$2 ORDER BY created_at',[s.workspaceId,id]);return rows}
  async markRead(s,id,messageId=null){
    if(messageId){
      const{rowCount}=await this.pool.query('SELECT 1 FROM messages WHERE workspace_id=$1 AND id=$2 AND conversation_id=$3',[s.workspaceId,messageId,id]);
      if(!rowCount)throw Object.assign(new Error('That message is not in this conversation'),{code:'MESSAGE_NOT_IN_CONVERSATION',statusCode:400});
    }
    await this.pool.query(`INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role,last_read_at,last_read_message_id)
      VALUES($1,$2,$3,$4,'member',now(),$5)
      ON CONFLICT(workspace_id,conversation_id,user_id) DO UPDATE SET last_read_at=now(),last_read_message_id=EXCLUDED.last_read_message_id`,
      [s.organizationId,s.workspaceId,id,s.userId,messageId]);
  }
  /**
   * Присутствие и объявленная доступность.
   *
   * Это две разные вещи, и их нельзя смешивать. Состояние («в сети»,
   * «отошёл») вычисляет приложение по сокету и обновляет само —
   * в том числе при каждом подключении. Доступность («на обеде до 14»,
   * «в отпуске до 5-го») объявляет человек, и переподключение не должно
   * её стирать: иначе закрытая крышка ноутбука отменяла бы отпуск.
   *
   * Отсюда `touch`: когда приложение просто отмечает, что человек в
   * сети, объявленное не трогается.
   */
  async setPresence(s,v){
    const touch=v.availability===undefined&&v.statusText===undefined&&v.backAt===undefined;
    const{rows}=await this.pool.query(
      `INSERT INTO user_presence(organization_id,workspace_id,user_id,state,last_seen_at,status_emoji,status_text,status_expires_at,availability,back_at,updated_at)
       VALUES($1,$2,$3,$4,now(),$5,$6,$7,COALESCE($8,'available'),$9,now())
       ON CONFLICT(workspace_id,user_id) DO UPDATE SET
         state=EXCLUDED.state,last_seen_at=now(),
         status_emoji=CASE WHEN $10 THEN user_presence.status_emoji ELSE EXCLUDED.status_emoji END,
         status_text=CASE WHEN $10 THEN user_presence.status_text ELSE EXCLUDED.status_text END,
         status_expires_at=CASE WHEN $10 THEN user_presence.status_expires_at ELSE EXCLUDED.status_expires_at END,
         availability=CASE WHEN $10 THEN user_presence.availability ELSE EXCLUDED.availability END,
         back_at=CASE WHEN $10 THEN user_presence.back_at ELSE EXCLUDED.back_at END,
         updated_at=now()
       RETURNING state,last_seen_at "lastSeenAt",status_emoji "statusEmoji",status_text "statusText",
                 status_expires_at "statusExpiresAt",availability,back_at "backAt"`,
      [s.organizationId,s.workspaceId,s.userId,v.state||'online',v.statusEmoji??null,v.statusText??null,
       v.statusExpiresAt??null,v.availability??null,v.backAt??null,touch]);
    return rows[0];
  }
  async saveFile(s,v){const{rows}=await this.pool.query(`INSERT INTO files(id,organization_id,workspace_id,uploaded_by,name,mime_type,size_bytes,storage_key,sha256,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready') RETURNING id,name,mime_type "mimeType",size_bytes "sizeBytes",storage_key "storageKey",sha256,status,created_at "createdAt"`,[v.id,s.organizationId,s.workspaceId,s.userId,v.name,v.mimeType,v.sizeBytes,v.storageKey,v.sha256]);return rows[0]}
  /**
   * Текст вложения для поиска.
   *
   * Отдельной таблицей: он бывает в сотни раз больше карточки файла, а
   * карточку читают на каждом экране со списком вложений.
   */
  async saveFileText(s,fileId,{body,kind}){
    await this.pool.query(
      `INSERT INTO file_texts(organization_id,workspace_id,file_id,body,kind)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id,file_id) DO UPDATE SET body=EXCLUDED.body,kind=EXCLUDED.kind,extracted_at=now()`,
      [s.organizationId,s.workspaceId,fileId,body,kind??'text']);
  }
  async getFile(s,id){return(await this.pool.query('SELECT id,name,mime_type "mimeType",size_bytes "sizeBytes",storage_key "storageKey",sha256,status,workspace_id "workspaceId" FROM files WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',[s.workspaceId,id])).rows[0]||null}
  async saveVoiceMessage(s,id,v){return this.tx(async c=>{const messageId=randomUUID(),voiceId=randomUUID(),{rows}=await c.query(`INSERT INTO messages(id,organization_id,workspace_id,conversation_id,kind,author_id,body,metadata) VALUES($1,$2,$3,$4,'voice',$5,NULL,$6) RETURNING id,kind,author_id "authorId",metadata,created_at "createdAt"`,[messageId,s.organizationId,s.workspaceId,id,s.userId,{fileId:v.file.id,durationMs:v.durationMs}]);await c.query('INSERT INTO voice_messages(id,organization_id,workspace_id,message_id,file_id,duration_ms,waveform) VALUES($1,$2,$3,$4,$5,$6,$7)',[voiceId,s.organizationId,s.workspaceId,messageId,v.file.id,v.durationMs,JSON.stringify(v.waveform)]);return{message:rows[0],voice:{id:voiceId,messageId,fileId:v.file.id,durationMs:v.durationMs,waveform:v.waveform},file:v.file}})}
  taskSelect(){return `SELECT c.id,c.organization_id "organizationId",c.workspace_id "workspaceId",c.title,c.outcome,c.owner_id "ownerId",c.requester_id "requesterId",c.acceptor_id "acceptorId",c.source_message_id "sourceMessageId",c.status,c.priority,c.promised_at "promisedAt",c.forecast_at "forecastAt",c.version,c.created_at "createdAt",c.updated_at "updatedAt",(SELECT count(*)::int FROM evidence e WHERE e.workspace_id=c.workspace_id AND e.commitment_id=c.id) "evidenceCount",COALESCE((SELECT jsonb_agg(tc.user_id) FROM task_collaborators tc WHERE tc.workspace_id=c.workspace_id AND tc.commitment_id=c.id),'[]') "collaboratorIds",(SELECT count(*)::int FROM task_checklist_items i WHERE i.workspace_id=c.workspace_id AND i.commitment_id=c.id) "checklistTotal",(SELECT count(*)::int FROM task_checklist_items i WHERE i.workspace_id=c.workspace_id AND i.commitment_id=c.id AND i.completed_at IS NOT NULL) "checklistDone",(SELECT count(*)::int FROM task_dependencies d JOIN commitments b ON b.workspace_id=d.workspace_id AND b.id=d.depends_on_commitment_id WHERE d.workspace_id=c.workspace_id AND d.commitment_id=c.id AND d.kind='blocks' AND b.status<>ALL(ARRAY['closed','accepted_result','cancelled','rejected'])) "blockedBy" FROM commitments c`}
  taskView(s,row){if(!row||!canViewTask(row,s))return null;return{...row,allowedTransitions:allowedTaskTransitions(row,s,Number(row.evidenceCount||0))}}
  /**
   * Задачи без курсора — для поиска и сводок.
   *
   * Метод читал весь бэклог компании целиком и фильтровал видимость уже в
   * JavaScript: на двадцати тысячах задач это пять с половиной секунд и
   * десятки мегабайт в память процесса. Предел обязателен: страницы — дело
   * listTasksPage, а здесь нужен ограниченный срез.
   */
  async listTasks(s,{limit=500}={}){
    const size=Math.min(Math.max(Number(limit)||500,1),2000);
    const{rows}=await this.pool.query(
      `${this.taskSelect()} WHERE c.workspace_id=$1 ORDER BY c.promised_at NULLS LAST,c.created_at DESC LIMIT $2`,
      [s.workspaceId,size]);
    return rows.filter(row=>canViewTask(row,s)).map(row=>this.taskView(s,row));
  }
  // listTasks loads a workspace's whole backlog, which is fine for search but
  // not for an API. This page pushes the visibility rule into SQL so LIMIT
  // counts rows the caller can actually see, and walks a keyset over the same
  // (promised_at NULLS LAST, created_at DESC, id DESC) order.
  /**
   * Страница задач с отбором по состоянию.
   *
   * Экран задач был плоским списком: закрытые, отменённые и предложенные
   * вперемешку, без вкладок и без счётчиков. Чтобы понять, сколько
   * сделано за месяц, владелец должен был прокрутить всё, что накопилось
   * за историю компании, и считать глазами. Отбор по состоянию просился
   * сам: он всё равно делается в SQL, просто никто его не передавал.
   *
   * `scope` — чьи задачи: «мои» (я делаю, прошу или принимаю) или «все»,
   * если человеку доверены чужие.
   */
  async listTasksPage(s,{limit=50,cursor=null,status=null,scope='mine'}={}){
    if(isGuest(s))return{items:[],nextCursor:null};
    const params=[s.workspaceId],where=['c.workspace_id=$1'];
    if(status==='active'){
      params.push([...ACTIVE_TASK_STATUSES]);
      where.push(`c.status=ANY($${params.length}::text[])`);
    }else if(status==='overdue'){
      params.push([...ACTIVE_TASK_STATUSES]);
      where.push(`c.status=ANY($${params.length}::text[]) AND c.promised_at<now()`);
    }else if(status){
      const wanted=String(status).split(',').map(value=>value.trim()).filter(Boolean);
      if(wanted.length){params.push(wanted);where.push(`c.status=ANY($${params.length}::text[])`)}
    }
    // Тому, кому доверены чужие задачи, «все» показывает всё; остальным
    // это слово ничего не меняет — они и так видят только своё.
    if(!managesTeamTasks(s)||scope!=='all'){
      params.push(s.userId);
      // Соисполнитель тоже видит задачу и должен находить её в своём
      // списке: иначе помощь есть, а места, где её делать, нет.
      where.push(`(c.owner_id=$${params.length} OR c.requester_id=$${params.length} OR c.acceptor_id=$${params.length} OR EXISTS(SELECT 1 FROM task_collaborators tc WHERE tc.workspace_id=c.workspace_id AND tc.commitment_id=c.id AND tc.user_id=$${params.length}))`);
    }
    const key=decodeTaskCursor(cursor);
    if(key){
      params.push(key.createdAt,key.id);
      const created=`$${params.length-1}::timestamptz`,id=`$${params.length}::uuid`;
      if(key.promisedAt===null){
        where.push(`(c.promised_at IS NULL AND (c.created_at,c.id)<(${created},${id}))`);
      }else{
        params.push(key.promisedAt);
        const promised=`$${params.length}::timestamptz`;
        where.push(`(c.promised_at>${promised} OR c.promised_at IS NULL OR (c.promised_at=${promised} AND (c.created_at,c.id)<(${created},${id})))`);
      }
    }
    params.push(taskPageSize(limit)+1);
    const{rows}=await this.pool.query(
      `${this.taskSelect()} WHERE ${where.join(' AND ')} ORDER BY c.promised_at NULLS LAST,c.created_at DESC,c.id DESC LIMIT $${params.length}`,params);
    const size=params[params.length-1]-1,page=rows.slice(0,size);
    return{items:page.map(row=>this.taskView(s,row)),nextCursor:rows.length>size?encodeTaskCursor(page[page.length-1]):null};
  }
  /** Сколько задач в каждом состоянии — для вкладок и ответа «сколько сделано». */
  async taskCounts(s,{scope='mine'}={}){
    if(isGuest(s))return{};
    const params=[s.workspaceId],where=['c.workspace_id=$1'];
    if(!managesTeamTasks(s)||scope!=='all'){
      params.push(s.userId);
      // Соисполнитель тоже видит задачу и должен находить её в своём
      // списке: иначе помощь есть, а места, где её делать, нет.
      where.push(`(c.owner_id=$${params.length} OR c.requester_id=$${params.length} OR c.acceptor_id=$${params.length} OR EXISTS(SELECT 1 FROM task_collaborators tc WHERE tc.workspace_id=c.workspace_id AND tc.commitment_id=c.id AND tc.user_id=$${params.length}))`);
    }
    params.push([...ACTIVE_TASK_STATUSES]);
    const active=`$${params.length}::text[]`;
    const{rows}=await this.pool.query(
      `SELECT count(*)::int total,
              count(*) FILTER(WHERE c.status=ANY(${active}))::int active,
              count(*) FILTER(WHERE c.status=ANY(${active}) AND c.promised_at<now())::int overdue,
              count(*) FILTER(WHERE c.status='proposed')::int proposed,
              count(*) FILTER(WHERE c.status IN('closed','accepted_result'))::int done,
              count(*) FILTER(WHERE c.status IN('cancelled','rejected'))::int dropped
         FROM commitments c WHERE ${where.join(' AND ')}`,params);
    return rows[0]??{};
  }

  async getTask(s,id){const{rows}=await this.pool.query(`${this.taskSelect()} WHERE c.workspace_id=$1 AND c.id=$2`,[s.workspaceId,id]);return this.taskView(s,rows[0])}
  async createTask(s,v){if(v.sourceMessageId){const conversationId=await this.messageConversation(s,v.sourceMessageId);if(!conversationId||!await this.canAccessConversation(s,conversationId))throw Object.assign(new Error('Task source message not found'),{code:'TASK_SOURCE_NOT_FOUND',statusCode:404})}return this.tx(async c=>{const ownerId=v.ownerId||s.userId,acceptorId=v.acceptorId||s.userId;for(const userId of new Set([ownerId,acceptorId,s.userId])){const{rows:member}=await c.query('SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',[s.workspaceId,userId]);if(!member.length)throw Object.assign(new Error('Task participant must belong to the workspace'),{code:'INVALID_TASK_MEMBER',statusCode:400});if(member[0].role===GUEST_ROLE)throw Object.assign(new Error('A guest cannot carry a commitment'),{code:'GUEST_CANNOT_HOLD_TASK',statusCode:400});}const id=randomUUID(),{rows}=await c.query(`INSERT INTO commitments(id,organization_id,workspace_id,title,outcome,owner_id,requester_id,acceptor_id,source_message_id,status,priority,promised_at,forecast_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'proposed',$10,$11,$12) RETURNING id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt"`,[id,s.organizationId,s.workspaceId,v.title,v.outcome||v.title,ownerId,s.userId,acceptorId,v.sourceMessageId,v.priority||'normal',v.promisedAt,v.forecastAt]);await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'commitment',$3,'commitment.created',$4,$5)`,[s.organizationId,s.workspaceId,id,s.userId,{ownerId,acceptorId,sourceMessageId:v.sourceMessageId??null}]);
    await c.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload) VALUES($1,$2,'task.created',$3,$4)`,[s.organizationId,s.workspaceId,id,{taskId:id,ownerId,acceptorId,requesterId:s.userId,status:rows[0].status,promisedAt:rows[0].promisedAt??null}]);return this.taskView(s,{...rows[0],evidenceCount:0})})}
  /**
   * Шаги внутри обязательства.
   *
   * Одно обещание с пятью шагами честнее пяти обещаний: человек обещал
   * одно дело, а не пять, и отчитываться должен за него. Таблица под это
   * лежала в схеме с самого начала, и кода за ней не было.
   */
  async addChecklistItem(s,id,title){
    const task=await this.getTask(s,id);
    if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    assertTaskStructureAuthority(task,s);
    const{rows}=await this.pool.query(
      `INSERT INTO task_checklist_items(organization_id,workspace_id,commitment_id,title,position)
       VALUES($1,$2,$3,$4,COALESCE((SELECT max(position)+1 FROM task_checklist_items WHERE workspace_id=$2 AND commitment_id=$3),0))
       RETURNING id,title,position,completed_at "completedAt",completed_by "completedBy"`,
      [s.organizationId,s.workspaceId,id,title]);
    return rows[0];
  }
  /** Отметить шаг сделанным или снять отметку. */
  async setChecklistItem(s,id,itemId,done){
    const task=await this.getTask(s,id);
    if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    const{rows:helpers}=await this.pool.query(
      'SELECT user_id FROM task_collaborators WHERE workspace_id=$1 AND commitment_id=$2',[s.workspaceId,id]);
    assertChecklistAuthority(task,s,helpers.map(r=>r.user_id));
    const{rows}=await this.pool.query(
      `UPDATE task_checklist_items
          SET completed_at=CASE WHEN $4 THEN now() ELSE NULL END,
              completed_by=CASE WHEN $4 THEN $5::uuid ELSE NULL END
        WHERE workspace_id=$1 AND commitment_id=$2 AND id=$3
        RETURNING id,title,position,completed_at "completedAt",completed_by "completedBy"`,
      [s.workspaceId,id,itemId,Boolean(done),s.userId]);
    if(!rows[0])throw Object.assign(new Error('Checklist item not found'),{code:'CHECKLIST_ITEM_NOT_FOUND',statusCode:404});
    return rows[0];
  }
  async removeChecklistItem(s,id,itemId){
    const task=await this.getTask(s,id);
    if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    assertTaskStructureAuthority(task,s);
    const{rowCount}=await this.pool.query(
      'DELETE FROM task_checklist_items WHERE workspace_id=$1 AND commitment_id=$2 AND id=$3',[s.workspaceId,id,itemId]);
    if(!rowCount)throw Object.assign(new Error('Checklist item not found'),{code:'CHECKLIST_ITEM_NOT_FOUND',statusCode:404});
    return{removed:true};
  }

  /**
   * Соисполнители.
   *
   * Обещание несёт один человек — это основа всей модели, и менять её
   * незачем. Но помогают обычно вдвоём, и помощнику нужно место в
   * задаче: видеть её, отмечать шаги, попадать в уведомления. Отвечает
   * при этом по-прежнему owner.
   */
  async addCollaborator(s,id,userId){
    const task=await this.getTask(s,id);
    if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    assertTaskStructureAuthority(task,s);
    const{rows:member}=await this.pool.query(
      'SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',[s.workspaceId,userId]);
    if(!member.length)throw Object.assign(new Error('Task participant must belong to the workspace'),{code:'INVALID_TASK_MEMBER',statusCode:400});
    // Гость обязательств не носит — и помогать с ними тоже не может.
    if(member[0].role===GUEST_ROLE)throw Object.assign(new Error('A guest cannot carry a commitment'),{code:'GUEST_CANNOT_HOLD_TASK',statusCode:400});
    if(userId===task.ownerId)throw Object.assign(new Error('Ответственный уже здесь'),{code:'ALREADY_OWNER',statusCode:409,expose:true});
    await this.pool.query(
      `INSERT INTO task_collaborators(organization_id,workspace_id,commitment_id,user_id)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[s.organizationId,s.workspaceId,id,userId]);
    return{added:true,userId};
  }
  async removeCollaborator(s,id,userId){
    const task=await this.getTask(s,id);
    if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    assertTaskStructureAuthority(task,s);
    const{rowCount}=await this.pool.query(
      'DELETE FROM task_collaborators WHERE workspace_id=$1 AND commitment_id=$2 AND user_id=$3',[s.workspaceId,id,userId]);
    if(!rowCount)throw Object.assign(new Error('Collaborator not found'),{code:'COLLABORATOR_NOT_FOUND',statusCode:404});
    return{removed:true};
  }

  /**
   * Связи между обязательствами.
   *
   * `blocks` — «это ждёт то»: отчёт уже показывает застрявшее, но не
   * может объяснить, чего именно оно ждёт. `relates_to` — просто рядом.
   *
   * Круг запрещён: цепочка «A ждёт B, B ждёт A» — это не зависимость, а
   * пара обязательств, которые никогда не сдвинутся, и лучше сказать об
   * этом сразу.
   */
  async addDependency(s,id,dependsOnId,kind='blocks'){
    if(!['blocks','relates_to'].includes(kind))throw Object.assign(new Error('Unknown dependency kind'),{code:'INVALID_DEPENDENCY_KIND',statusCode:400});
    if(id===dependsOnId)throw Object.assign(new Error('Обязательство не может ждать само себя'),{code:'SELF_DEPENDENCY',statusCode:400,expose:true});
    const[task,other]=await Promise.all([this.getTask(s,id),this.getTask(s,dependsOnId)]);
    if(!task||!other)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    assertTaskStructureAuthority(task,s);
    if(kind==='blocks'&&await this.dependencyWouldLoop(s,id,dependsOnId)){
      throw Object.assign(new Error('Эти обязательства уже ждут друг друга — так ни одно не сдвинется'),
        {code:'DEPENDENCY_LOOP',statusCode:409,expose:true});
    }
    await this.pool.query(
      `INSERT INTO task_dependencies(organization_id,workspace_id,commitment_id,depends_on_commitment_id,kind)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,commitment_id,depends_on_commitment_id) DO UPDATE SET kind=EXCLUDED.kind`,
      [s.organizationId,s.workspaceId,id,dependsOnId,kind]);
    return{added:true,dependsOn:dependsOnId,kind};
  }
  /** Дойдёт ли цепочка ожиданий от `dependsOnId` обратно до `id`. */
  async dependencyWouldLoop(s,id,dependsOnId){
    const{rows}=await this.pool.query(
      `WITH RECURSIVE chain(id) AS (
         SELECT $3::uuid
         UNION
         SELECT d.depends_on_commitment_id FROM task_dependencies d
           JOIN chain ON chain.id=d.commitment_id
          WHERE d.workspace_id=$1 AND d.kind='blocks'
       )
       SELECT 1 FROM chain WHERE id=$2::uuid LIMIT 1`,[s.workspaceId,id,dependsOnId]);
    return rows.length>0;
  }
  async removeDependency(s,id,dependsOnId){
    const task=await this.getTask(s,id);
    if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    assertTaskStructureAuthority(task,s);
    const{rowCount}=await this.pool.query(
      'DELETE FROM task_dependencies WHERE workspace_id=$1 AND commitment_id=$2 AND depends_on_commitment_id=$3',
      [s.workspaceId,id,dependsOnId]);
    if(!rowCount)throw Object.assign(new Error('Dependency not found'),{code:'DEPENDENCY_NOT_FOUND',statusCode:404});
    return{removed:true};
  }

  async getTaskDetail(s,id){const task=await this.getTask(s,id);if(!task)return null;const[evidence,acceptances,audit,checklist,collaborators,dependencies]=await Promise.all([this.pool.query(`SELECT id,type,value,added_by "addedBy",created_at "createdAt" FROM evidence WHERE workspace_id=$1 AND commitment_id=$2 ORDER BY created_at,id`,[s.workspaceId,id]),this.pool.query(`SELECT id,reviewer_id "reviewerId",decision,comment,created_at "createdAt" FROM acceptances WHERE workspace_id=$1 AND commitment_id=$2 ORDER BY created_at,id`,[s.workspaceId,id]),this.pool.query(`SELECT id,event_type "eventType",actor_id "actorId",payload,created_at "createdAt" FROM audit_events WHERE workspace_id=$1 AND aggregate_type='commitment' AND aggregate_id=$2 ORDER BY sequence`,[s.workspaceId,id]),this.pool.query(`SELECT i.id,i.title,i.position,i.completed_at "completedAt",i.completed_by "completedBy",COALESCE(p.display_name,u.email) "completedByName" FROM task_checklist_items i LEFT JOIN users u ON u.id=i.completed_by LEFT JOIN workspace_profiles p ON p.workspace_id=i.workspace_id AND p.user_id=i.completed_by WHERE i.workspace_id=$1 AND i.commitment_id=$2 ORDER BY i.position,i.created_at`,[s.workspaceId,id]),this.pool.query(`SELECT t.user_id "userId",COALESCE(p.display_name,u.email) "displayName",p.title,t.created_at "createdAt" FROM task_collaborators t JOIN users u ON u.id=t.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=t.workspace_id AND p.user_id=t.user_id WHERE t.workspace_id=$1 AND t.commitment_id=$2 ORDER BY COALESCE(p.display_name,u.email)`,[s.workspaceId,id]),this.pool.query(`SELECT d.depends_on_commitment_id id,d.kind,'depends' direction,b.title,b.status FROM task_dependencies d JOIN commitments b ON b.workspace_id=d.workspace_id AND b.id=d.depends_on_commitment_id WHERE d.workspace_id=$1 AND d.commitment_id=$2 UNION ALL SELECT d.commitment_id id,d.kind,'blocks' direction,b.title,b.status FROM task_dependencies d JOIN commitments b ON b.workspace_id=d.workspace_id AND b.id=d.commitment_id WHERE d.workspace_id=$1 AND d.depends_on_commitment_id=$2 ORDER BY direction,title`,[s.workspaceId,id])]);return{...task,evidence:evidence.rows,acceptances:acceptances.rows,audit:audit.rows,checklist:checklist.rows,collaborators:collaborators.rows,dependencies:dependencies.rows}}
  async addTaskEvidence(s,id,{type,value,expectedVersion}){return this.tx(async c=>{const{rows}=await c.query(`SELECT id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt" FROM commitments WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[s.workspaceId,id]);const row=rows[0];if(!row||!canViewTask(row,s))throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});assertTaskEvidenceAuthority(row,s,{expectedVersion});const evidenceId=randomUUID(),createdAt=new Date().toISOString();await c.query(`INSERT INTO evidence(id,organization_id,workspace_id,commitment_id,type,value,added_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,[evidenceId,s.organizationId,s.workspaceId,id,type,value,s.userId]);const updated=(await c.query(`UPDATE commitments SET version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt"`,[s.workspaceId,id])).rows[0];await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'commitment',$3,'evidence.added',$4,$5)`,[s.organizationId,s.workspaceId,id,s.userId,{evidenceId,type}]);
    await c.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload) VALUES($1,$2,'task.evidence.added',$3,$4)`,[s.organizationId,s.workspaceId,id,{taskId:id,evidenceId,type}]);const evidenceCount=Number((await c.query('SELECT count(*)::int count FROM evidence WHERE workspace_id=$1 AND commitment_id=$2',[s.workspaceId,id])).rows[0]?.count||0),evidence={id:evidenceId,type,value,addedBy:s.userId,createdAt};return{task:this.taskView(s,{...updated,evidenceCount}),evidence}})}
  async transitionTask(s,id,{to,reason=null,expectedVersion}){return this.tx(async c=>{const{rows}=await c.query(`SELECT id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt" FROM commitments WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[s.workspaceId,id]);const row=rows[0];if(!row||!canViewTask(row,s))throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});const evidenceCount=Number((await c.query('SELECT count(*)::int count FROM evidence WHERE workspace_id=$1 AND commitment_id=$2',[s.workspaceId,id])).rows[0]?.count||0),decision=assertTaskTransition(row,s,{to,reason,expectedVersion,evidenceCount}),from=row.status;const updated=(await c.query(`UPDATE commitments SET status=$3,version=version+1,updated_at=now(),closed_at=CASE WHEN $3 IN('closed','accepted_result','cancelled','rejected') THEN COALESCE(closed_at,now()) ELSE closed_at END WHERE workspace_id=$1 AND id=$2 RETURNING id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt"`,[s.workspaceId,id,to])).rows[0];if(from==='in_review'&&(to==='accepted_result'||to==='in_progress'))await c.query(`INSERT INTO acceptances(organization_id,workspace_id,commitment_id,reviewer_id,decision,comment) VALUES($1,$2,$3,$4,$5,$6)`,[s.organizationId,s.workspaceId,id,s.userId,to==='accepted_result'?'accepted':'returned',decision.reason]);await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'commitment',$3,'commitment.transitioned',$4,$5)`,[s.organizationId,s.workspaceId,id,s.userId,{from,to,reason:decision.reason}]);
    await c.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload) VALUES($1,$2,'task.transitioned',$3,$4)`,[s.organizationId,s.workspaceId,id,{taskId:id,from,to,reason:decision.reason}]);return this.taskView(s,{...updated,evidenceCount})})}
  // See the memory store: a commitment could not change hands.
  async reassignTask(s,id,{ownerId=null,acceptorId=null,reason,expectedVersion}){return this.tx(async c=>{
    const{rows}=await c.query(`SELECT id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt" FROM commitments WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[s.workspaceId,id]);
    const row=rows[0];
    if(!row||!canViewTask(row,s))throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});
    for(const userId of [ownerId,acceptorId].filter(Boolean)){
      const{rows:member}=await c.query('SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',[s.workspaceId,userId]);
      if(!member.length)throw Object.assign(new Error('Task participant must belong to the workspace'),{code:'INVALID_TASK_MEMBER',statusCode:400});
      if(member[0].role===GUEST_ROLE)throw Object.assign(new Error('A guest cannot carry a commitment'),{code:'GUEST_CANNOT_HOLD_TASK',statusCode:400});
    }
    const next=assertTaskReassignAuthority(row,s,{expectedVersion,reason,ownerId,acceptorId});
    const status=next.resetToProposed?'proposed':row.status;
    const updated=(await c.query(`UPDATE commitments SET owner_id=$3,acceptor_id=$4,status=$5,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt"`,
      [s.workspaceId,id,next.ownerId,next.acceptorId,status])).rows[0];
    await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'commitment',$3,'commitment.reassigned',$4,$5)`,
      [s.organizationId,s.workspaceId,id,s.userId,{previousOwnerId:row.ownerId,previousAcceptorId:row.acceptorId,previousStatus:row.status,ownerId:next.ownerId,acceptorId:next.acceptorId,status,reason:next.reason}]);
    await c.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload) VALUES($1,$2,'task.reassigned',$3,$4)`,
      [s.organizationId,s.workspaceId,id,{taskId:id,ownerId:next.ownerId,acceptorId:next.acceptorId,previousOwnerId:row.ownerId,reason:next.reason}]);
    return this.taskView(s,updated);
  })}
  async rescheduleTask(s,id,{promisedAt,forecastAt,reason,expectedVersion}){return this.tx(async c=>{const{rows}=await c.query(`SELECT id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt" FROM commitments WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[s.workspaceId,id]);const row=rows[0];if(!row||!canViewTask(row,s))throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});const normalizedReason=assertTaskScheduleAuthority(row,s,{expectedVersion,reason}),nextPromised=promisedAt===undefined?row.promisedAt:promisedAt,nextForecast=forecastAt===undefined?row.forecastAt:forecastAt;const updated=(await c.query(`UPDATE commitments SET promised_at=$3,forecast_at=$4,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt"`,[s.workspaceId,id,nextPromised,nextForecast])).rows[0];await c.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'commitment',$3,'commitment.rescheduled',$4,$5)`,[s.organizationId,s.workspaceId,id,s.userId,{previousPromisedAt:row.promisedAt,previousForecastAt:row.forecastAt,promisedAt:nextPromised,forecastAt:nextForecast,reason:normalizedReason}]);
    await c.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload) VALUES($1,$2,'task.rescheduled',$3,$4)`,[s.organizationId,s.workspaceId,id,{taskId:id,promisedAt:nextPromised??null,forecastAt:nextForecast??null,reason:normalizedReason}]);return this.taskView(s,{...updated,evidenceCount:Number((await c.query('SELECT count(*)::int count FROM evidence WHERE workspace_id=$1 AND commitment_id=$2',[s.workspaceId,id])).rows[0]?.count||0)})})}
  async listCalendar(s,from=null,to=null){return(await this.pool.query(`SELECT e.id,e.kind,e.title,e.description,e.owner_id "ownerId",e.start_at "startAt",e.end_at "endAt",e.timezone,e.all_day "allDay",e.visibility,e.commitment_id "commitmentId",e.conversation_id "conversationId",e.created_at "createdAt",e.updated_at "updatedAt" FROM calendar_events e WHERE e.workspace_id=$1 AND($2::timestamptz IS NULL OR e.start_at>=$2)AND($3::timestamptz IS NULL OR e.start_at<=$3) AND(e.owner_id=$4 OR(e.visibility='workspace' AND $5<>'guest') OR(e.visibility='participants' AND(EXISTS(SELECT 1 FROM calendar_event_participants p WHERE p.workspace_id=e.workspace_id AND p.calendar_event_id=e.id AND p.user_id=$4) OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$4)))) ORDER BY e.start_at,e.id`,[s.workspaceId,from,to,s.userId,s.role])).rows}
  async createCalendarEvent(s,v){const id=randomUUID(),{rows}=await this.pool.query(`INSERT INTO calendar_events(id,organization_id,workspace_id,kind,title,description,owner_id,start_at,end_at,timezone,all_day,visibility,commitment_id,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,kind,title,description,owner_id "ownerId",start_at "startAt",end_at "endAt",timezone,all_day "allDay",visibility,commitment_id "commitmentId",conversation_id "conversationId",created_at "createdAt",updated_at "updatedAt"`,[id,s.organizationId,s.workspaceId,v.kind||'meeting',v.title,v.description,v.ownerId||s.userId,v.startAt,v.endAt,v.timezone||'UTC',Boolean(v.allDay),v.visibility||'participants',v.commitmentId,v.conversationId]);return rows[0]}
  async savePushSubscription(s,v){const id=randomUUID(),{rows}=await this.pool.query(`INSERT INTO push_subscriptions(id,organization_id,workspace_id,user_id,endpoint,p256dh,auth,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,user_agent=EXCLUDED.user_agent,revoked_at=NULL,updated_at=now() RETURNING id,endpoint,created_at "createdAt"`,[id,s.organizationId,s.workspaceId,s.userId,v.endpoint,v.p256dh,v.auth,v.userAgent]);return rows[0]}
  async listPushSubscriptions(workspaceId,userIds){if(!userIds.length)return[];const{rows}=await this.pool.query('SELECT user_id "userId",endpoint,p256dh,auth FROM push_subscriptions WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND revoked_at IS NULL',[workspaceId,userIds]);return rows}
}
