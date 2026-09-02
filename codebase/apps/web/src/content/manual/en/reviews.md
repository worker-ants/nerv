The review centre collects the **findings** raised against code and specs. A review is what a machine noticed before a person read it; what to fix is a person's call.

## Review sessions and findings

One review run is one **review session**, and findings live inside it. There are four kinds of review.

| Kind            | What it looks at                                   |
| --------------- | -------------------------------------------------- |
| `code`          | The code change itself                             |
| `consistency`   | Whether documents and code contradict each other   |
| `spec_coverage` | Whether what the spec asked for was actually built |
| `merge`         | The last check before merging                      |

A session goes `running` → `complete` (or `failed`). The input it looked at — branch and commit — is attached to the session, so two reviews of the same change stay distinguishable.

## Severity and disposition

Findings carry one of three severities: `critical` · `warning` · `info`. `open` is the **state** nobody has touched yet; the **dispositions** are four.

- **Fixed** (`fixed`) — the code was changed. Record the commit hash with it.
- **Fixed by changing the spec** (`spec_change`) — the **document** was wrong, not the code. Pick which spec revision resolved it (no need to memorise version numbers — choose from the list).
- **Dismissed** (`dismissed`) — the finding was wrong, or is not a problem in this context.
- **Won't fix** (`wont_fix`) — a real problem, but not one being fixed now.

`spec_change` exists for honesty. Recording a documentation fix as `fixed` claims the code was changed; recording it as `dismissed` claims it was a false positive. Neither is true. When someone later asks "what resolved these findings", this distinction is the answer.

**Findings take comments.** They flow separately from the disposition, so the person who raised it and the person fixing it talk in the same place. From here a finding can also be **promoted to a task**: what cannot be fixed now moves to the backlog.

Dispositions are made by roles holding `review:resolve` — admin, planner and qa.

**Lowering a `critical` is a person's decision.** When an agent tries to move a `critical` finding to `dismissed` or `wont_fix`, it is not applied on the spot — an **approval card** is created instead. There is deliberately no quiet path for making a severe problem disappear.

## What needs fixing

Severity says how urgent a finding is; **area** says what needs fixing. There are four.

- `Codebase` — the implementation is wrong. Fix the code and its tests.
- `Spec` — the specification is wrong, or has drifted from the implementation. Fix the document; these usually close as `spec_change`.
- `Task` — the task definition, its scope or its delegation brief is the problem. Fix the task.
- `Process` — a convention, gate or tool: the way of working itself.

When an agent does not send this value, **the server infers it from what the finding points at**, and the card then says `inferred`. Where you see that mark, read the finding before trusting the classification — the mark exists so a guess never reads as a fact.

## Filters

Narrow the list with the four filters at the top — **severity, area, status and tag**. The number beside each value tells you in advance how many match. So that an empty list is never ambiguous between "there are none" and "they were filtered out", the screen also states **M of N**.

## Gate coverage

A gate is the rule that decides whether a change may go out. The coverage table shows what each gate actually covers — a rule that checks nothing is only stamping things as passed.

## The sidebar badge

The number on the review item in the project sidebar is the count of **open `critical`** findings. A number you only learn by opening a screen is a number nobody knows before opening it.
