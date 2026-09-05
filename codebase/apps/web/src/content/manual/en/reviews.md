The review center collects the **findings** raised against code and specs. A review is what a machine noticed before a person read it; what to fix is a person's call.

## Review sessions and findings

One review run is one **review session**, and findings live inside it. There are four kinds of review.

| Kind            | What it looks at                                   |
| --------------- | -------------------------------------------------- |
| `code`          | The code change itself                             |
| `consistency`   | Whether documents and code contradict each other   |
| `spec_coverage` | Whether what the spec asked for was actually built |
| `merge`         | The last check before merging                      |

These four are set when a review is **filed**, and they never appear on screen — they are not an axis the queue filters on.

A session goes `running` → `complete`. The input it looked at — branch and commit — is attached to the session.

**File the same change twice under the same kind and there is still one session** — no new one is made; another report joins it. What separates them is the report (the reviewer), not the session, and a round goes up when the branch moves and the change itself differs. So **the same point stays one finding across rounds**, and the card says how many times it was observed and in which recent round.

## Severity and resolution

Findings carry one of three severities: `critical` · `warning` · `info`. `open` is the **state** nobody has touched yet; the **resolutions** are four.

- **Fixed** (`fixed`) — the code was changed. Record the commit hash with it.
- **Fixed by changing the spec** (`spec_change`) — the **document** was wrong, not the code. Pick which spec version resolved it (no need to memorise version numbers — choose from the list).
- **Dismissed** (`dismissed`) — the finding was wrong, or is not a problem in this context.
- **Won't fix** (`wont_fix`) — a real problem, but not one being fixed now.

`spec_change` exists for honesty. Recording a documentation fix as `fixed` claims the code was changed; recording it as `dismissed` claims it was a false positive. Neither is true. When someone later asks "what resolved these findings", this distinction is the answer.

**Findings take comments.** They live on the **finding rail** on the right, not on the card — pick a finding in the queue and it opens (on a narrow screen the rail folds away). Beside the comments the rail carries the category, the symbol, the full path, review times and the **reason for the resolution**, and the button that **promotes a finding to a task** is there too: what cannot be fixed now moves to the backlog.

Resolutions and comments alike are made by roles holding `review:resolve` — admin, planner and qa. **Saying something and closing it take the same permission.**

**Lowering a `critical` is a person's decision.** When an agent tries to move a `critical` finding to `dismissed` or `wont_fix`, it is not applied on the spot — an **approval card** is created instead. There is deliberately no quiet path for making a severe problem disappear.

## What needs fixing

Severity says how urgent a finding is; **area** says what needs fixing. There are four.

- `Codebase` — the implementation is wrong. Fix the code and its tests.
- `Spec` — the specification is wrong, or has drifted from the implementation. Fix the document; these usually close as `spec_change`.
- `Task` — the task definition, its declared scope or its delegation brief is the problem. Fix the task.
- `Process` — a convention, gate or tool: the way of working itself.

When an agent does not send this value, **the server infers it from what the finding points at**, and the card then says `inferred`. Where you see that mark, read the finding before trusting the classification — the mark exists so a guess never reads as a fact.

## Filters

Narrow the list with the filters in the **left column** — **severity, area, status**, plus **tag** when tagged findings exist. The number beside each value tells you in advance how many match (on a narrow screen the filters move above the list).

**The default shows only `open`.** That is why a finding you have disposed of is not there; change the status filter to see it. Open a single finding by link from elsewhere and, if it falls outside the default, the screen **drops the status filter once by itself** — so following a link never lands you on an empty page.

**The status filter has no `spec_change` value.** A finding closed by fixing the spec is stored as `fixed`; what it was resolved with is written on the rail.

When the list hits its ceiling and is cut short, the screen states **M of N**. On a result of zero that line gives way to the empty-state message instead.

## Gate coverage

A gate is the rule that decides whether a change may go out. **One row is one branch**, carrying the reviews that covered it, the resolved ratio and the verdict — a rule that checks nothing is only stamping things as passed. The last 20 branches are shown.

**The table reports the verdict; it does not block yet.** Enforcement belongs to a later stage, so a red verdict stops nothing today — the screen says as much above the table.

For a branch that was bypassed, **who bypassed it, when and why** unfolds beneath its row. That a bypass never happens quietly is itself the job of this table.

## The sidebar badge

The number on the review item in the project sidebar is the count of **open `critical`** findings. A number you only learn by opening a screen is a number nobody knows before opening it.
