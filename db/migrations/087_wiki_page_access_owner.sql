BEGIN;

ALTER TABLE wiki_pages ADD COLUMN access_owner_id uuid;

UPDATE wiki_pages
   SET access_owner_id=created_by
 WHERE access_owner_id IS NULL;

-- Preserve the historical insert contract for SQL fixtures/integrations that
-- know only created_by/updated_by. Repository writes pass access_owner_id
-- explicitly, while older callers inherit the creator as the initial owner.
CREATE FUNCTION wiki_page_default_access_owner()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF NEW.access_owner_id IS NULL THEN
    NEW.access_owner_id := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$;

CREATE TRIGGER wiki_pages_default_access_owner
BEFORE INSERT ON wiki_pages
FOR EACH ROW EXECUTE FUNCTION wiki_page_default_access_owner();

ALTER TABLE wiki_pages
  ALTER COLUMN access_owner_id SET NOT NULL,
  ADD CONSTRAINT wiki_pages_access_owner_membership_fk
    FOREIGN KEY (workspace_id,access_owner_id)
    REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT;

CREATE INDEX wiki_pages_access_owner_idx
  ON wiki_pages(workspace_id,access_owner_id)
  WHERE archived_at IS NULL;

COMMIT;
