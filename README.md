# feeds.mdruker.app Feed Generator

This started as a fork from https://github.com/bluesky-social/feed-generator but has diverged quite a bit.

## Overview

This currently powers one feed - Catch Up On Follows. The app is deployed on fly.io on one server and a separate Postgres database.

Feeds are published/unpublished with the scripts configured in `package.json`, e.g. `yarn publishStaging`.

To update the cursor, update the corresponding row in sub_state with the new microsecond cursor value and `restart = 1`.

Features:
* Tracks all posts over 24 hours
* Records and updates engagement counts for posts (additions only, no removals)
* Records accounts that use the feed
* Records and updates following relationships for accounts that use the feed
* Per-user settings and an authenticated web page to update them.
* Consumes data from the Jetstream
* Handles database operations in batches
* Has authenticated testing endpoints to validate behavior
* Set up for running locally, and in configured staging and production environments
