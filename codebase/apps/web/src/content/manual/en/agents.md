Once you connect an agent, Claude Code or Codex can read your specs, claim tasks, and report what it is doing in real time. The connection has five parts: **MCP tools, hooks, skills, the statusline, and a subagent**.

This chapter explains **how these parts work together**. For the steps to connect an agent, see [Installing the plugin](/help/install).

## What gets connected

- **MCP tools** — agents use these to read from and write to NERV. The server is named `nerv`, and the tools are named `nerv_*`.
- **Hooks** — report what the agent is doing to the Sessions screen. Where hooks aren't available, the agent sends these events itself.
- **Skills** — procedures you invoke, such as `/nerv:next`. Each one defines what to do and in what order.
- **The statusline** — shows your current claim, the time left on its lease, and declared-scope overlaps on the prompt line.
- **A subagent** — `nerv-spec-writer`, a dedicated agent that only drafts specs.

**The token, not the skill, decides what an agent is allowed to do.** A skill makes a procedure easier to follow and spells out the details, but it cannot bypass a server gate.

## Tokens and scopes

What an agent can do depends on **its token**. Issuing one is step 1 of [Installing the plugin](/help/install).

- The token value is shown **only once, right after it is issued**. Copy it right away.
- The **My tokens** list under Settings → Agent tokens shows your tokens from **all organizations**. If you belong to more than one organization, the Project column shows "organization / project", so you can tell which organization each token belongs to.
- Scopes are written as `resource:action`. There are **ten**: `spec:read` · `spec:draft` · `spec:meta` · `spec:evidence` · `task:claim` · `task:update` · `review:submit` · `review:resolve` · `agent-session:launch` · `import:write`.
- **`spec:evidence` is for CI.** It can only attach PR and test evidence to requirements. It cannot touch drafts or tasks. A token for a build pipeline needs only this scope.
- **A token cannot change a project's settings, archive it, or restore it.** This applies even with the admin role. Lowering a gate policy is as serious as bypassing a gate, so a person does it directly on the web.
- **`spec:approve` and `approval:decide` cannot be granted to a token.** On the token issuing screen, both are **visible but locked**. If they were removed from the list, nothing on the screen would explain why a token can't approve. Showing them without letting you select them makes the rule clear at a glance. Approval is always done by a person.
- **A token also cannot answer questions, bypass a gate, or read the inbox.** The admin role is no exception. If an agent could answer its own questions, there would be no human gate at all. A person answers questions in the Inbox on the web.
- A token can never have broader scopes than your role allows. Your role at the time the token is issued sets the upper limit.
- The list records when each token was last used and from which host. If you see a host you don't recognize, revoke that token right away.

## Skills

| Skill            | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `/nerv:next`     | Recommend and claim the next task                      |
| `/nerv:spec`     | Write a spec draft or a change request                 |
| `/nerv:impl`     | Follow the implementation procedure for a claimed task |
| `/nerv:question` | Ask a question and wait for the answer                 |
| `/nerv:review`   | Submit reviews and resolve findings                    |

## Tool tiers

Every tool has a risk tier.

- **A1** — reads. The agent calls these without approval.
- **A2** — writes. Only reversible changes belong in this tier.
- **A3** — **requires human approval.** Requesting review (`nerv_spec_submit_review`) and downgrading a `critical` finding are in this tier. No skill lists an A3 tool among the tools it may call without approval. **The decision is delivered to the requesting session on its next heartbeat.** This applies to approvals, rejections, and comments alike, so the session knows what to do next.

## Importing documents

Use the CLI to import an existing repository's documents as specs and tasks.

```
nerv import <spec|plan|review|docs|rebuild-map> --root <path> --project <slug> [--apply]
```

There are five modes. `spec`, `plan`, `review`, and `docs` import documents, and `rebuild-map` rebuilds the mapping table for items that were already imported.

**Always specify a profile.** If you omit both `--profile` and `--profile-file`, the CLI silently uses a default profile. Your documents are then read by another repository's rules, and it is hard to notice when the results are wrong.

To use `--apply`, you must specify a server and a token (`--server` and `--token`, or `NERV_SERVER` and `NERV_TOKEN`). Without them, the command is refused.

Without `--apply`, the command runs as a **dry run**: it writes nothing and only prints a report. The report lists how many items were read and how many were converted, and it shows **what was skipped and why**, line by line. Check the report first, then run the command again with `--apply`.

Running the same command again is safe. Items that were already imported are not created again, and only empty links are filled in.
