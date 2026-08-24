Settings has four tabs: **Workspace, Members, Tokens and Gate policy**.

## Workspace

What the two header selects let you _pick_, this tab lets you create, rename and put away.

- **Create a project** — type a name and the address (slug) and key follow from it. The key is the short prefix on task and spec numbers (`CLV-T-3F92A1`).
- **Rename** — only the name changes. **The slug does not** — addresses and API paths are built on it, so changing it would break every link already out in the world.
- **Archive a project** — it drops out of lists but is not deleted, and its address still works. It can be undone.
- **Delete an organisation** — possible **only while it holds no projects**. That puts one reversible step (archiving a project) in front of an irreversible one.

## Members

Who is here and in what role. A role can be granted across the whole organisation or on a single project. When one person holds both, **permissions are the union**.

Editing members and roles is `admin` only.

## Tokens

Issue and revoke the tokens agents use. The details are in [Agents](/help/agents).

## Gate policy

Gates decide what a spec change has to go through, according to **how risky it is**. Tiers run T0–T3, and the tier follows from the sum of four risk axes: side effects, sensitivity, reversibility and blast radius.

- **Tier boundaries** — the scores at which T1, T2 and T3 begin. Lower them and more changes pass through a person.
- **Dynamic escalation** — a history of retries or rollbacks raises the tier by one. Having already slipped once in a place is evidence that the place is dangerous.
- **T1 objection window** — after a low-risk change passes automatically, the time in which a person can still object.

Editing is `admin` only; everyone else sees the current values as they are — anyone should be able to see what is holding them up.
