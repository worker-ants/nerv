The review center is where you see the **findings** about your code and specs in one place. A review is the result of an agent checking the work before a person reads it. A person decides what to fix.

## Review sessions and findings

Each review run is one **review session**, and its findings belong to that session. There are four kinds of review.

| Kind            | What it checks                                     |
| --------------- | -------------------------------------------------- |
| `code`          | The code change itself                             |
| `consistency`   | Whether documents and code contradict each other   |
| `spec_coverage` | Whether what the spec asked for was actually built |
| `merge`         | The final check before merging                     |

The kind is set when a review is **submitted**. It doesn't appear on screen, and you can't filter the queue by it.

A session moves from `running` to `complete`. It also records which input it reviewed (branch and commit).

**If the same change is submitted twice under the same kind, there is still only one session.** No new session is created; another report is added to the existing one. A different reviewer also adds a report, not a session. The round number goes up when new commits on the branch change the diff. As a result, **the same issue stays a single finding across rounds.** The card shows how many times it was seen and the most recent round, in the form "seen N× · latest round M".

## Severity and resolution

A finding has one of three severities: `critical`, `warning` or `info`. `open` is the **state** of a finding that nobody has acted on yet. There are four **resolutions**:

- **Fixed** (`fixed`) — The code was changed. Record the commit hash with it.
- **Spec fix** (`spec_change`) — The code was right and the **document** was wrong. Pick from the list which version of which spec resolved it. You don't need to remember version numbers.
- **Dismissed** (`dismissed`) — The finding is wrong, or it isn't a problem in this context.
- **Won't fix** (`wont_fix`) — The problem is real, but it won't be fixed now. Record a reason, and the finding is removed from the queue. **If it should be fixed later, add it as a task instead** (see below).

`spec_change` exists to keep the record honest. Resolving a documentation fix as `fixed` would mean the code was changed. Resolving it as `dismissed` would mean the finding was a false positive. Neither is true. When you later need to know how these findings were resolved, this distinction gives you the answer.

**You can comment on findings.** Comments are on the **finding rail** on the right, not on the card. Select a finding in the queue to open the rail. **On a narrow screen, it opens below that card instead.** Only the position changes; the content is the same. Along with the comments, the rail shows the category, symbol, full path, review time and the **rationale for the resolution**. The **[Add as task]** button is on the rail too. Use it to move a finding you can't fix now into the backlog. Once the finding is added, the button is replaced by **a link to the new task**, and the toast also has an [Open] button. If you try to add the same finding again, no new task is created. Instead, you see **which task** it was already added as. Queue cards also show the task a finding **came from** (Task {key}) and the task it **was added as** (→ {key}). Click either one to go to that task.

**Resolve a finding where you read it.** The four resolution buttons are at the top of the rail. Clicking one opens the rationale form **inside the rail** and moves the cursor to the rationale field. Clicking a resolution button on a queue card also opens the rail on that finding, with the form in the rail. That way you can write the rationale while reading the full text and the comments. Hover over a button to see what that resolution requires (a commit hash, the corrected spec or a rationale).

**You can also select findings with the keyboard.** A card's title is a button: press `Tab` to reach it and `Enter` to select it. Outside a text field, `j` and `k` move through the queue one card at a time. On the sessions screen, each row's name is also a button.

Only roles with the `review:resolve` scope (admin, planner and qa) can resolve findings or comment on them. **Commenting on a finding and closing it take the same scope.** **Adding a finding as a task takes a different scope** (`task:update`), so developers can do it too. If you lack the scope for a button, hover over it or reach it with `Tab` to see why it's unavailable.

**Only a person can dismiss a `critical` finding or mark it won't fix.** When an agent tries to resolve a `critical` finding as `dismissed` or `wont_fix`, the change isn't applied right away. An **approval card** is created instead. This way, a serious problem can't be removed without anyone noticing.

## What needs fixing

Severity shows how urgent a finding is. **Area** shows what needs fixing. There are four areas.

- `Code` — The implementation is wrong. Fix the code and its tests.
- `Spec` — The spec is wrong or has drifted from the implementation. Fix the document. These findings usually close as `spec_change`.
- `Task` — The problem is in the task definition, its declared scope or its delegation brief. Fix the task itself.
- `Process` — The problem is in the way of working, such as a convention, a gate or a tool.

When an agent doesn't send this value, **the server infers the area from what the finding points to** and marks the card `inferred`. When you see that mark, read the finding before you trust its area. The mark is there so that a guess never looks like a fact.

## Filters

Narrow the queue with the filters in the **left column**: **Severity**, **Area** and **Status**, plus **Tags** when some findings are tagged. The number next to each value shows how many findings match under the current filters. On a narrow screen, the filters move above the list.

**By default, only `Open` findings are shown.** That's why findings you've resolved don't appear. To see them, change the status filter. If you open a finding from a link on another screen and it doesn't match the default filter, **the status filter is cleared automatically, once**. That way, following a link never lands you on an empty screen.

**The filters you apply and the finding you select are kept in the URL.** For example, if you share a URL narrowed to area `Spec`, severity `critical` and status `Open`, the recipient sees the same queue. Reloading the page or going back keeps the filters. Changing a filter clears the selected finding. To share a single finding, use **[Copy link]** at the top of the rail. You don't need to copy the short id by hand.

**You can also arrive from a branch link.** Click a branch in the review row of a task's detail page, or in the gate table, and the review center opens with **only that branch's findings**. Above the list, "Showing findings from branch … only." appears with a **[Clear the branch filter]** button. The counts next to the filters also cover that branch only. A finding belongs to the branch of the round in which it was **last observed**.

When the list reaches its limit and is cut short, you see **M of N**. When there are no results, an empty-state message appears in place of that line.

**The status filter has no `spec_change` value.** A finding closed by fixing the spec is listed under `Fixed`, and the rail shows what resolved it.

## Gate coverage

A gate is the rule that decides whether a change can ship. In the table, **each row is one branch** and shows the reviews that covered it, the share of findings resolved and the verdict. If no review actually checked the branch, the gate is only stamping it as passed, whatever its rules say. The table shows up to the 20 most recent branches. Click a branch name to go to that branch's findings.

**The table shows the verdict, but it doesn't block merges yet.** Blocking comes in a later stage, so a red verdict doesn't stop anything today. This is also noted above the table.

For a waived branch (a gate bypass), **who waived it, when and why** appears under its row. Making sure a bypass never goes unnoticed is part of this table's job too.

## The sidebar badge

In the left sidebar, the number next to **Review** under the expanded project is the count of **open `critical`** findings. If you could see this number only by opening the review center, nobody would know it until they opened it. That's why it's shown in the sidebar.
