A session is **one agent, running now**. The session monitor answers "what is going on".

## Reading the monitor

The list is on the left; the **activity rail** for the selected session is on the right. Pick a row and its activity streams right there — a monitor that makes you navigate elsewhere to see why something stalled is not a monitor. On a narrow screen the rail folds away; open **Details** on the card to see the activity there — **the detail screen draws the same thing as the rail** (what it did, the activity, run collapsing, raw payloads, [Load earlier activity]). Moving to a narrow screen does not cost you anything you could see.

Each session carries whose machine it is on, which agent is running (`claude-code` · `codex` · `web` · `other`), and which task it has claimed. `other` is where a session that did not name its kind lands.

The card carries four more things — the **remaining lease** (it changes colour under two minutes, meaning the work is about to be reclaimed), when the last heartbeat was, the `+N −M` this session has changed, and the scope it declared (hover to unfold it). The lease runs 30 minutes, on the **same clock** as a task claim's lease.

## Statuses

| Status           | Meaning                                    |
| ---------------- | ------------------------------------------ |
| `pending`        | Getting ready to start                     |
| `active`         | Running                                    |
| `awaiting_input` | **Waiting on a person** — a question is up |
| `complete`       | Finished                                   |
| `error`          | Ended in failure                           |
| `stale`          | No word for over 30 minutes                |

`stale` does not mean "failed", it means **"unknown"**. The machine may have slept, the network may have dropped, the process may have died — the screen cannot tell which, so it says only what it knows.

The consequence is certain, though — **when a session goes `stale`, the task it held is reclaimed and returns to `ready`.** The card says so.

## Activity

Opening a session shows the rail in **two layers**. Above is **what it did** (what is in progress, and is it stuck); below is the **tool log**. That order exists because the first question here is not the name of a tool.

**The tool log is not everything.** What the default hooks stream is the four that change files or run commands — `Write`, `Edit`, `MultiEdit`, `Bash`. Reads, searches and `nerv_*` calls leave no line. Read it as: what was changed is here, what was looked at is not.

Five kinds flow through it: `thought` · `action` (a tool ran) · `elicitation` (asking a person) · `response` · `error`. Hooks in the agent send this stream — where hooks are unavailable, the agent posts the events itself.

Two things make it readable.

- **Runs of the same tool collapse** (`×12`). A different tool in between means a different phase, so those are not merged.
- **Failures never collapse.** Hidden inside a group, the marker made to stand out loses its point.

The list arrives most recent first, one page at a time. When there is more before it, **[Load earlier activity]** sits at the top of the list, and pressing it **prepends** the older entries. Keep pressing and you can walk a long session all the way back to its start.

Expanding a line shows the **raw payload** (tool input and response). Raw payloads are visible **only to the session's owner and to admins** — secrets are masked at ingest, but masking is never perfect, so the audience is narrowed too.

Everyone else sees the title, the outcome, the tool name and the **body**. The raw payload is the only thing withheld — which means the instructions and stop reasons below are **visible to every project member.**

The **summary strip** at the top is both a count and a filter — press a number and only sessions in that state remain. **Six states hold their place**: a state with nothing in it still shows, dimmed, as `0`, and a `0` cannot be pressed because there is nothing to show (in a project with no sessions at all, a single line says so instead of six zeros). Drawing only what exists would leave you unable to tell "no errors" from "no such state", and the columns would move around from one visit to the next.

## Instructions and stopping

Under **Intervene** on the card are two buttons — [Send instruction] and [Stop]. **Both are for the session's owner and for admins only.** On someone else's session they are **disabled from the start**, with the reason spelled out beside them — so you never write out a stop reason and only then get refused. An agent token cannot do either — this is a person's move.

**Send instruction** tells a running agent to change direction. It does not interrupt immediately — it rides along on the agent's next **heartbeat**. The same instruction is never delivered twice.

**There is one condition on delivery.** Only a session **holding a task** sends heartbeats. So a session with no claim — writing specs, already finished with its task, or `stale` — **never receives the instruction.** The screen opens the input box for those sessions anyway, so if nothing happens after you send, first check whether that session is holding a task.

The heartbeat interval is not a timer either. The agent approximates it at tool calls and work boundaries, so while one long piece of work runs it arrives later than that. **"Within a minute" is the best case, not the worst.**

**Stop** does not deliver an instruction — it **reclaims the work now**. The most common reason to press it is that the session is already dead and cannot heartbeat, and waiting for delivery in that case would do nothing at all.

Stopping is not one press: a confirmation appears and **a reason is required**. Leave it empty and the button stays disabled. Give a reason, confirm, and the claim is released — the task returns to `ready`.

## Questions

An agent raises a question wherever it cannot decide. There are two urgencies.

- `blocking` — it will not proceed until answered. The session goes to `awaiting_input`.
- `normal` — it keeps going while it waits.

Questions arrive **as cards in the inbox** (see [Inbox and notifications](/help/inbox)). Write an answer and that session picks up where it left off.
