# Sheet Fan-Out — config-driven n8n workflow

Splits one master Google Sheet into many per-recipient sheets, driven by a config array instead of duplicated branches.

This repository documents a refactor: the original production workflow solved the same problem with **95 nodes**, the rewritten one uses **11**.

---

## The problem

A single master sheet holds work assignments for every operator, stacked vertically. Each operator's block is delimited by two marker rows:

```
operator-01 start
  Task A     | week 1 | week 2 | ...
  Task B     | week 1 | week 2 | ...
operator-01 end
operator-02 start
  ...
```

Every operator also has their own Google Sheet, which must be a mirror of their block. On each run the target sheet is wiped and rewritten from the master. Some cells contain leftover values (stale date serials, stray names) that have to be blanked out during the copy.

Constraints:

- Google Sheets API quotas — writes must be paced, not fired in parallel.
- A failure on one operator must not stop the remaining ones.
- Operators are added and removed regularly.

---

## The original approach and why it did not scale

The first working version handled each operator as its own branch on the canvas: a slice node, a cleanup node, a switch, a wait, a clear and an append — copied once per operator.

Concrete costs of that shape:

| Problem | Consequence |
|---|---|
| 14 duplicated branches | Adding an operator meant copying 6 nodes and editing each by hand |
| Cleanup logic pasted 14 times | The copies drifted — different branches filtered different values |
| A `Wait` node per branch, 60s each | ~14 minutes of idle time per run, used purely as a quota workaround |
| Case-sensitive marker matching | Markers were lowercased on one side only, so 3 branches silently matched nothing and never updated their sheets |
| Empty-result branch wired back into its own source node | Dead wiring that made the canvas harder to read than the logic warranted |

The workflow ran, but every change was a manual edit in 14 places.

---

## The rewrite

```
Start
  └─ Read Master Sheet
      └─ Build Recipient Config          ← the only place operators are listed
          └─ Split By Recipient (batch size 1)
              ├─ each batch
              │    └─ Slice Recipient Block
              │        └─ Has Rows?
              │            ├─ true  → Clear Target Sheet → Append Rows → next batch
              │            └─ false → next batch
              └─ done → Done

  Clear / Append error output → Format Error → Telegram Alert → next batch
```

### 1. Recipients are data, not topology

```js
const junkValues = ['45767', '45772', '45718'];

const recipients = [
  { key: 'operator-01', startMarker: 'operator-01 start', endMarker: 'operator-01 end', sheetId: '...', sheetName: 'gid=0' },
  { key: 'operator-02', startMarker: 'operator-02 start', endMarker: 'operator-02 end', sheetId: '...', sheetName: 'gid=0' },
];

return recipients.map(r => ({ json: { ...r, junkValues } }));
```

Adding an operator is one line. Nothing on the canvas changes.

### 2. One generic slice-and-clean pass

The slice node reads the master rows once via `$('Read Master Sheet').all()` and takes its markers from the current loop item. Both sides of the comparison are normalized, which is the fix for the silent-match bug in the original:

```js
const norm = (v) => (v === null || v === undefined ? '' : String(v).toLowerCase().trim());

const start = rows.findIndex(r => norm(r.json.col_1).includes(norm(cfg.startMarker)));
const end   = rows.findIndex((r, i) => i > start && norm(r.json.col_1).includes(norm(cfg.endMarker)));
```

### 3. Empty blocks do not stall the loop

An n8n loop that receives zero items never fires its loop-back connection, so the run stops silently. The slice node therefore always emits at least one item, using a `_skip` flag that an IF node routes straight to the next iteration.

### 4. Target sheet resolved per iteration

Both Sheets nodes read the destination from the loop item rather than from a hardcoded resource locator:

```
{{ $("Split By Recipient").item.json.sheetId }}
```

### 5. Quota handling without idle waits

Sequential iteration plus per-node retry (3 attempts, 5s apart) replaces 14 fixed 60-second waits. Same protection against rate limits, none of the dead time.

### 6. Failures are logged, not fatal

`Clear Target Sheet` and `Append Rows` use `continueErrorOutput`. The error branch formats the node name and message, sends a Telegram alert, and returns to the loop, so one broken destination sheet does not block the rest.

---

## Result

| | Original | Rewrite |
|---|---|---|
| Nodes | 95 | 11 |
| Adding a recipient | copy 6 nodes, edit each | 1 config line |
| Cleanup logic | 14 copies | 1 |
| Idle time per run | ~14 min | 0 |
| Recipients silently skipped | 3 | 0 |
| One failure stops the run | yes | no |

---

## Running it yourself

1. Import `workflow.json` into n8n.
2. Attach a Google Sheets credential (service account) to the three Sheets nodes.
3. Replace `REPLACE_WITH_MASTER_SHEET_ID` and each `REPLACE_WITH_SHEET_ID_*` with real document IDs.
4. Adjust `recipients` and `junkValues` in the **Build Recipient Config** node.
5. Set the Telegram chat ID on the **Telegram Alert** node, or delete that branch.

All identifiers in this repository are placeholders. No real document IDs, chat IDs, credentials or personal data are included.

---

## Stack

n8n · Google Sheets API · JavaScript (Code nodes) · Telegram Bot API
