Connect an agent and Claude Code or Codex will read your specs, claim tasks, and report live on what it is doing. Five things get connected: **MCP tools, hooks, skills, the statusline and a subagent**.

This chapter explains **how the pieces fit together**. The procedure for actually connecting one is in [Installing the plugin](/help/install).

## What gets connected

- **MCP tools** — the channel an agent reads and writes NERV through. The server is named `nerv` and the tools are `nerv_*`.
- **Hooks** — they stream what the agent is doing onto the sessions screen. Where hooks are unavailable the agent posts the events itself.
- **Skills** — procedures you invoke, like `/nerv:next`. They carry "what to do in what order".
- **The statusline** — puts your current claim, remaining lease and scope overlaps on the prompt line.
- **A subagent** — `nerv-spec-writer`, a narrow agent whose only job is drafting specs.

Permissions come from the **token, not the skill.** A skill is convenience and resolution; it cannot get around a server gate.

## Tokens and scopes

What an agent may do is decided by **the token** (issuing one is step 1 of [Installing the plugin](/help/install)).

- The token value is shown **once, right after issuing**. Copy it there and then.
- Scopes are written `resource:action`, and there are **ten**: `spec:read` · `spec:draft` · `spec:meta` · `spec:evidence` · `task:claim` · `task:update` · `review:submit` · `review:resolve` · `agent-session:launch` · `import:write`.
- **`spec:evidence` exists for CI.** It can only attach PR and test evidence to a requirement — a build pipeline's token needs nothing else. It cannot touch drafts or tasks.
- **Project settings, archive and restore cannot be done with a token**, not even with the admin role. Lowering a gate policy carries the same weight as bypassing a gate, so a person does it on the web.
- **`spec:approve` and `approval:decide` cannot be granted to a token.** They are **visible but locked** on the issuing screen. Dropping them from the list would leave the question "why can't a token approve?" unanswered anywhere on screen; something visible and unpickable teaches the rule. Approval is something a person does.
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
nerv import <spec|plan|review|docs|rebuild-map> --root <path> --project <slug> [--apply]
```

There are five modes — `spec`, `plan`, `review` and `docs` move things in; `rebuild-map` rebuilds the mapping table for what has already moved.

**Always name a profile.** With neither `--profile` nor `--profile-file`, the CLI quietly falls back to a default one — reading your documents by another repository's rules, so the result goes wrong quietly.

To use `--apply` you need a server and a token (`--server` and `--token`, or `NERV_SERVER` and `NERV_TOKEN`). Without them it is refused.

Without `--apply` this is a **dry run**: it writes nothing and produces a report. The report states how many items were read, how many converted, and **what was skipped and why**, line by line. A person reads that report and then adds `--apply`.

Re-running the same command is safe — what is already in is not created again, and only links that were empty get filled.
