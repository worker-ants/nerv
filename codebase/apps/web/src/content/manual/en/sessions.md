A session is **one agent, running now**. The session monitor answers "what is going on".

## Reading the monitor

The list is on the left; the **activity rail** for the selected session is on the right. Pick a row and its activity streams right there — a monitor that makes you navigate elsewhere to see why something stalled is not a monitor.

Each session carries whose machine it is on, which agent is running (`claude-code` · `codex` · `web`), and which task it has claimed.

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

## Activity

Opening a session shows the rail in **two layers**. Above is **what it did** (what is in progress, and is it stuck); below is the **tool log** (which tools ran, in what order). That order exists because the first question here is not the name of a tool.

Five kinds flow through it: `thought` · `action` (a tool ran) · `elicitation` (asking a person) · `response` · `error`. Hooks in the agent send this stream — where hooks are unavailable, the agent posts the events itself.

Two things make it readable.

- **Runs of the same tool collapse** (`×12`). A different tool in between means a different phase, so those are not merged.
- **Failures never collapse.** Hidden inside a group, the marker made to stand out loses its point.

Expanding a line shows the **raw payload** (tool input and response). Raw payloads are visible **only to the session's owner and to admins** — secrets are masked at ingest, but masking is never perfect, so the audience is narrowed too. Everyone else sees the title, the outcome and the tool name.

The **summary strip** at the top is both a count and a filter — press a number and only sessions in that state remain. **All six states always hold their place**: a state with nothing in it still shows, dimmed, as `0`, and a `0` cannot be pressed because there is nothing to show. Drawing only what exists would leave you unable to tell "no errors" from "no such state", and the columns would move around from one visit to the next.

## Messages and stopping

**A message** tells a running agent to change direction. It does not interrupt immediately — the agent meets the server every 60 seconds (the heartbeat) and picks it up there. So the message appears on the rail right away, but the agent's response lags by up to a minute. The same message is never delivered twice.

**Stop** does not deliver an instruction — it **reclaims the work now**. The most common reason to press it is that the session is already dead and cannot heartbeat, and waiting for delivery in that case would do nothing at all. Stopping releases the claim and the task returns to `ready`.

## Questions

An agent raises a question wherever it cannot decide. There are two urgencies.

- `blocking` — it will not proceed until answered. The session goes to `awaiting_input`.
- `normal` — it keeps going while it waits.

Questions arrive **as cards in the inbox** (see [Inbox and notifications](/help/inbox)). Write an answer and that session picks up where it left off.
