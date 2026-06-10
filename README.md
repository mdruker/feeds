# feeds.mdruker.app Feed Generator

This started as a fork from https://github.com/bluesky-social/feed-generator but has diverged quite a bit.

## Overview

This powers two Highline feeds and an Only Links feed. It runs as Docker containers on a VPS, backed by MySQL.

Feeds are published/unpublished with the scripts configured in `package.json`, e.g. `yarn publishStaging`.

To update the cursor, update the corresponding row in sub_state with the new microsecond cursor value and `restart = 1`.

Features:
* Tracks all posts over 24 hours
* Records and updates engagement counts for posts (additions only, no removals)
* Records accounts that use the feed
* Records and updates following relationships for accounts that use the feed
* Has a feature to show a news post at the top of a feed
* Has a database-backed job queue to do asynchronous work
* Per-user settings and an authenticated web page to update them
* Consumes data from the Jetstream and processes data in batches
* Has authenticated testing endpoints to validate behavior, and an admin dashboard
* Set up for running locally, and in configured staging and production environments

## Architecture: serving vs. ingest

The app runs in one of two roles, selected by the `ROLE` env var (`web`, `worker`, or
`all` — the default — for local / single-process):

| `ROLE=web` | `ROLE=worker` |
|---|---|
| HTTP only: getFeedSkeleton, OAuth, web UI | Jetstream consumer + job worker |
| Reads + per-user-state writes | Writes firehose data; owns the cursor |
| **N instances**, rolled with overlap → zero-downtime deploys | **Exactly one instance** |

Zero-downtime only matters for serving. Two HTTP instances are fine; two consumers are
not (double-writes, cursor contention). So rather than try to make the consumer's restart
gap *zero*, we make it *not matter*: the cursor lives in `sub_state` and resumes, and jobs
re-acquire — so a few-second worker restart is invisible to users, who keep being served
from the DB.

### Deploy choreography (blue-green web + worker restart)

1. CI builds + pushes the image.
2. **Migrate step** runs as a separate entrypoint (*not* on instance boot) — expand /
   additive changes only, safe for the still-running old code.
3. **Roll the web tier blue-green:** start the new instance → wait until ready (DB
   connected, schema compatible) → flip the reverse-proxy upstream → drain + stop the old.
4. **Restart the worker** (single instance) onto the new image. Brief ingest pause,
   invisible to users because web keeps serving from the DB.
5. **Later, separate deploy:** contract / destructive migrations, once no old code remains.

Migrations never run on web-instance boot (race + footgun during a rolling deploy). The
rules every schema change must follow are in [docs/migrations.md](docs/migrations.md).

> Implementation status: the `ROLE` split exists in the app; the blue-green orchestration
> (load-balanced web tier, migrate step, deploy script) lives in the `ops` layer and is
> being built out.
