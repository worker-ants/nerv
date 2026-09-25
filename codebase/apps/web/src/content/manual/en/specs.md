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

**Open a document and a spec tree column stands beside the sidebar.** It holds **every document, expanded**. A place that lists things and lists only some of them leaves you unable to tell a missing document from a collapsed one. The `141 / 141` in its header is **how many are showing / how many there are**; collapse a branch and that number drops, telling you what is now hidden.

**The top of the spec list shows how many documents are in each status** (draft · in review · approved …). Pressing one opens the tree filtered to that status; pressing it again clears it. The end of each row in the full tree shows **the current version · last updated · 💬 open comments**, so you can pick what needs work from the rows alone. **[Create baseline]** is for planners and admins; other roles see it locked with the reason.

The **chevron** in front of a branch folds and unfolds that branch. Branches above the document you are viewing fold too — a folded branch that holds it gets a **blue dot** before its title, so you can tell where you are. Moving to another document unfolds the path to it again.

The header has three buttons.

- **Target** — go to the document you are viewing. It unfolds the branches above it and scrolls to its line. It appears only while you are viewing a document.
- **Arrows pointing apart** — expand all. Dimmed when everything is already expanded.
- **Arrows pointing together** — collapse all. It folds down to the roots even while you are viewing a document. Dimmed when everything is already collapsed.

What you fold is remembered, and the tree column beside a document and the spec list screen remember it **separately**.

**The tree column stands only while you are reading a document** — on tasks, sessions and reviews that width goes to the page itself. Type in **Filter by title or key** at the top of the column and only documents whose title or key matches remain (to search contents, use ⌘K or the spec list's search). On a wide screen, **[Hide spec tree]** at the end of its header folds it away, and this browser remembers that — press the strip at the left edge to bring it back. On a narrow screen the strip opens the tree over the page, and picking a document or pressing `Esc` closes it.

To see all of them, go to **Specs** in the left menu. That screen is the **complete list** — it opens with every document expanded, and collapsing is something you do, not the default. **A document that is not there is not in this project.**

Both the tree tab and the table tab print `Showing N of M`. When the two numbers differ, that many are collapsed or filtered out by **Filter by title or key**. The list has no separate tree column — the tree on this screen is that column's full-screen version.

The **Status** selector above the list narrows it by status — `draft`, `in review`, or the two together. What stays is **the documents in that status and the ones above them**: the ancestors are not matches, they are there **to hold the place** (without a parent you cannot tell where a document belongs). A branch with nothing matching underneath drops out entirely. The chosen status **stays in the address, so a link hands someone the same list.** The `of M` is the project's document count, unaffected by the filter.

The **Type** selector beside it works the same way. Choose `Skeleton (vision + area)` and only the documents that **hold a place** remain, so the shape of the tree is visible at a glance — a project of 141 documents has a skeleton of 17. It is a good way to decide where a new document belongs. Set both and only what matches **both** stays.

Both selectors appear **only on the tree tab**, in the tree's own control row beside **Filter by title or key** and the expand/collapse buttons — switch to the table or the relationship graph and they are gone.

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

The badge at the top is the status of the version you are looking at. If you are reading a `superseded` version, the screen says so first — reading an outdated document as if it were current is the most common accident here. Open another version with `?v=` and the badge, version, pre-review, [Request review] and comments **all belong to that version**. If you are reading the approved version and a newer draft exists, a banner above the body says so and offers **[Open vN]·[changes]**. Links an agent hands you, approval cards in the Inbox and a task's source-spec link open **that version**.

**The line under the title is the next step.** A draft shows **[Request review]**, a document in review shows **[Open in the Inbox]** (the decision happens on that card), an approved version shows **[Create a task]** — the form for deriving a task from that version (documents without requirements work too). Beside it, chips show the **open comment count** and the **requirement count**; pressing one opens that tab in the right rail. **[Hand off to an agent]** takes you to the [Continue in the terminal] card at the bottom of the rail.

## Baselines — reading the set as it was

Specs run ahead of implementation. While new versions get approved document by document, implementation needs to work against **the set of approved versions that were consistent with each other at the time**. Pinning a single document's version is not enough — the documents it references keep moving.

A **baseline** names that set and freezes it.

- Create one with **[Create baseline]** above the list (planner/admin). It captures every spec at its latest approved version as of now.
- **It cannot be changed afterwards.** To change the set, make a new one — that is what makes a given baseline answer the same way whenever you look.
- Pick one from the **baseline selector** and **the list itself becomes that set** — only the documents it holds, at the versions it holds them. Documents created after the baseline was made do not appear (if they did, you would read the set as holding them). The choice stays in the address and follows you into the detail view, so **hand someone the link and they see the same set.**
- While a baseline is chosen the **status and type filters are gone** — everything in the set is approved, so there is nothing to filter by.
- With nothing chosen the selector reads **No baseline**. Then each document reads at its latest approved version — or, if it has **never been approved, at its current one (the draft)**.
- A badge at the top of the document says which set you are reading. If that set does not contain this document (one created later), you get the latest version instead, marked **"not in set"** — you are never quietly handed a different version.
- **You can change or drop the baseline from the document too.** While reading by a baseline, a baseline selector sits in the document header; pick **No baseline** to go back to the latest. Moving to a neighbouring document — from the tree, the table, the graph, a relation row in the rail or the left sidebar — keeps the same set.

Tasks can carry a baseline too, so the agent working on one reads the surrounding documents from that same set.

## Comparing versions

The **Versions** tab in the rail holds the **eight most recent** versions (the count beside the tab name is the total, so on a document past eight the two numbers differ). Two things are possible.

- **Compare with previous** — one button, the difference against the version just before.
- **Pick two** — choose any two versions in the selects and compare them.

While comparing you see the **difference**, not the editor. Requirements added or removed come first, body line changes below — that is the order review actually asks about.

**The address is the state.** `?v=3` shows version 3 in full (read-only), `?diff=v2..v3` shows the difference between two. Copy the URL and the other person sees the same screen — no need to say "look at the third paragraph". Opening a comparison, switching to another pair or closing it **keeps the rail tab and the baseline** as they were.

## Attachments

The **Attachments** tab in the rail holds mockups and documents. Drag files in or pick them.

- Nine formats — images `png` · `jpeg` · `gif` · `webp` · `svg`, documents `pdf` · `html` · `txt`, and `zip` archives.
- Size: **10MB** per file
- After uploading, **Insert into body** puts it at the cursor — images as images, everything else as a **link**.

**Deleting an attachment cannot be undone, so it asks once more** — the file is removed from storage too, and if the body points to it, that spot breaks.

Attachments hang on the **document, not the version**. Rewriting the draft leaves them in place, and archiving the document takes them along. An external link changes independently of the spec's versions, so "the screen this version describes" cannot be recovered later.

Reading also goes through the server — **project members** see them, not whoever has the URL.

`html` attachments **open rendered** — mockups and reports run their scripts. The page opens **isolated** while they do: it cannot reach your session or any other NERV screen, and anything that would send what you typed back out (a form submission) stays blocked. Every other format, `svg` included, renders without scripts.

## Diagrams

A ` ```mermaid ` code block in the body **renders as a diagram.** There is no reason to draw ASCII art — the syntax is [mermaid](https://mermaid.js.org) as-is.

- **The diagram is the default**, on approved documents and drafts alike.
- **[Code]** at the top right of the block brings the source back; edit it there. **[Diagram]** returns.
- Bad syntax leaves the code standing and **says it is wrong** — never a place with neither a picture nor words.
- **You can make it bigger.** `−` and `+` at the top right change the scale, and the number between them snaps back to 100%. When a diagram is wider than the column, pan it where it stands.
- **Full screen** (`⤡`) gives the diagram the whole window — not a new tab, so closing it leaves you where you were reading. The scale in the body and in full screen are remembered separately.
- What is saved is always the code. Neither the diagram nor the scale is part of the document — both are ways of looking.

## Who writes the body

**You do not edit the body on the web.** This is where you read, decide and attach — agents write the body.

The [Continue in the terminal] card below the document holds the command. Copy it, paste it in a terminal, and the agent opens that document and carries on.

```text
claude "/nerv:spec edit SPC-CWC-007"
```

**Why it is set up this way.** A web editor has to render markdown _and_ turn it back into markdown, and the way back was never complete — a pipe inside a table cell, or consecutive block quotes, left documents **the editor would open but refuse to save** (3 of 22 measured), and the advice at that point was "fix it in the terminal". One road that works beats two roads that each work halfway.

What stays on the web is **what a person does**: requesting review, approving, metadata (title, parent), archiving and restoring, attachments, comments.

**In a project with no specs at all**, the spec list shows how to start — `claude "/nerv:spec new"` to run in a terminal (with a copy button), **the install guide and issuing a token** if no agent is connected yet, and the CLI importer if you already have documents ("Importing documents" in the [Agents](/help/agents) chapter). The tree in the sidebar sends you there in one line. A role that cannot draft specs (viewer) sees who writes them instead of the command.

## Getting around a long document

- **[Contents ▾]** in the meta row takes you to a section (`##`·`###`). It appears only when a document has two sections or more.
- **Anchors take you to their section when pressed** — the anchor on a pre-review finding, on a comment, and `#…` links inside the body alike. A finding that points at a requirement number (`REQ-…`) opens the Requirements tab in the rail.
- Where you went stays in **the address's `#…`**, so you can pass it on. Both a heading slug (`#3-gameplay`) and a section number (`#3`) work — a section link like `…/specs/SUD-AREA-PLAY#3` that an agent puts in the body lands on that section.
- Links to other specs inside the body move **within the app** (the page does not reload). Links that leave the app open in a new tab.
- If the body's first line is a `# Title` identical to the document title, the reader does not draw it — so the title does not appear twice. It is still there in the Source tab and the original.
- Lines in the Source tab have **numbers**. The numbers are not copied, and `#L120` at the end of the address takes you to that line.
- When the window is narrow and the rail sits below the body, pressing a chip at the top or arriving with a `?rail=…` address **scrolls you down to the rail.** The rail tabs move with the left and right arrow keys.

## Two ways to look at the body

The **Reader / Source** tabs above the body choose how you look at it.

- **Reader** — read it as a picture. Tables and links are live, and ` ```mermaid ` renders as a diagram.
- **Source** — the raw markdown. **[Copy]** at the top right takes the whole thing — handing it to an agent by dragging across it mixes up the line breaks and indentation.

The tab you pick **stays in the address** (`?body=source`), so the link you send opens on the same view.

## Checks and submission

The checks are not something you press — they run **automatically** when you open the document, and the result sits **above** the body as a `Pre-review` panel. The checkers look for contradictions between documents, broken chains of rationale, and empty promises.

If the result holds even one **block**, [Request review] is locked. The server refuses it too, so fix what is blocking first. When it is locked, **"N blocking pre-review findings"** appears beside the button and takes you to the results.

**Requesting review does not always reach a person.** A gate grades the document, and at the low grades (T0, T1) it goes **straight to `approved`** with no approval step — the screen says the gate passed. A card appears in the inbox at T2 and T3 (grades are in the [settings](/help/settings) chapter).

When a person does decide, authors cannot approve their own specs — **except when nobody else could approve that document.** Being unable to move at all in a project you work alone in is worse, and anything that passes that way is recorded in the audit log.

**Submitting for review is for the author, a planner or an admin.** Having someone else submit it makes them the requester, but the author still cannot approve it — the server looks at all three: requester, author, and the owner of the session that wrote it.

To start the next version from an approved document, press **New draft** in the document header.

## Comments

Comments belong to **a place, not to the document as a whole**. You do not drag over the text to leave one: you **pick an anchor** in the comment box — the headings of the version you are looking at and the requirement numbers (`REQ-…`) are the choices (you type one in only for a document that has nothing to pick). Close a comment as `resolved` once it has been addressed.

Each comment shows **who (for an agent, which machine and which agent) · when · on which version** it was left. The count beside the tab name and the chip at the top count **open comments only**. Resolved ones sit behind **[Show N resolved]** under the list, together with who resolved them. Comments whose heading has gone from the body are gathered at the top as **lost anchors** — pressing them leads nowhere, so check first whether the point still stands. If leaving or resolving a comment fails (say, no permission to resolve), the reason is shown.

Leaving a comment needs only **`spec:read`** — a viewer can raise one. Closing it is for the roles that can write drafts.

What the confirmation dialog counts before you submit is not comments but **how many documents reference this one and how many tasks came out of it** — so you see what an approval will shake.

## Requirements

Requirements in a spec body are extracted and carry their own implementation status: `unimplemented` → `in_progress` → `implemented` → `verified`. Priorities are `must` · `should` · `could`.

**A requirement is one line in the body.** There is a single format — `- REQ-<prefix>-<number> WHEN <condition> THE SYSTEM SHALL <behaviour>`. The sentence starts with one of WHEN · WHILE · IF.

```text
- REQ-CWC-031 WHEN a visitor opens the widget for the first time THE SYSTEM SHALL restore the previous conversation
- REQ-CWC-032 WHILE the connection is down THE SYSTEM SHALL queue outgoing messages
- REQ-CWC-033 IF the conversation to restore is older than 30 days THE SYSTEM SHALL start a new one
```

The agent takes the number from the server, so nobody counts them by hand. **Requirement rows are created from these lines when the document is approved** — which is why the Requirements tab of a draft that was never approved is empty. Lines that break the format show up as warnings in the pre-review.

**Progress** on the project screen counts these statuses. Of its five numbers, the last two are the point of the screen.

| Number               | What it counts                                            |
| -------------------- | --------------------------------------------------------- |
| Requirements         | Every live requirement                                    |
| Implemented          | `implemented` or `verified`                               |
| Verified             | `verified`                                                |
| **Missing evidence** | Called `implemented` with **no evidence attached at all** |
| **Empty promises**   | Still unimplemented with **no task taking it on**         |

**Missing evidence** is "you said it was done and there is nothing to show"; **empty promises** is "you wrote it down and nobody took it". You bring the first down by attaching evidence, the second by making a task and linking it to the requirement (see [Tasks](/help/tasks)).

**Which requirement it is, you read on the document.** The project screen's numbers only say how many. The **Requirements** tab on the right of a spec lists that document's requirements one per line, each with its derived-task and evidence counts — and a line where both are zero stands out in **red**. Below it, **Derived tasks** shows the work that came out of this document and is still moving (`ready`, `in_progress`, `blocked`); [See all on the board] opens the task board with the same filter applied.

Requirement rows are created from the body **when a version is approved**. Writing EARS sentences into a draft is not enough — a draft is not yet a promise. When a sentence drops out of a later version the row is not deleted; **which version dropped it** is recorded instead.

Priority starts at `must`, because the EARS line in the body does not carry one. Imported requirements are different: when the source states no priority, it is **left empty** (the screen says "no priority"). Filling in `must` for something the source never said would read as if the source had said it.

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

The **relations graph** shows the same thing as a picture — the `Relations` tab on the spec list screen. Clicking a node does **not** open that document: it highlights the node and everything linked to it, and opens a panel on the right with its name and its neighbors (backlinks / references). To go to a document, **click its name in the panel.** Click the background or press `Esc` to let go. **The view you are on (tree, table, graph) and the graph's centre document stay in the address** — go into a document and come back, and it is as you left it; send the link and the other person sees the same picture. **[View in graph →]** at the head of the **Relations** tab in a document's rail opens the graph centred on that document.

**Color is the document type, size is the backlink count.** The **legend at the bottom-left** of the canvas spells both out — vision, feature, design, convention and decision each have their own color, and an area is drawn as a pale rectangle rather than a circle, so the legend shows it as a rectangle too. Only the types actually drawn appear in the legend.

A bigger node means more documents point at it. Two things keep you from misreading it — the most-referenced documents all **stop at one size** (there is a cap, so a single hub cannot swallow the picture), and size counts only **what is currently drawn**, so the same document looks smaller in centered mode. **For the exact number, click the node** and read the `Backlinks` tab in the panel on the right. The panel header also carries the selected document's color dot and type, so you never have to walk back to the legend.

**Drag the background to move the view**, scroll to zoom. Dragging inside an area box (the pale rectangle around a group of documents) moves the view too — selecting the box is a **single click**.

**Sibling area boxes never overlap.** So a box drawn inside another box really is a parent-child relationship — you never have to squint to tell nesting from a collision.

The graph's controls sit in the **top-left of the canvas** — view scope (whole project / around this doc), area grouping, [Re-layout], and a **`?`** that opens both **how to read** the picture (color, size, fading) and the gestures. Node and edge counts sit in the bottom-right corner; the legend sits in the bottom-left.

**Nodes can be dragged.** Use it to pull apart a crowded spot; the new position lives only in this view — it does not change where the document sits in the tree, and redrawing the graph (center mode, area grouping) restores the computed layout. **[Re-layout]** recomputes the arrangement: every run gives a different picture, which is what untangles a knot — and it is also how you undo your own dragging.

Zoomed out, **document names are not drawn.** A hundred labels too small to read cover the picture in smudges — zoom in and the names come back. Area names stay at any zoom.

**When two names overlap, only one is drawn.** A name you cannot read because something covers it is just as unreadable, so the one with more backlinks keeps its label. Zooming in does **not** bring the hidden one back — the text grows with the picture, so the overlap is unchanged. Use one of three things instead: **click the node** (a selected document always shows its name, and once the rest fades its neighbors' names come back), **drag them apart**, or read the **table tab**. The panel on the right spells the names out anyway.

## Archiving

**[Archive] in the metadata asks once more** — the document leaves the list and the tree, and the only way back is [Restore] at its own address. Esc closes just that confirmation; press it again to close the metadata window.

Archiving can be **refused** — a document with live children, or with a task of its own that someone is holding, is blocked. The screen then lists what blocked it, and each key takes you to the document or task to sort out.

Archiving is **not deletion.** The document drops out of lists and the tree but its address still works, and links pointing at it stay alive. A spec is the record of what was decided and why — delete it and that record is gone.

To **see archived documents again**, turn on **Show archived** in the header of the spec list. They come back into the list marked `Archived`, and the setting stays in the address (`?archived=true`), so a link you share shows the other person the same list.

**Restoring happens inside the document.** Open an archived spec and a banner appears at the top, with a **Restore** button for planners and admins. If its parent is archived the restore is refused — and the screen tells you the key of the document to restore first.

You **cannot create a document under an archived one**, and you cannot move an existing document under it either. If you could, that document would appear in no list at all — not even to the person who made it.
