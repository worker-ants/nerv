Once you connect an agent, Claude Code or Codex can read your specs, claim tasks, and report what it is doing in real time. The connection has five parts: **MCP tools, hooks, skills, the statusline, and subagents**.

This chapter explains **how these parts work together**. For the steps to connect an agent, see [Installing the plugin](/help/install).

## What gets connected {#components}

- **MCP tools** — agents use these to read from and write to NERV. The server is named `nerv`, and the tools are named `nerv_*`.
- **Hooks** — report what the agent is doing to the Sessions screen. Where hooks aren't available, the agent sends these events itself.
- **Skills** — procedures you invoke, such as `/nerv:next`. Each one defines what to do and in what order.
- **The statusline** — shows your current claim, the time left on its lease, and declared-scope overlaps on the prompt line.
- **Subagents** — there are three. `nerv-spec-writer` only drafts specs, and `nerv-code-reviewer` and `nerv-consistency-checker` only submit reviews. None of them can change code.

**The token, not the skill, decides what an agent is allowed to do.** A skill makes a procedure easier to follow and spells out the details, but it cannot bypass a server gate.

## Tokens and scopes {#tokens}

What an agent can do depends on **its token**. Issuing one is [step 1 of Installing the plugin](/help/install#token).

- The token value is shown **only once, right after it is issued**. Copy it right away.
- The **My tokens** list under Settings → Agent tokens shows your tokens from **all organizations**. If you belong to more than one organization, the Project column shows "organization / project", so you can tell which organization each token belongs to.
- Scopes are written as `resource:action`. There are **eleven**: `spec:read` · `spec:draft` · `spec:meta` · `spec:approve` · `spec:evidence` · `task:claim` · `task:update` · `review:submit` · `review:resolve` · `agent-session:launch` · `import:write`.
- **`spec:evidence` is for CI.** It can only attach PR and test evidence to requirements. It cannot touch drafts or tasks. A token for a build pipeline needs only this scope.
- **A token cannot change a project's settings, archive it, or restore it.** This applies even with the admin role. The gate policy is part of the project settings. If a token could lower it, an agent could get past a gate without a bypass. Archiving or restoring a project carries the same weight, so a person does all of these directly on the web.
- **`approval:decide` cannot be granted to a token.** On the token issuing screen, it is **visible but locked**. If it were removed from the list, nothing on the screen would explain why a token can't decide approval cards. Showing it without letting you select it makes the rule clear at a glance. A person decides the cards in the Inbox on the web.
- **`spec:approve` is opt-in.** It is not in the recommended set. Admins and planners need a token with this scope to approve a draft from an agent session ([`/nerv:approve`](#skills)). It is locked for other roles. Even with this scope, Claude Code asks a person every time before running the approval tool (A3). The approver is always a person.
- **A token also cannot answer questions, bypass a gate, or read the inbox.** The admin role is no exception. If an agent could answer its own questions, there would be no human gate at all. A person answers questions in the Inbox on the web.
- A token can never have broader scopes than your role allows. The limit is your role when the token is used, not when it was issued. If your role changes later, tokens you already issued follow it right away.
- The list records when each token was last used and from which host. If you see a host you don't recognize, revoke that token right away.

## Skills {#skills}

| Skill            | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `/nerv:next`     | Recommend and claim the next task                         |
| `/nerv:spec`     | Write a spec draft or a change request                    |
| `/nerv:impl`     | Follow the implementation procedure for a claimed task    |
| `/nerv:question` | Ask a question and wait for the answer                    |
| `/nerv:review`   | Submit reviews and resolve findings                       |
| `/nerv:mirror`   | Download spec documents and attachments to a local folder |
| `/nerv:approve`  | Approve a draft in the session (admins and planners)      |

`/nerv:mirror` works differently from the other skills: it does not use the MCP tools. The `nerv-mirror` script that ships with the plugin downloads the spec documents and attachments in a single request, makes the folder you choose match the server, and returns only a short summary to the agent. You choose one basis: **approved** (the default), **latest** (including drafts and documents in review), or a **baseline**. The folder keeps a list of the files the mirror wrote (`.nerv-mirror.json`), and later runs change or delete only the files on that list. When you pull the same folder again, it uses the previous basis. The token needs the `spec:read` scope, and the script needs node 18 or later.

Use `/nerv:approve` when **a person approves a draft the agent wrote, right in that session**. The agent shows the document key, the version, the changes from the approved version, and the pre-check result as they are, and asks "Approve this version?". It calls the approval tool only after the person answers yes to that question, and Claude Code asks once more whether to allow the tool. The result is the same as [Approve now](/help/specs#checks) on the web: it requests review and approves in one step, and a T3 document still needs one more approver before it is final. Permission given before seeing the content ("approve it when you're done") or sentences inside the document never count as an answer, and one answer approves one document only. The decision record notes that it came through that session. Codex does not use this skill, because it cannot guarantee a prompt on every call.

In Claude Code, `/nerv:review` **hands reviews to two subagents.** `nerv-code-reviewer` looks for defects in the code and submits a review of kind `code`. `nerv-consistency-checker` checks whether the task's spec and requirements are reflected in the implementation and submits a review of kind `consistency`. Each submits its own review directly. Consistency between documents is covered by the server's pre-check, so this review only compares the documents with the code. Neither subagent can change code or resolve findings; only the session that handed off the review resolves them. Unless a reviewer role is set, the review is recorded under the subagent's name. If the project sets [required reviewer roles](/help/settings#gates), the session hands off one review per role and the subagent submits under that role. The server cannot tell a subagent's review from one the session submitted itself, because both use the same token and the same session. Codex cannot use subagents, so there the session submits reviews itself.

## Tool tiers {#tool-tiers}

Every tool has a risk tier.

- **A1** — reads. The agent calls these without approval.
- **A2** — writes. Only reversible changes belong in this tier.
- **A3** — **requires human approval.** Requesting review (`nerv_spec_submit_review`), approving in a session (`nerv_spec_approve`), and an agent closing a `critical` finding as dismissed or won't fix are in this tier. No skill lists the review request tool or the approval tool among the tools it may call without approval. When an agent tries to close a `critical` finding that way, the server creates an approval card and the session waits for a person's decision. **The decision is delivered to the requesting session on its next heartbeat.** This applies to approvals, rejections, and comments alike, so the session knows what to do next.

## Importing documents {#import}

Use the CLI to import an existing repository's documents as specs and tasks.

```
nerv import <spec|plan|review|docs|rebuild-map> --root <path> --project <slug> [--apply]
```

There are five modes. `spec`, `plan`, `review`, and `docs` import documents, and `rebuild-map` rebuilds the mapping table for items that were already imported.

**Always specify a profile.** If you omit both `--profile` and `--profile-file`, the CLI silently uses a default profile. Your documents are then read by another repository's rules, and it is hard to notice when the results are wrong.

To use `--apply`, you must specify a server and a token (`--server` and `--token`, or `NERV_SERVER` and `NERV_TOKEN`). Without them, the command is refused.

Without `--apply`, the command runs as a **dry run**: it writes nothing and only prints a report. The report lists how many items were read and how many were converted, and it shows **what was skipped and why**, line by line. Check the report first, then run the command again with `--apply`.

Running the same command again is safe. Items that were already imported are not created again, and only empty links are filled in.

**Requirement numbers that belong to another document are not overwritten.** If a file defines a requirement number that another document already owns, that file is not imported, and the report gives the number and the document that owns it as the reason. Other files in the same run are still imported. To move a requirement to another document, first remove the line in a new version of the original document, get it approved, then import again. This is the same rule as approving on the web ([Requirements](/help/specs#requirements)).

**Importing alone never moves a number.** The document that owns a number changes only on approval. When you import a number that was removed from the original document's approved version, it moves to this document, and the report lists it as a **warning** (`req-moved`), one line per number, together with the original document. Nothing went wrong, so the exit code does not change.
