# feeds.mdruker.app Feed Generator

This started as a fork from https://github.com/bluesky-social/feed-generator but has diverged quite a bit.

## Overview

This powers two Highline feeds and an Only Links feed. The app is deployed on fly.io on one server with a separate MySQL database.

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
