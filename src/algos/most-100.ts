import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { getCursor, isCursor } from '../util/cursors'
import { AppBskyFeedDefs } from '@atproto/api'

// max 15 chars
export const shortname = 'most-100'

// A fixed leaderboard: the highest-engagement posts across the whole network
// over the last day, shown newest-first. Network-wide, so requesterDid is
// unused.
const MOST_COUNT = 100
const WINDOW_HOURS = 24

export const handler = async (ctx: AppContext, params: QueryParams, requesterDid: string) => {
  // Keyset cursor on the display order (indexed_at, cid). Both are immutable per
  // post, so paging stays stable even as engagement counts churn the ranking
  // between requests — unlike an offset, which would dupe/skip on reordering.
  let cursorDate: Date | undefined
  let cursorCid: string | undefined
  if (params.cursor && isCursor(params.cursor)) {
    const parts = params.cursor.split(':')
    cursorDate = new Date(parseInt(parts[0], 10))
    cursorCid = parts[1]
  }

  let startDate = new Date()
  startDate.setHours(startDate.getHours() - WINDOW_HOURS)

  // Pick the top MOST_COUNT by engagement, then page through that snapshot in
  // reverse-chronological order. cid is the stable tiebreaker throughout.
  let queryBuilder = ctx.db
    .with('topPosts', (db) =>
      db
        .selectFrom('post')
        .select(['uri', 'cid', 'indexed_at'])
        .where('indexed_at', '>', startDate)
        .orderBy('engagement_count', 'desc')
        .orderBy('cid', 'desc')
        .limit(MOST_COUNT),
    )
    .selectFrom('topPosts')
    .selectAll()

  if (cursorDate) {
    const cd = cursorDate
    const cc = cursorCid!
    queryBuilder = queryBuilder.where(({ eb, or, and }) => or([
      eb('indexed_at', '<', cd),
      and([eb('indexed_at', '=', cd), eb('cid', '<', cc)]),
    ]))
  }

  let postResults = await queryBuilder
    .orderBy('indexed_at', 'desc')
    .orderBy('cid', 'desc')
    .limit(params.limit)
    .execute()

  if (postResults.length === 0) {
    return { feed: [] }
  }

  const feed: AppBskyFeedDefs.SkeletonFeedPost[] = postResults.map((row) => ({
    post: row.uri,
    feedContext: shortname + '::' + getCursor(row.indexed_at, row.cid),
  }))

  // A short page means we've reached the end of the leaderboard: omit the
  // cursor so the client stops paging.
  const last = postResults.at(-1)!
  const newCursor = feed.length < params.limit
    ? undefined
    : getCursor(last.indexed_at, last.cid)

  return {
    cursor: newCursor,
    feed,
  }
}
