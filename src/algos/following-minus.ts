import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { getCursor, isCursor } from '../util/cursors'
import { NO_POSTS_PLACEHOLDER_POST } from './helpers'
import { SelectQueryBuilder, sql } from 'kysely'
import { AppBskyFeedDefs } from '@atproto/api'

export const shortname = 'following-minus'

// Reverse-chronological Following feed (posts + reposts by the people you
// follow, same inclusion rules as following-chron) with per-subject muting:
//   muted        → drop the account's posts and reposts entirely
//   hide_reposts → drop only the account's reposts
// Mutes are set via the "show less like this" interaction (see send-interactions)
// and managed on the settings page.
export const handler = async (ctx: AppContext, params: QueryParams, requesterDid: string) => {
  // Keyset cursor on the display order (indexed_at desc, cid desc).
  let cursorDate: Date | undefined
  let cursorCid: string | undefined
  if (params.cursor && isCursor(params.cursor)) {
    const parts = params.cursor.split(':')
    cursorDate = new Date(parseInt(parts[0], 10))
    cursorCid = parts[1]
  }

  let queryBuilder = ctx.db
    .with('entries', (db) => {
      let postsQuery: SelectQueryBuilder<any, any, any> = db
        .selectFrom('post')
        .innerJoin('follow as author_follow', (join) => join
          .onRef('author_follow.target_did', '=', 'post.author_did')
          .on('author_follow.source_did', '=', requesterDid))
        .leftJoin('follow as root_follow', (join) => join
          .onRef('root_follow.target_did', '=', 'post.reply_root_did')
          .on('root_follow.source_did', '=', requesterDid))
        // Anti-join: a matching row means the author is muted → drop the post.
        .leftJoin('feed_subject_settings as author_mute', (join) => join
          .on('author_mute.actor_did', '=', requesterDid)
          .on('author_mute.shortname', '=', shortname)
          .onRef('author_mute.subject_did', '=', 'post.author_did')
          .on('author_mute.muted', '=', true))
        // Anti-join: a reply whose (followed) root author is muted → drop it.
        // No-op for top-level posts, where reply_root_did is null.
        .leftJoin('feed_subject_settings as root_mute', (join) => join
          .on('root_mute.actor_did', '=', requesterDid)
          .on('root_mute.shortname', '=', shortname)
          .onRef('root_mute.subject_did', '=', 'post.reply_root_did')
          .on('root_mute.muted', '=', true))
        // following-chron's rule: top-level posts, or replies whose root author
        // is also a follow.
        .where((eb) => eb('post.reply_parent_uri', 'is', null)
          .or('root_follow.target_did', 'is not', null))
        .where('author_mute.subject_did', 'is', null)
        .where('root_mute.subject_did', 'is', null)

      const postsSelect = postsQuery.select([
        'post.uri as uri',
        'post.cid as cid',
        sql<string>`null`.as('post_uri'),
        'post.author_did as subject_did',
        'post.indexed_at as indexed_at',
      ])

      let repostsQuery: SelectQueryBuilder<any, any, any> = db
        .selectFrom('repost')
        .innerJoin('follow', (join) => join
          .onRef('follow.target_did', '=', 'repost.author_did')
          .on('follow.source_did', '=', requesterDid))
        // Anti-join: a matching row means the reposter is muted or has reposts
        // hidden → drop the repost.
        .leftJoin('feed_subject_settings as repost_mute', (join) => join
          .on('repost_mute.actor_did', '=', requesterDid)
          .on('repost_mute.shortname', '=', shortname)
          .onRef('repost_mute.subject_did', '=', 'repost.author_did')
          .on((eb) => eb.or([
            eb('repost_mute.muted', '=', true),
            eb('repost_mute.hide_reposts', '=', true),
          ])))
        .where('repost_mute.subject_did', 'is', null)

      const repostsSelect = repostsQuery.select([
        'repost.uri as uri',
        'repost.cid as cid',
        'repost.post_uri as post_uri',
        'repost.author_did as subject_did',
        'repost.indexed_at as indexed_at',
      ])

      return postsSelect.unionAll(repostsSelect)
    })
    .selectFrom('entries')
    .selectAll()

  if (cursorDate) {
    const cd = cursorDate
    const cc = cursorCid!
    queryBuilder = queryBuilder.where(({ eb, or, and }) => or([
      eb('indexed_at', '<', cd),
      and([eb('indexed_at', '=', cd), eb('cid', '<', cc)]),
    ]))
  }

  const postResults = await queryBuilder
    .orderBy('indexed_at', 'desc')
    .orderBy('cid', 'desc')
    .limit(params.limit)
    .execute()

  if (postResults.length === 0) {
    // If we have nothing with a cursor, we paged to the end and return nothing.
    // If we have nothing without a cursor, surface a message to the user.
    return {
      feed: params.cursor
        ? []
        : [{ post: NO_POSTS_PLACEHOLDER_POST, feedContext: shortname }],
    }
  }

  // feedContext carries the subject DID and whether the item is a repost, so the
  // "show less" interaction can mute the right account (a repost item's post URI
  // points at the original author, not the reposter).
  const feed: AppBskyFeedDefs.SkeletonFeedPost[] = postResults.map((row) => {
    const itemCursor = getCursor(row.indexed_at, row.cid)
    if (row.post_uri) {
      const entry: AppBskyFeedDefs.SkeletonFeedPost = {
        post: row.post_uri,
        feedContext: `${shortname}::${itemCursor}::repost::${row.subject_did}`,
      }
      entry.reason = {
        $type: 'app.bsky.feed.defs#skeletonReasonRepost',
        repost: row.uri,
      }
      return entry
    }
    return {
      post: row.uri,
      feedContext: `${shortname}::${itemCursor}::post::${row.subject_did}`,
    }
  })

  const last = postResults.at(-1)!
  const newCursor = feed.length < params.limit
    ? undefined
    : getCursor(last.indexed_at, last.cid)

  return {
    cursor: newCursor,
    feed,
  }
}
