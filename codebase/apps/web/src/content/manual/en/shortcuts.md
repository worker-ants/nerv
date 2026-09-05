## ⌘K — finding a document

`⌘K` (`Ctrl+K` on Windows and Linux) opens the quick switcher. It finds **specs and requirements** by name — not screens, not settings.

**It only works inside a project.** On screens whose address carries no project — home, the inbox, notifications, settings — the panel opens but neither search nor navigation does anything.

| Key             | Action               |
| --------------- | -------------------- |
| `⌘K` · `Ctrl+K` | Open / close         |
| `↑` · `↓`       | Move through results |
| `Enter`         | Open                 |
| `Esc`           | Close                |

With the input empty, **what you pinned and what you opened recently** is listed — pinned first.

Press the **☆** at the right of a row to pin that document (★); press it again to unpin. The recent list pushes yesterday's document out today, and **the five or six you open every day should not go that way.** Pins are kept **in this browser**, like the theme and the language.

## Dialogs and panels

`Esc` closes four places — the **New spec** dialog, the baseline **Freeze** dialog, the **link picker** in a spec body, and the panel for a selected node in the **relationship graph**.

In the link picker, `↓` moves down into the results and `Enter` takes the first one.

## Inbox

| Key       | Action             |
| --------- | ------------------ |
| `j` · `k` | Move between cards |
| `a`       | Approve            |
| `r`       | Reject             |
| `c`       | Write a comment    |

They do nothing while the cursor is in a text field.

**On a question card, `a` and `r` are inert.** A question is answered, not approved or rejected, so only `c` opens.

**On an approval you raised yourself, `a` does not open** — the rule that stops you approving your own request, with exceptions for admins and for projects with fewer than two members (see [Inbox](/help/inbox)).

Otherwise, pressing `a` without the permission to decide does not pass quietly — **the server refuses it.** The same is true of cards in the Decided tab: the buttons are gone but the keys are still live.

## Language

Pick **한국어 / English** from the user menu (your name ▾ at the right of the header). The screens and the error messages the server returns switch together.

**The CLI is separate.** It draws on the same catalogue of phrases, but its language comes from the environment (`NERV_LANG`, else `LC_ALL` or `LANG`), not from what you picked on the web.

Three things are never translated: **identifiers** (status values like `ready` and `approved`), **operator logs**, and **content stored in documents**. If status values differed by language, the screen and the logs would be saying different things.

## Light and dark

Pick **Light / Dark / System** from the same menu, right under the language. `System` is the choice not to choose: while it is selected the screen follows your browser (or operating system) setting, so it turns dark when your machine does. Picking Light or Dark overrides the machine setting.

**The theme is remembered by this browser, not by your account** — the same person uses a laptop by day and a desktop at night. On another machine you pick it again there.

**The language is kept in the same place.** It does not follow your account, so opening the app for the first time on another machine starts in the browser's language — pick it again there.
