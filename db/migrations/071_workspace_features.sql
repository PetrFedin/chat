-- Включение и отключение функций пространства. Хранятся только отступления от «всё включено».
-- cascade_from: функция выключена не самим администратором, а потому что выключили ту, от которой она зависит;
-- при возвращении исходной функции такие возвращаются вместе с ней.
CREATE TABLE IF NOT EXISTS workspace_features (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feature       text NOT NULL,
  enabled       boolean NOT NULL,
  cascade_from  text,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, feature)
);
