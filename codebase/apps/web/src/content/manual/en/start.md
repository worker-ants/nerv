NERV keeps **specification documents as the single source of truth**, holds people at the approval gates, and lets AI agents read those specs and implement against them. This manual explains what each screen does and what its markings mean.

## The loop

Work in NERV goes around a five-step loop.

1. **Write the spec** — say what will be built. A draft is not yet a baseline for anyone.
2. **A person approves it** — only approved versions become the baseline. Agents read what is approved.
3. **Create tasks** — split work out of an approved spec. Each task holds on to the spec version it was briefed against.
4. **An agent claims one** — it takes the task and implements it. What it is doing shows up live on the sessions screen.
5. **Reviews land** — findings accumulate, and the severe ones are decided by a person.

Wherever an agent gets stuck it raises a **question**, which arrives in your inbox as a card. When the loop comes around again, a changed spec becomes a new version, and tasks holding the old baseline say so themselves.

## Map of the screens

| Screen            | The question it answers                               |
| ----------------- | ----------------------------------------------------- |
| **Home**          | How many decisions are waiting on me right now        |
| **Project**       | How far along is this project (progress, activity)    |
| **Specs**         | What did we decide to build                           |
| **Tasks**         | Who is doing what, and what is stuck                  |
| **Sessions**      | What is an agent actually doing right now             |
| **Reviews**       | What is wrong, and who decides about it               |
| **Inbox**         | What I have to decide                                 |
| **Notifications** | What I missed                                         |
| **Settings**      | Organizations, projects, members, tokens, gate policy |

## Two axes of membership scope — organization and project

The two selects at the left of the header are the membership scope you are looking at: **organization → project**, in that order, and the header shows the order plainly. The only organizations you can pick are the ones you belong to.

Home, inbox, notifications and settings are organization-wide, so their addresses carry no project. There the header shows the **project you looked at last** — an empty slot reads as "you cannot pick one", which would not be true.

**To get back home, press the `NERV` logo at the top left.** There is no separate menu item for it — the logo is that link.

## Roles

| Role        | What it can do                                                                         |
| ----------- | -------------------------------------------------------------------------------------- |
| `admin`     | Organizations and projects, members, tokens, gate policy, imports                      |
| `planner`   | Write, submit and **approve** specs of any type, baselines, metadata, resolve findings |
| `designer`  | Comment and edit drafts, claim and progress tasks. Creates **design** specs only       |
| `developer` | The same, but creates **convention** and **adr** specs                                 |
| `qa`        | The same, plus **resolving findings**. Creates no new specs                            |
| `viewer`    | Read + **comment**                                                                     |

**Which spec types a role may create differs by role.** admin and planner have no limit; designer creates `design`; developer creates `convention` and `adr`. qa creates none — what qa produces is a **review**, not a spec. **Even a viewer comments** — raising a point is participation, not a permission, so `spec:read` is enough. **Resolving** a comment is the job of the five roles that can write drafts.

**Resolving a review finding** (fixed, dismissed, won't fix) belongs to admin, planner and qa only. A developer receives findings and fixes them; closing them is someone else's call.

One person can be `admin` in the organization and `developer` on a project. **Holding both is a union** — you get the permissions of both seats.

## Your first five minutes

0. If you were sent an invitation link, open that first — signing in accepts the invitation. If you do not belong to an organization yet, signing in takes you to **Get started**, where any invitation waiting for you sits as a card.
1. Sign in and check that the **organization and project** in the header are the ones you meant.
2. Skim the **spec tree** on the left. What this project decided to build is in there.
3. Open **Tasks** and look at the `ready` lane — that is what can be picked up right now.
4. If you are connecting an agent, issue a token under **Settings → Tokens** and install the plugin — the procedure is in [Installing the plugin](/help/install), what fits together with what is in [Agents](/help/agents).
5. To find a document, press **⌘K**. It finds **specs and requirements** by name — not screens or settings — and it only works **inside a project**.
