-- Приглашение сразу в подразделение.
--
-- Человека звали в компанию, а потом отдельным действием раскладывали по
-- отделам. Для списка из сорока строк это второй проход по тому же
-- списку — и он делается через неделю, когда уже неважно, кто в каком
-- отделе.
--
-- Теперь отдел указывается в самом приглашении, и новичок попадает туда
-- сразу вместе с комнатой подразделения: состав отдела и состав комнаты
-- по-прежнему одно и то же.
ALTER TABLE workspace_invitations
  ADD COLUMN unit_id uuid REFERENCES org_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workspace_invitations_unit_idx
  ON workspace_invitations(workspace_id, unit_id) WHERE unit_id IS NOT NULL;
