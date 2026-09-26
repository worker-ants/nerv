## ⌘K — go anywhere

`⌘K` (`Ctrl+K` on Windows and Linux) opens the quick switcher. Results are grouped as follows.

| Group                   | What is in it                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **Pinned** · **Recent** | Documents you pinned, and specs and tasks you opened recently (only while the input is empty) |
| **This project**        | Overview · Specs · Tasks · Sessions · Reviews (when you are inside a project)                 |
| **Go to**               | Home · Inbox · Notifications · the five settings pages · Help · Help for this screen          |
| **Projects**            | Projects in the current organization                                                          |
| **Documents**           | Specs, requirements and tasks that match your search (inside a project only)                  |

Typing narrows every group to the items whose names match. For example, type "tokens" to find the **Agent tokens** page in settings, or type a project's name to find that project. English words (`inbox` · `settings` · `tokens`) work in either interface language. **Paste a stable ID** to jump straight to that document, requirement or task (tasks can be found by key only). Picking a requirement opens its spec's requirements tab. Picking a matching heading opens that section.

**Document search works only inside a project.** On Home, Inbox, Notifications and Settings, the switcher still takes you to screens and projects, but it does not search specs or tasks. The input's placeholder text notes this as well.

| Key             | Action               |
| --------------- | -------------------- |
| `⌘K` · `Ctrl+K` | Open / close         |
| `↑` · `↓`       | Move through results |
| `Enter`         | Open                 |
| `Esc`           | Close                |

When the input is empty, **your pinned and recently opened items** appear at the top of the list, pinned items first. **Recent lists what you actually opened**, including specs and tasks you opened from the tree, a link or a notification. Each row shows which project the document belongs to, and selecting it opens the document **in that project**, even when you are in another project or on Home. Only items from the current organization appear.

Press the **☆** at the right end of a row to pin that document (★). Press it again to unpin it. In the recent list, a document you viewed yesterday can drop off today. **You can pin the five or six documents you open every day** so they don't get pushed out. Pins are saved **in this browser**, like the theme and the language.

Inside the switcher, `Tab` moves focus only between the input and the ☆ buttons. Focus never leaves for the screen behind it. `Esc` closes the switcher wherever focus is. When it closes, you return to **where you were before you opened it**. Screen readers announce the input as a combo box with a list, and the highlighted row as the selected option.

## The screen by keyboard

**Your first `Tab` press reveals "Skip to main content".** Press `Enter` on it to skip the header and sidebar and start in the page content.

**Menus** (the organization menu in the left column, and the help and user menus in the header) move focus to their first item when opened. Closing a menu with `Esc` returns focus to the button that opened it. Tabbing out of a menu closes it.

**The spec tree is a single `Tab` stop.** Once you are in the tree, use the keys below to move. `Tab` skips the expand buttons.

| Key            | Action                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| `↑` · `↓`      | Move between rows                                                            |
| `→`            | Expand a collapsed branch (if it is already expanded, go to its first child) |
| `←`            | Collapse an expanded branch (on a leaf, go to its parent)                    |
| `Home` · `End` | Go to the first · last row                                                   |
| `Enter`        | Open that document                                                           |

**In Notifications, `Tab` to a row and press `Enter` to open it.** Just like a click, this marks the notification read and takes you to the item it points to. **[Read]** is always visible when the row has focus, and on touch screens.

## Dialogs and panels

`Esc` closes all of the following: the **Document info** dialog ([⋯ Document info]), the **Create baseline** dialog, a diagram's full-screen view, the panel for a selected node in the relationship graph, the spec tree opened from the strip on a narrow screen (focus returns to the strip's button), and any confirmation prompt (`Esc` is the same as canceling). If a dialog is showing a confirmation prompt, `Esc` closes only the prompt. While a dialog is open, `Tab` keeps focus inside it. When the dialog closes, focus returns to **the button that opened it**.

When you resolve a review finding, the field for choosing a spec takes two keys. `↓` moves into the list of results, and `Enter` selects the first result right away.

## Inbox

| Key       | Action                              |
| --------- | ----------------------------------- |
| `j` · `k` | Move between cards                  |
| `a`       | Approve                             |
| `r`       | Reject                              |
| `c`       | Write a comment                     |
| `z`       | Undo before it is sent (within 5 s) |
| `x`       | Add to or remove from the selection |
| `⇧X`      | Select everything visible           |
| `⇧A`      | Approve the selection               |
| `⇧R`      | Reject the selection                |
| `Esc`     | Clear the selection                 |

These keys do nothing while the cursor is in a text field. The bulk keys are **uppercase** so they can't clash with the single-card keys. Deciding twenty cards should take at least one `Shift` more than deciding one. While the confirmation list is open, `a`, `r` and `c` do nothing.

**On a question card, `a` and `r` do nothing.** You answer a question instead of approving or rejecting it, so only `c` (for writing the answer) works.

**On a request you made yourself, `a` does nothing.** This rule stops you from approving your own work. **The same applies to a draft written by you or by your session.** The exceptions are admins and projects with fewer than two members (see [Inbox](/help/inbox)).

In other cases, if your role cannot decide approvals and you press `a`, the key is not silently ignored: **the server rejects it.** **On cards in the Decided tab, neither the buttons nor the keys do anything.** Pressing `a`, `r` or `c` on a card that has already been decided has no effect (anything you can press should actually work).

## Task screen (sheet over the board)

| Key       | Action                                        |
| --------- | --------------------------------------------- |
| `j` · `k` | Next and previous task in the same lane       |
| `Esc`     | Close (the board's filters stay as they were) |

These keys do nothing while the cursor is in an input field ([Tasks](/help/tasks)).

## Language

Choose **한국어 / English** from the user menu (your name ▾ at the right end of the header). The screens and the error messages from the server switch together. **The sign-in, sign-up, invitation and password reset screens** have no user menu, so the same buttons appear at the bottom of the screen instead. That way you can switch languages before you sign in. Sign-up confirmation and password reset emails arrive in the language you chose there.

**The CLI sets its language separately.** It uses the same translated strings as the web app, but it does not follow the language you picked on the web. Its language comes from environment variables (`NERV_LANG`, else `LC_ALL` or `LANG`).

Three things are never translated: **identifiers** (status values like `ready` and `approved`), **operator logs**, and **content stored in documents**. If status values changed with the language, the screen and the logs would show different values.

## Light and dark

Choose **Light / Dark / System** in the same menu, just below the language. `System` means you leave the choice to your device. With it selected, the screen follows your browser (or operating system) setting, so when your device switches to dark mode at night, the screen turns dark too. Choosing Light or Dark overrides the device setting.

**The theme is saved in this browser, not in your account.** The same person may want different settings on a daytime laptop and an evening desktop. On another device, choose the theme again there.

**The language is saved in the same place.** It is not stored in your account, so the first time you open the app on another device, it starts in the browser's language. Choose it again on that device.
