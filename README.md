# n8n workflows

Production n8n workflows I have built and run, exported, sanitised and
documented so they can be read without an n8n instance. Each workflow lives in
its own folder with the exported JSON, a case study explaining the problem and
the design decisions behind it, and a screenshot of the canvas.

## Workflows

| Workflow | What it does | Stack | Folder |
| --- | --- | --- | --- |
| Sheet Fan-Out | Splits a master Google Sheet into per-recipient sheets, driven by a config array: each recipient is one entry describing its markers and target sheet, and the same generic loop handles all of them. | n8n · Google Sheets · Code (JS) · Telegram | [workflows/sheet-fanout](workflows/sheet-fanout) |

## How these are published

Workflows are exported from n8n as `*.raw.json`, which is git-ignored and never
committed. Every export is passed through the sanitiser before it lands in the
repository:

```bash
node scripts/sanitize.mjs workflow.raw.json workflows/<name>/workflow.json
```

The script removes each node's `credentials` object and `webhookId`, and the
top-level `pinData`, `meta.instanceId`, `id`, `versionId`, `tags` and `active`
fields. It then scans every remaining string for things that must not be
published: Google Sheets document IDs, bearer tokens, API keys, email
addresses, URLs with query strings, and long bare numeric IDs such as Telegram
chat IDs. Each hit is reported as a warning and left untouched, and any warning
exits with code 1, so a workflow with a leftover real value cannot be committed
without a deliberate fix.

Nothing here contains real credentials, document IDs, chat IDs or customer
data: every such value is replaced by a named placeholder before publication.

## Contact

[replyto.info](https://replyto.info)
