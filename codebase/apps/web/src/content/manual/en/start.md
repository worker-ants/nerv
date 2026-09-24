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

## Narrow screens — phones and tablets

On a narrow screen the project sidebar moves into a **drawer, opened by the [☰] at the far left of the header**. It is the **same one** that sits fixed beside the content on a wide screen, so the drawer holds the very same things: overview, specs, tasks, sessions, reviews, and the spec tree. A narrower screen does not mean less to see.

- The drawer **closes itself once you go somewhere.** To close it where you are, press the [✕] at its top right, press the dimmed area outside it, or press `Esc`.
- What the header folds away at that width is **wording**, not function: inbox and notifications become glyphs and **keep their count badges** (a number you have to open something to see is not a badge). Search shrinks to a single magnifier, and pressing it opens the same quick switcher.
- The **organization picker and help move into the drawer**, since they gave up their place in the header. The project picker stays in the header.
- Widen the window and the drawer closes as the sidebar takes its place again.

## Roles

| Role        | What it can do                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `admin`     | Organizations and projects, members, tokens, gate policy, imports                                           |
| `planner`   | Write, **submit others' drafts**, **approve** specs of any type, baselines, metadata, findings              |
| `designer`  | Comment and edit drafts, claim and progress tasks. Creates **design** specs; **assigned approvals** on them |
| `developer` | The same, but creates **convention** and **adr** specs; **assigned approvals** on those                     |
| `qa`        | The same, plus **resolving findings** and **assigned approvals** on `feature` specs                         |
| `viewer`    | Read + **comment**                                                                                          |

**“Assigned approvals” only apply when a card names that discipline.** A designer does not decide every `design` document — a T3 document names its second approver by discipline, and that card goes to them (see [Inbox](/help/inbox)).

**Which spec types a role may create differs by role.** admin and planner have no limit; designer creates `design`; developer creates `convention` and `adr`. qa creates none — what qa produces is a **review**, not a spec. **Even a viewer comments** — raising a point is participation, not a permission, so `spec:read` is enough. **Resolving** a comment is the job of the five roles that can write drafts.

**Resolving a review finding** (fixed, dismissed, won't fix) belongs to admin, planner and qa only. A developer receives findings and fixes them; closing them is someone else's call.

One person can be `admin` in the organization and `developer` on a project. **Holding both is a union** — you get the permissions of both seats.

## Creating an account — signing up ends with the confirmation mail

Fill in a name, an email and a password on the sign-up screen and the account is created — then you are asked **once whether the address is really yours.** You get in after confirming it.

1. Press [Sign up] and the form is replaced by **"Confirmation mail sent"**, which says which address it went to. The form is not left behind: there is nothing to type again.
2. Open the link in the mail. **Confirming signs you in right there and takes you to Get started, where you create an organization** — you do not retype the password you just chose. Any invitation waiting for you sits there as a card, ahead of everything else. If you signed up from an invitation link, you go back to that invitation instead.
3. Signing in before confirming is refused with **"Your email is not confirmed yet."** That does **not** mean the password is wrong, so do not retype it — what is left to do is open your inbox.

- **If the mail is missing, check the spam folder.** If it is not there either, use **[Resend the confirmation mail]**, which sits on both the sign-up and the sign-in screen. One press turns it into "Sent" and it will not press again on that screen — reload the page to get it back.
- **Resending uses the same limit as signing in (10 per minute).** Hammering somebody else's address would fill their inbox.
- **An unconfirmed account can do nothing.** If a confirmation mail arrives and you never signed up, just delete it.
- **Coming in from an invitation link works the same way.** Once confirmed, you are returned to that invitation (see "Inviting people" in [Settings](/help/settings)).

**Some servers skip this step entirely.** Email confirmation is required **only where the server can send mail** — on a deployment with no mail sender configured (an empty `NERV_MAIL_HOST`), signing up takes you straight in, and neither the notice above nor [Resend] is ever shown. The point is to avoid a server that demands a confirmation it cannot send: configured that way, the server refuses to start at all.

**Accounts that were already in use are not asked again.** Accounts that existed before this rule reached the server were treated as confirmed — making a new rule retroactive charges people who did nothing wrong. The rule applies to sign-ups after it.

## Your first five minutes

0. If you were sent an invitation link, open that first — signing in accepts the invitation. If you do not belong to an organization yet, signing in takes you to **Get started**, where any invitation waiting for you sits as a card.
1. Sign in and check that the **organization and project** in the header are the ones you meant.
2. Skim the **spec tree** on the left. What this project decided to build is in there.
3. Open **Tasks** and look at the `ready` lane — that is what can be picked up right now.
4. If you are connecting an agent, issue a token under **Settings → Tokens** and install the plugin — the procedure is in [Installing the plugin](/help/install), what fits together with what is in [Agents](/help/agents).
5. To find a document, press **⌘K**. It finds **specs and requirements** by name, and pasting a stable ID jumps straight to it — not screens or settings — and it only works **inside a project**.
