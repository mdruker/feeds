# Migration safety (zero-downtime)

The feed serves real users, and deploys roll the web tier with overlap — so **old and
new code run against the same database at the same time.** Every migration must be
compatible with **both**. (For the deploy model that makes this true — the web/worker
role split and blue-green choreography — see the
[README](../README.md#architecture-serving-vs-ingest).)

## The rules

- **Expand/contract, split across deploys.** Additive in the *expand* deploy; destructive
  (drop / rename / tighten) only in a *later contract* deploy after the old code is gone.
- **Never expand + contract in one deploy.**
- **Migrations are a separate, reviewed step** — gated against the checklist below before
  any code that depends on them ships. They do **not** run on instance boot.

### Operation cheatsheet (unsafe → safe)

| Change | Safe form |
|---|---|
| Add column | Only nullable or with a default. `NOT NULL` w/o default breaks old INSERTs. |
| Drop column | Stop referencing in code (deploy) → drop in a **later** migration. |
| Rename column | Never in place. Add new → dual-write → backfill → read-new → stop writing old → drop old (≥4 deploys). |
| Change type / tighten constraint | Expand/contract like a rename; add `NOT NULL`/`UNIQUE` only after data conforms. |
| Add index | Generally safe, but see big-table note. |
| Backfill | Batched (no whole-table transaction). |

### MySQL-on-15GB specifics (post / repost)

- **Online DDL**: `ALGORITHM=INPLACE, LOCK=NONE` so a schema change doesn't lock against
  the consumer's heavy write load. Verify the operation supports it before running.
- **Batched backfills** — chunk by primary key; never one giant `UPDATE`.
- **Pause the worker** for a genuinely heavy/locking DDL — serving is unaffected (a payoff
  of the role split). Resume after; the cursor catches up.

### Per-migration checklist

- [ ] Backward-compatible with the **currently-deployed** code?
- [ ] Forward-compatible — new code works against the **pre-migration** schema?
- [ ] Additive only (expand)? Anything destructive deferred to a later contract deploy?
- [ ] Online / non-locking on `post`/`repost`?
- [ ] Backfill batched?
- [ ] Runs as the separate migrate step, not on instance boot?
