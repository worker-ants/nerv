This chapter shows how to connect Claude Code or Codex to NERV. Once connected, an agent can read your specs and claim tasks. What the agent is doing appears on the sessions screen.

There are **five steps**. If something goes wrong along the way, see the last section for common causes. For how the pieces work together and why, see [Agents](/help/agents).

## Before you start

You need three values, and **all three are already on this screen.** They are shown on the "Values on this server" card just above, and every command and file below is already filled in with them. Copy them as they are.

| What                    | Where it comes from                       | Value on this server |
| ----------------------- | ----------------------------------------- | -------------------- |
| The NERV server address | `NERV_API_URL`, set by your administrator | `{{server}}`         |
| The project slug        | The project you are viewing (left column) | `{{project}}`        |
| Your role               | Settings → Members and roles              | `{{role}}`           |

**This may differ from the address in your browser's address bar.** If the web app and the API run on different hosts, the address bar shows `app.…`, but agents connect to `api.…`. The value in the table above is the address agents connect to.

Your role matters because **a token's scopes can never be broader than your role.** With the `viewer` role, you cannot issue a token that can claim tasks.

## 1. Issue a token

Go to **Settings → Agent tokens → Issue a new token.** Give the token a name that tells you which machine uses it (for example, `mac-02/claude-code`).

- The token value is shown **only once, right after it is issued**. After you close the dialog you cannot see it again, and you would have to issue a new token.
- **A token is bound to one project.** In the first field of the form, you **choose that project** (it defaults to the project you are viewing). The token works only in that project, so if you work in several projects, issue a separate token for each. The project you choose also **determines which scope checkboxes are locked**, because your role can differ from project to project. If you don't belong to any project, the issue button is disabled and the reason is shown on screen.
- **You can set an expiry**: 30 days, 90 days, 1 year, or never. The default is never. An expired token is rejected from that moment on, just like a revoked one. The list shows the expiry date.
- After you issue a token, a card appears with **the token's details** (project, scopes, expiry) and **three connection steps** in order: ① the token (with a copy button), ② two lines that install the plugin (run them in Claude Code), and ③ one `nerv-init` line to run in your working repository. Line ③ looks up `nerv-init` in the install cache, so you can paste it as is. It creates the files from steps 2 and 3 in one go. **That line leaves the token in your shell history.** To avoid this, remove `--token` and its value. You are then prompted for the token, and your input is hidden. The **first time the token is used**, the card changes to **"Connected · machine name"**.
- The **first column** of your token list is the project. Revoked and expired tokens are collapsed; click [Show revoked and expired] to show them. **Organization admins** (people whose organization-wide role is admin) can see who has which token in which project on the **[Organization tokens]** screen, under Organization in Settings. **Only organization admins can use [Revoke] on that screen to cut off someone else's token.** A project admin can revoke only their own tokens. Revoking cannot be undone, so you are asked to confirm.
- Scopes start with the **[Recommended]** preset. It includes the scopes an agent needs for the five skills (next · spec · impl · question · review): `spec:read` · `spec:draft` · `task:claim` · `task:update` · `review:submit` · `agent-session:launch`. Any of these that your role lacks is left out when the token is issued (a locked scope is never added without your knowledge). To grant a different set, switch to **[Custom]** and check or uncheck the boxes. Under each scope's name, **one line describes what it allows**.
- **Do not remove `agent-session:launch`.** `nerv_bootstrap` requires this scope, so without it you cannot even start steps 4 and 5 below. This is the most common mistake when trimming scopes with [Custom].
- **A token's scopes never exceed your role.** Scopes your role does not have appear **dimmed and locked**. For example, `review:resolve` belongs only to the admin, planner, and qa roles, so it is locked for a `developer`. Locked scopes stay in the list for the same reason the human-only scopes do: you should be able to see on screen why you cannot grant them.
- If your role later gains more permissions, **tokens you have already issued reflect the change immediately.** You don't need to reissue them.
- The checkboxes for `spec:approve` and `approval:decide` are locked. Approval is something only a person can do, so it cannot be granted to a token.

## 2. Environment variables

**This step shows how to write the settings files by hand.** If you install the plugin first (3-A), the single command at the end of 3-A creates this step's files and the next step's `.mcp.json` **for you**. It never overwrites a value that is already set. Follow this step if you want to know which files are created, or if you prefer to write them yourself.

**These values depend on the project, not the machine.** If you export them in your shell profile, the machine can only work with one project. Every time you switch projects, you have to edit the profile and restart your sessions. Keep the values **inside the working repository** instead.

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

This file is **git-ignored by default**, so the token is not committed. Each repository can have its own values, and you don't have to touch your shell profile.

### `.nerv/env` — for Codex (not used yet)

**If you only use Claude Code, the file above is all you need.** Don't keep the values in two places. If the two copies differ, which value applies depends on the situation.

`.nerv/env` is a fallback for environments other than Claude Code (Codex). The plugin's scripts read it.

```bash
NERV_SERVER={{server}}
NERV_PROJECT={{project}}
NERV_TOKEN=<the token from step 1>
```

**Values that are already set are never overwritten.** Settings on a company-managed machine and values already in your shell always take precedence. Only variables whose names start with `NERV_` are read.

> This file supports Codex only **halfway**. Notifications and hooks work because the plugin's scripts read the file directly. However, Codex's MCP authentication accepts only the _name_ of an environment variable, so the values in this file don't apply to it. Codex support is still in progress.

### If you use only one project on this machine

You can still use your shell profile. However, if `.claude/settings.local.json` sets the same variable, that value is used. `.nerv/env` never overwrites a value that is already set, so a value from your shell profile takes precedence over `.nerv/env`.

```bash
export NERV_TOKEN="<the token from step 1>"
export NERV_PROJECT="{{project}}"
```

`NERV_HOSTNAME` is the value the sessions screen shows as "whose machine this is". **We recommend setting it.** Some hooks send events directly to the server and include this value as is. If it is empty, sessions appear in the list with no machine name. Once you run agents on two or more machines, you can no longer tell which session belongs to which machine.

```bash
export NERV_HOSTNAME="$(hostname -s)"
```

The value is **for display only**. The sender can put anything in a header, so it is never used for permission checks.

**Do not commit the token.** Also add `.nerv/` to your working repository's `.gitignore`. The environment file, the plugin's cache, and the offline queue are all stored there.

## 3-A. Install the plugin in Claude Code

Run these two lines inside Claude Code. **They install the plugin that this server distributes.**

```text
/plugin marketplace add {{server}}/plugin/marketplace.json
/plugin install nerv@nerv
```

Then **restart** Claude Code. `/plugin` should list `nerv` v{{version}} as active.

Installing from this server means **the version always matches this server**. The server builds the catalog itself, so you always get the build this server expects. On a network without outbound access, it is also the only option.

> **If installing from this address fails, install from GitHub instead.** Change only the first line to `add worker-ants/nerv`. The install command stays the same, and **you get the same files** (both are sources for the same marketplace, so don't register both at once).
>
> Installing from the server requires all three of **HTTPS, a public address, and a trusted CA**. If the install is rejected with `Archive URLs must use https://…`, the problem is one of the first two (the card above already shows a warning for these). If it fails with a certificate error, the problem is the third. **The browser cannot detect a problem with a certificate issued by an internal CA, so it does not appear on the card.**

If your company uses an internal git marketplace, enter that git URL instead and install `nerv@nerv-internal`.

**Two tools must already be installed.** The hook forwarder uses `curl`, and the statusline and outbox use `jq`. If either is missing, you get no error; the features that need it **silently do nothing.**

> To get a new version, run `/plugin marketplace update`. You get a new copy only when an administrator bumps the plugin version. If the version is unchanged, you keep using the copy you already have.

Four things are installed.

| What                        | What it does                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Five skills                 | `/nerv:next` `/nerv:spec` `/nerv:impl` `/nerv:question` `/nerv:review`                           |
| Hooks                       | Send what the agent does to the sessions screen                                                  |
| statusline                  | Shows your current claim, time left on the lease, and declared-scope overlaps on the prompt line |
| Subagent `nerv-spec-writer` | A dedicated agent that only drafts specs                                                         |

**The `nerv_*` tools are not among these four.** To use them, your repository needs a `.mcp.json`. The server address and token differ per project, so the plugin does not include this file.

**Instead, the plugin includes a command that creates it.** Run it once in your working repository to set up three things at once: `.mcp.json`, the environment variables in `.claude/settings.local.json`, and `.nerv/` in `.gitignore`. **The address and project are already filled in with this server's values**, so the token is the only thing left to enter. Your input is hidden when you type it.

```bash
cd <your repository>
"$(ls -d "$HOME"/.claude/plugins/cache/*/nerv/*/bin/nerv-init | sort -V | tail -1)" \
  --server {{server}} --project {{project}}
```

**It never overwrites a value that is already set.** If a token is already in the file, the command keeps it and tells you so. To change it, edit that file yourself. If `.mcp.json` exists but has no `nerv` entry, the command leaves the file untouched and **prints the entry to add.**

In a repository where setup is incomplete, you see what is missing when a session starts. **This is only a notice; no files are created.** Starting the setup is up to you. In a repository with no sign of NERV, nothing is shown.

After the files are created, **restart Claude Code**. A newly created `.mcp.json` is read on restart.

To write it by hand, use the content below (together with the environment variables from step 2).

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

`/mcp` should show `nerv` as connected.

**On a company-managed machine, skip this step.** The managed settings have already registered the marketplace and enabled the plugin, and `NERV_SERVER` and `NERV_PROJECT` come from them too. You only need steps 1, 2, 4, and 5.

## 3-B. Connect Codex

Codex has no plugin format. Instead, you **add two files to the repository where you use Codex.** Drafts of both files ship with the plugin package, under `codex/`.

```bash
mkdir -p <your repo>/.codex
cp <plugin>/codex/config.toml <your repo>/.codex/config.toml
cp <plugin>/codex/AGENTS.md   <your repo>/AGENTS.md
```

If you already have an `AGENTS.md`, don't overwrite it. Copy **only the "single source of truth" and "at the start of every session" sections** into it.

In the copied `.codex/config.toml`, replace three values with your own: `url`, `X-NERV-Project`, and `[otel] environment` (if you use it).

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

**Do not put the token in `config.toml`.** As `bearer_token_env_var` indicates, the token is read from the `NERV_TOKEN` environment variable. Codex does not read `.claude/settings.local.json`, and values in `.nerv/env` are not used for MCP authentication (see step 2). So for Codex, set `NERV_TOKEN` as a shell environment variable.

Claude Code does not read `AGENTS.md` automatically yet. If you use both agents in the same repository, add this line to `CLAUDE.md`.

```markdown
@AGENTS.md
```

**What works in Codex, and what does not:**

- **All the tools work.** A Codex session can run `bootstrap → next → claim → heartbeat → release` from start to finish using tools alone, because every core capability is available as a tool.
- Skill files (`SKILL.md`) are reused as is. The format is open, so Codex uses the very same files.
- **There is no hook telemetry.** As a result, Codex sessions show less detail on the sessions screen. You see the milestones the agent posts itself, not every action.
- A repository's `.codex/config.toml` is read only in **trusted projects**. You approve it once, the first time you open the project.

## 4. Check the connection

- **Claude Code**: Start Claude Code in the project repository and type `/mcp`. The `nerv` server should be connected, with the `nerv_*` tools listed.
- **Codex**: Start a session and call `nerv_bootstrap`. The response includes a `session_id` and the gate policy.

Either way, the connection is only complete when **your session card appears on the sessions screen** in the web app.

In Claude Code, the session card appears **before** `nerv_bootstrap` is called, because the session-start hook registers the session directly. So if you see the tools but no card, check **the hook**: the token may be empty, `curl` may be missing, or the hook could not connect to the server. The forwarder fails without reporting an error, so nothing is shown.

## 5. Your first task

```text
/nerv:next
```

The skill calls `nerv_bootstrap` first, recommends the next task, and walks you through claiming it. In Codex, you call the same tools in the same order yourself. That order is described in the `AGENTS.md` you copied.

## When it does not work

| Symptom                                   | Usual cause                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nerv` missing from `/mcp`                | You did not restart after installing, or the repository has no `.mcp.json`. Run the command in 3-A once                                                                                                 |
| Cannot connect to the server              | A typo in `url`, or you are outside the internal network. Compare it with the address on the card at the top of this chapter                                                                            |
| `NERV_UNAUTHENTICATED`                    | `NERV_TOKEN` is empty or was revoked. Issue a new one under Settings → Agent tokens                                                                                                                     |
| `NERV_FORBIDDEN`, missing scope           | The token lacks a required scope, or the role it was issued under cannot do that                                                                                                                        |
| Tools work but the project is not visible | **That token was issued in a different project.** A token's project is set when it is issued, and no header can change it. Issue a new token in the project you want                                    |
| `project_mismatch`                        | `X-NERV-Project` and the token's project differ. The error message shows both values, so fix whichever is wrong                                                                                         |
| No session card appears                   | The hook could not connect to the server. Check `NERV_TOKEN`, `NERV_SERVER`, and `curl`. Hooks fail without showing an error                                                                            |
| Requesting review just fails              | It is an A3 tool, so a person has to click it in the web app (see [Inbox](/help/inbox))                                                                                                                 |
| `NERV_RATE_LIMIT`                         | Too many requests. The limit is 300 requests per minute per token, and 120 per session for hooks. Wait for the `retry_after_s` in the response. Don't try to get around the limit with parallel retries |
| The session goes `stale`                  | Heartbeats stopped. After 30 minutes, the claim is reclaimed (see [Sessions](/help/sessions))                                                                                                           |
