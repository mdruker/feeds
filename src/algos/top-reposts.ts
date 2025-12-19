import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import {
  ALL_CAUGHT_UP_POST, NO_POSTS_PLACEHOLDER_POST,
} from './helpers'
import { getCursor } from '../util/cursors'
import { sql } from 'kysely'
import { AppBskyFeedDefs } from '@atproto/api'

// max 15 chars
export const shortname = 'top-reposts'

export const handler = async (ctx: AppContext, params: QueryParams, requesterDid: string) => {
  let cursor = params.cursor
  let cursorOffset: number

  if (cursor && /^[0-9]+$/.test(cursor)) {
    cursorOffset = parseInt(cursor, 10)
  } else {
    cursorOffset = 0
  }

  let queryBuilder = ctx.db
    .with('repostDetails', (db) => {
      return db
        .selectFrom('repost')
        .innerJoin(
          'follow',
          (join) => join
            .onRef('follow.target_did', '=', 'repost.author_did')
            .on('follow.source_did', '=', requesterDid),
        )
        .select([
          'repost.uri as repost_uri',
          'repost.cid',
          'repost.post_uri',
          'repost.indexed_at',
          sql<number>`count(*) over (partition by post_uri)`.as('repost_count'),
          sql<number>`row_number() over (partition by post_uri order by repost.indexed_at asc)`.as('repost_rn')
        ])
    })
    .with('rankedReposts', (db => {
      return db
        .selectFrom('repostDetails')
        .select([
          'repost_uri as uri',
          'cid',
          'indexed_at',
          'post_uri',
          'repost_count',
          sql<number>`row_number() over (order by repost_count desc)`.as('repost_rank')
        ])
        .where('repost_rn', '=', 1)
    }))
    .selectFrom('rankedReposts')
    .selectAll()

  let startDate = new Date()
  startDate.setHours(startDate.getHours() - 24)

  queryBuilder = queryBuilder
    .where('indexed_at', '>', startDate)
    .orderBy(['repost_count desc', 'cid desc'])

  let postResults = await queryBuilder
    .limit(params.limit)
    .offset(cursorOffset)
    .execute()

  if (postResults.length === 0) {
    return {
      feed: [{
        post: NO_POSTS_PLACEHOLDER_POST,
        feedContext: shortname
      }]
    }
  }

  let newCursor: string | undefined = (cursorOffset + postResults.length).toString()

  let feed: AppBskyFeedDefs.SkeletonFeedPost[] = postResults.map((row) => {
    let feedEntry: AppBskyFeedDefs.SkeletonFeedPost = {
      post: row.post_uri,
      feedContext: shortname + "::" + getCursor(row.indexed_at, row.cid)
    }

    return feedEntry
  })

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
