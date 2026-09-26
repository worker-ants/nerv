The inbox collects **only what is waiting on your decision**. Count background activity too and the badge is soon ignored, and an ignored badge is no badge at all.

## Kinds of card

| Card              | What it asks                                        |
| ----------------- | --------------------------------------------------- |
| **Spec approval** | May this version become the baseline                |
| **Plan approval** | May this large piece of work start now              |
| **Question**      | Something an agent could not decide — please answer |

**Plan approval** stands only in front of large work — four or more tasks from the same spec version, or a version graded **T3**. Claiming such a task is refused on the spot and this card is created; approve it and the next claim goes through. The point is to look at the design before the code is written, which is why the gate sits right before the start.

Lowering a `critical` review finding also arrives here as a card (see [Reviews](/help/reviews)).

**A gate bypass** is recorded here too. It is not a card that asks anything, though — it is the record of something already done, so it lands straight in the Decided tab **of whoever made it**, rather than in the waiting one: a bypass goes through without asking, so the person who made it is the person who decided it.

### What a card tells you

An approval card carries two more lines under its header.

- **Request line** — who asked, the machine and agent kind if an agent session raised it, and **"A session is waiting on this"** when that session is stopped until you decide.
- **Target line** — what you are deciding. For a spec: **which version** it is, its risk grade (T0–T3), the author's **change summary**, and **[View changes ▸]**, which opens the difference from the previous version (a first version has no such link — there is nothing to compare against). For a plan approval: **which task** the plan is for. For a `critical` downgrade: **which finding** is being lowered. The key in the header takes you to that task or finding.

### Which organization and project it belongs to

The inbox gathers from **every organization and project you belong to**, so each card carries, on its right, the **name of the project** it belongs to. If you are in more than one organization, the organization's name comes first so it reads "organization / project", and anything outside the current organization (top of the left column) is shown in an **accent colour** — so you do not read another organization's approval as one of this organization's. Items with no project say "Whole organization". Home's to-do list and notifications use the same marking.

## Question cards

When an agent hits something it must not decide on its own, it **stops** and asks. Those cards carry three more things.

- **Options** — the agent writes 2–4 answers that can be acted on as they stand. Pressing a button sends **exactly that value**, which is more precise than retyping it as a sentence. Add anything else in the answer box.
- **Source** — which spec, task, or finding the question came from, printed as a key you can click through to the original. You never have to judge from the summary alone.
- **Reason** — why a human is being called (product decision · spec gap · infrastructure · E2E failed 3× · sensitive change). It is the first sorting of what to look at.

Answering **wakes the session immediately.**

**Not every question stops an agent.** There are two urgencies (`blocking` and `normal`); only `blocking` halts the session, while `normal` keeps going while it waits. A `blocking` question carries a **Blocking** mark in its header (the same mark as on Home's today list). **Review requests and `critical` downgrades raised by an agent park a session in the same way** — decide, and that session gets the result on its next heartbeat.

## Deciding

**The default queue is admins and planners.** On top of that, when a card names a **discipline** (the second approver on a T3 document — designer for `design`, qa for `feature`, developer for `convention` and `adr`), that discipline decides it too. **Answering a question**, by contrast, is open to anyone who can read.

**The inbox only shows what is waiting on you.** Cards used to be visible to every member, which made them read as your own work even without the right to decide — now they reach the assignee, that discipline, the default queue and admins.

**The most sensitive documents need two people.** A top-tier (T3) document is confirmed only when **two different people** approve it, and the second seat belongs to the discipline that owns that document type. The card shows how many of how many (`1/2`), and after the first approval **the document is still in review** — approving says so instead of pretending it is done. One person cannot fill both seats.

**Spec cards say why they got their tier.** Under the tier next to the version (T2, T3) there is one line: the total across the four axes (side effects · sensitivity · reversibility · blast radius, 0–2 points each), the score on each axis, and any signal that raised the tier by one step. A new document, for example, reads "Four-axis score 3 (side effects 2 · sensitivity 1 · reversibility 0 · blast radius 0) · the document's first approved version → tier +1" — which shows why a document whose score alone would have passed without anyone came to you. If an agent hit the same failure three times and handed it to a person, the line also says "the same failure reported three times" with a link to that report — look at what broke before you decide. Two signals still raise the tier by only one step. The line is what NERV decided, not the agent's explanation. Requests made before this line existed show only the tier.

An approval card offers three things: **approve, reject, comment**. **A rejection requires a reason** — without one the requester cannot tell what to do next. A comment does not force one, though for the same reason it is better to give one.

**A question card is different** — it has one button, [Send answer], and `a` and `r` do nothing there.

**A decision goes out five seconds after you press it.** When you approve, reject, comment or answer a question (options included), the card does not send it at once: it shows what it is about to send and an **[Undo]** button. Press [Undo] or `z` before the bar underneath runs out and nothing is sent — the buttons come back. That is the only way to take a decision back: **once sent, it cannot be undone** (an approval has already moved the document and the notifications have already gone out). While it waits the comment box is read-only — what goes out is what you had written when you pressed. Leave for another screen in the meantime and the decision goes out straight away; close or reload the window and the browser asks first. Bulk decisions do not wait five seconds — their confirmation list has already asked once.

**After sending, correct with a new decision.** There is no way to take a decision back — a decision moves the document and wakes the agent the moment you press it, so what already happened would stay either way. Instead, each card on the **Processed** tab carries a one-line way to correct it, with a link to its subject.

- **An approved spec** — leave a comment on the document, or once it is approved, make a new draft and get it approved again. An approved body never changes.
- **A rejected or commented spec** — the document went back to draft. Its author revises and resubmits it, and two-person approval counts again from zero.
- **An approved plan** — it does not come back once given. To stop the work, stop its session or release the claim.
- **An approved critical downgrade** — a resolution can't be changed. Raise a new finding if it needs another look.
- **An answer you sent** — the agent receives it right away. If you answered wrongly, press **[Open session]** on the delivered notice and send that session an instruction that sets it straight.

**What is yours is usually not yours to approve.** A card is yours in any of three ways: you **requested** it, you **wrote** the draft, or **your session** wrote it. Having someone else submit it changes nothing: what this guards against is **passing your own work through yourself**, and looking only at the requester lets one favour walk around that. Two exceptions:

- **admin** — a human admin signing their own judgement is a different act. An org-level admin counts too.
- **When nobody else can approve that card** — without this path, **no approval would ever finish** in a solo project. What is counted is not members but **people who could decide**.

Both exceptions are written to the audit trail (including which of the three ways made it yours). Whether the button opens is decided by the server and carried on the card, so the screen does not judge it again — **and when it is locked, the card says why.**

**Those cards sit folded at the end of the list.** Cards you cannot approve — ones you requested or wrote, or the second slot of a T3 you already approved — gather at the end of the waiting list in a **N waiting on someone else** group. The inbox badge, the home greeting and the count at the top do not count them — once you have handled everything you can, the number reaches 0. Unfold the group and each card still says why it is locked; to withdraw a request, reject it there. While the group is folded, `j`/`k` do not move onto those cards. Home's today list leaves them out too and only notes how many there are underneath. When a notification or link points at one of them, the group unfolds by itself.

**Reject and comment are open to the requester too.** Only approval is held back. And **leaving a comment returns the document to draft** — that is what makes it fixable and resubmittable.

## Deciding several at once

The checkbox on the left of a pending card lets you pick several and approve or reject them in one go. Question cards and decided cards have no checkbox — a question is answered rather than approved, and a decided card is a record.

**What you picked and what gets approved can differ.** That is why the selection bar shows both, as in `3 selected · 2 can be approved`. Two kinds are left out of bulk approval:

- **Documents that need two approvers (T3)** — the point of that gate is that two different people look; passing it in a list leaves only the name.
- **Gate waiver requests** — a waiver not happening quietly is itself the feature.

**Admins can decide both of those in bulk.** In exchange, decisions made in bulk are recorded as such (marked `bulk` with a batch id) in the audit trail — allowing an exception and hiding it are different things.

**Rejection applies to everything you picked**, because only approval is held back. A bulk rejection still **requires a reason**, and that one reason is recorded on every item.

Pressing the button does not send anything yet: it **lists what you are about to decide**. Since you are deciding without opening the bodies, that list is the scope of what you agreed to.

**Anything that did not go through stays in the list.** That happens when the body changed after you opened the card, when someone already decided it, or when it is not yours to approve — those cards stay selected with the reason shown in place, and the toast says `Decided 7, 2 left`. One blocked item does not stop the rest.

You can pick up to **50** at a time, and [Everything visible] picks only what is **on screen right now**.

**The list does not arrive all at once** — **[Load more]** at the bottom fetches the rest. The count at the top, and the badge, are counted by the server, not from what has arrived — and they count **only what you can act on** (the folded group above is left out). The waiting tab puts **what has waited longest on top**, so what you fetch next is always the less urgent end — you never scroll to the bottom to find something urgent.

Decided cards move to the **Decided** tab. That tab carries **what you decided** — decisions other people made are in their own lists. Nothing is deleted, so what was decided, when and how stays readable later, and the card stays put after an approval settles the document or a rejection sends it back to draft. Cards in that tab carry no decision buttons or input boxes; in place of the waiting time they say **what was decided, and when**. If a note was left with the decision — a rejection always carries one — that sentence sits on the card too. When the waiting tab is empty, **the three most recent decisions** sit under it, so you can see where what you just did went.

## Keyboard

| Key       | Action                                      |
| --------- | ------------------------------------------- |
| `j` · `k` | Move between cards                          |
| `a`       | Approve                                     |
| `r`       | Reject                                      |
| `c`       | Jump to the comment box                     |
| `z`       | Undo within five seconds, before it is sent |
| `x`       | Add this card to the selection              |
| `⇧X`      | Select everything visible                   |
| `⇧A`      | Approve the selection                       |
| `⇧R`      | Reject the selection                        |
| `Esc`     | Clear the selection                         |

Inside the comment or answer box there are three more.

| Key   | Action                                            |
| ----- | ------------------------------------------------- |
| `⌘↵`  | Send the comment (or the answer, on a question)   |
| `⌘⇧↵` | Reject, with what you wrote as the reason         |
| `Esc` | Leave the box for the card — shortcuts work again |

On Windows and Linux, use `Ctrl` instead of `⌘`.

**Keys land on the highlighted card** — the one with the bar on its left. Not only `j`/`k` move it: **clicking a card, or entering a box or button inside it,** makes that card the one. **`a`, `r` and `x` do not decide a card that is off screen** — the first press brings the card into view and highlights it briefly; press again once you have seen it. This stops a card you are not looking at from being approved while you scroll and read another.

The shortcuts do nothing while the cursor is in a text field — typing `a` in a comment must never approve anything. The bulk keys are **uppercase** for the same reason: the difference between one card and twenty should cost at least a `Shift`. While the confirmation list is open, `a`, `r` and `c` are inert.

## Links that land on the card

**Home's today list, notifications, and the address an agent prints in its terminal take you to that card in the inbox** (`/inbox?focus=…`). If it is further down the list it is loaded and found for you, and the card is highlighted briefly. **If it is not in the list at all, the screen says why** — an approval already decided shows who decided what and when; otherwise it says the request was handled already or is not in your inbox.

## Notifications

**The badge counts only important ones.** Notifications come in two grades, and the number on **[Notifications]** in the left column counts unread **Important** notifications only. Without that split, the few urgent ones are buried under hundreds of background events.

| Grade         | What arrives                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Important** | Approval requested · Agent question · Claim blocked by declared-scope overlap · Spec approved · Spec rejected · Declared-scope overlap warning · Session went stale · Task blocked · Re-brief needed · Gate passed without approval |
| Other         | Comment added · Finding commented · Recheck requested · Task ready · Invitation declined                                                                                                                                            |

Sessions starting or ending, and tasks being claimed or finished, do not create notifications — you see them in the activity feed. **Important is not "a decision"**: something already finished, like a spec being approved, is Important too. What waits on your decision is in the inbox.

Narrow the list with **[All · Important · Unread]** above it. The control stays even when nothing is unread, so after marking everything read while filtered you can still go back to All. Your choice is kept in the address (`?filter=`) — it survives a reload and a shared link. Hover over **Notifications** in the left column to see both numbers, important and unread — that is why the badge can be empty while the notification centre still shows many unread.

The notification center is for **what you missed**. If the inbox is "what I must do", notifications are "what I should know". The number of unread Important notifications sits on the **[Notifications]** badge and clears as you read.

**Each line says what it is about** — spec key and version, task key, and the title. That includes approval requests and questions: an approval request names what is being decided (the document, or the plan's task, or the finding to downgrade), and a question shows **its title** and the task it is attached to. Pressing it still takes you to **that card** in the inbox — the notification is a shadow; deciding happens in the inbox. When the same notification about the same subject arrives several times in a row, the lines **fold into one with ×N**. Press ×N to unfold; pressing the folded line marks the whole group **read together**.

**Opening a notification lands on what changed.** A notification that a spec was approved or rejected takes you to the **difference from the previous version**, not the document body — you no longer read a document from the top to find what moved. A first version has nothing to compare against, so it opens the body. A notification that someone commented opens with the **comments panel already showing**.

**Handling a request in the inbox also marks its notification read.** Approval requests and questions are counted in two places, the inbox and notifications; whoever handles one — even another approver in the queue, first — marks that request's notifications read for everyone. You do not have to clear both badges. In the notification list the row gains **"(handled · Jimin, Approval)"**, saying who closed it and how.

When there are unread ones, a **[Mark all read]** sits beside the count — if clearing them one at a time is the only way, the badge soon becomes a badge nobody reads. It tells you how many it marked. With nothing unread the button is not shown.

The list does not arrive all at once — **[Load more]** at the bottom continues it.
