BEGIN;

ALTER TABLE wiki_pages ADD COLUMN access_owner_id uuid;

UPDATE wiki_pages
   SET access_owner_id=created_by
 WHERE access_owner_id IS NULL;

ALTER TABLE wiki_pages
  ALTER COLUMN access_owner_id SET NOT NULL,
  ADD CONSTRAINT wiki_pages_access_owner_membership_fk
    FOREIGN KEY (workspace_id,access_owner_id)
    REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT;

CREATE INDEX wiki_pages_access_owner_idx
  ON wiki_pages(workspace_id,access_owner_id)
  WHERE archived_at IS NULL;

COMMIT;
