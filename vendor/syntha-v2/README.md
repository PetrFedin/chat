# SYNTH-V2 collaboration extraction snapshot

Reference-only source material copied from `PetrFedin/synth-v2` at main commit `7e16256953659f1d507e9952e39fab49b416c60c` on 2026-09-16.

These files are intentionally **not** imported by the runtime. They preserve provenance for the standalone Chat product while the production implementation in `src/domain` removes SYNTH-V2's wholesale/fashion coupling.

Copied source assets:

- `calendar/public.mjs` — original calendar milestone domain primitive.
- `calendar/render-calendar.fragment.js` — original calendar workspace renderer extracted verbatim from `public/modules/views-2.js`.
- `notifications/public.mjs` — original notification primitive with deterministic dedupe and idempotent read transition.

Not copied into runtime:

- `planning-core.js` / `planning.js`: these plan fashion campaigns, collections, SKU, showrooms and orders; they are not employee task planning.
- `workspace-query-service.mjs` and `postgres-workspace-reader.mjs`: their reusable calendar ordering/pagination ideas are documented in `docs/SYNTHA_EXTRACTION.md`, but the files are coupled to the complete SYNTH-V2 workspace graph.
- JOOR messaging research: SYNTH-V2 contains routes/documentation for messaging, not a production `conversations/messages` backend. The standalone `chat` repository therefore remains authoritative for messaging.
