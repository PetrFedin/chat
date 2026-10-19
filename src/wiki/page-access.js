const notFound=()=>Object.assign(new Error('Страница не найдена'),{
  code:'WIKI_PAGE_NOT_FOUND',statusCode:404,expose:true,
});

const level=(value)=>value==='edit'?2:value==='view'?1:0;

export function createWikiPageAccess(pool){
  const lineage=async(session,pageId,db=pool)=>{
    const {rows}=await db.query(
      `WITH RECURSIVE lineage AS (
         SELECT p.id,p.parent_id,p.visibility,p.created_by,p.access_owner_id,0 depth
           FROM wiki_pages p
          WHERE p.workspace_id=$1 AND p.id=$2
         UNION ALL
         SELECT parent.id,parent.parent_id,parent.visibility,parent.created_by,parent.access_owner_id,lineage.depth+1
           FROM wiki_pages parent
           JOIN lineage ON lineage.parent_id=parent.id
          WHERE parent.workspace_id=$1
       )
       SELECT lineage.id,lineage.parent_id "parentId",lineage.visibility,
              lineage.created_by "createdBy",lineage.access_owner_id "accessOwnerId",
              lineage.depth,g.access
         FROM lineage
         LEFT JOIN wiki_page_grants g
           ON g.workspace_id=$1 AND g.page_id=lineage.id AND g.user_id=$3
        ORDER BY lineage.depth`,
      [session.workspaceId,pageId,session.userId],
    );
    return rows;
  };

  const evaluate=async(session,pageId,db=pool)=>{
    const rows=await lineage(session,pageId,db);
    if(!rows.length) return null;
    const current=rows[0];
    const canReadNode=(row)=>row.visibility==='workspace'
      || row.createdBy===session.userId
      || row.accessOwnerId===session.userId
      || level(row.access)>=1;
    const canView=rows.every(canReadNode);
    const canEdit=canView && (
      current.visibility==='workspace'
      || current.createdBy===session.userId
      || level(current.access)>=2
    );
    // ACL policy is deliberately narrower than edit permission: editors can
    // change content, not silently widen the audience. The creator remains the
    // authority that chooses visibility and grants.
    const canManage=current.accessOwnerId===session.userId;
    return {canView,canEdit,canManage,current,lineage:rows};
  };

  return {
    async evaluate(session,pageId,db=pool){return evaluate(session,pageId,db);},
    async assertView(session,pageId,db=pool){
      const access=await evaluate(session,pageId,db);
      if(!access?.canView)throw notFound();
      return access;
    },
    async assertEdit(session,pageId,db=pool){
      const access=await evaluate(session,pageId,db);
      if(!access?.canEdit)throw notFound();
      return access;
    },
    async assertManage(session,pageId,db=pool){
      const access=await evaluate(session,pageId,db);
      if(!access?.canManage)throw notFound();
      return access;
    },
  };
}
