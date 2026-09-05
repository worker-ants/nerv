The inbox collects **only what is waiting on your decision**. Count background activity too and the badge is soon ignored, and an ignored badge is no badge at all.

## Kinds of card

| Card              | What it asks                                        |
| ----------------- | --------------------------------------------------- |
| **Spec approval** | May this version become the baseline                |
| **Question**      | Something an agent could not decide — please answer |

Lowering a `critical` review finding also arrives here as a card (see [Reviews](/help/reviews)).

**A gate bypass** is recorded here too. It is not a card that asks anything, though — it is the record of something already done, so it lands straight in the Decided tab rather than the waiting one.

## Question cards

When an agent hits something it must not decide on its own, it **stops** and asks. Those cards carry three more things.

- **Options** — the agent writes 2–4 answers that can be acted on as they stand. Pressing a button sends **exactly that value**, which is more precise than retyping it as a sentence. Add anything else in the answer box.
- **Source** — which spec, task, or finding the question came from, printed as a key you can click through to the original. You never have to judge from the summary alone.
- **Reason** — why a human is being called (product decision · spec gap · infrastructure · E2E failed 3× · sensitive change). It is the first sorting of what to look at.

Answering **wakes the session immediately.**

**Not every question stops an agent.** There are two urgencies (`blocking` and `normal`); only `blocking` halts the session, while `normal` keeps going while it waits. The card does not show which one it is, so to see who is actually standing still, look for `awaiting_input` on the **sessions** screen.

## Deciding

**Only admins and planners can decide.** The card is visible to every project member, but approving and rejecting belong to those two — the server refuses anyone else. **Answering a question**, on the other hand, is open to anyone who can read.

An approval card offers three things: **approve, reject, comment**. **A rejection requires a reason** — without one the requester cannot tell what to do next. A comment does not force one, though for the same reason it is better to give one.

**A question card is different** — it has one button, [Send answer], and `a` and `r` do nothing there.

**You usually cannot approve your own request.** On such a card the approve button does not open. What this guards against is **an agent passing its own output**, so there are two exceptions.

- **admin** — a human admin signing their own judgement is a different act. An org-level admin counts too.
- **A project with fewer than two members** — without this path, **no approval would ever finish** in a solo project.

Both exceptions are written to the audit trail. Whether the button opens is decided by the server and carried on the card, so the screen does not judge it separately.

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

The notification centre is for **what you missed**. If the inbox is "what I must do", notifications are "what I should know". The unread count sits on the header badge and clears as you read.

When there are unread ones, a **[Mark all read]** sits beside the count — if clearing them one at a time is the only way, the badge soon becomes a badge nobody reads. It tells you how many it marked. With nothing unread the button is not shown.

The list does not arrive all at once — **[Load more]** at the bottom continues it.
