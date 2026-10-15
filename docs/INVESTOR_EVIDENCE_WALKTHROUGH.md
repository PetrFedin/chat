# CHATX — Investor Evidence Walkthrough (Draft admission)

**Status:** integrated into Draft PR #41 (`integration/chatx-main-20261015`); NOT a published product release.
**Dependency:** the integrated PostgreSQL Project/Page/Decision authority stack in PR #41. `main` and production remain unchanged until release admission.
**Pages Editor:** the PR #25 Tiptap implementation is now an ancestor of PR #41 and uses the renumbered integrated migration sequence (`081_wiki_structured_documents.sql`). Exact-head CI, independent review, recovery and real-device gates still apply to the combined release candidate.

## The investment story, with clickable proof rather than speculative numbers

1. **Conversation → commitment.** Open the Product channel, follow an existing source-linked task, inspect the owner, date, blocker, acceptance and evidence fields. Source: `src/persistence/store.js`, `src/task`, `public/app.js`.
2. **Commitment → Project Cockpit.** Open the canonical Project, examine actual task projections, workload, blocked/overdue counts, milestones and related discussion. State is not replicated into a second task database. Source: `src/project/project-repository.js`.
3. **Meeting → proposed action → human authority.** Inspect a *synthetic* fixture with timecoded transcript and review-ready intelligence; human confirmation must precede any canonical action. Source: `src/demo/seed-meeting-intelligence.js`. A fixture is NOT proof of an actual customer call or external AI integration.
4. **Evidence → dashboard.** Compare open/overdue/closed and time data with the canonical task/time reports for the same scope. Source: `src/http/dashboard.js`, `src/task/task-report.js`. A GREEN domain test with database tests skipped is insufficient.
5. **Risk containment.** Verify guest/session isolation, private project visibility, reversible role access, cross-tenant reads, and audit trails. Source: role tests and PostgreSQL tenant simulation; the tour never bypasses the viewer's server-side permissions.

## New investor walk-through slice

- `src/demo/seed-investor-project.js` seeds an opt-in, PostgreSQL-only **synthetic** project in Northstar Studio. It links **existing** commitments and Product discussion via Project Authority, adds milestones and project membership as allowed by the same admission controls used in real work. It never creates fake performance results.
- The demo project is tied to `demo@northstar.example`; all new data is explicitly synthetic, not a case study or customer revenue.
- `public/investor-tour.js` reads authenticated `/api/v1/projects`, `/api/v1/projects/:id`, `/api/v1/dashboard`, `/api/v1/meetings` and displays sources only when accessible. Broken/non-PostgreSQL APIs display unavailable, not fabricated zeros.
- More → **Инвестиционный маршрут** is available to staff, not guests. Links open existing canonical ChatX screens without performing mutating requests.
- The optional economics model is **what-if**, all values user-entered. Monthly gross value = employees × assumed hours saved per employee per week × hourly cost × 52/12. Monthly net scenario = gross value − monthly platform fee − implementation cost/horizon. Neither number is observed ROI, a contract price, or a prediction.

## Hard release gates

- [ ] Both CI jobs GREEN on exact head SHA (no skipped PostgreSQL tests).
- [ ] Browser login via explicitly enabled demo; mobile route to investor walkthrough; source-linked project opens.
- [ ] Verify 6 synthetic staff, 6 commitments, 4 calendar events, 1 synthetic review-ready meeting fixture, 1 canonical investor project with 4 linked tasks, 2 milestones, 1 discussion.
- [ ] Repeat process startup against the same isolated PG database; no duplicate demo entities, stable IDs.
- [ ] Member/private-project/guest denial remains enforced; no sensitive entity existence leakage.
- [ ] Unavailable API renders transparent unavailable state; economics inputs have no invented defaults.
- [ ] Independent review confirms security, dependency provenance and import/seed safety.
- [ ] Exact-head integration check against the actual PR #41 release candidate; historical stacked PRs are evidence inputs, not separate release targets.
- [ ] Real browser on phone/tablet/desktop, RU/EN, persistence+restore, production configuration checks.
- [ ] No production deploy or new paid services before acceptance.

## Commercial hypotheses to validate (NOT proven)

- *Buyer:* medium-sized companies with too many disconnected communications and execution tools.
- *Entry:* trial workspace and role-scoped team rollout; use pilot commitments and governance as success criteria.
- *Expansion:* more teams, projects, governed integrations and employee seats. External customer/partner functionality needs separately admitted visibility and consent controls.
- *Diligence:* actual activation/retention (D7/D30/D90), time from message to accepted outcome, overdue reduction relative to a baseline, weekly active teams, enterprise security and integration completion, infrastructure gross margin and paid pilot conversion. Gather before publishing a revenue forecast.
- *Defensibility thesis:* permission-bounded canonical objects + provenance + human-governed execution. This is a product thesis, not an independently verified moat.

## Safe presentation language

Show an account-controlled demonstration of observable product behaviors, then clearly distinguish **confirmed code/tests**, **synthetic fixture data**, **assumption-only economics**, and **unbuilt roadmap**. Never label a synthetic run as a real customer delivery, or a GREEN CI as a production release.
