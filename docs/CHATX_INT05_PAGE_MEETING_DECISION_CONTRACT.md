# CHATX-INT-05 — Page ↔ Meeting / Accepted Decision

**Status:** architecture and negative-admission contract only (no schema/runtime changes).  
**Dependency:** PR #21 → #25 → #29 → #30 → #31, then exact integrated CI, independent security review and release-candidate admission.  
**Authority principle:** a Page stores only a reference. Meeting/Calendar and Decision repositories alone determine existence, access, current state and presentation.

## Scope and acceptance boundaries

### Supported relations
- `Page ↔ Calendar Meeting`: canonical `calendar_events.id` where `kind='meeting'` (meeting metadata and participants stay in Calendar Authority).
- `Page ↔ Recorded Call`: canonical `call_sessions.id`; no copies of audio, transcript, speaker names, summaries or recording URLs.
- `Page ↔ Accepted Decision`: canonical `decisions.id` for an *active, accepted* decision; proposed/rejected/retracted decisions are never projected as accepted.
- Bidirectional traversal is **visibility-filtered**: even IDs, counts and "hidden items" indicators must not disclose links to inaccessible entities.
- Link/unlink changes never delete/update canonical source objects.

### Proposed schema (not implemented)
`wiki_page_meeting_links`: `organization_id`, `workspace_id`, `page_id`, `source_kind in ('calendar_event','call_session')`, `source_id`, `linked_by`, `linked_at`. The polymorphic UUID cannot enforce two target FKs; **prefer two link tables** (`wiki_page_calendar_meetings` and `wiki_page_calls`) each with composite `(workspace_id,id)` foreign keys to the respective canonical tables. Composite Page and actor FKs as in migrations 080–081; indexes by workspace/page and workspace/source. Page limit 100 visible or total links per type; reject duplicate with 409.

`wiki_page_decisions`: `organization_id`, `workspace_id`, `page_id`, `decision_id`, `linked_by`, `linked_at`, composite workspace FKs to Page/Decision and membership, unique `(page_id,decision_id)`. Recheck decision state and source visibility in repository projection and every mutation.

### Canonical verification
1. A Page request must pass Wiki RBAC and `ensurePage` before anything about relations can be returned.
2. Calendar meeting link: call `calendar.get(session,eventId)` / existing Calendar HTTP-equivalent authorization; verify `kind='meeting'`, attendee/owner visibility and non-archived state. **Do not** use the workspace FK as the authorization check.
3. Recorded call link: use `calls.get(session,callId)`, `store.canAccessConversation`, and participant-scoped checks from `accessibleMeetingCall` / `listAccessibleMeetings`. The existing helpers need to be extracted into a single shared exported authorization method before linking; don't fork permission logic.
4. Accepted Decision link: `meeting.getDecision(session,id)` must return a record. The decision source is revalidated during Page display and after any membership change. Never infer acceptance from the free-text Page.
5. Prohibit guest metadata leak: if the viewer lacks Wiki, return the existing 404. For an invisible relation, return no record and do not show relation count. For guessed UUIDs on POST/DELETE return 404, not 403/409.

### Expected HTTP surface (design only)
- `POST /api/v1/wiki/pages/:pageId/calendar-meetings` with `{eventId}`
- `DELETE /api/v1/wiki/pages/:pageId/calendar-meetings/:eventId`
- `POST /api/v1/wiki/pages/:pageId/calls` with `{callId}`
- `DELETE /api/v1/wiki/pages/:pageId/calls/:callId`
- `POST /api/v1/wiki/pages/:pageId/decisions` with `{decisionId}`
- `DELETE /api/v1/wiki/pages/:pageId/decisions/:decisionId`

All endpoints authenticate via existing session middleware, check Wiki permission, reauthorize target existence, write atomic audit events (linked/unlinked), project current source state and return the updated Page. Retry of already-linked records is explicit 409 (do not silently duplicate). Audit payload has canonical ID, actor and source kind but **not transcript or confidential body**. Event feeds containing relation audit must maintain same privacy scope as Page.

### Browser and device UX
Page sections: **Meetings**, **Decisions**, with search in visible canonical records, labels distinguishing calendar vs recorded call, date and verified source. Selector excludes already linked accessible items. Deep link resolves target anew; error after role change is discreet. From a meeting/decision show *only* accessible linked Pages. On 390px, 768px, desktop: open picker → select → view → navigate → back → unlink → reload; preserve focus, keyboard, scrolled context and no stale modal state. Avoid noncanonical URL assumptions.

### Mandatory tests
- Different workspaces and explicit UUID guessing; composite FKs prevent cross-workspace SQL writes.
- Owner/manager/member/observer/guest and nonparticipants; **call participant versus mere channel membership**.
- Meeting invitation removed after linking, conversation membership removed, private meeting visibility change.
- Decision accepted then retracted; originally linked Decision must disappear without leaking title/count.
- Old/archived Page and event, deleted or cancelled meeting, absent source; no ghost links.
- Two users link/unlink concurrently and retry, audit event exactly once per committed mutation.
- No transcript, recording URL, proposal details, unapproved decisions or privileged attendee names in a Page payload.
- Browser/SQL full suite, no tests skipped in PostgreSQL CI; repeated selector open and reload after unlink.
- Independent reviewer specifically approves ACL strategy, DB FKs, and threat model before implementation and merge.

## Release gate

1. Verify PR #31's **integrated merge commit** CI on its actual new head.
2. Obtain independent security/code review for #29–#31, not just authors' local checks.
3. Perform merged-release-branch full PostgreSQL + browser + device acceptance, backup/restore and rollback validation.
4. Only then implement the above contracts in a new Draft PR; no direct edits to `main` or production.

Nothing in this design claims shipped Meeting/Decision functionality or investor/customer metrics.
