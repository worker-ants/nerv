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

**Recent activity says what it happened to.** Home and the project screen share one activity list. Each line reads what happened · **to what** (spec key and version, task key, review branch — and the title) · by whom · when, and the key takes you there — a line saying a spec was approved opens the difference from the previous version. Work done by an agent shows an **AI** mark instead of a face; hover it to see which machine and which agent. When the same person does the same thing to the same subject several times in a row (an agent saving a draft over and over, say), the lines **fold into one with ×N** — press it to unfold. Home shows eight lines; the project screen carries on with **[Load more]** at the bottom.

**The right side of home lists your projects, one line each.** For every project you belong to in the current organization it shows three numbers — **active sessions · open approvals · open critical** — so you can see where sessions are running and what is at risk without opening each project in turn. The name takes you to that project; each number takes you to its list — active sessions to the session monitor, open approvals to the inbox, open critical to that project's review center (filtered to critical). Open approvals are **every undecided approval** in that project, including other people's turns — the ones waiting on you are counted under Today above. The project you looked at last (marked **Recent** in the left column) gets a faint background (the recent activity on the left is that project's). Progress (coverage) lives on the project screen.

**The project screen's header shows what is waiting on you there** — N for your decision · N sessions waiting for a reply · N open critical. They take you to the inbox, the session monitor filtered to waiting sessions, and the review center filtered to critical. Anything at zero is left out; when all three are zero, it says so.

**An active session is one that has not ended** — pending, active or waiting for a reply. Home, the sidebar badge and the project screen all count the same thing. The project screen lists **sessions waiting for a reply first**, and says so when none are running — finished sessions are on the sessions screen. The sidebar badges and recent activity update **without a reload** when a session starts or ends, or an approval or finding appears.

## The left column — the same on every screen

**The left column is the same on every screen.** From the top: the **organization** · **Home · Inbox · Notifications** · the current organization's **projects** · **Settings · Help**. Moving from home to a project, or from a project to the inbox, leaves the column where it is; only what is expanded changes.

- **Organization** — the slot at the top of the column is the organization you are looking at (with a small "Organization" label). Press it for the other organizations you belong to and **[Manage · new organization]**. The only organizations you can pick are the ones you belong to.
- **Projects** — the current organization's projects, one line each. **On a project screen that project is expanded**, with overview, specs, tasks, sessions, reviews and settings under it (the spec tree stands as a column beside a document you are reading — see [Specs](/help/specs)). Press another project's name to go to its overview.
- **Settings · Help** — the bottom of the column. In settings, the **settings items** open under [Settings]; on other screens [Help] is followed by a single **Help for this screen** line. While you are reading help, the manual's **contents** stand not in this column but in **the column right next to it** — the same spot as the spec tree beside a document — and the button at its top folds it away and back (folded stays folded next time).

**When the column holds more than fits, it scrolls.** With many projects, or with the settings items expanded, roll the wheel over the left column to reach the end — nothing is hidden.

Home, inbox, notifications and settings are organization-wide, so their addresses carry no project. There **no project is expanded** — expanding the project you looked at last would make the whole screen read as that project's. The project you looked at last carries **"Recent"** next to its name in the list, one click away. Places that do show one project, like Home's "Recent activity", put that project's name in their title. **When there are no projects**, the list says "No projects yet", with **[Manage · new project]** below it for organization admins (you arrive with the form open) and **[Manage projects]** for everyone else. When the organization has no projects and you are not its admin, Home names the organization admins to ask.

**The header says where you are** — `organization / project / screen`. Press the project name to go to its overview. Picking happens in the left column. Open a single spec, task or session and **its key** is added at the end (`… / Specs / SPC-CWC-007`); press the screen name to go back to that list. **The browser tab title starts with the key and title as well**, so with several documents open in tabs you can still tell them apart.

The **inbox and notification counts cover every organization you belong to** — an approval waiting in another organization is easy to miss if you have to switch to see it — and each row in those lists says which organization and project it belongs to. **⌘K searches documents inside a project** — the search box says which project, and outside a project it still takes you to screens and projects ([Shortcuts and language](/help/shortcuts)).

**Switching the organization switches everything with it.** The project list becomes that organization's and "Recent" moves to **the project you last looked at in that organization** (its first project if you have not been there yet), and "Switched to …" appears briefly. The last project is remembered per organization, so coming back to the original one brings back what you were looking at there. Accepting an invitation does the same: you move to the organization you joined, and a project invitation opens that project.

**Links to another organization's work switch the organization first.** Pressing a row from another organization in the inbox or notifications, or opening a project address a colleague sent you from another organization, first switches to that organization ("Switched to …") and then lands on that spot — addresses do not carry the organization, so without the switch the lookup would run in the current organization and say the item does not exist. If the organization that has the project cannot be narrowed to one, you pick among the candidates with **Open in …**.

**To get back home**, press the `NERV` logo at the top left or **[Home]** in the left column.

## Narrow screens — phones and tablets

On a narrow screen the left column moves into a **drawer, opened by the [☰] at the far left of the header**. It is the **same one** that sits fixed beside the content on a wide screen, so the drawer holds the very same things: organization · Home · Inbox · Notifications · projects (with the expanded project's tabs) · Settings · Help. A narrower screen does not mean less to see.

- The drawer **closes itself once you go somewhere.** To close it where you are, press the [✕] at its top right, press the dimmed area outside it, or press `Esc`.
- Inbox and notifications live in the left column on a wide screen; at the narrow width they also sit **in the header as glyphs with their count badges**, so you see them without opening the drawer (a number you have to open something to see is not a badge). Search shrinks to a single magnifier, and pressing it opens the same quick switcher.
- The header's help `?` folds away at that width — help is at the bottom of the drawer.
- The **spec tree** for a document you are reading, and the **contents** of the manual, are not in the drawer but in the strip at the left edge — press it and the column opens over the page; picking a document or chapter, or pressing `Esc`, closes it.
- Widen the window and the drawer closes as the left column takes its place again.

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
- **The mail comes in the language of the screen you signed up on.** If you switched it with the language buttons under the sign-up form, it comes in that language. The password reset mail works the same way.

**Some servers skip this step entirely.** Email confirmation is required **only where the server can send mail** — on a deployment with no mail sender configured (an empty `NERV_MAIL_HOST`), signing up takes you straight in, and neither the notice above nor [Resend] is ever shown. The point is to avoid a server that demands a confirmation it cannot send: configured that way, the server refuses to start at all.

**Accounts that were already in use are not asked again.** Accounts that existed before this rule reached the server were treated as confirmed — making a new rule retroactive charges people who did nothing wrong. The rule applies to sign-ups after it.

**Signing in takes you back to where you were going.** If you opened a link a colleague sent before signing in, you land on **that exact address** afterwards — filters, the selected item and any comparison included. If you just came in at the app address, you land on the first screen for your role: **Inbox** for planners, designers and admins, the **task board** for developers and QA, the project overview otherwise. With several organizations, it goes by your role in **the organization you were last looking at**.

## Forgot your password

On the sign-in screen, press **"Forgot your password?"** right under the password field. Whatever you typed into the email field comes along.

1. Check that it is the email you signed up with and press **[Send reset link]**. The form is replaced by **"Check your mail"**.
2. Open the link in the mail. **The link works for 60 minutes, once.**
3. Type the new password twice and press **[Set password]**. It needs at least 8 characters, and a mismatch between the two fields is pointed out before anything is sent.
4. When **"New password set"** appears, press **[Sign in]** and come in with the new password.

- **The screen says the same thing even when no account uses that address.** That way nobody can use this screen to find out whether an account exists — if no mail arrives, check the spam folder, then check that it is the address you signed up with.
- **Setting a new password signs out every device** — this browser included. Anyone who knew the old password is out at that point.
- **An expired or already-used link** shows **"This link cannot be used"** and **[Get a new reset link]** instead of the form, so you find out before typing a password.
- **It works for an account whose email is not confirmed yet.** Setting a password through the link in the mail proves the address is yours, so you come straight in without waiting for a confirmation mail.
- **Requests use the same limit as signing in (10 per minute).** Going over is reported inside the form.
- **On a server that does not send mail** (an empty `NERV_MAIL_HOST`) the password cannot be reset here — sending shows **"ask the server operator"**. The point is not to leave you waiting for a mail that will never come.

If you **know your password and want to change it**, do it under "My account" in [Settings](/help/settings).

## Your first five minutes

0. If you were sent an invitation link, open that first — signing in accepts the invitation. If you do not belong to an organization yet, signing in takes you to **Get started**, where any invitation waiting for you sits as a card.
   **If you just created an organization**, you stay on Get started, which shows your role and a **setup checklist** (first project · invite people · connect an agent). Fill in a **first project name** when creating the organization and the project is created in the same step. The same checklist sits at the top of Home, and goes away once all three are done or you press **[Dismiss]** (only organization admins see it).
1. Sign in, check that the **organization** at the top of the left column is the one you meant, and press a **project** in the list below it.
2. Open **Specs** and skim the tree. What this project decided to build is in there.
3. Open **Tasks** and look at the `ready` lane — that is what can be picked up right now.
4. If you are connecting an agent, issue a token under **Settings → Tokens** and install the plugin — the procedure is in [Installing the plugin](/help/install), what fits together with what is in [Agents](/help/agents).
5. To find a document, press **⌘K**. It finds **specs, requirements and tasks** by name, and pasting a stable ID jumps straight to it — documents are searched **inside a project** only, while screens (the inbox, settings tabs and so on) and projects are reachable from anywhere.

## Messages in the lower right

The short messages in the lower-right corner come in three shapes.

- **⚠ Failure or warning** — a request was refused, or another session already holds the same scope. It says what was blocked and what to do, with a link when there is somewhere to go. It stays for 20 seconds.
- **✓ Something you did** — what you just pressed went through. A decision made in the inbox names **what you decided** (key and title) and stays for 3 minutes, because the card itself leaves the list right away. Everything else stays for 8 seconds.
- **ℹ Something someone else did** — another person or an agent changed a spec in the project you are looking at. Repeated changes to the same document fold into one message, and **Open** takes you to it. It stays for 8 seconds.

Up to three show at a time. When there are more, "N more" and **Dismiss all** appear above them.

**A failure is always reported, once.** Actions that explain the reason in place (a blocked task transition, rejecting without a reason) say it there only; everything else says it here. No action fails silently.

**Pressing the same action again runs it again.** Releasing a task and claiming it again, or sending the same instruction twice, goes out as a new request. Only a double press made before the button locks counts as one.

## When something fails to load, or is not there

Screens tell these three cases apart.

- **Loading** — grey placeholders. Nothing is called "empty" yet.
- **⚠ Could not load this** — the server could not be reached, or it failed. The reason and **Retry** appear in place. A list that looks empty is not empty — Home's greeting does not say "no decisions are waiting" when the inbox could not be read; it says "your inbox could not be loaded". A list that was already showing is kept when a refresh fails.
- **? Not found** — the task, document, session or project in the address does not exist, or you are not a member of that project. It says what is missing (the key or the address) and gives a way out: **← Back to the list** or **Go home**. If you are not a member it says so — ask an organization admin to add you.

**Settings that failed to load cannot be saved.** Saving a gate policy that was never read would overwrite the server's policy with defaults, so **Save** stays locked until it loads.

**The connection state sits at the right of the header, before search.** While connected there is nothing there. When something drops there are two states, and they look different.

- **Amber ● Live off** — only the live connection dropped. The screen refreshes every 15 seconds, so you can keep working. Press it to see this along with when it dropped (`Esc` closes it). On a narrow screen only the dot shows.
- **Grey ⚠ Offline** — the server cannot be reached. **A grey line appears under the header as well.** What you see was received at the time on that line, and **buttons that write (approve · save · reject · change status and the like) are locked** — so that nothing you press quietly vanishes. Once the server is reachable the line goes away and the buttons unlock on their own.

**A locked button says why.** Hover it, or `Tab` to it, and the reason appears (which roles can · offline and so on). Screen readers read it as the button's description.

**A spec's version list shows the latest 8 first.** If there are more, **Show N older versions** at the end of the list opens the rest.

## Buttons that ask once more

**Actions that are hard to undo or that reach other people ask once more, in place.** Revoking a token · revoking an invitation · removing a member · turning off your own admin · archiving a project · deleting the organization · archiving a spec · deleting an attachment · abandoning a claim · stopping a session. Pressing one puts **what will happen** (that it cannot be undone, who it reaches) and [Confirm]·[Cancel] where the button was.

- Focus lands on **[Cancel]** — so pressing Enter twice does not run it. For an action that needs a reason (stopping a session), focus lands in the reason field.
- **Esc** cancels. Inside a window, it closes only the confirmation.
- Leave a confirmation open and move elsewhere, and it turns back into the button after a moment.

Easily undone actions (turning a role on, restoring) happen at once without asking.
