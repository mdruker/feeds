import { AppContext } from '../config'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { debugLog } from '../lib/env'

export async function generateCatchupFeed(ctx: AppContext, requesterDid: string, params: QueryParams, useStoredCursor: boolean) {
  // Fetch all of actor's follows from the db
  let t0 = performance.now()
  let follows = await ctx.db
    .selectFrom('follow')
    .selectAll()
    .where('source_did', '=', requesterDid)
    .execute()
  debugLog(`Got follows at ${Math.round(performance.now() - t0)}`)

  if (follows.length == 0) {
    return {
      feed: [],
    }
  }

  // Posts and replies to people you follow, all the way to the cut-off so we're calculating
  // what needs to be seen more-or-less consistently.
  // We do want replies, but only ones that are a thread under a follow or a reply to a follow.
  // Self-replies are a weird case -- trying to exclude them here.
  let res = await ctx.db
    .selectFrom('post')
    .innerJoin(
      'follow',
      (join) => join
        .onRef('follow.target_did', '=', 'post.author_did')
        .on('follow.source_did', '=', requesterDid)
    )
    .select(['post.uri', 'post.cid', 'post.indexed_at', 'post.author_did', 'post.num_likes', 'post.num_reposts', 'post.num_replies'])
    .where('reply_parent_uri', 'is', null)
    .execute()

  let cutOffDate = new Date()
  cutOffDate.setHours(cutOffDate.getHours() - 24)

  // We need some time to pass before the engagement counts cure up
  let oldEnoughDate = new Date()
  oldEnoughDate.setMinutes(oldEnoughDate.getMinutes() - 15)

  // It's apparently faster to do this filtering in the application layer.
  res = res.filter((x) => {
    return x.indexed_at > cutOffDate.toISOString() && x.indexed_at < oldEnoughDate.toISOString()
  })

  debugLog(`Got posts at ${Math.round(performance.now() - t0)}`)

  res = res.sort((a, b) =>
    b.num_likes + b.num_reposts + b.num_replies - a.num_likes - a.num_reposts - a.num_replies)

  debugLog(`Sorted all posts at ${Math.round(performance.now() - t0)}`)

  let followsMap = new Map(follows.map((x) => [x.target_did, x]))

  let posts = Map.groupBy(res, (item, index) => {
    return item.author_did
  }).entries().map((entry) => {
    let follow = followsMap.get(entry[0])
    if (!follow) {
      return []
    }
    return entry[1].slice(0, Math.max(0, follow.actor_score + 2))
  }).toArray().flat()

  debugLog(`Filtered top posts at ${Math.round(performance.now() - t0)}`)

  // Now sort again in descending order by date and CID as in the original sort
  posts.sort((a, b) => {
    let indexedAtDiff = new Date(b.indexed_at).getTime() - new Date(a.indexed_at).getTime()
    if (indexedAtDiff != 0) {
      return indexedAtDiff
    }
    return b.cid.localeCompare(a.cid)
  })

  debugLog(`Sorted posts at ${Math.round(performance.now() - t0)}`)

  // Apply the cursor only after so we're relatively consistently calculating the posts needed.
  if (params.cursor) {
    let strings = params.cursor.split(':')
    const timeStr = new Date(parseInt(strings[0], 10)).toISOString()

    let cursorCid: string = strings.length == 2 ? strings[1] : ""

    posts = posts.filter((x) =>
      x.indexed_at < timeStr ||
      x.indexed_at === timeStr && x.cid < cursorCid
    )
  }

  debugLog(`Filtered by cursor at ${Math.round(performance.now() - t0)}`)

  posts = posts.slice(0, params.limit)

  let cursor: string | undefined
  const last = posts.at(-1)
  if (last) {
    cursor = new Date(last.indexed_at).getTime().toString(10) + ':' + last.cid
  }

  const feed = posts.map((row) => ({
    post: row.uri,
  }))

  debugLog(`Generated feed at ${Math.round(performance.now() - t0)}`)

  return {
    cursor,
    feed,
  }
}
