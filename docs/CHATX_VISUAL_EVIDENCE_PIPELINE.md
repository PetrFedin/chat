# CHATX Visual Evidence · Portfolio Capture

This is a **capture of a real rendered browser session**, not an AI-generated mockup.
Do not label the isolated Northstar Studio demo as a customer installation.

## Workflow and proof

- GitHub Actions: `.github/workflows/presentation-evidence.yml`.
- Manual `workflow_dispatch` with `capture_kind=demo` or `live`.
- Weekly Monday 09:00 UTC scheduled **demo** refresh after this workflow reaches the default branch.
- Set GitHub Actions **secret** `CHATX_CAPTURE_URL` to a validated deployment URL controlled by the owner. A missing URL must fail rather than fabricate screenshots.
- Capture runs Chromium/Playwright against the URL; browser errors and unrecognized scenes go into `evidence-manifest.json`.
- Outputs: up to 5 desktop PNGs, one 390px mobile PNG, and a 25-second `webm` browser recording.
- Manifest includes timestamp, commit SHA, source URL, kind `demo` or `live`, filename inventory, and warnings. Link it beside images/videos when publishing.
- Download the workflow artifact and review it. GitHub's 90-day artifact retention is **not permanent hosting**. Copy approved media and manifest into versioned durable portfolio media storage before that deadline.
- For `live`, capture intentionally refuses a demo-login page or unauthenticated application. Do not store production passwords, cookies, customer messages or user data in artifacts. Use a consented sanitized review workspace and a capture-specific authentication mechanism.
- Never use these assets as proof of production uptime or real customer ROI: only a verified deployment plus separately substantiated performance evidence can support those claims.

## Release admission

1. Exact-commit full PostgreSQL and domain CI green, no skipped database tests.
2. Reviewer confirms tenant isolation and role checks.
3. Run capture against an **approved** staging/demo deploy (deployment SHA must be separately verified).
4. Check each recorded state: Projects, Tasks, Chat, and Calendar navigation; review responsive layout and error warnings.
5. Select portfolio-worthy frames and publish labeled **CHATX · интерактивная демонстрация** with captured timestamp and source revision.
6. For repeat captures use the weekly workflow after its approved merge. Compare scenes with previous revision before replacing files shown on syntha.pro.

Video is generated as WebM; convert a vetted video to MP4 when required by the landing site's video pipeline, preserving the original manifest and labeling. CI does not publish to syntha.pro automatically.
