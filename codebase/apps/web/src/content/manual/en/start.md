NERV is a platform where people and AI agents build software together. **Specification documents are the single source of truth**, people make the decisions at approval gates, and AI agents read those specs and implement them. This manual explains what you can do on each screen and what each indicator means.

## The loop

Work in NERV moves through a loop of five steps.

1. **Write the spec** — describe what will be built. A draft is not yet the reference for anyone.
2. **A person approves it** — only approved versions become the reference. Agents read the approved version.
3. **Create tasks** — break the work in an approved spec into tasks. Each task records which spec version it is based on.
4. **An agent implements it** — an agent claims a task and implements it. You can see what the agent is doing on the Sessions screen.
5. **Review** — reviews collect findings, and a person decides on the severe ones.

When an agent gets stuck, it can send a person a **question** at any time. Questions appear in your inbox as cards. On the next pass through the loop, a changed spec becomes a new version, and tasks based on the old version are flagged automatically.

## Map of the screens

| Screen            | What it shows                                                  |
| ----------------- | -------------------------------------------------------------- |
| **Home**          | How many decisions are waiting on you right now                |
| **Project**       | How far along the project is (implementation status, activity) |
| **Specs**         | What the team decided to build                                 |
| **Tasks**         | Who is doing what, and what is blocked                         |
| **Sessions**      | What an agent is actually doing right now                      |
| **Reviews**       | What is wrong, and who decides what to do about it             |
| **Inbox**         | What you need to decide                                        |
| **Notifications** | What you missed                                                |
| **Settings**      | Organizations, projects, members, tokens, gate policy          |

**Recent activity shows what each event applied to.** Home and the project screen show the same activity list. Each line shows what happened, **to what** (spec key and version, task key, or review branch, plus the title), by whom, and when. Click the key to go to that item. A line about a spec approval opens the diff against the previous version. Work done by an agent has an **AI** mark instead of a face; hover over it to see which machine and which agent. When the same person does the same thing to the same item several times in a row (for example, an agent saving a draft repeatedly), the lines **collapse into one with ×N**. Click it to expand them. Home shows eight lines; on the project screen, **[Load more]** at the bottom loads more.

**The right side of Home lists your projects, one per line.** For each project you belong to in the current organization, it shows three counts: **Active sessions · Open approvals · Open critical**. You can see where sessions are running and what is at risk without opening each project. Click a project name to open that project, or click a count to open the matching list. Active sessions open the session monitor, open approvals open the inbox, and open critical opens that project's review center filtered to critical. Open approvals include **every undecided approval** in the project, including those waiting on other people. The ones waiting on you are listed separately under Today above. The project you viewed last (marked **Recent** in the left column) has a light background, and the recent activity on the left of Home is for that project. Implementation status (coverage) is on the project screen.

**The top of the project screen shows what is waiting on you in that project:** N for your decision · N sessions waiting for a reply · N open critical. They open the inbox, the session monitor filtered to sessions waiting for a reply, and the review center filtered to critical. Items with nothing waiting are hidden. When all three are empty, you see "Nothing in this project is waiting on you right now."

**An active session is one that has not ended (Pending, Active, or Awaiting input).** Home, the sidebar badge, and the project screen all count sessions the same way. On the project screen, **sessions awaiting input (paused until a person replies) are listed first**. If no sessions are running, the list shows that there are none. Finished sessions are on the Sessions screen. The sidebar badges and recent activity update **without a reload** when a session starts or ends, or when an approval or finding is created.

## The left column — the same on every screen

**The left column is the same on every screen.** From top to bottom, it shows the **organization**, **Home · Inbox · Notifications**, the current organization's **projects**, and **Settings · Help**. When you move from Home to a project, or from a project to the inbox, the column stays the same; only the expanded item changes.

- **Organization** — the top of the column shows the organization you are viewing, with a small "Organization" label. Click it to see the other organizations you belong to and **[Manage or add organizations]**. You can only pick organizations you belong to.
- **Projects** — the current organization's projects, one per line. **On a project screen, that project is expanded**, with overview, specs, tasks, sessions, reviews, and settings under it. When you read a document, the spec tree appears in a separate column right next to it (see [Specs](/help/specs)). Click another project's name to go to its overview.
- **Settings · Help** — at the bottom of the column. On settings screens, the **settings items** expand under [Settings]. On other screens, a single **Help for this screen** line appears under [Help]. While you read help, the manual's **contents** appear in **the column just to the right**, not in this one. This is the same place where the spec tree appears next to a document. The button at the top of that column collapses and expands it, and it stays collapsed the next time you open help.

**If the left column has more items than fit, you can scroll it.** With many projects, or with the settings items expanded, scroll over the left column to reach the end. No item is hidden out of reach.

Home, Inbox, Notifications, and Settings cover the whole organization, so their addresses do not include a project. On these screens, **no project is expanded**. Expanding the project you viewed last would make the whole screen look like it belonged to that project. Instead, the project you viewed last has **"Recent"** next to its name in the list, so you can get back to it in one click. Places that show a single project's content, such as "Recent activity" on Home, include the project name in their title. **When there are no projects**, the list shows "No projects yet". Organization admins see **[Manage or add projects]** below it, which opens the projects page with the form already open. Everyone else sees **[Manage projects]**. If the organization has no projects and you are not an admin, Home lists the organization admins you can ask.

**The header shows where you are** as `organization / project / screen`. Click the project name to go to its overview. You choose organizations and projects in the left column. When you open a single spec, task, or session, **its key** is added at the end (`… / Specs / SPC-CWC-007`). Click the screen name to go back to the list. **The browser tab title also starts with the key and title**, so you can tell tabs apart when several documents are open.

**The inbox and notification counts include every organization you belong to.** An approval waiting in another organization would be easy to miss if you had to switch organizations to see it. Each row in those lists shows which organization and project it belongs to. **⌘K searches documents only inside a project.** The search box shows which project it searches. Outside a project, you can still use it to go to screens and projects ([Shortcuts and language](/help/shortcuts)).

**Switching organizations switches everything else too.** The project list changes to that organization's projects, and "Recent" moves to **the project you last viewed in that organization** (or its first project if you have not been there yet). "Switched to …" appears briefly. The last project is remembered for each organization, so when you switch back, you return to the project you were viewing there. Accepting an invitation works the same way. You switch to the organization you joined, and a project invitation opens that project.

**Opening a link to another organization's item switches the organization first.** If you click a row from another organization in the inbox or notifications, or open a project address that a colleague sent from another organization, NERV first switches to that organization ("Switched to …") and then opens the item. Addresses do not include the organization. Without the switch, NERV would look in the current organization and report that the item was not found. If the project cannot be matched to a single organization, choose one of the candidates with **Open in …**.

**To get back to Home**, click the `NERV` logo at the top left or **[Home]** in the left column.

## Narrow screens — phones and tablets

On a narrow screen, the left column moves into a **drawer that you open with [☰] at the left end of the header**. The drawer has **the same content** as the column that stays beside the page on a wide screen: organization · Home · Inbox · Notifications · projects (with the expanded project's tabs) · Settings · Help. A narrow screen does not hide anything.

- The drawer **closes automatically when you go somewhere else.** To close it without leaving, click [✕] at its top right, click the dimmed area outside it, or press `Esc`.
- On a wide screen, Inbox and Notifications are in the left column. On a narrow screen, they also appear **in the header as icons with count badges**, so you can see them without opening the drawer. A count that you have to open something to see would not work as a badge. Search shrinks to a magnifier icon, and clicking it opens the same quick switcher.
- The help `?` in the header is hidden at this width. Help is at the bottom of the drawer.
- The **spec tree** for a document you are reading and the manual's **contents** are not in the drawer. They are in the narrow strip at the left edge. Click the strip to open the column over the page. Choosing a document or chapter, or pressing `Esc`, closes it.
- When you widen the window, the drawer closes and the left column returns to its place.

## Roles

| Role        | What it can do                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`     | Manage organizations and projects; members, tokens, gate policy, imports                                                                  |
| `planner`   | Write, **submit others' drafts**, and **approve** specs of any type; baselines, metadata, resolving findings                              |
| `designer`  | Comment on specs and edit drafts; claim and work on tasks. Can create only **design** specs. **Assigned approvals** on `design` documents |
| `developer` | Same as above, but can create **convention** and **adr** specs. **Assigned approvals** on those two types                                 |
| `qa`        | Same as above, plus **resolving findings**. **Assigned approvals** on `feature` documents                                                 |
| `viewer`    | Read + **comment**                                                                                                                        |

**“Assigned approvals” apply only when the card names that discipline.** A designer does not approve every `design` document. The card goes to them only when a T3 document names its second approver by that discipline (see [Inbox](/help/inbox)).

**Each role can create different spec types.** admin and planner have no limit, designer can create `design`, and developer can create `convention` and `adr`. qa creates no specs, because what qa produces is a **review**. **Even a viewer can comment.** Raising a point is a way of taking part and needs no special permission, so `spec:read` is enough. **Resolving** (closing) a comment is done by the five roles that can write drafts.

**Resolving a review finding** (fixed, dismissed, or won't fix) is limited to admin, planner, and qa. A developer receives findings and fixes them but does not close them.

One person can be `admin` in the organization and `developer` on a project. **Multiple roles combine**: you get the permissions of both.

## Creating an account — signing up ends with the confirmation mail

Enter a name, an email address, and a password on the sign-up screen to create an account. You are then asked **once to confirm that the address is yours.** You can sign in after you confirm it.

1. Click [Sign up]. The form is replaced by **"Confirmation email sent"**, along with the address it was sent to. The form is not kept, because there is nothing you need to enter again.
2. Open the link in the email. **Confirming signs you in right away and takes you to Get started, where you create an organization.** You do not need to re-enter the password you just chose. If you have a pending invitation, its card appears there first. If you signed up from an invitation link, you return to that invitation instead.
3. If you try to sign in before confirming, you see **"Your email is not confirmed yet."** and are not signed in. This does **not** mean your password is wrong, so do not retype it. Check your inbox instead.

- **If you do not see the email, check your spam folder.** If it is not there either, use **[Resend confirmation email]**, which is on both the sign-up and sign-in screens. After one click, it changes to **"Sent. Check your inbox and spam folder."** and cannot be clicked again. Reload the page to use it again.
- **Resending has the same limit as signing in (10 per minute).** Otherwise, repeated requests for someone else's address could flood their inbox.
- **An unconfirmed account cannot do anything.** If you get a confirmation email but never signed up, just delete it.
- **Signing up from an invitation link works the same way.** After you confirm, you return to that invitation (see "Invitations" in [Settings](/help/settings)).
- **The email is sent in the language of the screen you signed up on.** If you changed the language with the buttons below the sign-up form, the email uses that language. The password reset email works the same way.

**Some servers skip this step.** Email confirmation is required **only when the server can send email**. On a deployment with no mail sender configured (`NERV_MAIL_HOST` is empty), signing up signs you in immediately, and neither the notice above nor [Resend confirmation email] appears. This keeps a server from requiring a confirmation it cannot send. A server configured to require email confirmation without a mail sender does not start at all.

**Existing accounts are not asked to confirm.** Accounts that existed before this rule was introduced on the server were marked as confirmed. Applying a new rule retroactively would inconvenience people who did nothing wrong. The rule applies only to accounts created after it was introduced.

**After you sign in, you go where you were headed.** If you opened a link from a colleague before signing in, you land on **that exact address** afterward, including filters, the selected item, and any comparison. If you came in through the app's main address, you land on the first screen for your role: the **Inbox** for planners, designers, and admins; the **task board** for developers and QA; and the project overview for everyone else. If you belong to several organizations, NERV uses your role in **the organization you were last viewing**.

## Forgot your password

On the sign-in screen, click **"Forgot your password?"** just below the password field. Any address you entered in the email field is filled in on the next screen.

1. Check that it is the email address you signed up with, and click **[Send reset link]**. The form is replaced by **"Check your email"**.
2. Open the link in the email. **The link can be used once, within 60 minutes.**
3. Enter the new password twice and click **[Set password]**. It must be at least 8 characters long. If the two fields do not match, you are told before anything is sent.
4. When **"New password set"** appears, click **[Sign in]** and sign in with the new password.

- **The screen shows the same message even when no account uses that address.** This keeps anyone from using this screen to find out whether an account exists. If no email arrives, check your spam folder, then check that it is the address you signed up with.
- **Setting a new password signs you out on every device**, including this browser. Anyone who knew the old password loses access at that point.
- **An expired or already used link** shows **"This link cannot be used"** and **[Get a new reset link]** instead of the form, so you find out before you enter a password.
- **Reset also works for an account whose email is not confirmed yet.** Setting a password through the emailed link proves the address is yours, so you are signed in right away without waiting for a confirmation email.
- **Reset requests have the same limit as signing in (10 per minute).** If you go over it, a message appears in the form.
- **On a server that does not send email** (`NERV_MAIL_HOST` is empty), you cannot reset your password here. Submitting the form shows **"Contact the server operator."** This keeps you from waiting for an email that will never arrive.

If you **know your password and want to change it**, go to "My account" in [Settings](/help/settings).

## Your first five minutes

0. If you received an invitation link, open it first. After you sign in, click **[Join]** on the invitation card to become a member. If you do not belong to any organization yet, you land on **Get started** after signing in, and any invitations you have appear there as cards.
   **If you just created an organization**, you stay on Get started, which shows your role and a **setup checklist** (first project · invite people · connect an agent). If you enter a **first project name** when you create the organization, the project is created in the same step. The same checklist appears at the top of Home. It disappears when all three are done or when you click **[Dismiss]** (only organization admins see it).
1. Sign in, check that the **organization** at the top of the left column is the right one, and click a **project** in the list below it.
2. Open **Specs** and skim the tree. It shows what this project decided to build.
3. Open **Tasks** and look at the `ready` lane. It lists the tasks you can pick up right now.
4. To connect an agent, issue a token under **Settings → Agent tokens** and install the plugin. The steps are in [Installing the plugin](/help/install), and how the pieces work together is in [Agents](/help/agents).
5. To find a document, press **⌘K**. You can find **specs, requirements, and tasks** by name, and pasting a stable ID takes you straight to that item. Documents can be searched **only inside a project**. Screens (the inbox, settings tabs, and so on) and projects can be reached from anywhere.

## Messages in the lower right

The short messages that appear in the lower-right corner come in three kinds.

- **⚠ Failure or warning** — a request was refused, or another session has already claimed the same declared scope. The message shows what was blocked and what to do, with a link when there is somewhere to go. It stays for 20 seconds.
- **✓ Something you did** — what you just did went through. A decision made in the inbox shows **what you decided** (key and title) and stays for 3 minutes, because the card leaves the list right away. Other messages stay for 8 seconds.
- **ℹ Something someone else did** — another person or an agent changed a spec in the project you are viewing. Repeated changes to the same document are combined into one message, and **Open** takes you to it. It stays for 8 seconds.

Up to three messages are shown at a time. If there are more, "N more" and **Dismiss all** appear above them.

**Every failure is reported, exactly once.** Actions that show the reason in place (a blocked task transition, rejecting without a reason) report it only there. All other actions report it here. No action fails silently.

**Repeating an action runs it again.** Releasing a task and claiming it again, or sending the same instruction twice, is sent as a new request. Only a double click made before the button locks counts as one.

## When something fails to load, or is not there

Screens show these three cases differently.

- **Loading** — grey placeholders appear. Nothing is shown as "empty" yet.
- **⚠ Failed to load** — the server could not be reached, or it returned an error. The reason and **Retry** appear in place. A list that looks empty is not really empty. For example, if the inbox could not be read, Home's greeting shows "we couldn't load your inbox" instead of "no decisions are waiting". A list that was already showing stays in place if a refresh fails.
- **? Not found** — the task, document, session, or project in the address does not exist, or you are not a member of that project. The screen shows what is missing (the key or the address) and links to **← Back to the list** or **Go home**. If you are not a member, that is shown too. Ask an organization admin to add you.

**Settings that failed to load cannot be saved.** Saving a gate policy that was never loaded would overwrite the server's policy with defaults, so **Save** stays locked until the policy loads.

**The connection status appears at the right of the header, before search.** Nothing is shown while you are connected. There are two disconnected states, and they look different.

- **Amber ● Live off** — only the live connection dropped. The screen refreshes every 15 seconds, so you can keep working. Click it to see this explanation and when the connection dropped (`Esc` closes it). On a narrow screen, only the dot is shown.
- **Grey ⚠ Offline** — the server cannot be reached. **A grey bar also appears under the header.** What you see was received at the time shown in that bar. **Buttons that change data (approve, save, reject, change status, and so on) are locked**, so nothing you click is silently lost. When the server is reachable again, the bar disappears and the buttons unlock automatically.

**A locked button shows why it is locked.** Hover over it, or move to it with `Tab`, to see the reason (which roles can use it, offline, and so on). Screen readers read the reason as the button's description.

**A spec's version list shows the latest 8 versions first.** If there are more, click **Show N older versions** at the end of the list to see the rest.

## Actions that need confirmation

**Before an action that is hard to undo or that affects other people, NERV asks you to confirm it in place.** These actions are: revoking a token · revoking an invitation · removing a member · turning off your own admin role · archiving a project · deleting the organization · archiving a spec · deleting an attachment · abandoning a claim · stopping a session. When you click one, the button is replaced by a description of **what will happen** (whether it can be undone, and who it affects), a button that runs the action, and [Cancel].

- Focus starts on **[Cancel]**, so pressing Enter twice does not run the action by accident. For an action that needs a reason (stopping a session), focus starts in the reason field.
- **Esc** cancels. Inside a dialog, it closes only the confirmation.
- If you leave a confirmation open and move focus elsewhere, it turns back into the original button after a moment.

Actions that are easy to undo (turning on a role, restoring) run immediately without confirmation.
