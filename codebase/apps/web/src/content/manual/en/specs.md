Specs are the central documents of this product. **The spec is the baseline**, not the code, and a spec is what an agent reads before it implements anything.

## The tree and the types

The tree on the left is the structure of your specs. There are six types, and the type says what kind of document it is.

| Type         | What it holds                                          |
| ------------ | ------------------------------------------------------ |
| `vision`     | What this product is                                   |
| `area`       | An area — a grouping that carries documents beneath it |
| `feature`    | A single feature                                       |
| `design`     | Design and screens                                     |
| `convention` | A convention — a way things must be done               |
| `adr`        | A decision record — what was decided and why           |

An `area` may hold a place in the tree with no body of its own. For the rest, the body is the document.

## Versions and statuses

Specs are **not edited in place — versions accumulate.** Each version is in one of five statuses.

- `draft` — not yet a baseline for anyone.
- `in_review` — submitted, waiting on a person's decision.
- `approved` — **this is the only thing agents read.**
- `superseded` — a newer approved version exists. The document remains; the baseline moved.
- `deprecated` — no longer in use.

The badge at the top is the status of the version you are looking at. If you are reading a `superseded` version, the screen says so first — reading an outdated document as if it were current is the most common accident here.

## The edit lease

If two people edit one document at once, one person's writing disappears. So editing takes a **lease**.

- Starting an edit takes a 30-minute lease. It renews itself while you type.
- If someone else holds it, the screen turns **read-only** and names the holder.
- You can **request a handover**. The request arrives on their screen.
- If you walk away, the lease expires and the next person can take it.

If the base version changed while you were writing, the save is refused: the screen offers your text **so you can copy it** and then reloads the newest version. Nothing is silently overwritten.

## Checks and submission

When a draft is ready, run the **checks**. The checkers look for contradictions between documents, broken chains of rationale, and empty promises. Results appear next to the body.

**Request review** moves the version to `in_review` and creates a card in the inbox. Authors cannot approve their own specs.

## Comments

Select a passage and comment on it — comments **attach to a sentence, not to a document**. Close a comment as `resolved` once it has been addressed. If open comments remain, the submit screen tells you how many.

## Requirements

Requirements in a spec body are extracted and carry their own implementation status: `unimplemented` → `in_progress` → `implemented` → `verified`. Priorities are `must` · `should` · `could`.

These statuses are what produce **coverage** on the project screen. That axis only moves when tasks are linked to requirements (see [Tasks](/help/tasks)).

## Relations and backlinks

When a document refers to another in its body, a `references` relation is created **automatically**. The other relations — `refines` · `depends_on` · `duplicates` · `supersedes` — are judgements you only make by reading, so a person or an agent declares them.

**Backlinks** in the right rail are the documents that point at this one. That is where you see what shakes when you change something.

## Archiving

Archiving is **not deletion.** The document drops out of lists and the tree but its address still works, and links pointing at it stay alive. A spec is the record of what was decided and why — delete it and that record is gone.
