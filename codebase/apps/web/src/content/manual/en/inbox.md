The inbox collects **only what is waiting on your decision**. Count background activity too and the badge is soon ignored, and an ignored badge is no badge at all.

## Three kinds of card

| Card              | What it asks                                        |
| ----------------- | --------------------------------------------------- |
| **Spec approval** | May this version become the baseline                |
| **Plan approval** | May work proceed along this plan                    |
| **Question**      | Something an agent could not decide — please answer |

Lowering a `critical` review finding also arrives here as a card (see [Reviews](/help/reviews)).

## Question cards

When an agent hits something it must not decide on its own, it **stops** and asks. Those cards carry three more things.

- **Options** — the agent writes 2–4 answers that can be acted on as they stand. Pressing a button sends **exactly that value**, which is more precise than retyping it as a sentence. Add anything else in the answer box.
- **Source** — which spec, task, or finding the question came from, printed as a key you can click through to the original. You never have to judge from the summary alone.
- **Reason** — why a human is being called (product decision · spec gap · infrastructure · E2E failed 3× · sensitive change). It is the first sorting of what to look at.

Answering **wakes the session immediately.** Until then the agent is stopped.

## Deciding

Every card offers three things: **approve, reject, comment**. Rejections and comments take a reason — without one the requester cannot tell what to do next.

**You cannot approve your own request.** On such a card the approve button does not open.

Decided cards move to the **Decided** tab. Nothing is deleted, so what was decided, when and how stays readable later.

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
