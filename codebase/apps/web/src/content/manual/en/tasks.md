A task is one piece of work split out of an approved spec. People and agents look at the same board.

## The board and its lanes

Lanes are task statuses.

| Screen name (value)         | Meaning                        |
| --------------------------- | ------------------------------ |
| Backlog (`backlog`)         | Not up for work yet            |
| Ready (`ready`)             | **Can be picked up right now** |
| Claimed (`claimed`)         | Someone has taken it           |
| In progress (`in_progress`) | Being worked on                |
| In review (`in_review`)     | Waiting for review (optional)  |
| Done (`done`)               | Finished                       |
| Blocked (`blocked`)         | Stuck — with a stated reason   |

Screens speak in **names** — board lanes, the task screen, sessions and a spec's derived-task list all use the same names. The value in brackets is the identifier the API, the CLI and agents use.

**A board card says whose work it is and who is running it.** The assignee shows only as an initials circle, but hovering shows the name and a screen reader reads it. When an agent session is running the task a small **AI** mark appears; press it to go to that session. Priority shows as a chip **for P0 and P1 only** — on every card it would not be a signal. The source spec key also takes you to that spec.

`in_review` is an **optional** step. Use it on a shared board when you want "the work is out, nobody has checked it yet" to be visible. Going straight from `in_progress` to `done` is fine — what actually gates completion is the evidence and the spec impact, not the lane.

**A blocked reason is picked from four** — waiting on an answer, a dependency broke, conflicts with the base spec, something outside the repo. It is not a free-text box: when the same situation is written differently by different people, **counting how many tasks are blocked stops being true.** Anything more to say goes in a comment or a question.

Board cards and the task screen show that reason **by those four names**. A task blocked before the vocabulary existed (prior to 2026-09-06) still carries whatever sentence was typed then, and **that sentence is shown as written** — an old reason is not hidden.

The screen for a blocked task also shows **what would unblock it**: whatever is still holding it (an open question, an unfinished dependency, a superseded base spec) appears as a link, and once nothing is left you get a **Can be unblocked now** badge. The badge does not unblock it for you — press **[Unblock]** at the top of the task screen. The task goes back to **In progress** if someone holds it, otherwise to **Ready** (or **Backlog** if the brief is empty). While something is still holding it the button is locked and says why. When the reason is `Something outside the repo`, the server cannot judge it, so a person confirms with **[Check and unblock]**.

**Four kinds of people can move a task to done** — whoever holds its active claim, the assignee, a planner, or an admin. Agents are stricter: without **a live claim of their own** they cannot call `in progress`, `in review` or `done`. The refusal says whether the task can be claimed again, so the agent knows whether to pick it back up or stop and report. `claimed` is not a lane you move into — claiming is the only way in.

**Sending a task back to ready is also a judgement.** The four parts of the delegation brief must be filled in and every blocking task must be finished (a task imported with "source had no delegation brief" in those fields counts as **empty**). If an active claim is held, **release it or stop the session first** before moving the task back to ready or backlog.

**Show backlog is on by default.** A task is always created in `backlog` and only moves to `ready` once the four parts of the delegation brief are filled in, so a task you just created lives in that lane. **If you filled in all four when creating it, press [Move to ready] on its card** — creating alone does not queue it; pressing it has the server check the four parts and the dependencies, then queue it. A card with parts missing shows **[Fill it in]** instead. Turn **Show backlog** off to see only what is flowing; that choice stays in the address (`?backlog=0`). The summary strip at the top (`ready` · `in progress` · `mine` · `blocked`) is there so you can read the state without reading the whole board.

**Filters in force are shown above the board.** Filter with the **Spec** and **Assignee** pickers above the summary strip; when you arrive through a filtered link — like "Derived tasks → See all" on a spec — the pickers show that value. As soon as any filter is set, **Filtered** appears beside them — the summary numbers and the lanes then count **only matching tasks**. **[Clear filters]** removes the spec, assignee and agent filters and leaves show-backlog and show-archived as they were. Press the **mine** number in the summary strip to keep only tasks assigned to you. Every filter stays in the address (`?spec=` · `?assignee=`), so you can hand it on as is.

**A lane does not arrive all at once.** A lane whose count carries `+` has more behind it: **+N more** at the bottom unfolds what has arrived, then **Load more** fetches the next batch — even a long lane, like done with the archive shown, can be read to the end. **When the ready lane is empty**, it says what to do next — **See N blocked** (to the blocked lane) and **Fill N in backlog** (to the backlog lane, switching it on if it is off).

## The task screen opens over the board

Clicking a card opens the task **as a sheet on the right of the board** — the board stays behind it. Your filters, collapsed lanes and expanded "+N more" stay as they were, and clicking another card behind switches the sheet to that task. On a narrow screen the sheet covers the whole screen.

- **Close** with the **✕** at the top of the sheet or `Esc`. The board's filters live in the address, so closing does not drop them.
- `j` · `k` move to the **next and previous task in the same lane**. The top of the sheet shows where you are, like "2 of 5 in the lane" — handy for going through blocked cards one after another.
- `Esc`, `j` and `k` do nothing while the cursor is in an input.
- The task's address (`/p/…/tasks/CLV-T-…`) is unchanged, so you can pass it on as a link. Opening it shows the sheet with the board behind.

## The next step is at the top of the task screen

The buttons to the right of the task title are **the door from the current status to the next one**.

| Now         | Button at the top                                                                     |
| ----------- | ------------------------------------------------------------------------------------- |
| Backlog     | **[Move to ready]** when all four parts are filled, **[Fill in the brief]** otherwise |
| Ready       | **[Claim]**                                                                           |
| Claimed     | **[Start work]** · [Finish…]                                                          |
| In progress | **[Request review]** · [Finish…]                                                      |
| In review   | **[Finish…]**                                                                         |
| Blocked     | **[Unblock]** ([Check and unblock] when the server cannot judge the reason)           |

**Buttons you cannot press still show** — locked, with the reason on hover or when you `Tab` to them (which roles can · someone else holds it · the block is not cleared yet). [Claim] appears only on **Ready** tasks — except a task held only by an expired lease, where pressing it reclaims that claim. On a backlog or blocked task it used to be a button that got refused.

**The header shows the assignee and the runner together.** **Assignee {name}** is the person responsible for the work; **Running on {host} ▸** is the agent session holding the task right now — press it to go to that session. They can be different: people set the assignee, while the runner is whoever holds the claim.

**The finish form opens when you press [Finish…] or when the task is Claimed, In progress or In review.** The spec impact **starts with nothing chosen** — "none" is a choice too, so [Move to done] is locked until you pick. Choose "some" and it turns on only once you write which spec should change and how. If no evidence is attached, the form says so before you press — the done gate requires evidence. Marking a task blocked happens in its own **Mark as blocked** card, where you pick the reason.

## The four parts of a brief

A task becomes `ready` only when four things are filled in.

1. **Goal** — what counts as done
2. **Output format** — what has to be handed back (a PR, a document, a patch)
3. **Tools and sources** — what to read, and what to do it with
4. **Boundaries** — what must not be touched

If any of them is empty the task cannot be claimed. **Large work takes one more step** — four or more tasks from the same spec version, or a version graded T3, need **plan approval** before they start (see [Inbox](/help/inbox)). **The base spec version is not one of the four** — when it is set the agent reads that version, and a task without one still reaches `ready`. Agents are instructed not to guess the missing part but to **raise a question** — work started on a guess only reveals the guess was wrong at the end.

**Tasks are derived from approved versions.** On a spec's requirement row, [Create a task from this requirement] opens the new-task form with the source filled in. Opening the form directly lets you pick spec, version and requirement — and the version list shows **approved versions only** (work derived from an unapproved document stands on a promise nobody agreed to yet). The source is optional, but with it set that requirement's implementation status follows this task.

**The brief is edited on the task screen.** **[Edit]** on the brief card opens the form in place. Empty parts and import placeholders ("source had no delegation brief") are marked **❌**. In the form those parts open **blank**, with "Missing from the source — needs filling in" shown faintly. Only the parts you fill are saved; a part left blank stays as it was — so you can change just the title. After saving, the screen names the parts that are still empty. A part that already had content cannot be cleared. The rebrief badge has an [Edit] beside it too — when the basis moves, the instructions need reading again. **Planners, developers, admins and qa create tasks; planners, developers and admins edit the brief** (qa turns findings into tasks but does not write briefs). Anyone who cannot sees [+ New task], [Fill it in] and [Edit] locked — so nobody fills in the whole form only to be refused.

The task screen shows that basis in human terms: the requirement's stable ID and sentence, the active claim's remaining lease and declared scope, and the reviews that covered this task (open criticals in red). All three take you there — the requirement to the **Requirements** tab of its spec, **[View session ▸]** on the claim row to the session holding that claim, and the branch on a review row to the review center filtered to **that branch's findings only**.

## Claims and leases

Taking a task is a **claim**. A claim carries a 30-minute lease, and the session sends a heartbeat every 60 seconds to keep it alive.

- If heartbeats stop, the lease expires and the task returns to `ready`. This is what stops a dead session from holding work forever.
- Two sessions touching the same declared scope register as an **overlap** — but not always a refusal. There are three grades. **Block** happens only when two sessions declare the **same spec document**, and only then is the second claim refused. **Warn** covers documents joined up or down the spec tree, and two tasks from the same requirement; **info** is anything else that grazes. Neither one stops anyone. **Overlapping file paths alone do not block**: refusing every overlap would let one large module serialise the whole project. **A block notifies whoever claimed first** — the blocked session sees the refusal immediately, but the person who needs to know that scopes are colliding is the one already holding the claim.
- **You can take and drop work from the web too.** Press [Claim] at the top of the task detail and it is yours — the scope is this task's source spec, and no files are declared. To drop it, pick one of two: **[Hand off]** means someone should pick it up next, **[Abandon]** means you are stopping. They are stored as different reasons, so "why did you put it down" has an answer later. **[Abandon] asks once more** — the task goes back to `ready`.
- A claim is usually released by **whoever holds it** — the agent releases it when it finishes or gives up (`nerv_task_release`). To stop work someone else holds, **Stop** their session: the claim is released on the spot and the task returns to `ready`.
- **A task in progress that nobody holds can be sent back.** When a `claimed` or `in progress` task has no active claim, the screen offers [Send back to ready] or [Send back to backlog] — the first when the four parts of the delegation brief are filled in, the second when they are not (imported tasks usually are not). Imported tasks sat in that state for a long time: invisible to the queue and impossible to claim, so nobody ever saw them. If an active claim is held, release it or stop the session first.
- The server allows more than the screen offers — **an admin can release someone else's claim**, and planners and admins can move someone else's task between lanes. Only the door is missing.

## Done, and the archive window

Finished tasks stay on the board for **seven days** and then drop out of the list. **Show archived** brings the older ones back.

This is not a status — it is a **window computed from the completion time**. Archived tasks are not deleted, and their addresses still work.

**`done` cannot be undone.** A request to move a finished task into another lane is refused — completion is a state closed over evidence and spec impact, and reopening it is a new decision. When work remains, **make a new task**.

## Click the evidence

The **Evidence** list on a task is the record that something was put up to be seen. Entries that have somewhere to go **open in a new tab** when you click them — a PR goes to the address recorded on it, a commit or a code path goes to that spot in the project repository, and a review goes to that finding in the review center. The new tab matters because you may be filling in a transition to done on this screen; leaving in the same tab loses the spec impact and evidence you typed.

**Evidence that carries its own repository goes there instead.** Evidence attached by CI records which repository it came from, so in a project that uses several repositories the link lands in the repository that actually holds the commit. When it is not recorded, the project's repository URL is used.

**User-guide evidence opens a chapter of this manual.** Write the chapter name (`tasks`) or the whole address (`/help/tasks`) and that chapter opens — a name that is not a chapter stays as text.

**Some rows are not clickable.** Test names are written differently in every repository, so we do not guess where they lead — leaving them as text is more honest than a link to the wrong place. Commits and code paths need the **project repository URL**; when it is empty those rows stay as text and the screen says why.

## Requirement links

A task can point at the requirement it implemented. What that link moves is one number on the project screen — **empty promises**, the count of unimplemented requirements no task has taken on. Without links that number is not zero but at its **maximum**.

The implemented and verified bars are a different axis: they are counted from the requirement's own implementation status (see "Requirements and coverage" in the specs chapter).

## When the baseline goes stale

If the spec version a task is briefed against becomes `superseded`, the task card says so. That is as far as the marker goes — **there is no door in the screen for changing a task's base version afterwards.**

So there are two ways forward: finish against the current baseline and carry the difference into another task, or **make a new task** against the new version. The screen asks you to choose; it does not choose for you.
