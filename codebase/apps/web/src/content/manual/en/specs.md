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

## Where you can see all of them

The tree in the left sidebar holds **every document, expanded**. A place that lists things and lists only some of them leaves you unable to tell a missing document from a collapsed one. The `141 / 141` in its header is **how many are showing / how many there are**; collapse a branch and that number drops, telling you what is now hidden.

To see all of them, go to **Specs** in the left menu. That screen is the **complete list** — it opens with every document expanded, and collapsing is something you do, not the default. **A document that is not there is not in this project.**

Both the tree tab and the table tab print `Showing N of M`. When the two numbers differ, that many are collapsed or filtered out by the tree filter.

The **Status** selector above the list narrows it to one status — `draft`, `in review`, and so on. What stays is **the documents in that status and the ones above them**: the ancestors are not matches, they are there **to hold the place** (without a parent you cannot tell where a document belongs). A branch with nothing matching underneath drops out entirely. The chosen status **stays in the address, so a link hands someone the same list.** The `of M` is the project's document count, unaffected by the filter.

The **Type** selector beside it works the same way. Choose `Skeleton (vision + area)` and only the documents that **hold a place** remain, so the shape of the tree is visible at a glance — a project of 141 documents has a skeleton of 17. It is a good way to decide where a new document belongs. Set both and only what matches **both** stays.

## Versions and statuses

Specs are **not edited in place — versions accumulate.** Each version is in one of five statuses.

- `draft` — not yet a baseline for anyone.
- `in_review` — submitted, waiting on a person's decision.
- `approved` — **this is the only thing agents read.**
- `superseded` — a newer approved version exists. The document remains; the baseline moved.
- `deprecated` — no longer in use.

The badge at the top is the status of the version you are looking at. If you are reading a `superseded` version, the screen says so first — reading an outdated document as if it were current is the most common accident here.

## Baselines — reading the set as it was

Specs run ahead of implementation. While new versions get approved document by document, implementation needs to work against **the set of approved versions that were consistent with each other at the time**. Pinning a single document's version is not enough — the documents it references keep moving.

A **baseline** names that set and freezes it.

- Create one with **[Freeze current set…]** above the list (planner/admin). It captures every spec at its latest approved version as of now.
- **It cannot be changed afterwards.** To change the set, make a new one — that is what makes a given baseline answer the same way whenever you look.
- Pick one from the **baseline selector** and it stays in the address, following you into the detail view. **Hand someone the link and they see the same set.**
- A badge at the top of the document says which set you are reading. If that set does not contain this document (one created later), you get the latest version instead, marked **"not in set"** — you are never quietly handed a different version.

Tasks can carry a baseline too, so the agent working on one reads the surrounding documents from that same set.

## Comparing versions

The **Versions** tab in the rail stacks every revision. Two things are possible.

- **Compare with previous** — one button, the difference against the revision just before.
- **Pick two** — choose any two revisions in the selects and compare them.

While comparing you see the **difference**, not the editor. Requirements added or removed come first, body line changes below — that is the order review actually asks about.

**The address is the state.** `?v=3` shows revision 3 in full (read-only), `?diff=v2..v3` shows the difference between two. Copy the URL and the other person sees the same screen — no need to say "look at the third paragraph".

## Attachments

The **Attachments** tab in the rail holds mockups and documents. Drag files in or pick them.

- Formats: PNG · JPEG · GIF · WebP · SVG · PDF
- Size: **10MB** per file
- After uploading, **Insert into body** puts the image at the cursor.

Attachments hang on the **document, not the revision**. Rewriting the draft leaves them in place, and archiving the document takes them along. An external link changes independently of the spec's revisions, so "the screen this revision describes" cannot be recovered later.

Reading also goes through the server — **project members** see them, not whoever has the URL.

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

The **Relations** tab in the right rail shows both, and its sub-tabs split them by direction — because the two directions ask different questions.

| Sub-tab        | What it shows                                                         |
| -------------- | --------------------------------------------------------------------- |
| **All**        | Both directions                                                       |
| **Backlinks**  | Documents that point **at** this one — what shakes when you change it |
| **References** | Documents this one points **to** — what it leans on                   |

The number beside each tab name is how many that direction holds. You can see the count before clicking, so there is never a reason to open an empty tab.

The **relations graph** shows the same thing as a picture — the `Relations` tab on the spec list screen. Clicking a node does **not** open that document: it highlights the node and everything linked to it, and opens a panel on the right with its name and its neighbours (backlinks / references). To go to a document, **click its name in the panel.** Click the background or press `Esc` to let go.

**Drag the background to move the view**, scroll to zoom. Dragging inside an area box (the pale rectangle around a group of documents) moves the view too — selecting the box is a **single click**.

The graph's controls sit in the **top-left of the canvas** — scope (whole project / around this doc), area grouping, [Re-layout], and a **`?`** that opens the gesture help. Node and edge counts sit in the bottom-right corner.

**Nodes can be dragged.** Use it to pull apart a crowded spot; the new position lives only in this view — it does not change where the document sits in the tree, and redrawing the graph (centre mode, area grouping) restores the computed layout. **[Re-layout]** recomputes the arrangement: every run gives a different picture, which is what untangles a knot — and it is also how you undo your own dragging.

Zoomed out, **document names are not drawn.** A hundred labels too small to read cover the picture in smudges — zoom in and the names come back. Area names stay at any zoom.

## Archiving

Archiving is **not deletion.** The document drops out of lists and the tree but its address still works, and links pointing at it stay alive. A spec is the record of what was decided and why — delete it and that record is gone.

To **see archived documents again**, turn on **Show archived** in the header of the spec list. They come back into the list marked `Archived`, and the setting stays in the address (`?archived=true`), so a link you share shows the other person the same list.

**Restoring happens inside the document.** Open an archived spec and a banner appears at the top, with a **Restore** button for planners and admins. If its parent is archived the restore is refused — and the screen tells you the key of the document to restore first.

You **cannot create a document under an archived one**, and you cannot move an existing document under it either. If you could, that document would appear in no list at all — not even to the person who made it.
