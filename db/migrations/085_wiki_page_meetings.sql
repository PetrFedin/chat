BEGIN;

-- Page -> Calendar Meeting / Recorded Call are references only.
-- Calendar/Call Authorities own metadata, membership, transcripts and media.
-- Composite workspace FKs prevent cross-tenant UUID injection. Cancelling a
-- calendar event or deleting a call removes only the relation.
CREATE TABLE wiki_page_calendar_meetings (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  calendar_event_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, calendar_event_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, page_id)
    REFERENCES wiki_pages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, calendar_event_id)
    REFERENCES calendar_events(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, linked_by)
    REFERENCES memberships(workspace_id, user_id)
);

CREATE INDEX wiki_page_calendar_meetings_page_idx
  ON wiki_page_calendar_meetings(workspace_id, page_id, linked_at DESC);
CREATE INDEX wiki_page_calendar_meetings_event_idx
  ON wiki_page_calendar_meetings(workspace_id, calendar_event_id, linked_at DESC);

CREATE TABLE wiki_page_calls (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  call_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, call_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, page_id)
    REFERENCES wiki_pages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, call_id)
    REFERENCES call_sessions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, linked_by)
    REFERENCES memberships(workspace_id, user_id)
);

CREATE INDEX wiki_page_calls_page_idx
  ON wiki_page_calls(workspace_id, page_id, linked_at DESC);
CREATE INDEX wiki_page_calls_call_idx
  ON wiki_page_calls(workspace_id, call_id, linked_at DESC);

COMMIT;
