-- Структурные заявки и согласования (ROADMAP: «Request Template Authority», «Approval Workflow»).
--
-- Повторяющиеся просьбы — отпуск, покупка, доступ — раньше жили длинным сообщением со скрытым смыслом:
-- кто должен ответить, что именно просили и чем кончилось, узнавалось только из переписки. Здесь заявка —
-- самостоятельная сущность: шаблон с версиями (использованная версия неизменна), значения полей, цепочка
-- согласующих и история. Исполнение остаётся за задачей: заявка лишь ссылается на неё и не дублирует её статус.

CREATE TABLE IF NOT EXISTS request_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id    uuid NOT NULL,
  title           text NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 160),
  description     text CHECK (description IS NULL OR length(description) <= 1000),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  current_version integer NOT NULL DEFAULT 1,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS request_templates_workspace_idx ON request_templates (workspace_id, status);

CREATE TABLE IF NOT EXISTS request_template_versions (
  template_id uuid NOT NULL REFERENCES request_templates(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  fields      jsonb NOT NULL,
  approval    jsonb NOT NULL,
  task_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, version)
);

CREATE TABLE IF NOT EXISTS requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  workspace_id     uuid NOT NULL,
  template_id      uuid NOT NULL,
  template_version integer NOT NULL,
  requester_id     uuid NOT NULL,
  title            text NOT NULL CHECK (length(btrim(title)) > 0),
  "values"         jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('submitted','needs_info','approved','rejected','cancelled','completed')),
  current_step     integer NOT NULL DEFAULT 0,
  task_id          uuid REFERENCES commitments(id) ON DELETE SET NULL,
  version          integer NOT NULL DEFAULT 1,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (template_id, template_version) REFERENCES request_template_versions(template_id, version)
);
CREATE INDEX IF NOT EXISTS requests_workspace_status_idx ON requests (workspace_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS requests_requester_idx ON requests (workspace_id, requester_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS request_steps (
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  step       integer NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('role','user')),
  role       text CHECK (role IN ('manager','admin','owner')),
  user_id    uuid,
  decision   text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','rejected','needs_info')),
  comment    text,
  decided_by uuid,
  decided_at timestamptz,
  PRIMARY KEY (request_id, step),
  CHECK ((kind = 'role' AND role IS NOT NULL) OR (kind = 'user' AND user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS request_events (
  id         bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id   uuid,
  event      text NOT NULL,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_events_request_idx ON request_events (request_id, id);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'message.created','message.mentioned','task.assigned','task.due','task.updated','task.rescheduled',
  'calendar.invited','calendar.reminder','calendar.updated','calendar.cancelled','calendar.responded',
  'review.requested','meeting.review_ready','meeting.failed','integration.disabled','call.started','call.declined','call.missed',
  'request.submitted','request.decided'
]));
