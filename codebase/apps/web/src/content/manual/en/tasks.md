A task is one piece of work split out of an approved spec. People and agents look at the same board.

## The board and its lanes

Lanes are task statuses.

| Status        | Meaning                        |
| ------------- | ------------------------------ |
| `backlog`     | Not up for work yet            |
| `ready`       | **Can be picked up right now** |
| `claimed`     | Someone has taken it           |
| `in_progress` | Being worked on                |
| `in_review`   | Waiting for review             |
| `done`        | Finished                       |
| `blocked`     | Stuck — with a stated reason   |

By default `backlog` is folded away; **Show backlog** brings it back. The summary strip at the top (`ready` · `in progress` · `mine` · `blocked`) is there so you can read the state without reading the whole board.

## The four parts of a brief

A task becomes `ready` only when four things are filled in.

1. **Goal** — what counts as achieving it
2. **Scope** — which specs and which files may be touched
3. **Done criteria** — what has to be shown for it to be finished
4. **Base spec version** — which approved version this work reads

If any of them is empty the task cannot be claimed. Agents are instructed not to guess the missing part but to **raise a question** — work started on a guess only reveals the guess was wrong at the end.

## Claims and leases

Taking a task is a **claim**. A claim carries a 30-minute lease, and the session sends a heartbeat every 60 seconds to keep it alive.

- If heartbeats stop, the lease expires and the task returns to `ready`. This is what stops a dead session from holding work forever.
- If two sessions touch the same scope, the second claim is refused as a **scope conflict**.
- A person can revoke a claim from the task detail.

## Done, and the archive window

Finished tasks stay on the board for **seven days** and then drop out of the list. **Show archived** brings the older ones back.

This is not a status — it is a **window computed from the completion time**. Archived tasks are not deleted, and their addresses still work.

## Requirement links

A task can point at the requirement it implemented. That link is what builds the "requirement → task" axis of coverage. Without links coverage reads as zero — but that zero means **"nobody asked"**, not "nothing was implemented".

## When the baseline goes stale

If the spec version a task is briefed against becomes `superseded`, the task card says so. There are two ways forward: **re-brief** it against the new version, or finish against the current baseline and carry the difference into another task. The screen asks you to choose; it does not choose for you.
