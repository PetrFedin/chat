# SYNTH-V2 -> Chat extraction audit

Source repository: `PetrFedin/synth-v2`  
Pinned source main: `7e16256953659f1d507e9952e39fab49b416c60c`  
Extraction date: 2026-09-16

## Verified source assets

### Calendar

SYNTH-V2 has a real calendar domain primitive in `src/modules/calendar/public.mjs`. A milestone has `id`, `ownerOrganisationId`, `cycleId`, `type`, `title`, `startsAt` and `visibility`. Its supported business types are `buying`, `order` and `deal`.

Persistence is in `calendar_milestones` from `db/migrations/001_wholesale_v2.sql`, indexed by owner organisation and start time. The workspace query layer sorts calendar items by `startsAt,id`; the PostgreSQL reader exposes only calendar milestones owned by organisations visible to the actor.

The browser workspace renders a shared calendar by sorting `state.workspace.calendar` and mapping each item through `calendarEntity`. The source fragment is preserved under `vendor/syntha-v2/calendar`.

Access control contains a dedicated `calendar.read` capability.

### Notifications

SYNTH-V2 has a reusable notification pattern: immutable creation, deterministic dedupe by source event + recipient, unread/read lifecycle, version increment on first read, outbox-driven projection and paginated reads. The source domain primitive is preserved under `vendor/syntha-v2/notifications`.

The standalone product keeps the same reliability idea but changes the recipient from wholesale organisation to workspace user and changes event types to collaboration events.

### Planning

SYNTH-V2's `public/modules/planning-core.js` and `planning.js` are verified, but they are **collection/campaign planning**, not employee task planning. They calculate readiness and risks from campaigns, collections, SKU, showrooms, commercial cycles, selections and orders. They are therefore not runtime dependencies of Chat.

The useful product idea retained here is the separation of portfolio/timeline/exceptions views. It can later be reapplied to employee commitments without importing fashion entities.

### Messaging

No production `conversation`, `chat` or `message` backend module was found in the current SYNTH-V2 source tree. The messaging material found in source history is JOOR research/documentation (for example route `/messages` and `/Messages/send/{brandId}` in `docs/joor-retailer-cabinet-complete-map.md`), not SYNTH-V2 persistence/API implementation.

Therefore Chat does **not** pretend to import a messaging backend that does not exist. Its own `conversations` and `messages` schema remains authoritative.

## Extraction decision

The standalone collaboration graph is:

`Workspace -> Conversation -> Message -> Commitment -> CalendarEvent/CalendarBlock -> Evidence -> Acceptance`

Notifications project from immutable business events through the outbox.

The migration added by this extraction introduces:

- conversation membership;
- general calendar events independent of fashion/commercial cycles;
- calendar participants and RSVP state;
- user notification inbox with deterministic dedupe.

Existing `commitments` remain the task/accountability model. Existing `calendar_blocks` remain reserved execution time linked to a commitment; general `calendar_events` cover meetings, focus time, deadlines, reminders and milestones.

## What intentionally stays out

- Product/SKU/collection/showroom/order/deal models.
- Wholesale organisation roles and buyer/sales capabilities.
- SYNTH-V2 commercial cycle identifiers.
- JOOR legacy messaging routes.

Those would create accidental coupling and make this repository a partial wholesale application instead of an independent corporate collaboration product.
