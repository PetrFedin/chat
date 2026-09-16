# Realtime media architecture

## Goal

`Chat` treats a call as a first-class work object linked to a conversation and, optionally, a calendar event. Media transport is delegated to LiveKit, while identity, authorization, participant lifecycle, recording consent and downstream work context remain authoritative in Chat/PostgreSQL.

## End-to-end path

```text
Authenticated employee
  -> Chat call API
  -> call_sessions / call_participants
  -> short-lived LiveKit participant token
  -> LiveKit SFU / TURN
  -> audio / video / screen share
  -> optional consent-gated Egress recording
  -> S3-compatible object storage
  -> call_recordings: processing
  -> transcription worker (next block)
  -> AI summary / decisions / tasks (next block)
```

## Boundaries

### Chat owns

- who may see and join a call;
- the relation between call and conversation/calendar;
- participant list and application-level call state;
- mic/camera/screen-share state used by the product UI;
- recording consent;
- who may start/stop recording;
- call and recording audit-ready persistence;
- links from resulting transcript/summary back to work objects.

### LiveKit owns

- WebRTC negotiation;
- SFU media routing;
- TURN traversal as provided by the selected LiveKit deployment;
- reconnect/media transport;
- composite Egress media generation.

The browser never receives `LIVEKIT_API_SECRET`. It receives a short-lived room-scoped participant token from the authenticated Chat backend.

## Product limits in this iteration

- application-level participant cap: 100 per call;
- audio and video call modes;
- one persisted provider room per call;
- screen sharing supported through the LiveKit client;
- call controls are mobile-first and use iOS safe areas;
- recording requires consent from every currently joined participant;
- `manager/admin/owner` may start recordings according to RBAC; ordinary members may consent but cannot start recording;
- recordings move to `processing` when stopped.

## Storage

Normal uploads and voice messages use one `ObjectStore` contract:

- no `S3_BUCKET` -> `LocalObjectStore` under `UPLOAD_DIR`;
- `S3_BUCKET` -> `S3ObjectStore` using AWS SDK v3 and optional custom endpoint.

Authenticated preview is available for:

- images;
- PDF;
- text MIME types.

Other file types remain authenticated downloads until dedicated preview workers are added.

## Recording pipeline

Current implemented boundary:

1. employee joins the call;
2. each active participant records consent;
3. permitted user starts Egress recording;
4. LiveKit writes an MP4 object;
5. Chat persists `call_recordings`;
6. stop moves recording to `processing`.

Next worker block:

1. consume LiveKit Egress completion webhook or poll completion;
2. verify provider recording ID and storage object;
3. set recording `ready` or `failed`;
4. queue transcription;
5. persist transcript with provenance;
6. queue AI meeting summary;
7. propose decisions and action items;
8. user confirms which proposals become real Chat tasks/decisions.

AI must not silently create commitments, reassign owners, accept results or alter deadlines.

## Failure scenarios

- LiveKit absent: core application works; join returns 503 rather than simulating a call.
- participant loses network: LiveKit reconnect is surfaced as `reconnecting`, then `connected`.
- browser denies microphone/camera: the call stays open and the user may retry/change device state.
- screen-share cancelled: UI returns screen state to off.
- DB persistence fails after Egress starts: backend makes a best-effort provider stop before returning failure.
- S3 write fails: file metadata is not persisted as a ready upload.
- DB file metadata fails after object write: object is deleted best-effort.
- recording consent incomplete: Egress cannot start.
- unauthorized member asks to record: 403 even if consent is complete.

## Production prerequisites

- PostgreSQL with migrations `001` through `006`;
- HTTPS for production browser media permissions;
- LiveKit Cloud or a self-hosted LiveKit deployment with working TURN/network configuration;
- S3-compatible bucket for persistent uploads and meeting recordings;
- Egress deployed/enabled when recording is required;
- retention, privacy and recording policies appropriate to the organization;
- webhook/worker infrastructure before transcription and AI summaries are presented as production-ready.
