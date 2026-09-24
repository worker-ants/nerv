Settings has four tabs: **Organization & projects, Members, Tokens and Gate policy**.

## Organization & projects

Of the two header selects, it is the **project** you create, rename and put away here.

**The organization this tab acts on is the one picked in the header.** With more than one organization, switching it in the header is what switches what this tab edits — a screen that points at two organizations at once leaves you unsure which one you just renamed.

**Creating, editing and putting away are `admin` work, and which admin depends on what you change.** Renaming or deleting the organization and [New project] are for **organization admins** (people whose organization-wide role is admin) only. Editing or archiving a project row is for organization admins and **that project's admins** — a project admin sees only their own project's row unlocked, with the organization name and other projects locked. With admin nowhere, the [Show archived] toggle is not shown either. [New project] stays **visible but locked** for anyone who is not an organization admin, and the note at the top of the tab **names the organization admins to ask**.

- **Create a project** — type a name and the address (slug) and key follow from it. The key is the short prefix on **task** numbers (`CLV-T-3F92A1`). A spec key is unrelated — a person writes it when creating the document.
- **Rename** — only the name changes. **The slug does not** — addresses and API paths are built on it, so changing it would break every link already out in the world.
- **Repository kind** — chosen in the same [Edit] (`github` by default, or `gitlab`). It decides only the **shape of the links**: GitLab puts `/-/` in commit and file addresses, so links do not open unless this is set. **The server never connects to the repository.** We do not guess it from the domain for the same reason — a self-hosted address does not say which kind it is.
- **Repository URL and default branch** — the project row's [Edit] takes these alongside the name. Commits and code paths attached to a task's **evidence** open on top of this URL (see "Click the evidence" in the [Tasks](/help/tasks) chapter) — when it is empty those rows are not clickable and the task screen says so. To remove a wrong URL, **clear the field and save**.
- **Archive a project** — pressing it **asks once more, in place**, and says how many approvals are waiting in that project (they are hidden for everyone, as below). It drops out of lists but is not deleted, and its address still works. It can be undone: turn on **Show archived** above the list and press **Restore** on that row.
- An archived project's **notifications and approval cards are hidden.** You should not be kept waiting on decisions for something you put away — they come back when you restore it.
- You cannot create a new project on the same slug. If an archived project holds that name, the screen says so — **restore** it instead of creating a new one.
- **Delete an organization** — possible **only while it holds no projects**, because an irreversible act should have a reversible step in front of it. **Archiving does not satisfy that condition, though** — archived projects still count, and the screen offers no way to delete a project. So an organization that ever held a project cannot be deleted from this screen today. In that case [Delete organization] is **locked**, and the line below it says how many projects (how many archived) are in the way — do not archive projects in order to delete the organization. An empty organization is deleted after one more confirmation.

## Inviting people

Only an `admin` sends invitations — every other role sees **[+ Invite] locked**. **Inviting to the whole organization is for organization admins only**; a project's admin can invite to that project only.

Under **Invitations** on the Members tab, pick an email, a role and **what it applies to**, and you get an **invitation link**. The form starts by naming **the organization you are inviting into** (switch organizations in the header), and the scope is either "Whole organization (every project)" or one of that organization's projects, **by name**. Once created, a "who → organization / scope · role" summary sits above the link.

- **The mail goes out on its own** — where this server has a mail sender configured, the invitation link is sent to that address and the screen says **"Mail sent"**. Where it does not, the screen says **"copy it and pass it on"** instead — covering both with one wording makes one of them a lie, and then someone waits for mail that is not coming.
- **The link is shown once, right there.** Sent or not, the link sits on the same card, and the server cannot produce it again — on a deployment without mail, **[Copy link]** and pass it on yourself.
- **Only the invited email can accept.** If the link reaches someone else, it does not let them in.
- It **expires after 7 days**. Just make a new one.
- It is the **same link** whether or not they already have an account. Without one they sign up and are returned to the invitation automatically.
- **The list of sent invitations says when each one last went out** (**Unsent** if it never did). Not sent and sent-but-not-arrived are different problems, and an admin who cannot tell them apart makes the same invitation three times.
- **You see the invitations you could have sent.** Organization admins see every invitation in the organization; a project’s admin sees only the invitations to that project.
- Sent it by mistake? **Revoke** it from the list. It asks once more, and the link stops working at once. Revoking keeps the record — who invited whom is part of the audit trail.

On the receiving side the invitation shows as a card on **Home, Getting started and Notifications**, and can be accepted right there. **Someone without an account has to sign up and confirm their email before they can accept** — on a deployment that can send mail; the steps are under "Creating an account" in [Getting started](/help/start).

## Members

Who is here and in what role. A role can be granted across the whole organization or on a single project. When one person holds both, **permissions are the union**.

The table's title names **whose members these are**, and the **Applies to** column says, by project **name**, whether a role is organization-wide or for one project. Turning a role chip on adds the role **in that row's scope**.

**Each person is one group.** Name and email appear on the group's first row only; the organization-wide row comes first, then the project rows. On a project row, a **dashed chip marked ↳** is a role the person **already holds organization-wide** — they have that permission in this project too, so it needs no separate grant and cannot be pressed. Change it on the organization-wide row.

Editing members and roles is `admin` only — **organization-wide rows by organization admins only**; project rows also by that project's admins. Rows you cannot change have their chips locked, and hovering a chip says why. If you are not an organization admin, the note at the top of the tab **names the organization admins to ask**. **A member's last role cannot be removed with a chip** — a member with no role can reach nothing while still sitting in the list.

**Remove someone who has left with [Remove…].** Organization admins have it at the end of each person's first row. It deletes **all** of that person's memberships and **revokes their live tokens** — pressing it says how many of each and asks once more. A project admin gets **[Remove from this project]** at the end of their own project's rows, which takes off every role on that row. You cannot remove yourself. To undo it, invite them again.

**The organization's last admin cannot be removed.** When only one person holds the organization-wide admin role, that person's admin chip and [Remove…] are locked — an organization with no admin left has nobody who can manage memberships, so there is no way back (the server refuses too). Make someone else an organization admin first. **Turning off your own admin chip asks once more** — editing on this screen locks the moment you do, and getting it back takes another admin.

## Tokens

Issue and revoke the tokens agents use. The details are in [Agents](/help/agents).

**Revoking cannot be undone, so it asks once more** and names the **machine that last used** the token — the agent there is cut off from its next call. Organization admins also cut off other people's live tokens with the same [Revoke] in the **organization-wide token table** (someone who has left, for example).

## Gate policy

Gate policy is **per project**, not one set for the whole organization. **Pick the project you are editing with this tab's project picker**; the title, "Gate policy — project name", says which one it is. It starts on the project you last looked at in the header.

Gates decide what a spec change has to go through, according to **how risky it is**. Tiers run T0–T3, and the tier follows from the sum of four risk axes: side effects, sensitivity, reversibility and blast radius.

- **Tier boundaries** — the scores at which T1, T2 and T3 begin, in **three fields**. Lower them and more changes pass through a person. They must be whole numbers from 0 with T1 ≤ T2 ≤ T3; otherwise the screen says so below the fields before you save. The summary below redraws, as you type, **each tier's score range and what it requires** (passes automatically · one person approves · two people from different roles approve).
- **Dynamic escalation** — three signals raise the tier by one: retries past the threshold, a recent rollback, and **a document's first approved version**. The first two mean something already slipped here; the third means this promise is arriving for the first time.

**A new document that establishes requirements goes past a person once.** A newly created spec has no earlier version to revert to and nothing referencing it yet, so it scores low. Left alone, a document that establishes new requirements would be approved without a person ever seeing it. So the first version alone gets the extra step. From the second version on, the score decides.

**Even with the extra step, anything up to T1 still passes automatically.** So a very low-scoring new document — a short one with no requirements, say — is still approved without a person. The extra step only actually summons someone on a document that already scores somewhere.

Turning dynamic escalation off removes this too.

The **fail-open** values below the tab (escalation count and time window) are read-only — they set how many times a person is called when the gate check itself fails, and are not edited from this screen.

**[Save] turns on only when something changed**, and lists the changes above it as before → after. **A save that raises a boundary or turns dynamic escalation off** widens what passes automatically, so it asks once more — from that moment more specs are approved without a person. Picking another project with unsaved changes asks whether to discard them first.

Editing is `admin` only; everyone else sees the current values as they are — anyone should be able to see what is holding them up. The note names that project's admins to ask.
