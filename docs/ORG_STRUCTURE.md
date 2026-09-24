# Organisational structure

A company is a tree, not a list. Until migration 015 this product had two
free-text fields on the profile — `title` and `department` — that no endpoint
could even write. Departments, divisions, teams, planned headcount, who is
accountable for what, and who may staff which part of the company are now
first-class objects.

## The model

```
org_units            a tree: company → department → division → team, six levels deep
  seat_limit         planned headcount; NULL means "not planned"
  head_user_id       the one person accountable for the unit
  depth              materialised, so a chart read needs no recursion

org_unit_members     who works where, with a role inside the unit
  head               accountable for the unit; exactly one, enforced by a partial unique index
  admin              runs the unit's roster and everything below it
  member             works in it
```

A person may belong to several units. A matrix organisation — an engineer in a
delivery team and in a discipline guild — is normal, not an error.

## Two authorities

| | `org.structure.manage` (owner, admin) | unit `head` / `admin` |
|---|---|---|
| read the chart | ✓ | ✓ (everyone can) |
| create a top-level department | ✓ | · |
| create a sub-unit | ✓ | ✓ inside their own branch |
| rename, re-describe | ✓ | ✓ their own branch |
| move a unit | ✓ | · |
| change planned headcount | ✓ | · |
| add and remove people | ✓ | ✓ their own branch |
| appoint the head | ✓ | ✓ their own branch |
| delete a unit | ✓ | · |

This is the point of the split: a department head staffs their department
without being handed the whole workspace. Authority flows **down** a branch —
running a department means running everything under it — and never sideways or
up.

## Rules the database and the repository hold

- Planned headcount is a limit, not a label. Adding past it answers
  `409 SEAT_LIMIT_REACHED`; the count is taken under the unit's row lock, so
  two concurrent adds cannot both take the last seat. Lowering the plan below
  the people already in the unit answers `409 SEAT_LIMIT_BELOW_HEADCOUNT`.
- Exactly one head per unit. Appointing a new one demotes the previous one;
  removing the head from the unit clears the post rather than leaving a
  dangling name. The head must already be a member (`409 HEAD_NOT_IN_UNIT`).
- A guest is somebody else's employee and is refused a place on the chart
  (`409 NOT_WORKSPACE_STAFF`): a chart that includes clients lies about who
  works here.
- A unit cannot move under its own descendant (`409 ORG_CYCLE`), and a move
  carries the whole branch's depth with it. Six levels is the ceiling.
- A unit still holding sub-units or people cannot be deleted
  (`409 ORG_UNIT_HAS_CHILDREN` / `ORG_UNIT_HAS_MEMBERS`) — deleting it would
  silently orphan them.
- Sibling names are unique, and so are top-level names. The composite key
  alone does not cover the root, because two NULL parents never compare equal,
  so a partial unique index closes it.

## Reporting lines

`GET /api/v1/org/people/{userId}/chain` walks from the person's units up to the
root and names the head at each step. The chain is **derived from the tree**,
never stored on the person, so moving a unit moves everyone's reporting line
with it and the two can never disagree.

```
Анна Лебедева
  Отдел АР (Дмитрий Орлов) → Департамент проектирования (Павел Ковалёв) → ООО «Меридиан» (Ирина Соколова)
```

## API

| Route | Method | Who |
|---|---|---|
| `/api/v1/org/units` | GET | everyone in the workspace |
| `/api/v1/org/units` | POST | structure managers, or the parent's admin |
| `/api/v1/org/units/{id}` | PATCH | structure managers; a unit admin for name, purpose, kind and head |
| `/api/v1/org/units/{id}` | DELETE | structure managers |
| `/api/v1/org/units/{id}/members` | GET | everyone |
| `/api/v1/org/units/{id}/members` | POST | structure managers, or that unit's admin |
| `/api/v1/org/units/{id}/members/{userId}` | DELETE | structure managers, or that unit's admin |
| `/api/v1/org/people/{userId}/chain` | GET | everyone |

The whole chart is readable by everyone in the workspace: knowing who runs what
is the point of having one. Without `DATABASE_URL` the routes answer
`503 ORG_STRUCTURE_UNAVAILABLE`.

## Not built yet

- **Invitations into a unit.** `workspace_invitations.org_unit_id` exists in
  the schema so a unit admin can grow their own team, but no endpoint sets it
  and accepting an invitation does not place the person. This is the next step.
- **Editing the chart from the interface.** «Ещё → Оргструктура» shows the tree
  with headcount and heads; changes go through the API.
- **Seats against billing.** `seat_limit` is a planning number today and is not
  connected to any licence count.
