# CHATX Email: local verification

Implementation commit: `b0696b3cff7edd9c7fdcb3bcf576d30534def8b0`.

Implementation tree: `0a1f714eb55c283f39e32a4d218a311a1f862048`.

Base: `62e53ede01bacd450f6bf960dc4fe6a3af4860b8`, the head of PR #67.

## Executed verification

| Check | Result |
|---|---|
| Complete Node test suite with real PostgreSQL | **1472 passed, 0 failed, 0 skipped**, 389.17 seconds |
| Final Service Worker privacy regression | **2 passed, 0 failed, 0 skipped** |
| Working-tree/index consistency after implementation commit | No tracked modifications |
| Exported application ZIP | CRC verification and required runtime files passed |
| Binary integration patch | Reverse apply check passed against the implementation commit |

The full suite used Node 24.19.0, PostgreSQL 17.11 with migrations 001–093, and Chrome 156.0.8078.47. The environment could not obtain Playwright's bundled Chromium, so a temporary test harness supplied the official installed Chrome executable. CI is configured to install its normal Playwright Chromium.

The full suite began before the last Service Worker privacy change. That final change normalizes sensitive API paths regardless of case, honors `Cache-Control: no-store/private`, and evicts prior cache versions. Its two direct fetch/activate regressions passed afterward. This record does not claim that the entire final commit ran in GitHub CI.

## Coverage and boundaries

The full run includes three actual browser flows through HTTP/PostgreSQL, provider MIME/TLS/STARTTLS tests, mailbox and message ACL, durable send/unknown-outcome handling, shared inbox notifications, migration upgrades, routing rules, canonical Task/Page/Calendar/Decision links, booking/calendar races and a one-connection PostgreSQL pool regression. Browser captures cover 375, 390, 768 and 1440 px and RU/EN.

Synthetic accounts and controlled email providers/protocol servers were used. No real user's mailbox was connected, and no email was sent to real external recipients. Browser emulation does not constitute a physical-device review.

## Publication and operation

The changes are committed locally on `feature/chatx-email-workflow-20261020`. A remote branch, pull request, merge and deployment were not created. Automatic approval review rejected public code publication to `PetrFedin/chat` pending explicit user authorization, even after repository ownership and push permissions were verified. Some immutable Git blobs were accepted before that rejection; no ref points to an implementation commit.

The planned PR targets `feature/chatx-execution-risk-parity-20261020` and preserves the upstream review/release gates. GitHub CI and public deployment remain pending.

For installation and mailbox connection, follow `docs/CHATX_EMAIL_RUNTIME.md`. Full operation needs PostgreSQL, an independent `EMAIL_ENCRYPTION_KEY`, a connected mailbox and a continuously running host that allows outbound IMAP/SMTP. Existing free Render services cannot provide the required SMTP and scheduling behavior. No paid resources were created.
