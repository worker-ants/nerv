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

Five kinds of entry flow through the rail: `thought` (reasoning), `action` (a tool run), `elicitation` (asking a person), `response`, and `error`. The agent's hooks send this stream; where hooks are unavailable the agent posts the events itself.

## Messages and stopping

**A message** tells a running agent to change direction. It does not interrupt immediately — the agent meets the server every 60 seconds (the heartbeat) and picks it up there. So the message appears on the rail right away, but the agent's response lags by up to a minute. The same message is never delivered twice.

**Stop** does not deliver an instruction — it **reclaims the work now**. The most common reason to press it is that the session is already dead and cannot heartbeat, and waiting for delivery in that case would do nothing at all. Stopping releases the claim and the task returns to `ready`.

## Questions

An agent raises a question wherever it cannot decide. There are two urgencies.

- `blocking` — it will not proceed until answered. The session goes to `awaiting_input`.
- `normal` — it keeps going while it waits.

Questions arrive **as cards in the inbox** (see [Inbox and notifications](/help/inbox)). Write an answer and that session picks up where it left off.
