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

The **Status** selector above the list narrows it by status — `draft`, `in review`, or the two together. What stays is **the documents in that status and the ones above them**: the ancestors are not matches, they are there **to hold the place** (without a parent you cannot tell where a document belongs). A branch with nothing matching underneath drops out entirely. The chosen status **stays in the address, so a link hands someone the same list.** The `of M` is the project's document count, unaffected by the filter.

The **Type** selector beside it works the same way. Choose `Skeleton (vision + area)` and only the documents that **hold a place** remain, so the shape of the tree is visible at a glance — a project of 141 documents has a skeleton of 17. It is a good way to decide where a new document belongs. Set both and only what matches **both** stays.

Both selectors appear **only on the tree tab**, in the tree's own control row beside the filter and the expand/collapse buttons — switch to the table or the relationship graph and they are gone.

## Versions and statuses

Specs are **not edited in place — versions accumulate.** Each version is in one of five statuses.

- `draft` — not yet a baseline for anyone.
- `in_review` — submitted, waiting on a person's decision.
- `approved` — **this is the only thing agents read.**
- `superseded` — a newer approved version exists. The document remains; the baseline moved.
- `deprecated` — no longer in use.

**How to see a draft.** One of three ways.

1. Pick `draft` in the **Status** selector above the list — it stays in the address, so a link hands someone the same view.
2. **A document that has never been approved** opens on its draft.
3. A document with a newer draft above an approved version opens on the approved one. Then pick the draft in the **Versions** tab on the rail — the list is there regardless of status, and choosing one puts `?v=4` in the address for you to pass on.

The badge at the top is the status of the version you are looking at. If you are reading a `superseded` version, the screen says so first — reading an outdated document as if it were current is the most common accident here.

## Baselines — reading the set as it was

Specs run ahead of implementation. While new versions get approved document by document, implementation needs to work against **the set of approved versions that were consistent with each other at the time**. Pinning a single document's version is not enough — the documents it references keep moving.

A **baseline** names that set and freezes it.

- Create one with **[Create baseline…]** above the list (planner/admin). It captures every spec at its latest approved version as of now.
- **It cannot be changed afterwards.** To change the set, make a new one — that is what makes a given baseline answer the same way whenever you look.
- Pick one from the **baseline selector** and **the list itself becomes that set** — only the documents it holds, at the revisions it holds them. Documents created after the baseline was made do not appear (if they did, you would read the set as holding them). The choice stays in the address and follows you into the detail view, so **hand someone the link and they see the same set.**
- While a baseline is chosen the **status and type filters are gone** — everything in the set is approved, so there is nothing to filter by.
- With nothing chosen the selector reads **No baseline**. Then each document reads at its latest approved version — or, if it has **never been approved, at its current one (the draft)**.
- A badge at the top of the document says which set you are reading. If that set does not contain this document (one created later), you get the latest version instead, marked **"not in set"** — you are never quietly handed a different version.

Tasks can carry a baseline too, so the agent working on one reads the surrounding documents from that same set.

## Comparing versions

The **Versions** tab in the rail holds the **eight most recent** revisions (the count beside the tab name is the total, so on a document past eight the two numbers differ). Two things are possible.

- **Compare with previous** — one button, the difference against the revision just before.
- **Pick two** — choose any two revisions in the selects and compare them.

While comparing you see the **difference**, not the editor. Requirements added or removed come first, body line changes below — that is the order review actually asks about.

**The address is the state.** `?v=3` shows revision 3 in full (read-only), `?diff=v2..v3` shows the difference between two. Copy the URL and the other person sees the same screen — no need to say "look at the third paragraph".

## Attachments

The **Attachments** tab in the rail holds mockups and documents. Drag files in or pick them.

- Nine formats — images `png` · `jpeg` · `gif` · `webp` · `svg`, documents `pdf` · `html` · `txt`, and `zip` archives.
- Size: **10MB** per file
- After uploading, **Insert into body** puts the image at the cursor.

Attachments hang on the **document, not the revision**. Rewriting the draft leaves them in place, and archiving the document takes them along. An external link changes independently of the spec's revisions, so "the screen this revision describes" cannot be recovered later.

Reading also goes through the server — **project members** see them, not whoever has the URL.

## The edit lease

If two people edit one document at once, one person's writing disappears. So editing takes a **lease**.

- The lease is taken on your **first save**, not when you open the document (30 minutes), and it renews itself while you type.
- Which means **you also find out someone else holds it by saving.** A save on a document held by someone else is refused; the screen then turns read-only and names the holder.
- A **Take over** button sits right there. It does not send a request — pressing it **takes the lease on the spot**, and nothing arrives on the other person's screen. It is the way out of a lease held by a session that has died.
- If you walk away, the lease expires and the next person can take it.

If the base version changed while you were writing, the save is refused and the screen hands your text back. **You choose the next step** — **Copy** takes your writing with you, **Reload** brings in the newest version. Nothing is overwritten quietly, and nothing is discarded quietly either.

## Checks and submission

The checks are not something you press — they run **automatically** when you open the document, and the result sits **above** the body as a `Pre-review` panel. The checkers look for contradictions between documents, broken chains of rationale, and empty promises.

If the result holds even one **block**, [Request review] is locked. The server refuses it too, so fix what is blocking first.

**Requesting review does not always reach a person.** A gate grades the document, and at the low grades (T0, T1) it goes **straight to `approved`** with no approval step — the screen says the gate passed. A card appears in the inbox at T2 and T3 (grades are in the [settings](/help/settings) chapter).

When a person does decide, authors cannot approve their own specs — **except in a project with fewer than two members.** Being unable to move at all in a project you work alone in is worse, and anything that passes that way is recorded in the audit log.

To start the next revision from an approved document, press **New draft** in the document header.

## Comments

Comments belong to **a place, not to the document as a whole**. You do not drag over the text to leave one, though: you type the **anchor** into the comment box — a heading slug (say `3-input`) or a requirement number (`REQ-…`). Close a comment as `resolved` once it has been addressed.

Leaving a comment needs only **`spec:read`** — a viewer can raise one. Closing it is for the roles that can write drafts.

What the confirmation dialog counts before you submit is not comments but **how many documents reference this one and how many tasks came out of it** — so you see what an approval will shake.

## Requirements

Requirements in a spec body are extracted and carry their own implementation status: `unimplemented` → `in_progress` → `implemented` → `verified`. Priorities are `must` · `should` · `could`.

**Progress** on the project screen counts these statuses. Of its five numbers, the last two are the point of the screen.

| Number               | What it counts                                            |
| -------------------- | --------------------------------------------------------- |
| Requirements         | Every live requirement                                    |
| Implemented          | `implemented` or `verified`                               |
| Verified             | `verified`                                                |
| **Missing evidence** | Called `implemented` with **no evidence attached at all** |
| **Empty promises**   | Still unimplemented with **no task taking it on**         |

**Missing evidence** is "you said it was done and there is nothing to show"; **empty promises** is "you wrote it down and nobody took it". You bring the first down by attaching evidence, the second by making a task and linking it to the requirement (see [Tasks](/help/tasks)).

Requirement rows are created from the body **when a version is approved**. Writing EARS sentences into a draft is not enough — a draft is not yet a promise. When a sentence drops out of a later revision the row is not deleted; **which revision dropped it** is recorded instead.

Priority starts at `must`, because the EARS line in the body does not carry one.

**Implementation status is not something a person marks.** The server derives it from the tasks that came out of that requirement.

| Status          | When                                                           |
| --------------- | -------------------------------------------------------------- |
| `unimplemented` | Every derived task is `backlog` or `ready`                     |
| `in_progress`   | At least one is **claimed** or under way                       |
| `implemented`   | All are `done` **and** there is at least one piece of evidence |

**All done with no evidence stays `in_progress`** — to say it is finished, attach something to show. `verified` is not marked by the server yet: its conditions (a QA verification record, and no open `critical` in that commit range) are not something the data carries today, and marking it without them would make the value mean nothing. Values that came in through the importer are left alone.

The document header also carries a **references updated** badge: it lights when a document this one points at has moved ahead of the version you are reading, and it names which one. It is the server's judgement, not the screen's guess.

## Relations and backlinks

Write another document as a **link** in the body and a `references` relation is created **automatically**. Link means a **Markdown link** — a title in square brackets followed by the address in parentheses. A spec key typed into prose as plain text creates nothing. Only the places where a person pressed "this is that document" are counted. The other relations — `refines` · `depends_on` · `duplicates` · `supersedes` — are judgements you only make by reading, so a person or an agent declares them.

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

Archiving can be **refused** — a document with live children, or with a task of its own that someone is holding, is blocked. The screen then lists what blocked it.

Archiving is **not deletion.** The document drops out of lists and the tree but its address still works, and links pointing at it stay alive. A spec is the record of what was decided and why — delete it and that record is gone.

To **see archived documents again**, turn on **Show archived** in the header of the spec list. They come back into the list marked `Archived`, and the setting stays in the address (`?archived=true`), so a link you share shows the other person the same list.

**Restoring happens inside the document.** Open an archived spec and a banner appears at the top, with a **Restore** button for planners and admins. If its parent is archived the restore is refused — and the screen tells you the key of the document to restore first.

You **cannot create a document under an archived one**, and you cannot move an existing document under it either. If you could, that document would appear in no list at all — not even to the person who made it.
