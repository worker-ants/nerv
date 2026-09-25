This is how you connect Claude Code or Codex to NERV. When you are done, an agent can read your specs and claim tasks, and what it is doing shows up on the sessions screen.

**Five steps**, and the last section tells you where it went wrong if it did. For why the pieces fit together the way they do, see [Agents](/help/agents).

## Before you start

You need to know three things, and **this screen already knows all three** — they are the values on the card just above, and every command and file below is filled in with them. Copy them as they are.

| What                    | Where it comes from                       | This deployment |
| ----------------------- | ----------------------------------------- | --------------- |
| The NERV server address | `NERV_API_URL`, set by your administrator | `{{server}}`    |
| The project slug        | The current project (left column)         | `{{project}}`   |
| Your role               | Settings → Members                        | `{{role}}`      |

**It may not be the address in your address bar.** Where the screen and the API sit on different hosts, the address bar says `app.…` while agents connect to `api.…` — the value above is the one that matters.

The role matters: **a token can never be broader than the role.** As a `viewer` you cannot issue a token that claims tasks.

## 1. Issue a token

**Settings → Tokens → Issue.** Name it after the machine that will use it (something like `mac-02/claude-code`).

- The token value is shown **once, right after issuing**. Close the dialog and it is gone — you would have to issue another.
- **A token belongs to one project.** The first field of the form is where you **pick that project** (it defaults to the one you are looking at). The token works only there, so several projects mean several tokens. The project you pick also decides **which scope boxes are locked** — your role can differ per project. If you belong to no project the issue button stays disabled, and the screen says why.
- **You can set an expiry** — 30 days, 90 days, a year, or never. Never is the default. An expired token is refused from that moment, the same effect as revoking it, and the list shows the date.
- The card you get right after issuing **says what the token is** (project, scopes, expiry) and gives you **three connection steps** in order — ① the token (with a copy button) ② two lines that install the plugin (in Claude Code) ③ one `nerv-init` line to run in your working repository. ③ finds `nerv-init` in the install cache, so paste it as is; it writes the files of steps 2 and 3 in one go. **That line leaves the token in your shell history** — to avoid it, drop `--token` and its value, and the token is asked for with input hidden. The card turns into **"Connected — machine name" the first time the token is used**.
- The **first column** of the issued list is the project. Revoked and expired tokens are folded away; [Show revoked and expired] unfolds them. **Organization admins** (whose organization-wide role is admin) also get an **organization-wide table** below it: who holds which token on which project. **Cutting off someone else’s token with that table’s [Revoke] is also for organization admins only** — a project’s admin revokes only their own. Revoking cannot be undone, so it asks once more.
- Scopes start as **[Recommended]** — what an agent needs for the five skills (next · spec · impl · question · review): `spec:read` · `spec:draft` · `task:claim` · `task:update` · `review:submit` · `agent-session:launch`. Whatever your role lacks is left out when it is issued (a locked box is never issued behind your back). To give something else, switch to **[Choose myself]** and tick the boxes. Each scope carries **one line on what it allows** under its name.
- **Do not drop `agent-session:launch`.** `nerv_bootstrap` requires that scope, so without it steps 4 and 5 below are blocked from the start — the most common mistake when trimming scopes with [Choose myself].
- **A token never reaches wider than your role.** Scopes your role does not hold appear **dimmed and locked**. `review:resolve`, for instance, belongs to admin, planner and qa, so it is locked for a `developer`. They stay visible for the same reason the human-only scopes do: why you cannot grant it belongs on the screen.
- If your role widens later, **the tokens you already issued follow immediately.** No need to reissue.
- `spec:approve` and `approval:decide` are locked checkboxes — approval is something a person does, so it cannot ride on a token.

## 2. Environment variables

**This chapter is the by-hand route.** If you install the plugin first (3-A), the single command at the end of that chapter writes these files and the next chapter's `.mcp.json` **for you** — and never overwrites a value that is already there. Follow this chapter when you want to know what it writes, or prefer to write it yourself.

**These values belong to a project, not to a machine.** Exported in your shell profile they are machine-wide, so the machine can only serve one project — switch projects and you edit the profile and restart every session. Put them **inside the working repository** instead.

### Default — the repository's `.claude/settings.local.json`

```jsonc
{
  "env": {
    "NERV_SERVER": "{{server}}",
    "NERV_PROJECT": "{{project}}",
    "NERV_TOKEN": "<the token from step 1>",
  },
}
```

This file is **git-ignored by default**, so the token is not committed. Every repository can carry its own values and your shell profile stays untouched.

### `.nerv/env` — the slot for Codex (not needed today)

**If you only use Claude Code, the one place above is all you need.** Don't keep the values in two places — when they drift, which one won is answered by a different part of the system each time.

`.nerv/env` is a fallback for outside Claude Code (Codex). The plugin's scripts read it.

```bash
NERV_SERVER={{server}}
NERV_PROJECT={{project}}
NERV_TOKEN=<the token from step 1>
```

> This file covers Codex only **halfway**. Notifications and hooks work because our own scripts read the file, but Codex's MCP authentication only accepts the _name_ of an environment variable, so this file never reaches it. Codex support is still in preparation.

**Values already set are never overwritten** — a managed machine's settings, or anything already in your shell, always wins. Only names starting with `NERV_` are read.

### If the machine only ever serves one project

The shell profile still works. It is the weakest place, so either of the above overrides it.

```bash
export NERV_TOKEN="<the token from step 1>"
export NERV_PROJECT="{{project}}"
```

`NERV_HOSTNAME` is what the sessions screen shows as "whose machine this is". **Set it.** The hooks that post straight to the server send this variable verbatim, so leaving it empty leaves sessions in the list with no machine name. The moment you run on a second machine, you can no longer tell which session is where.

```bash
export NERV_HOSTNAME="$(hostname -s)"
```

The value is **for display only**. A header can say anything, so it never enters a permission decision.

**Do not commit the token.** While you are there, add `.nerv/` to the working repository's `.gitignore` — the environment file, the plugin's cache and the offline queue all live under it.

## 3-A. Install the plugin in Claude Code

Two lines inside Claude Code. **You take what this server ships.**

```text
/plugin marketplace add {{server}}/plugin/marketplace.json
/plugin install nerv@nerv
```

Then **restart**. You should see `nerv` v{{version}} listed as active under `/plugin`.

You take it from here because **the version then matches this server** — the server builds the catalogue itself, so what you get is always the build this server expects. On a network that cannot reach out, it is also the only way.

> **If the install fails from this address, take it from GitHub instead** — change only the first line to `add worker-ants/nerv`. The install command is unchanged and **the files you get are the same** (they are two transports for one marketplace — don't register both at once).
>
> The server path needs all three of **https, a public address, and a trusted CA**. A refusal reading `Archive URLs must use https://…` is one of the first two (the card above says so in advance); a certificate error is the third — **a certificate from an internal CA is invisible to the browser, so the card cannot know about it.**

If your deployment uses an internal git marketplace instead, put that git URL in and install `nerv@nerv-internal`.

**Two things have to be there already** — the hook forwarder uses `curl`, and the statusline and outbox use `jq`. Without them nothing errors; they simply **do nothing, quietly.**

> To pick up a new version, run `/plugin marketplace update`. You only get a new copy when an administrator bumps the plugin version — at the same version you keep the copy you already have.

Four things get installed.

| What                        | What it does                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Five skills                 | `/nerv:next` `/nerv:spec` `/nerv:impl` `/nerv:question` `/nerv:review`                  |
| Hooks                       | Stream what the agent does onto the sessions screen                                     |
| statusline                  | Puts your current claim, remaining lease and declared-scope overlaps on the prompt line |
| Subagent `nerv-spec-writer` | A narrow agent whose only job is drafting specs                                         |

**The `nerv_*` tools are not among those four** — your repository needs a `.mcp.json` before you have them. Its address and token differ per project, so the plugin does not ship that file.

**It ships the command that writes it instead.** Run this once in your working repository and three things go up together: `.mcp.json`, the environment variables in `.claude/settings.local.json`, and `.nerv/` in `.gitignore`. **The address and the project are already filled in with this deployment's own values**, so only the token is left — and it is asked for without echoing it to the screen.

```bash
cd <your repository>
"$(ls -d "$HOME"/.claude/plugins/cache/*/nerv/*/bin/nerv-init | sort -V | tail -1)" \
  --server {{server}} --project {{project}}
```

**It never overwrites a value that is already there.** If a token is on file it stays, and the command says so — change it by editing that file yourself. If a `.mcp.json` exists but has no `nerv` entry, the file is left untouched and the entry to add is printed for you.

In a repository where the setup is incomplete, the session start tells you what is missing. **It only tells you — it writes nothing**: setup is yours to start. In a repository with no sign of NERV at all it stays quiet.

Afterwards, **restart Claude Code** — a newly created `.mcp.json` is read then.

By hand, this is the content (read it together with chapter 2):

```json
{
  "mcpServers": {
    "nerv": {
      "type": "http",
      "url": "${NERV_SERVER:-{{server}}}/mcp",
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
url = "{{server}}/mcp"
bearer_token_env_var = "NERV_TOKEN"
http_headers = { "X-NERV-Project" = "{{project}}" }
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
| `nerv` missing from `/mcp`                | You did not restart after installing, or the repository has no `.mcp.json` — run the command in 3-A once                                                             |
| Cannot reach the server                   | A typo in `url`, or you are off the internal network — check it against the address on the card at the top of this chapter                                           |
| `NERV_UNAUTHENTICATED`                    | `NERV_TOKEN` is empty or was revoked. Issue a new one under Settings → Tokens                                                                                        |
| `NERV_FORBIDDEN`, missing scope           | The token's scopes are too narrow, or the role it was issued under cannot do that                                                                                    |
| Tools work but the project is not visible | **That token was issued for a different project.** The project is bound into the token and no header changes it — issue a new token in the project you want          |
| `project_mismatch`                        | `X-NERV-Project` and the token's project disagree. The error prints both values — correct whichever is wrong                                                         |
| No session card appears                   | The hook could not reach the server — check `NERV_TOKEN`, `NERV_SERVER` and `curl`. Hooks fail silently                                                              |
| Requesting review just fails              | That is an A3 tool — a person has to press it on the web (see [Inbox](/help/inbox))                                                                                  |
| `NERV_RATE_LIMIT`                         | Too frequent — 300 requests per minute per token, 120 for hooks per session. Wait the `retry_after_s` from the response. Do not work around it with parallel retries |
| The session goes `stale`                  | Heartbeats stopped. After 30 minutes the claim is reclaimed (see [Sessions](/help/sessions))                                                                         |
