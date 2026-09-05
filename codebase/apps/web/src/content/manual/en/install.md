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
- **A token belongs to one project.** It is issued for the project selected in the header and works only there — several projects mean several tokens. With no project selected, the issue button stays disabled.
- Scopes start with **`spec:read` and `task:claim` ticked, nothing else** (whichever your role lacks starts off — a locked box is never issued behind your back). There are no role presets — tick what you need.
- **`agent-session:launch` is not optional.** `nerv_bootstrap` requires that scope, so without it steps 4 and 5 below are blocked from the start. Those three are the real minimum. Above them, add `task:update` to run tasks, `spec:draft` to write drafts, `review:submit` to file reviews.
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

### `.nerv/env` — the slot for Codex (not needed today)

**If you only use Claude Code, the one place above is all you need.** Don't keep the values in two places — when they drift, which one won is answered by a different part of the system each time.

`.nerv/env` is a fallback for outside Claude Code (Codex). The plugin's scripts read it.

```bash
NERV_SERVER=https://nerv.example.com
NERV_PROJECT=clemvion
NERV_TOKEN=<the token from step 1>
```

> This file covers Codex only **halfway**. Notifications and hooks work because our own scripts read the file, but Codex's MCP authentication only accepts the _name_ of an environment variable, so this file never reaches it. Codex support is still in preparation.

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
/plugin marketplace add worker-ants/nerv
/plugin install nerv@nerv
```

To take what this server ships instead, change only the first line — `add https://<this server>/plugin/marketplace.json`. They are **two transports for the same marketplace**, so the install command is unchanged (don't register both at once).

Then **restart**. You should see `nerv` v0.2.6 listed as active under `/plugin`.

The server builds the catalogue itself, so **there is nothing to edit after you install** — its own address is already in there. If your deployment uses an internal git marketplace instead, put that git URL in and install `nerv@nerv-internal`.

> If the install is refused with `Archive URLs must use https://…`, this server is **not on https, or is on an internal address**. Adding the marketplace succeeding and the install failing is the expected shape of that problem — ask an administrator to check the server's public URL setting.

**Two things have to be there already** — the hook forwarder uses `curl`, and the statusline and outbox use `jq`. Without them nothing errors; they simply **do nothing, quietly.**

> To pick up a new version, run `/plugin marketplace update`. You only get a new copy when an administrator bumps the plugin version — at the same version you keep the copy you already have.

Four things get installed.

| What                        | What it does                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Six skills                  | `/nerv:next` `/nerv:spec` `/nerv:impl` `/nerv:question` `/nerv:import` `/nerv:review` |
| Hooks                       | Stream what the agent does onto the sessions screen                                   |
| statusline                  | Puts your current claim, remaining lease and scope overlaps on the prompt line        |
| Subagent `nerv-spec-writer` | A narrow agent whose only job is drafting specs                                       |

**The `nerv_*` tools are not among those four** — the `.mcp.json` below has to be in place before you have them.

**The MCP server is separate.** Its address and token differ per project, so the plugin does not ship it — put a `.mcp.json` at your repository root. Without that file you have no `nerv_*` tools.

```json
{
  "mcpServers": {
    "nerv": {
      "type": "http",
      "url": "${NERV_SERVER:-https://nerv.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${NERV_TOKEN}",
        "X-NERV-Project": "${NERV_PROJECT}"
      }
    }
  }
}
```

You should see `nerv` as connected under `/mcp`.

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

Either way, it is only really connected once **your session card appears on the sessions screen**.

In Claude Code the card appears **before** `nerv_bootstrap` is called — the session-start hook registers it directly. So if you have the tools but no card, look at **the hook**: an empty token, a missing `curl`, or a server it could not reach. The forwarder fails silently, so nothing is printed.

## 5. Your first task

```text
/nerv:next
```

The skill calls `nerv_bootstrap` first, recommends the next task, and takes you through claiming it. In Codex you call the same sequence as tools — that sequence is written in the `AGENTS.md` you copied.

## When it does not work

| Symptom                                   | Usually this                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nerv` missing from `/mcp`                | You did not restart after installing                                                                                                                                 |
| Cannot reach the server                   | A typo in `url`, or you are off the internal network — check the address with your administrator                                                                     |
| `NERV_UNAUTHENTICATED`                    | `NERV_TOKEN` is empty or was revoked. Issue a new one under Settings → Tokens                                                                                        |
| `NERV_FORBIDDEN`, missing scope           | The token's scopes are too narrow, or the role it was issued under cannot do that                                                                                    |
| Tools work but the project is not visible | **That token was issued for a different project.** The project is bound into the token and no header changes it — issue a new token in the project you want          |
| `project_mismatch`                        | `X-NERV-Project` and the token's project disagree. The error prints both values — correct whichever is wrong                                                         |
| No session card appears                   | The hook could not reach the server — check `NERV_TOKEN`, `NERV_SERVER` and `curl`. Hooks fail silently                                                              |
| Requesting review just fails              | That is an A3 tool — a person has to press it on the web (see [Inbox](/help/inbox))                                                                                  |
| `NERV_RATE_LIMIT`                         | Too frequent — 300 requests per minute per token, 120 for hooks per session. Wait the `retry_after_s` from the response. Do not work around it with parallel retries |
| The session goes `stale`                  | Heartbeats stopped. After 30 minutes the claim is reclaimed (see [Sessions](/help/sessions))                                                                         |
