A task is one piece of work split out of an approved spec. People and agents look at the same board.

## The board and its lanes

Lanes are task statuses.

| Status        | Meaning                        |
| ------------- | ------------------------------ |
| `backlog`     | Not up for work yet            |
| `ready`       | **Can be picked up right now** |
| `claimed`     | Someone has taken it           |
| `in_progress` | Being worked on                |
| `in_review`   | Waiting for review (optional)  |
| `done`        | Finished                       |
| `blocked`     | Stuck — with a stated reason   |

`in_review` is an **optional** step. Use it on a shared board when you want "the work is out, nobody has checked it yet" to be visible. Going straight from `in_progress` to `done` is fine — what actually gates completion is the evidence and the spec impact, not the lane.

By default `backlog` is folded away; **Show backlog** brings it back. The summary strip at the top (`ready` · `in progress` · `mine` · `blocked`) is there so you can read the state without reading the whole board.

## The four parts of a brief

A task becomes `ready` only when four things are filled in.

1. **Goal** — what counts as done
2. **Output format** — what has to be handed back (a PR, a document, a patch)
3. **Tools and sources** — what to read, and what to do it with
4. **Boundaries** — what must not be touched

If any of them is empty the task cannot be claimed. **Large work takes one more step** — four or more tasks from the same spec version, or a version graded T3, need **plan approval** before they start (see [Inbox](/help/inbox)). **The base spec version is not one of the four** — when it is set the agent reads that version, and a task without one still reaches `ready`. Agents are instructed not to guess the missing part but to **raise a question** — work started on a guess only reveals the guess was wrong at the end.

## Claims and leases

Taking a task is a **claim**. A claim carries a 30-minute lease, and the session sends a heartbeat every 60 seconds to keep it alive.

- If heartbeats stop, the lease expires and the task returns to `ready`. This is what stops a dead session from holding work forever.
- Two sessions touching the same declared scope register as an **overlap** — but not always a refusal. There are three grades. **Block** happens only when two sessions declare the **same spec document**, and only then is the second claim refused. **Warn** covers documents joined up or down the spec tree, and two tasks from the same requirement; **info** is anything else that grazes. Neither one stops anyone. **Overlapping file paths alone do not block**: refusing every overlap would let one large module serialise the whole project.
- A claim is usually released by **whoever holds it** — the agent releases it when it finishes or gives up (`nerv_task_release`). There is no revoke button in the UI, so to stop work, **Stop** the session: the claim is released on the spot and the task returns to `ready`.
- The server allows more than the screen offers — **an admin can release someone else's claim**, and planners and admins can move someone else's task between lanes. Only the door is missing.

## Done, and the archive window

Finished tasks stay on the board for **seven days** and then drop out of the list. **Show archived** brings the older ones back.

This is not a status — it is a **window computed from the completion time**. Archived tasks are not deleted, and their addresses still work.

**`done` cannot be undone.** A request to move a finished task into another lane is refused — completion is a state closed over evidence and spec impact, and reopening it is a new decision. When work remains, **make a new task**.

## Requirement links

A task can point at the requirement it implemented. What that link moves is one number on the project screen — **empty promises**, the count of unimplemented requirements no task has taken on. Without links that number is not zero but at its **maximum**.

The implemented and verified bars are a different axis: they are counted from the requirement's own implementation status (see "Requirements and coverage" in the specs chapter).

## When the baseline goes stale

If the spec version a task is briefed against becomes `superseded`, the task card says so. That is as far as the marker goes — **there is no door in the screen for changing a task's base version afterwards.**

So there are two ways forward: finish against the current baseline and carry the difference into another task, or **make a new task** against the new version. The screen asks you to choose; it does not choose for you.
