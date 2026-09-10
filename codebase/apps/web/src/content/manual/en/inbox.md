The inbox collects **only what is waiting on your decision**. Count background activity too and the badge is soon ignored, and an ignored badge is no badge at all.

## Kinds of card

| Card              | What it asks                                        |
| ----------------- | --------------------------------------------------- |
| **Spec approval** | May this version become the baseline                |
| **Plan approval** | May this large piece of work start now              |
| **Question**      | Something an agent could not decide — please answer |

**Plan approval** stands only in front of large work — four or more tasks from the same spec version, or a version graded **T3**. Claiming such a task is refused on the spot and this card is created; approve it and the next claim goes through. The point is to look at the design before the code is written, which is why the gate sits right before the start.

Lowering a `critical` review finding also arrives here as a card (see [Reviews](/help/reviews)).

**A gate bypass** is recorded here too. It is not a card that asks anything, though — it is the record of something already done, so it lands straight in the Decided tab rather than the waiting one.

## Question cards

When an agent hits something it must not decide on its own, it **stops** and asks. Those cards carry three more things.

- **Options** — the agent writes 2–4 answers that can be acted on as they stand. Pressing a button sends **exactly that value**, which is more precise than retyping it as a sentence. Add anything else in the answer box.
- **Source** — which spec, task, or finding the question came from, printed as a key you can click through to the original. You never have to judge from the summary alone.
- **Reason** — why a human is being called (product decision · spec gap · infrastructure · E2E failed 3× · sensitive change). It is the first sorting of what to look at.

Answering **wakes the session immediately.**

**Not every question stops an agent.** There are two urgencies (`blocking` and `normal`); only `blocking` halts the session, while `normal` keeps going while it waits. The card does not show which one it is, so to see who is actually standing still, look for `awaiting_input` on the **sessions** screen. **Review requests and `critical` downgrades raised by an agent park a session in the same way** — decide, and that session gets the result on its next heartbeat.

## Deciding

**The default queue is admins and planners.** On top of that, when a card names a **discipline** (the second approver on a T3 document — designer for `design`, qa for `feature`, developer for `convention` and `adr`), that discipline decides it too. **Answering a question**, by contrast, is open to anyone who can read.

**The inbox only shows what is waiting on you.** Cards used to be visible to every member, which made them read as your own work even without the right to decide — now they reach the assignee, that discipline, the default queue and admins.

**The most sensitive documents need two people.** A top-tier (T3) document is confirmed only when **two different people** approve it, and the second seat belongs to the discipline that owns that document type. The card shows how many of how many (`1/2`), and after the first approval **the document is still in review** — approving says so instead of pretending it is done. One person cannot fill both seats.

An approval card offers three things: **approve, reject, comment**. **A rejection requires a reason** — without one the requester cannot tell what to do next. A comment does not force one, though for the same reason it is better to give one.

**A question card is different** — it has one button, [Send answer], and `a` and `r` do nothing there.

**What is yours is usually not yours to approve.** A card is yours in any of three ways: you **requested** it, you **wrote** the draft, or **your session** wrote it. Having someone else submit it changes nothing: what this guards against is **passing your own work through yourself**, and looking only at the requester lets one favour walk around that. Two exceptions:

- **admin** — a human admin signing their own judgement is a different act. An org-level admin counts too.
- **When nobody else can approve that card** — without this path, **no approval would ever finish** in a solo project. What is counted is not members but **people who could decide**.

Both exceptions are written to the audit trail (including which of the three ways made it yours). Whether the button opens is decided by the server and carried on the card, so the screen does not judge it again — **and when it is locked, the card says why.**

**Reject and comment are open to the requester too.** Only approval is held back. And **leaving a comment returns the document to draft** — that is what makes it fixable and resubmittable.

Decided cards move to the **Decided** tab. Nothing is deleted, so what was decided, when and how stays readable later. Cards in that tab carry no decision buttons or input boxes; in place of the waiting time they say **what was decided, and when**.

## Keyboard

| Key       | Action                  |
| --------- | ----------------------- |
| `j` · `k` | Move between cards      |
| `a`       | Approve                 |
| `r`       | Reject                  |
| `c`       | Jump to the comment box |

The shortcuts do nothing while the cursor is in a text field — typing `a` in a comment must never approve anything.

## Notifications

**The badge counts only what needs a decision.** Notifications come in two grades — waiting on you (approval requests, questions, scope conflicts) and background activity (spec rechecks, tasks becoming ready). The header number counts the first kind only, and the notification centre can narrow to [Needs a decision]. Without that split, the few urgent ones are buried under hundreds of background events.

The notification center is for **what you missed**. If the inbox is "what I must do", notifications are "what I should know". The unread count sits on the header badge and clears as you read.

**Opening a notification lands on what changed.** A notification that a spec was approved or rejected takes you to the **difference from the previous version**, not the document body — you no longer read a document from the top to find what moved. A first version has nothing to compare against, so it opens the body. A notification that someone commented opens with the **comments panel already showing**.

When there are unread ones, a **[Mark all read]** sits beside the count — if clearing them one at a time is the only way, the badge soon becomes a badge nobody reads. It tells you how many it marked. With nothing unread the button is not shown.

The list does not arrive all at once — **[Load more]** at the bottom continues it.
