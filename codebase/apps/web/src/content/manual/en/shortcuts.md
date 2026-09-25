## ⌘K — go anywhere

`⌘K` (`Ctrl+K` on Windows and Linux) opens the quick switcher. The list comes in groups.

| Group                   | What is in it                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **Pinned** · **Recent** | Pinned documents and specs and tasks you opened recently — only while the input is empty |
| **This project**        | Overview · Specs · Tasks · Sessions · Reviews — when you are inside a project            |
| **Go to**               | Home · Inbox · Notifications · the four settings tabs · Help · help for this screen      |
| **Projects**            | The projects in the current organization                                                 |
| **Documents**           | Specs, requirements and tasks matching what you type — searched inside a project only    |

Typing filters every group by name — type "tokens" for the tokens tab in settings, or a project's name for that project. The English path words (`inbox` · `settings` · `tokens`) match whatever the interface language. **Pasting a stable ID** jumps straight to that document, requirement or task (tasks are found by key only). Picking a requirement opens that spec's requirements tab; picking a heading match opens that section.

**Document search happens inside a project.** On home, the inbox, notifications and settings the panel still takes you to screens and projects, but does not search specs or tasks — the placeholder says so.

| Key             | Action               |
| --------------- | -------------------- |
| `⌘K` · `Ctrl+K` | Open / close         |
| `↑` · `↓`       | Move through results |
| `Enter`         | Open                 |
| `Esc`           | Close                |

With the input empty, **what you pinned and what you opened recently** comes first — pinned on top. **Recent means what you actually opened** — specs and tasks opened from the tree, a link or a notification count too. Each row says which project it belongs to, and pressing it takes you to the document **in that project** (even from another project, or from home). Only the current organization's are shown.

Press the **☆** at the right of a row to pin that document (★); press it again to unpin. The recent list pushes yesterday's document out today, and **the five or six you open every day should not go that way.** Pins are kept **in this browser**, like the theme and the language.

Inside the panel `Tab` cycles between the input and the ☆ buttons and does not escape to the screen behind. `Esc` closes it from anywhere, and closing returns you to **where you were before opening it**. Screen readers hear the input as a combo box owning the list, and the highlighted row as the chosen one.

## The screen by keyboard

**The first `Tab` shows "Skip to main content"** — press `Enter` to skip the header and sidebar and start in the page itself.

**Menus** (organization in the left column · help and user in the header) move to their first item when opened. `Esc` closes them and returns you to the button that opened them; tabbing out of a menu closes it.

**The spec tree is a single `Tab` stop** — once inside, move with keys. The expand buttons do not take `Tab`.

| Key            | Action                                                     |
| -------------- | ---------------------------------------------------------- |
| `↑` · `↓`      | Move between rows                                          |
| `→`            | Expand a collapsed branch — if open, go to its first child |
| `←`            | Collapse an open branch — on a leaf, go to its parent      |
| `Home` · `End` | First · last                                               |
| `Enter`        | Open that document                                         |

**Notifications: `Tab` to a row and press `Enter`** — like clicking, it marks the row read and takes you there. **[Read]** is always visible when the row has focus or on a touch screen.

## Dialogs and panels

`Esc` closes — the **Spec metadata** dialog ([⋯ Metadata]), the **Create baseline** dialog, a diagram's **full screen**, the panel for a selected node in the **relationship graph**, the **spec tree** opened from the strip on a narrow screen (closing returns you to the strip's button), and any **ask-once-more confirmation** (same as cancelling it). In a dialog showing a confirmation, `Esc` closes only the confirmation. While a dialog is open `Tab` cycles inside it, and closing it returns you to **the button that opened it**.

When resolving a review finding, in the field that picks a spec, `↓` moves down into the results and `Enter` takes the first one.

## Inbox

| Key       | Action                    |
| --------- | ------------------------- |
| `j` · `k` | Move between cards        |
| `a`       | Approve                   |
| `r`       | Reject                    |
| `c`       | Write a comment           |
| `x`       | Add to the selection      |
| `⇧X`      | Select everything visible |
| `⇧A`      | Approve the selection     |
| `⇧R`      | Reject the selection      |
| `Esc`     | Clear the selection       |

They do nothing while the cursor is in a text field. The bulk keys are **uppercase** so they cannot collide with the single-card ones — the difference between one card and twenty should cost at least a `Shift`. While the confirmation list is open, `a`, `r` and `c` are inert.

**On a question card, `a` and `r` are inert.** A question is answered, not approved or rejected, so only `c` opens.

**On an approval you raised yourself, `a` does not open** — the rule that stops you approving your own work — **a draft you wrote, or one your session wrote, counts the same**, with exceptions for admins and for projects with fewer than two members (see [Inbox](/help/inbox)).

Otherwise, pressing `a` without the permission to decide does not pass quietly — **the server refuses it.** **On cards in the Decided tab neither the buttons nor the keys do anything** — a card that has already been decided ignores `a`, `r` and `c` (what you can press should be what you can do).

## Task screen (sheet over the board)

| Key       | Action                                        |
| --------- | --------------------------------------------- |
| `j` · `k` | Next and previous task in the same lane       |
| `Esc`     | Close — the board's filters stay as they were |

They do nothing while the cursor is in an input ([Tasks](/help/tasks)).

## Language

Pick **한국어 / English** from the user menu (your name ▾ at the right of the header). The screens and the error messages the server returns switch together.

**The CLI is separate.** It draws on the same catalogue of phrases, but its language comes from the environment (`NERV_LANG`, else `LC_ALL` or `LANG`), not from what you picked on the web.

Three things are never translated: **identifiers** (status values like `ready` and `approved`), **operator logs**, and **content stored in documents**. If status values differed by language, the screen and the logs would be saying different things.

## Light and dark

Pick **Light / Dark / System** from the same menu, right under the language. `System` is the choice not to choose: while it is selected the screen follows your browser (or operating system) setting, so it turns dark when your machine does. Picking Light or Dark overrides the machine setting.

**The theme is remembered by this browser, not by your account** — the same person uses a laptop by day and a desktop at night. On another machine you pick it again there.

**The language is kept in the same place.** It does not follow your account, so opening the app for the first time on another machine starts in the browser's language — pick it again there.
