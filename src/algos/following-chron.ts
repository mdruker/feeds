import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import {
  ALL_CAUGHT_UP_POST, LIKE_TO_JUMP_TO_30_MIN_AGO_POST,
  LIKE_TO_JUMP_TO_PRESENT_POST,
} from './helpers'
import { getCursor, isCursor } from '../util/cursors'
import { SelectQueryBuilder, sql } from 'kysely'
import { AppBskyFeedDefs } from '@atproto/api'

// max 15 chars
export const shortname = 'following-chron'

export const handler = async (ctx: AppContext, params: QueryParams, requesterDid: string) => {
  let cursor = params.cursor
  let cursorDate: Date
  let cursorCid: string

  if (!cursor) {
    const feedState = await ctx.db
      .selectFrom('feed_state')
      .select('latest_seen_cursor')
      .where('actor_did', '=', requesterDid)
      .where('shortname', '=', shortname)
      .executeTakeFirst()
    cursor = feedState?.latest_seen_cursor
  }

  if (cursor && isCursor(cursor)) {
    // TODO: ignore the cursor if it's too old
    let strings = cursor.split(':')
    cursorDate = new Date(parseInt(strings[0], 10))
    cursorCid = strings.length == 2 ? strings[1] : ''
  } else {
    cursorDate = new Date()
    cursorDate.setHours(cursorDate.getHours() - 24)
    cursorCid = "aaaaaaaaaaaaaa" // They all start with a metadata prefix
  }

  let queryBuilder = ctx.db
    .with('recentPosts', (db) => {
        let postsQuery: SelectQueryBuilder<any, any, any> = db.selectFrom('post')
          .innerJoin(
            'follow as author_follow',
            (join) => join
              .onRef('author_follow.target_did', '=', 'post.author_did')
              .on('author_follow.source_did', '=', requesterDid),
          )
          .leftJoin(
            'follow as root_follow',
            (join) => join
              .onRef('root_follow.target_did', '=', 'post.reply_root_did')
              .on('root_follow.source_did', '=', requesterDid),
          )
          .where((eb) =>
            eb('reply_parent_uri', 'is', null).or('root_follow.target_did', 'is not', null)
          )
          .select(['post.uri', 'post.cid', sql<string>`null`.as('post_uri'), 'post.indexed_at'])

        const repostsQuery = db.selectFrom('repost')
          .innerJoin(
            'follow',
            (join) => join
              .onRef('follow.target_did', '=', 'repost.author_did')
              .on('follow.source_did', '=', requesterDid),
          )
          .select(['repost.uri as uri', 'repost.cid', 'repost.post_uri', 'repost.indexed_at'])

        return postsQuery
          .unionAll(repostsQuery)
      },
    )
    .selectFrom('recentPosts')
    .selectAll()

  let cutOffDate = new Date()

  queryBuilder = queryBuilder
    .where('indexed_at', '<', cutOffDate)
    .where(({ eb, or, and }) => or([
      eb('indexed_at', '>', cursorDate),
      and([eb('indexed_at', '=', cursorDate), eb('cid', '<', cursorCid)])
    ]))
    .orderBy(['indexed_at asc', 'cid desc'])

  let postResults = await queryBuilder
    .limit(params.limit)
    .execute()

  if (postResults.length === 0) {
    return {
      feed: [{
        post: ALL_CAUGHT_UP_POST,
        feedContext: shortname
      }]
    }
  }

  let newCursor: string | undefined
  const last = postResults.at(-1)!!
  newCursor = getCursor(last.indexed_at, last.cid)

  let numReposts = 0
  let feed: AppBskyFeedDefs.SkeletonFeedPost[] = postResults.map((row) => {
    let feedEntry: AppBskyFeedDefs.SkeletonFeedPost = {
      post: row.uri,
      feedContext: shortname + "::" + getCursor(row.indexed_at, row.cid)
    }

    if (row.post_uri) {
      numReposts++
      feedEntry.reason = {
        $type: 'app.bsky.feed.defs#skeletonReasonRepost',
        repost: row.uri
      }
    }

    return feedEntry
  })

  // Show a jump to recent posts option at the top if we're showing posts at
  // least an hour old and this was the first page requested this time.
  let cutOffForShowingJumpPost = new Date()
  cutOffForShowingJumpPost.setHours(cutOffForShowingJumpPost.getHours() - 1)
  if (params.cursor === undefined && new Date(last.indexed_at) < cutOffForShowingJumpPost) {
    let jumpToPresentPost: AppBskyFeedDefs.SkeletonFeedPost = {
      post: LIKE_TO_JUMP_TO_30_MIN_AGO_POST,
      feedContext: shortname + "::"
    }

    feed = [ jumpToPresentPost ].concat(feed.slice(0, params.limit - 1))
  }

  if (feed.length < params.limit) {
    newCursor = undefined
    feed = feed.concat({
      post: ALL_CAUGHT_UP_POST,
      feedContext: shortname + "::"
    })
  }

  return {
    cursor: newCursor,
    feed,
  }
}
