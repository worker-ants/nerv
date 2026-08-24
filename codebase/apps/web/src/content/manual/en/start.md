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
| **Project**       | How far along is this project (coverage, activity)    |
| **Specs**         | What did we decide to build                           |
| **Tasks**         | Who is doing what, and what is stuck                  |
| **Sessions**      | What is an agent actually doing right now             |
| **Reviews**       | What is wrong, and who decides about it               |
| **Inbox**         | What I have to decide                                 |
| **Notifications** | What I missed                                         |
| **Settings**      | Organisations, projects, members, tokens, gate policy |

## Two axes of scope — organisation and project

The two selects at the left of the header are the scope you are looking at: **organisation → project**, in that order, and the header shows the order plainly. The only organisations you can pick are the ones you belong to.

Home, inbox and notifications are organisation-wide, so their addresses carry no project. There the header shows the **project you looked at last** — an empty slot reads as "you cannot pick one", which would not be true.

## Roles

| Role                            | What it can do                                                    |
| ------------------------------- | ----------------------------------------------------------------- |
| `admin`                         | Organisations and projects, members, tokens, gate policy, imports |
| `planner`                       | Write and submit specs, create tasks, approve                     |
| `designer` · `developer` · `qa` | Comment on specs, claim and progress tasks, answer questions      |
| `viewer`                        | Read                                                              |

One person can be `admin` in the organisation and `developer` on a project. **Holding both is a union** — you get the permissions of both seats.

## Your first five minutes

1. Sign in and check that the **organisation and project** in the header are the ones you meant.
2. Skim the **spec tree** on the left. What this project decided to build is in there.
3. Open **Tasks** and look at the `ready` lane — that is what can be picked up right now.
4. If you are connecting an agent, issue a token under **Settings → Tokens** and install the plugin (see [Agents](/help/agents)).
5. When you are lost, press **⌘K**. It finds specs, tasks and screens by name.
