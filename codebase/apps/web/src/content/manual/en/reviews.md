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

Findings have three severities: `critical` · `warning` · `info`. There are four dispositions.

- `open` — nobody has touched it.
- `fixed` — it was fixed.
- `dismissed` — the finding was wrong, or is not a problem in this context.
- `wont_fix` — it is a problem, but we are leaving it for now.

**Lowering a `critical` is a person's decision.** When an agent tries to move a `critical` finding to `dismissed` or `wont_fix`, it is not applied on the spot — an **approval card** is created instead. There is deliberately no quiet path for making a severe problem disappear.

## Filters

Narrow the list with the three filters at the top — **severity, status and tag**. The number beside each value tells you in advance how many match. So that an empty list is never ambiguous between "there are none" and "they were filtered out", the screen also states **M of N**.

## Gate coverage

A gate is the rule that decides whether a change may go out. The coverage table shows what each gate actually covers — a rule that checks nothing is only stamping things as passed.

## The sidebar badge

The number on the review item in the project sidebar is the count of **open `critical`** findings. A number you only learn by opening a screen is a number nobody knows before opening it.
