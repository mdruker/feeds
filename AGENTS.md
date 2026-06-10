# AGENTS.md

Guidance for AI agents (and humans) working in this repo.

## Before writing a database migration

This app serves live users behind a rolling, blue-green web deploy: **old and new code
run against the same schema at the same time.** A naive schema change — a `NOT NULL`
column without a default, an in-place rename, an unbatched backfill, a locking DDL on
`post`/`repost` — will break the running old code or stall the jetstream consumer.

**Read [docs/migrations.md](docs/migrations.md) and follow its checklist before writing or
reviewing any migration.** Migrations are a separate, reviewed step; they do not run on
instance boot.

## Runtime model

The `ROLE` env var selects **web** (HTTP serving, N instances) vs **worker** (jetstream
consumer + jobs, exactly one), with `all` as the single-process default for local. See the
[README](README.md#architecture-serving-vs-ingest) for the model and deploy choreography.
