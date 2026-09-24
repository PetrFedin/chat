-- Две дыры, каждая на своём месте.
--
-- ПЕРВАЯ: правка сообщения не оставляла следа. Текст перезаписывался,
-- прежний исчезал, в журнал аудита не попадало ничего. В продукте, чей
-- журнал показывает, кто и когда раскрыл пароль из сейфа, это значит,
-- что переписку можно переписать задним числом: обещание «я отправлю до
-- пятницы» превращается в «я посмотрю на неделе», и доказать обратное
-- нечем.
--
-- Хранится именно прежний текст, а не разница: разницу надо уметь
-- читать, а спор идёт о том, что человек написал тогда.
CREATE TABLE IF NOT EXISTS message_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL,
  -- Текст, каким он был ДО этой правки.
  body            text,
  edited_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Когда этот текст перестал быть текущим.
  replaced_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS message_versions_message_idx
  ON message_versions (workspace_id, message_id, replaced_at DESC);

-- ВТОРАЯ: у гостя не было срока. Приглашённый представитель заказчика
-- оставался в чужом пространстве навсегда — проект закончился год назад,
-- а доступ к перепискам и файлам остался, и руками его никто не
-- вспомнит закрыть.
--
-- Срок ставится на членство, а не на приглашение: приглашение
-- одноразовое, а находиться внутри человек продолжает.
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS access_until timestamptz;

-- Срок выбирается в момент приглашения — тогда, когда человек ещё
-- помнит, зачем зовёт гостя и на сколько. Оттуда он переезжает на
-- членство при входе.
ALTER TABLE workspace_invitations
  ADD COLUMN IF NOT EXISTS access_until timestamptz;

CREATE INDEX IF NOT EXISTS memberships_access_until_idx
  ON memberships (access_until) WHERE access_until IS NOT NULL;
