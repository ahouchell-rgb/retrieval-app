# Pending migrations

Migrations that are written but **must not be applied yet** because they depend on
a precondition that isn't met (e.g. a client cutover, a backfill, a deploy) live
here — NOT in the parent `db/migrations/` directory.

Why: the parent directory is meant to be safe to replay end-to-end on a fresh
database in filename order. A migration that would break the running app if applied
early (the way `20260614_02`/`_04` would have stopped pupils recording answers
before the edge-function client was live) does not belong in that replay set until
its precondition holds.

Workflow:

1. Write the migration here with a `-- STATUS:` header stating the precondition.
2. When the precondition is met, apply it, then **move the file up** into
   `db/migrations/` and flip its header to `APPLIED (verified <date>)`.

There are currently no pending migrations.
