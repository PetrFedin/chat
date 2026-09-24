BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  article_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES(org,'Knowledge Base Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Main');
  INSERT INTO users(id,email) VALUES(owner_id,'kb-owner@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES(org,ws,owner_id,'owner');
  INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email)
    VALUES(org,ws,owner_id,'KB Owner','kb-owner@example.com');

  INSERT INTO knowledge_articles(id,organization_id,workspace_id,title,body,category,created_by,updated_by)
    VALUES(article_id,org,ws,'Отпуск','28 календарных дней в год, заявка за две недели.','HR',owner_id,owner_id);

  IF (SELECT count(*) FROM knowledge_articles WHERE workspace_id=ws AND id=article_id) <> 1 THEN
    RAISE EXCEPTION 'article was not retained';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM knowledge_articles
    WHERE id=article_id AND to_tsvector('russian',title||' '||body) @@ plainto_tsquery('russian','отпуску')
  ) THEN
    RAISE EXCEPTION 'russian full-text search did not match a word form of an indexed article';
  END IF;

  BEGIN
    INSERT INTO knowledge_articles(organization_id,workspace_id,title,body,created_by,updated_by)
      VALUES(org,ws,'','Пустой заголовок',owner_id,owner_id);
    RAISE EXCEPTION 'empty title unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO knowledge_articles(organization_id,workspace_id,title,body,created_by,updated_by)
      VALUES(org,ws,'Заголовок','',owner_id,owner_id);
    RAISE EXCEPTION 'empty body unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO knowledge_articles(organization_id,workspace_id,title,body,created_by,updated_by)
      VALUES(org,ws,'Заголовок','Тело',gen_random_uuid(),owner_id);
    RAISE EXCEPTION 'article created_by outside workspace membership unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM workspaces WHERE id=ws;
  IF EXISTS (SELECT 1 FROM knowledge_articles WHERE workspace_id=ws) THEN
    RAISE EXCEPTION 'knowledge_articles survived their workspace being deleted';
  END IF;
END $$;

ROLLBACK;
