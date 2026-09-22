-- Комнаты для подразделений, заведённых раньше.
--
-- Миграция 049 дала комнату каждому новому подразделению, а старые так и
-- остались строчками без места для работы: новичок попадал в отдел и не
-- видел никакой переписки. Чинится один раз и на месте.
--
-- Беседа заводится закрытой и от имени того, кто завёл сам отдел: иначе в
-- журнале появится комната без автора.
INSERT INTO conversations(id, organization_id, workspace_id, kind, title, purpose, visibility, created_by)
SELECT gen_random_uuid(), u.organization_id, u.workspace_id, 'team', u.name, u.purpose, 'private', u.created_by
  FROM org_units u
 WHERE u.conversation_id IS NULL;

-- Связываем по названию и создателю: пары «подразделение → только что
-- созданная беседа» однозначны, потому что беседы выше заведены ровно по
-- одной на каждое подразделение без комнаты.
UPDATE org_units u
   SET conversation_id = c.id
  FROM conversations c
 WHERE u.conversation_id IS NULL
   AND c.workspace_id = u.workspace_id
   AND c.kind = 'team'
   AND c.visibility = 'private'
   AND c.title = u.name
   AND c.created_by = u.created_by
   AND NOT EXISTS (SELECT 1 FROM org_units other WHERE other.conversation_id = c.id);

-- Состав комнаты — это состав подразделения: тот же уговор, что и у
-- новых. Руководитель отдела становится владельцем комнаты.
INSERT INTO conversation_members(organization_id, workspace_id, conversation_id, user_id, role)
SELECT m.organization_id, m.workspace_id, u.conversation_id, m.user_id,
       CASE WHEN m.role = 'head' THEN 'owner' ELSE 'member' END
  FROM org_unit_members m
  JOIN org_units u ON u.workspace_id = m.workspace_id AND u.id = m.unit_id
 WHERE u.conversation_id IS NOT NULL
ON CONFLICT DO NOTHING;
