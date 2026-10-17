The review center is where you see the **findings** about your code and specs in one place. A review is the result of an agent checking the work before a person reads it. A person decides what to fix.

**If the gate is effectively off, a red banner appears under the title.** It is the same banner as on the session monitor: the gate could not decide and let things through as many times as the set limit within the set time. **[See the records]** shows those records, and the banner goes away when no new record comes in for that long.

## Review sessions and findings {#review-sessions}

A **review session** is the record of one change reviewed under one kind. Findings come from these sessions. There are four kinds of review.

| Kind            | What it checks                                     |
| --------------- | -------------------------------------------------- |
| `code`          | The code change itself                             |
| `consistency`   | Whether documents and code contradict each other   |
| `spec_coverage` | Whether what the spec asked for was actually built |
| `merge`         | The final check before merging                     |

The kind is set when a review is **submitted**. It doesn't appear on screen, and you can't filter the queue by it.

A session moves from `running` to `complete`. It also records which input it reviewed (branch and commit). The reviewed commit and the diff base must be commit SHAs (7 to 40 hex characters); a review sent with `HEAD` or a branch name is rejected.

**If the same change is submitted twice under the same kind, there is still only one session.** No new session is created; another report is added to the existing one. A different reviewer also adds a report, not a session. When new commits on the branch change the diff, a new session is created and the round number goes up. **The same issue stays a single finding across rounds.** Findings with the same category, file, symbol and title count as the same issue, so a shifted line number doesn't create a new finding. The card shows how many times it was seen and the most recent round, in the form "seen N× · latest round M".

## Severity and resolution {#severity}

A finding has one of three severities: `critical`, `warning` or `info`. **Open** (`open`) is the **state** of a finding that hasn't been resolved yet. There are four **resolutions**:

- **Fixed** (`fixed`) — The code was changed. Record the commit hash with it.
- **Spec fix** (`spec_change`) — The code was right and the **document** was wrong. Pick from the list which version of which spec resolved it. You don't need to remember version numbers.
- **Dismissed** (`dismissed`) — The finding is wrong, or it isn't a problem in this context.
- **Won't fix** (`wont_fix`) — The problem is real, but it won't be fixed now. Record a reason, and the finding is removed from the queue. **If it should be fixed later, add it as a task instead** (see below).

`spec_change` exists to keep the record honest. Resolving a documentation fix as `fixed` would mean the code was changed. Resolving it as `dismissed` would mean the finding was a false positive. Neither is true. When you later need to know how these findings were resolved, this distinction gives you the answer.

**You can comment on findings.** Comments are on the **finding rail** on the right, not on the card. Select a finding in the queue to open the rail. **On a narrow screen, it opens below that card instead.** Only the position changes; the content is the same. Along with the comments, the rail shows the category, symbol, full path, review time and the **rationale for the resolution**. The **[Add as task]** button is on the rail too. Use it to move a finding you can't fix now into the backlog. Once the finding is added, the button is replaced by **a link to the new task**, and the toast also has an [Open] button. If you try to add the same finding again, no new task is created. Instead, you see **which task** it was already added as. Queue cards also show the task a finding **came from** (Task {key}) and the task it **was added as** (→ {key}). Click either one to go to that task.

**Resolve a finding where you read it.** The four resolution buttons are at the top of the rail. Clicking one opens the rationale form **inside the rail** and moves the cursor to the rationale field. Clicking a resolution button on a queue card also opens the rail on that finding, with the form in the rail. That way you can write the rationale while reading the full text and the comments. Hover over a button to see what that resolution requires (a commit hash, the corrected spec or a rationale).

**You can also select findings with the keyboard.** A card's title is a button: press `Tab` to reach it and `Enter` to select it. Outside a text field, `j` and `k` move through the queue one card at a time. On the sessions screen, each row's name is also a button.

**Every role except viewer can comment on a finding** (`review:submit`), so developers and designers can answer findings on their own code right where they are. An agent token with `review:submit` can comment too. **Only roles with the `review:resolve` scope (admin, planner and qa) can resolve a finding.** As with spec comments, the conversation is open to participants while the decision takes a scope. **Adding a finding as a task takes yet another scope** (`task:update`), so developers and designers can do it too. If you lack the scope for a button, hover over it or reach it with `Tab` to see why it's unavailable.

**Only a person can dismiss a `critical` finding or mark it won't fix.** When an agent tries to resolve a `critical` finding as `dismissed` or `wont_fix`, the change isn't applied right away. An **approval card** is created instead. This way, a serious problem can't be removed without anyone noticing.

## What needs fixing {#targets}

Severity shows how urgent a finding is. **Area** shows what needs fixing. There are four areas.

- `Code` — The implementation is wrong. Fix the code and its tests.
- `Spec` — The spec is wrong or has drifted from the implementation. Fix the document. These findings usually close as `spec_change`.
- `Task` — The problem is in the task definition, its declared scope or its delegation brief. Fix the task itself.
- `Process` — The problem is in the way of working, such as a convention, a gate or a tool.

When an agent doesn't send this value, **the server infers the area from what the finding points to** and marks the card `inferred`. When you see that mark, read the finding before you trust its area. The mark is there so that a guess never looks like a fact.

## Filters {#filters}

Narrow the queue with the filters in the **left column**: **Severity**, **Area** and **Status**, plus **Tags** when some findings are tagged. The number next to each value shows how many findings match under the current filters. On a narrow screen, the filters move above the list.

**By default, only `Open` findings are shown.** That's why findings you've resolved don't appear. To see them, change the status filter. If you open a finding from a link on another screen and it doesn't match the default filter, **the status filter is cleared automatically, once**. That way, following a link never lands you on an empty screen.

**The filters you apply and the finding you select are kept in the URL.** For example, if you share a URL narrowed to area `Spec`, severity `critical` and status `Open`, the recipient sees the same queue. Reloading the page or going back keeps the filters. Changing a filter clears the selected finding. To share a single finding, use **[Copy link]** at the top of the rail. You don't need to copy the short id by hand.

**You can also arrive from a branch link.** Click a branch in the review row of a task's detail page, or in the gate table, and the review center opens with **only that branch's findings**. Above the list, "Showing findings from branch … only." appears with a **[Clear the branch filter]** button. The counts next to the filters also cover that branch only. A finding belongs to the branch of the round in which it was **last observed**.

When the list reaches its limit and is cut short, you see **M of N**. When there are no results, an empty-state message appears in place of that line.

**The status filter has no `spec_change` value.** A finding closed by fixing the spec is listed under `Fixed`, and the rail shows what resolved it.

## Gate coverage {#gate-coverage}

Gate coverage shows, for each branch, whether it has been reviewed and whether its findings have all been resolved. In the table, **each row is one branch** and shows the reviews that covered it, the share of findings resolved and the verdict. If no review actually checked the branch, the gate is only stamping it as passed, whatever its rules say. The table shows up to the 20 most recent branches. Click a branch name to go to that branch's findings.

**The table shows the verdict, but it doesn't block merges yet.** A **Pending** verdict doesn't stop anything today. This is also noted above the table.

For a waived branch (a gate bypass), **who waived it, when and why** appears under its row, with the scope (the review kinds waived and, if it was narrowed to one commit, that commit), and the number of waivers appears under the verdict. Making sure a bypass never goes unnoticed is part of this table's job too.

**A branch without reviews gets a row when it has a waiver.** Normally the table lists only branches that have received a review. When a branch is waived, it gets a row even without any review: the review and resolved cells show `—` and the verdict is **No review**.

**You can waive a branch from this table.** Roles that can waive (admin, planner, developer) see **[Waive]** on every row and **[Waive a branch]** next to the table title. Click **[Waive]** on a row to open the waiver form under that row with its branch filled in. A branch with no review and no waiver has no row, so click **[Waive a branch]** next to the title and type its name. Choose the kinds, the commit and the reason, then click **[Record waiver]**: the table is read again and the waiver appears on that branch's row. The form and its rules are the same as on a task's review card ([Branch waivers](/help/tasks#next-step)). Your role decides which kinds you can waive: developers code and merge, planners consistency and spec coverage, admins all of them.

A waived row keeps the **No review** verdict. This table judges each branch by its reviews, while a waiver applies per review kind. In the gate verdict that a push hook or CI asks for, the waived kinds pass as `waived`.

## The sidebar badge {#badge}

In the left sidebar, the number next to **Review** under the expanded project is the count of **open `critical`** findings. If you could see this number only by opening the review center, nobody would know it until they opened it. That's why it's shown in the sidebar.

## Sending to a change request {#to-change-request}

**A finding that says the spec is wrong goes to a change request.** Findings where the implementation is right and the approved spec is wrong carry the `spec_drift` tag. The rail of an open `spec_drift` finding has **Send to CR** (planners and admins). It opens a draft from the approved version of the source spec and links the finding to that change request. If the spec already has an open change request, the finding is linked to it. The finding does not close; it stays escalated (reason: spec), and the rail shows a link to that change request. From there it continues on a card in the inbox ([Change requests from the implementation](/help/inbox#drift-change-requests)). If the change request is approved, the finding closes as a spec fix; if it is rejected, the finding is dismissed and a revert task is created.

Agents use the same path: when an agent saves a draft and points to the finding, it is linked to the same change request.

**Findings an agent escalated** show "Escalated · reason" in the rail, along with whether the session is waiting. The decision is made on the escalation card in the inbox ([Escalation cards](/help/inbox#escalations)).

## Cutover watch {#cutover}

**Two rates for the M1 dual run.** When the project's review cutover stage is M1 dual run or After M2, admins and planners see **Cutover watch** above the gate coverage table ([Gate policy](/help/settings#gates)). During the dual run, the repository's local hook and NERV each judge the same push. The local hook sends its own verdict when it asks for the gate check, and NERV applies its own verdict and records how the two compare. When the same local verdict comes again for the same branch · commit · kinds, it counts once.

- **Verdict mismatches**: how many comparisons had different verdicts from the local hook and NERV, and the rate. Admins are notified for each mismatch. Mismatch notifications for one project are grouped into one line until read.
- **Failed review submissions**: how many review submissions were queued offline and rejected by the server when resent, and the rate. A submission rejected right away is not counted, because the agent gets that answer directly.

The status at the top follows the roadmap thresholds. A mismatch rate under 1% is **Stable**. A mismatch rate of 5% or more, or a submission failure rate of 2% or more, is **Rollback trigger reached**, shown with the reason. In between is **Watching**. With no comparisons yet, it says what it is waiting for. The watch counts from when the cutover stage was changed, and shows how many days have passed (the target is 14).

**Recent mismatches** show the branch · commit · both verdicts · the local hook's name and the reason it gave. Every mismatch needs its cause found before the cutover can be declared stable.

**Review files newly committed to the repository do not appear here.** NERV does not access the repository, so count them with the CLI in a checkout ([Cutover report](/help/agents#cutover-report)).
