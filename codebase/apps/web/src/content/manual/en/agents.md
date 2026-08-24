Connect an agent and Claude Code or Codex will read your specs, claim tasks, and report live on what it is doing. Three things get connected: **MCP tools, hooks and skills**.

## What gets connected

- **MCP tools** — the channel an agent reads and writes NERV through. The server is named `nerv` and the tools are `nerv_*`.
- **Hooks** — they stream what the agent is doing onto the sessions screen. Where hooks are unavailable the agent posts the events itself.
- **Skills** — procedures you invoke, like `/nerv:next`. They carry "what to do in what order".

Permissions come from the **token, not the skill.** A skill is convenience and resolution; it cannot get around a server gate.

## Issuing a token

Issue tokens under **Settings → Tokens**.

- The token value is shown **once, right after issuing**. Copy it there and then.
- Scopes are written `resource:action`: `spec:read` · `spec:draft` · `spec:meta` · `task:claim` · `task:update` · `review:submit` · `review:resolve` · `agent-session:launch` · `import:write`.
- **`spec:approve` and `approval:decide` cannot be granted to a token.** They are not a setting you switch off — they do not exist on the issuing path at all. Approval is something a person does.
- A token can never be broader than the role. The role at issue time is the ceiling.
- The list records last use and last host. If you see a host you do not recognise, revoke it right there.

## Skills

| Skill            | What it does                                       |
| ---------------- | -------------------------------------------------- |
| `/nerv:next`     | Recommend and claim the next task                  |
| `/nerv:spec`     | Write a spec draft or change request               |
| `/nerv:impl`     | The implementation procedure for a claimed task    |
| `/nerv:question` | Raise a question and wait for the answer           |
| `/nerv:import`   | Bring an existing repository's documents into NERV |
| `/nerv:review`   | Submit reviews and dispose of findings             |

## Tool tiers

Every tool carries a risk tier.

- **A1** — reads. Called without approval.
- **A2** — writes, within a reversible range.
- **A3** — **requires human approval.** Requesting review (`nerv_spec_submit_review`) and lowering a `critical` live here. A3 tools appear on no skill's pre-approved list.

## Importing documents

Use the CLI to bring an existing repository's documents in as specs and tasks.

```
nerv import <spec|plan|review|docs> --root <path> --project <slug> [--apply]
```

Without `--apply` this is a **dry run**: it writes nothing and produces a report. The report states how many items were read, how many converted, and **what was skipped and why**, line by line. A person reads that report and then adds `--apply`.

Re-running the same command is safe — what is already in is not created again, and only links that were empty get filled.
