This is how you connect Claude Code or Codex to NERV. When you are done, an agent can read your specs and claim tasks, and what it is doing shows up on the sessions screen.

**Five steps**, and the last section tells you where it went wrong if it did. For why the pieces fit together the way they do, see [Agents](/help/agents).

## Before you start

You need to know three things.

| What                    | Where to find it                           | Example                    |
| ----------------------- | ------------------------------------------ | -------------------------- |
| The NERV server address | Ask your administrator                     | `https://nerv.example.com` |
| The project slug        | The segment after `/p/` in the address bar | `clemvion`                 |
| Your role               | Settings → Members                         | `developer`                |

The role matters: **a token can never be broader than the role.** As a `viewer` you cannot issue a token that claims tasks.

## 1. Issue a token

**Settings → Tokens → Issue.** Name it after the machine that will use it (something like `mac-02/claude-code`).

- The token value is shown **once, right after issuing**. Close the dialog and it is gone — you would have to issue another.
- Scopes start with **`spec:read` and `task:claim` ticked, nothing else** (whichever your role lacks starts off — a locked box is never issued behind your back). There are no role presets — tick what you need. To run tasks through the plugin add `task:update` and `agent-session:launch`; to write drafts add `spec:draft`; to file reviews add `review:submit`.
- **A token never reaches wider than your role.** Scopes your role does not hold appear **dimmed and locked**. `review:resolve`, for instance, belongs to admin, planner and qa, so it is locked for a `developer`. They stay visible for the same reason the human-only scopes do: why you cannot grant it belongs on the screen.
- If your role widens later, **the tokens you already issued follow immediately.** No need to reissue.
- `spec:approve` and `approval:decide` are locked checkboxes — approval is something a person does, so it cannot ride on a token.

## 2. Environment variables

**These values belong to a project, not to a machine.** Exported in your shell profile they are machine-wide, so the machine can only serve one project — switch projects and you edit the profile and restart every session. Put them **inside the working repository** instead.

### Default — the repository's `.claude/settings.local.json`

```jsonc
{
  "env": {
    "NERV_SERVER": "https://nerv.example.com",
    "NERV_PROJECT": "clemvion",
    "NERV_TOKEN": "<the token from step 1>",
  },
}
```

This file is **git-ignored by default**, so the token is not committed. Every repository can carry its own values and your shell profile stays untouched.

### One file that also covers Codex and the CLI — `.nerv/env`

To use the same values outside Claude Code (Codex, the `nerv` CLI), put them in `.nerv/env` in the repository. The plugin's scripts read it.

```bash
NERV_SERVER=https://nerv.example.com
NERV_PROJECT=clemvion
NERV_TOKEN=<the token from step 1>
```

**Values already set are never overwritten** — a managed machine's settings, or anything already in your shell, always wins. Only names starting with `NERV_` are read.

### If the machine only ever serves one project

The shell profile still works. It is the weakest place, so either of the above overrides it.

```bash
export NERV_TOKEN="<the token from step 1>"
export NERV_PROJECT="clemvion"
```

`NERV_HOSTNAME` is what the sessions screen shows as "whose machine this is". **Set it.** The hooks that post straight to the server send this variable verbatim, so leaving it empty leaves sessions in the list with no machine name. The moment you run on a second machine, you can no longer tell which session is where.

```bash
export NERV_HOSTNAME="$(hostname -s)"
```

The value is **for display only**. A header can say anything, so it never enters a permission decision.

**Do not commit the token.** While you are there, add `.nerv/` to the working repository's `.gitignore` — the environment file, the plugin's cache and the offline queue all live under it.

## 3-A. Install the plugin in Claude Code

Two lines inside Claude Code.

```text
/plugin marketplace add <your internal marketplace git URL>
/plugin install nerv@nerv-internal
```

Then **restart**. You should see `nerv` v0.1.0 listed as active under `/plugin`.

Four things get installed.

| What              | What it does                                                                          |
| ----------------- | ------------------------------------------------------------------------------------- |
| MCP server `nerv` | The `nerv_*` tools — how an agent reads and writes NERV                               |
| Six skills        | `/nerv:next` `/nerv:spec` `/nerv:impl` `/nerv:question` `/nerv:import` `/nerv:review` |
| Hooks             | Stream what the agent does onto the sessions screen                                   |
| statusline        | Puts your current claim, remaining lease and scope overlaps on the prompt line        |

**On a managed company machine, skip this step.** Managed settings have already registered the marketplace and enabled the plugin, and `NERV_SERVER` and `NERV_PROJECT` come from there too — you only need steps 1, 2, 4 and 5.

## 3-B. Connect Codex

Codex has no plugin format. Instead you **put two files in the repository you work in.** The plugin package ships the drafts for them under `codex/`.

```bash
mkdir -p <your repo>/.codex
cp <plugin>/codex/config.toml <your repo>/.codex/config.toml
cp <plugin>/codex/AGENTS.md   <your repo>/AGENTS.md
```

If you already have an `AGENTS.md`, do not overwrite it — copy across **only the "single source of truth" and "at the start of every session" sections**.

In the copied `.codex/config.toml`, change three things to your own values: `url`, `X-NERV-Project`, and `[otel] environment` if you use it.

```toml
[mcp_servers.nerv]
url = "https://nerv.example.com/mcp"
bearer_token_env_var = "NERV_TOKEN"
http_headers = { "X-NERV-Project" = "clemvion" }
startup_timeout_sec = 20

# The human approval lane — A3 tools never run unapproved
approval_policy = "on-request"
sandbox_mode = "workspace-write"
```

**The token does not go in `config.toml`.** As `bearer_token_env_var` says, it is read from the `NERV_TOKEN` environment variable, and that value comes from wherever you put it in step 2 — for Codex it has to be `.nerv/env` or the shell, since Codex does not read `.claude/settings.local.json`.

Claude Code does not read `AGENTS.md` on its own yet, so if both tools share the repository, put a single line in `CLAUDE.md`.

```markdown
@AGENTS.md
```

**What works in Codex, and what does not.**

- **All the tools work.** A Codex session runs `bootstrap → next → claim → heartbeat → release` end to end with tools alone — because no core capability has a non-tool path.
- Skill files (`SKILL.md`) are reused as they are. The format is open, so it is literally the same file.
- **There is no hook telemetry.** Codex sessions therefore appear at lower resolution on the sessions screen — you see the milestones the agent posts itself, not every action.
- A repository's `.codex/config.toml` is only read in **trusted projects**. You have to approve it once, the first time.

## 4. Check the connection

- **Claude Code**: run it inside the project repository and type `/mcp`. The `nerv` server should be connected and the `nerv_*` tools listed.
- **Codex**: start a session and call `nerv_bootstrap`. The response carries a `session_id` and the gate policy.

Either way, it is only really connected once **your session card appears on the sessions screen**. If you see the tools but no session, `nerv_bootstrap` has not been called yet.

## 5. Your first task

```text
/nerv:next
```

The skill calls `nerv_bootstrap` first, recommends the next task, and takes you through claiming it. In Codex you call the same sequence as tools — that sequence is written in the `AGENTS.md` you copied.

## When it does not work

| Symptom                                   | Usually this                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `nerv` missing from `/mcp`                | You did not restart after installing                                                             |
| Cannot reach the server                   | A typo in `url`, or you are off the internal network — check the address with your administrator |
| `NERV_UNAUTHENTICATED`                    | `NERV_TOKEN` is empty or was revoked. Issue a new one under Settings → Tokens                    |
| `NERV_FORBIDDEN`, missing scope           | The token's scopes are too narrow, or the role it was issued under cannot do that                |
| Tools work but the project is not visible | `X-NERV-Project` (or `NERV_PROJECT`) is wrong, or you are not a member of that project           |
| Requesting review just fails              | That is an A3 tool — a person has to press it on the web (see [Inbox](/help/inbox))              |
| `NERV_RATE_LIMIT`                         | Too frequent — 300 requests per minute per token, 120 for hooks per session. Wait the `retry_after_s` from the response. Do not work around it with parallel retries |
| The session goes `stale`                  | Heartbeats stopped. After 30 minutes the claim is reclaimed (see [Sessions](/help/sessions))     |
