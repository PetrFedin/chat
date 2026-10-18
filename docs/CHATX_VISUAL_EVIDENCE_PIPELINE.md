# CHATX Visual Evidence · Verified Browser Portfolio

This pipeline captures **real running CHATX** in an isolated PostgreSQL-backed Northstar Studio demonstration workspace. Data is synthetic and must never be described as customer usage or production ROI.

## Automated collection

Workflow: `.github/workflows/presentation-evidence.yml`.

- On relevant PR changes to `main` or to the active stacked integration branch, GitHub starts the exact PR head SHA, applies migrations to a disposable PostgreSQL 17 database, builds Pages and opens the app in Chromium.
- On pushes to `main` and every Monday at 09:00 UTC (once this workflow is merged into the default branch), the same demo capture refreshes.
- Manual `workflow_dispatch` supports `demo` and guarded `live` mode. Live currently requires an independently configured, explicitly authenticated sanitized workspace; unauthenticated or demo pages fail rather than being mislabeled.
- Suspended Render services are **not** resumed or represented as live. The isolated running app is genuine code, while the content is synthetic demonstration content.

## Deliverables per successful run

- `01-home-desktop.png`, `02-chats-desktop.png`, `03-tasks-desktop.png`, `04-projects-desktop.png`, `05-project-gantt-desktop.png`, `06-calendar-desktop.png`
- `07-home-mobile.png`, `08-project-gantt-mobile.png` captured at **390 × 844**
- `chatx-product-tour-27s.mp4`, capped at **27 seconds**, H.264 + faststart suitable for web embedding; plus source WebM
- `evidence-manifest.json` with the exact checked-out SHA, source environment, UTC time, browser errors, scene confirmations, per-file SHA-256 and measured MP4 duration

The capture job fails if a required scene is absent, the Gantt lacks its four real demo Tasks, video duration is outside 20–30 seconds, or the login/screen is invalid. Media is uploaded as an Actions artifact, **not** automatically sent to syntha.pro. At most 90 days of GitHub artifact retention: save approved versions to durable media storage.

## Publishing protocol

1. Require exact-head PostgreSQL/CI GREEN and independently review security, feature gates, tenant isolation, and mobile navigation.
2. Open the artifact for that SHA and review the actual screenshots and video for credentials, private content, error states, clipping, typography and animation.
3. Do not publish if the manifest indicates `failed`; review all `warnings` and `pageErrors`.
4. Save a dated release folder `CHATX/<SHA>/` in controlled storage. Preserve originals and manifest. Only then replace media on the personal landing page.
5. Label the content **CHATX · тестовая интерактивная демонстрация (синтетические данные)** with the capture date. Do not imply customer adoption or actual deployment uptime.
6. Produce a visual diff against the previous accepted release; keep historical artifacts available instead of silently replacing investor proofs.

Private production accounts, passwords, cookies, conversation content, or customer records must not enter GitHub artifacts. The capture deliberately authenticates before starting the recorded session and keeps session state in memory.
