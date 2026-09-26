The inbox collects **only what is waiting on your decision**. If it counted background activity too, people would soon ignore the badge, and a badge nobody looks at is as good as no badge.

## Kinds of card

| Card              | What you decide                                                |
| ----------------- | -------------------------------------------------------------- |
| **Spec approval** | Whether this version can become the reference version          |
| **Plan approval** | Whether this large piece of work can start now                 |
| **Question**      | Something an agent cannot decide on its own. Please answer it. |

**Plan approval** is required only for large work. Work counts as large when **four or more** tasks come from the same spec version, or when that version's risk tier is **T3**. Claiming such a task is blocked immediately, and this card is created. Once you approve it, the next claim goes through. The point is to review the design once before any code is written, so the gate sits right before work starts.

A `critical` downgrade from a review also arrives here as a card (see [Reviews](/help/reviews)).

**Gate bypasses** are also recorded as cards. These cards do not ask anything, though. They record **something that already happened**, so they skip the Pending tab and go straight to the Decided tab **of the person who requested the bypass**. A waiver goes through without anyone's confirmation, so the person who requested it is also the person who decided it.

### What a card shows

An approval card shows two more lines below its header.

- **Request line** — shows who made the request. If an agent session raised it, the machine and agent kind appear too. If that session is **stopped until you decide**, the line shows **"A session is waiting on this"**.
- **Target line** — shows what you are deciding. For a spec, it shows **which version** it is, the risk tier (T0–T3) and the author's **change summary**. Click **[View changes ▸]** to open the difference from the previous version. A first version has no earlier version to compare against, so it has no such link. For a plan approval, the line shows **which task** the plan is for; for a `critical` downgrade, **which finding** is being downgraded. In both cases, the key in the header links to that task or finding.

### Which organization and project it belongs to

The inbox collects requests from **every organization and project you belong to**, so each card shows the **name of its project** on the right. If you belong to more than one organization, the organization name comes first, as in "organization / project". Items outside the current organization (shown at the top of the left column) appear in an **accent color**, so you do not mistake another organization's approval for one in the current organization. Items with no project are marked **Whole organization**. The **Today** list on Home and notifications are labeled the same way.

## Question cards

When an agent runs into something it must not decide on its own, it **stops** and asks a question. Question cards show three more things.

- **Options** — the agent sends 2–4 answers it can act on as they are. Pressing a button sends **exactly that value**, which is more precise than rewriting it as a sentence. If you want to add anything, write it in the answer box as well.
- **Source** — the spec, task or finding the question came from, shown as a key. Click the key to open the original, so you do not have to judge from the summary alone.
- **Reason** — why a human is being asked (product decision · spec gap · infrastructure · E2E failed 3× · sensitive change). Use it to decide what to look at first.

When you answer, the session **resumes immediately.**

**Not every question stops an agent.** There are two urgency levels, `blocking` and `normal`. The session stops only for `blocking`; with `normal`, it keeps working while it waits for your answer. A `blocking` question has a **Blocking** mark in its header (the same mark as in the Today list on Home). **Review requests and `critical` downgrades raised by an agent pause the session the same way.** Once you decide, that session receives the result on its next heartbeat.

## Deciding

**The default queue is admins and planners.** If a card names a **discipline**, that discipline can decide it too. This applies to the second approver on a T3 document (designer for `design`, qa for `feature`, developer for `convention` and `adr`). **Anyone who can read a question can answer it.**

**The inbox only shows what is waiting on you.** Cards used to be visible to every member, so people without the right to decide mistook them for their own work. Now a card is visible only to the assignee, that discipline, the default queue and admins.

**The most sensitive documents need two approvers.** A top-tier (T3) document is approved only when **two different people** approve it, and the second approver comes from the discipline that owns that document type. The card shows how many of the required approvals are in, such as `1/2`. After the first approval, **the document is still in review**, and approving tells you it is not final yet. One person cannot fill both seats.

**Spec cards show why they got their tier.** Below the tier next to the version (T2, T3), one more line appears. It shows the total across the four axes (side effects · sensitivity · reversibility · blast radius, 0–2 points each), the score on each axis, and any signal that raised the tier by one step. For a new document, for example, it reads "Risk score 3 (side effects 2 · sensitivity 1 · reversibility 0 · blast radius 0) · the document's first approved version → tier +1". This shows why a document that would have passed without a human on its score alone came to you. If an agent hit the same failure three times and handed the document to a person, the line includes "the same failure reported three times" with a link to that report, so you can check what broke before you decide. Even with two signals, the tier goes up only one step. NERV computes this line itself, independently of anything the agent wrote. Requests made before this line was added show only the tier.

An approval card has three buttons: **Approve, Reject and Comment**. **A rejection requires a reason.** Without one, the requester cannot tell what to redo. A comment does not require a reason, but for the same reason it is better to give one.

**Question cards are different.** They have a single [Send answer] button, and `a` and `r` do nothing on them.

**A decision is sent five seconds after you press it.** When you approve, reject, comment or answer a question (including by picking an option), nothing is sent right away. Instead, the card shows what it is about to send and an **[Undo]** button. Click [Undo] or `z` within those five seconds, while the bar below shrinks, and nothing is sent; the original buttons come back. This is the only way to cancel a decision. **Once sent, a decision cannot be undone** (an approval has already changed the document's status, and the notifications have already gone out). While you wait, the comment box is read-only. What is sent is the text as it was when you pressed the button. If you move to another screen in the meantime, the decision is sent right away. If you try to close or reload the window, the browser asks you to confirm first. Bulk decisions skip the five-second wait, because you already confirmed them once in the confirmation list.

**After a decision is sent, correct it with a new decision.** There is no way to withdraw a sent decision. A decision changes the document's status and reaches the agent the moment you press it, so withdrawing it would not undo what already happened. Instead, each card on the **Decided** tab has a one-line note on how to correct it, with a link to its subject.

- **An approved spec** — leave a comment on the document, or, if it is already approved, create a new draft and get it approved again. An approved body never changes.
- **A rejected or commented spec** — the document went back to draft. When its author revises and resubmits it, the two-person approval count starts again from zero.
- **An approved plan** — once a plan passes, the gate does not apply again. To stop the work, stop that task's session or release the claim.
- **An approved critical downgrade** — a resolution can't be changed. If it needs another look, file a new finding.
- **An answer you sent** — the agent receives it right away. If your answer was wrong, click **[Open session]** on the delivery notice and send that session a corrected instruction.

**You usually cannot approve your own work.** Work counts as yours in any of three cases: you **requested** it, you **wrote** the draft, or **your session** wrote the draft. It stays yours even if someone else submits it for you. The rule exists to stop **people from approving their own work**. If only the requester were checked, anyone could get around the rule by asking someone else to submit. There are two exceptions:

- **admin** — a human admin signing off on their own judgment is a different case from what this rule prevents. Organization-level admins count too.
- **When nobody else can approve that card** — without this exception, **no approval could ever finish** in a one-person project. What counts is not the number of members but the number of **people who can decide**.

Both exceptions are recorded in the audit log, including which of the three cases made the work yours. The server decides whether the approve button is available and sends that with the card data, so the screen does not check it again. **When the button is locked, the card shows why.**

**These cards are collapsed at the end of the list.** Cards you cannot approve are grouped at the end of the pending list under **N waiting on someone else**. They include cards you requested or wrote, and T3 documents you already approved where only the second approval remains. The inbox badge, the Home greeting and the count at the top of the screen leave them out, so the count reaches 0 once you have handled everything you can. Expand the group to see why each card is locked. To withdraw a request, reject it there. While the group is collapsed, `j`/`k` skip those cards. The Today list on Home leaves them out too and shows only their count below the list. When a notification or link points to one of these cards, the group expands automatically.

**The requester can still reject and comment.** Only approval is blocked. Also, **leaving a comment returns the document to draft**, so it can be revised and resubmitted.

## Deciding several at once

Use the **checkbox** on the left of a pending card to select several cards and approve or reject them at once. Question cards and decided cards have no checkbox. A question needs an answer rather than an approval, and a decided card is already a record.

**What you select and what actually gets approved can differ.** That is why the selection bar shows two numbers, as in `3 selected · 2 can be approved`. Two kinds of item are left out of bulk approval:

- **Documents that need two approvers (T3)** — the point of this gate is that two different people review the document. Approving it in a batch reduces the review to a formality.
- **Gate waiver requests** — the purpose of this request is to make sure no waiver goes through unnoticed.

**Admins can decide both of these in bulk too.** In that case, the audit log records that the decision was made in bulk (marked `bulk`, with a batch ID). An exception can be allowed, but it is never hidden.

**Rejection applies to everything you selected**, because only approval is restricted. A bulk rejection still **requires a reason**, and that one reason is recorded on every item.

Pressing the button does not send anything right away. It first **lists what you are about to decide**. Because you are deciding without opening each body, this list is the scope of what you agreed to. For a bulk approval, the cards that will be skipped are listed below it with the reason for each (needs two approvers, a gate exemption request, or a document you cannot approve).

**Items that could not be processed stay in the list.** This happens when the body changed after you opened the card, when someone else already decided it, or when you do not have permission to decide it. Those cards stay selected with the reason shown on each card, and the toast reads `Decided 7, 2 left.` One blocked item does not stop the rest.

You can select up to **50** at a time. Once you have 50, the checkboxes on the other cards are locked and the selection bar says why. [Select visible (up to 50)] selects what is **on screen right now**, from the top, up to 50. Decide those first, then select the rest.

**The list does not load all at once.** Use **[Load more]** at the bottom to load the rest. The count at the top and the badge are counted by the server, regardless of how many items have loaded, and they count **only what you can act on** (the collapsed group above is not counted). The Pending tab shows **the requests that have waited longest first**, so anything you load next is always less urgent. You never have to scroll to the bottom to find something urgent.

Decided cards move to the **Decided** tab. This tab shows only **what you decided**; decisions made by other people are in their own lists. Cards are never deleted, so you can check later what was decided, when and how. A card stays there even after an approval makes the document final or a rejection sends it back to draft. Cards in this tab have no decision buttons or input boxes, and instead of the waiting time they show **what was decided and when**. If you left a note with the decision, it appears on the card too (a rejection always has one). When the Pending tab is empty, **your three most recent decisions** appear below it, so you can see right away where the item you just handled went.

## Keyboard

| Key       | Action                                             |
| --------- | -------------------------------------------------- |
| `j` · `k` | Move between cards                                 |
| `a`       | Approve                                            |
| `r`       | Reject                                             |
| `c`       | Jump to the comment box                            |
| `z`       | Undo before it sends (within five seconds)         |
| `x`       | Add this card to, or remove it from, the selection |
| `⇧X`      | Select visible (up to 50)                          |
| `⇧A`      | Approve the selection                              |
| `⇧R`      | Reject the selection                               |
| `Esc`     | Clear the selection                                |

Inside the comment or answer box, three more keys work.

| Key   | Action                                                      |
| ----- | ----------------------------------------------------------- |
| `⌘↵`  | Send the comment (or the answer, on a question)             |
| `⌘⇧↵` | Reject, using what you wrote as the reason                  |
| `Esc` | Leave the box and return to the card (shortcuts work again) |

On Windows and Linux, use `Ctrl` instead of `⌘`.

**Keys apply to the highlighted card**, the one with a bar on its left. The highlight moves with `j`/`k`, and also when you **click a card or move into an input box or button inside it.** **`a`, `r` and `x` do not act right away on a card that is off screen.** The first press scrolls the card into view and highlights it briefly. Press the key again once you have checked the card. This keeps a card you cannot see from being approved while you scroll and read another one.

Shortcuts do nothing while the cursor is in a text field, because typing `a` in a comment must never approve anything. The bulk keys are **uppercase** for the same reason: deciding twenty cards should take at least a `Shift` more than deciding one. While the confirmation list is open, `a`, `r` and `c` do nothing.

## Links that land on the card

**Opening a link from the Today list on Home, from a notification, or from the address an agent prints in its terminal takes you to that card in the inbox** (`/inbox?focus=…`). If the card is further down the list, the rest of the list is loaded until the card is found, and the card is highlighted briefly. **If the card is not in the list at all, the screen shows why.** For an approval that was already decided, it shows who decided it, how and when. Otherwise it shows "That request was handled already, or is not in your inbox."

## Notifications

**The badge counts only important notifications.** Notifications come in two grades, and the number on **[Notifications]** in the left column is the count of unread **Important** notifications. Without this split, the few truly urgent ones would be buried under hundreds of background events.

| Grade         | Notifications                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Important** | Approval requested · Agent question · Claim blocked by declared-scope overlap · Spec approved · Spec rejected · Declared-scope overlap warning · Session went stale · Task blocked · Basis changed; re-check instructions · Gate passed automatically |
| Other         | Comment added · Comment added to finding · Re-check requested for referenced document · Task ready · Invitation declined                                                                                                                              |

Sessions starting or ending and tasks being claimed or completed do not create notifications. You can see those in the activity feed. **Important does not mean "needs a decision."** Something that is already finished, such as Spec approved, is also Important. Items waiting for your decision are in the inbox.

Use **[All · Important · Unread]** at the top of the notification center to narrow the list. The filter stays even when nothing is unread, so after reading everything with a filter on, you can still switch back to All. The filter you choose is kept in the address (`?filter=`), so it stays after a reload and in a shared link. Hover over **Notifications** in the left column to see both counts, important and unread. This is why the badge can be empty while the notification center still shows many unread notifications.

The notification center is where you check **what you missed**. If the inbox is "what I have to do," notifications are "what I should know." The number of unread Important notifications appears on the **[Notifications]** badge and goes away as you read them.

**Each row shows what it is about**: the spec key and version, the task key, and the title. The same goes for approval requests and questions. An approval request shows what is being decided (the document, the plan's task, or the finding being downgraded), and a question shows **its title** and the task it is linked to. Clicking one of these takes you to **that card** in the inbox. Notifications only let you know; decisions are made in the inbox. When the same notification about the same subject arrives several times in a row, the rows are **combined into one with ×N**. Press ×N to expand them. Clicking the combined row marks the whole group **as read**.

**Opening a notification shows what changed.** A notification that a spec was approved or rejected opens the **difference from the previous version** instead of the document body, so you do not have to read the document from the top to find what changed. A first version has nothing to compare against, so it opens the body. A notification about a new comment opens the document with the **comments panel already open**.

**Handling a request in the inbox also marks its notifications as read.** Approval requests and questions are counted in both the inbox and notifications. Whoever handles a request, its notifications are marked read for everyone, even when another approver in the queue handles it first. You do not need to clear both badges separately. In the notification list, the row shows who handled it and how, as in **"(handled · Jimin, Approval)"**.

When there are unread notifications, a **[Mark all read]** button appears next to the count. If clearing them one at a time were the only option, people would soon stop looking at the badge. After you press it, it tells you how many notifications it marked as read. When nothing is unread, the button is hidden.

The list does not load all at once. Use **[Load more]** at the bottom to continue.
