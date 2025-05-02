import { AppContext } from '../config'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { debugLog } from '../lib/env'
import { AtUri } from '@atproto/syntax'
import * as AppBskyFeedDefs from '../lexicon/types/app/bsky/feed/defs'
import { SkeletonReasonRepost } from '../lexicon/types/app/bsky/feed/defs'

export type CatchupSettings = {
  include_replies: boolean | undefined
  posts_per_account: number | undefined
  repost_percent: number | undefined
}

type FeedEntry = {
  uri: string
  cid: string
  indexed_at: string
  repost_uri: string | undefined
}

const DEFAULT_INCLUDE_REPLIES = false
const DEFAULT_POSTS_PER_ACCOUNT = 2
const DEFAULT_REPOST_PERCENT = 0

export async function getSettingsWithDefaults(ctx: AppContext, requesterDid: string): Promise<CatchupSettings> {
  let settingsResult = await ctx.db
    .selectFrom('feed_settings')
    .select('settings')
    .where('actor_did', '=', requesterDid)
    .where('shortname', '=', 'catchup')
    .executeTakeFirst()
  let settingsJson = settingsResult?.settings
  let settings = settingsJson ? JSON.parse(settingsJson) as CatchupSettings : undefined

  return {
    include_replies: DEFAULT_INCLUDE_REPLIES,
    posts_per_account: DEFAULT_POSTS_PER_ACCOUNT,
    repost_percent: DEFAULT_REPOST_PERCENT,
    ...settings,
  }
}

export async function updateSettings(ctx: AppContext, actorDid: string, settings: CatchupSettings) {
  let settingsJson = JSON.stringify(settings)

  console.log(`Updating settings for ${actorDid} to: ${settingsJson}`)

  await ctx.db
    .insertInto('feed_settings')
    .values({
      actor_did: actorDid,
      shortname: 'catchup',
      settings: settingsJson,
      updated_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.doUpdateSet({ settings: settingsJson, updated_at: new Date().toISOString() }))
    .execute()
}

export async function generateCatchupFeed(ctx: AppContext, requesterDid: string, params: QueryParams) {
  let t0 = performance.now()

  const settings = await getSettingsWithDefaults(ctx, requesterDid)
  debugLog(`Got settings at ${Math.round(performance.now() - t0)}`)

  // Fetch all of actor's follows from the db
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
  let res = await ctx.db
    .selectFrom('post')
    .innerJoin(
      'follow',
      (join) => join
        .onRef('follow.target_did', '=', 'post.author_did')
        .on('follow.source_did', '=', requesterDid),
    )
    .select(['post.uri', 'post.cid', 'post.indexed_at', 'post.author_did', 'post.num_likes', 'post.num_reposts', 'post.num_replies', 'post.reply_parent_uri', 'post.reply_root_uri'])
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

  if (settings.include_replies) {
    let followedDids = follows.map(follow => follow.target_did)

    // Only consider replies where the original thread root is followed.
    res = res.filter((x) =>
      !x.reply_root_uri || followedDids.includes(new AtUri(x.reply_root_uri).host))
  } else {
    // Exclude all replies
    res = res.filter((x) => !x.reply_parent_uri)
  }

  debugLog(`Got posts at ${Math.round(performance.now() - t0)}`)

  res = res.sort((a, b) =>
    b.num_likes + b.num_reposts + b.num_replies - a.num_likes - a.num_reposts - a.num_replies)

  debugLog(`Sorted all posts at ${Math.round(performance.now() - t0)}`)

  let followsMap = new Map(follows.map((x) => [x.target_did, x]))

  let posts: FeedEntry[] = Map.groupBy(res, (item, index) => {
    return item.author_did
  }).entries().map((entry) => {
    let follow = followsMap.get(entry[0])
    if (!follow) {
      return []
    }
    let postsPerAccount = settings.posts_per_account || DEFAULT_POSTS_PER_ACCOUNT
    return entry[1]
      .slice(0, Math.max(0, follow.actor_score + postsPerAccount))
      .map(x => {
        return {
          uri: x.uri,
          indexed_at: x.indexed_at,
          cid: x.cid,
          repost_uri: undefined
        }
      })
  }).toArray().flat()

  debugLog(`Filtered top posts at ${Math.round(performance.now() - t0)}`)

  let postUris = new Set(posts.map((post) => post.uri))

  let repostPercent = settings.repost_percent || DEFAULT_REPOST_PERCENT
  //let maxReposts = Math.round(posts.length * repostPercent / (100 - repostPercent))
  let maxReposts = 0

  // Reposts by people you follow
  let repostRes =
    maxReposts === 0
      ? []
      : await ctx.db
        .selectFrom('repost')
        .innerJoin(
          'follow',
          (join) => join
            .onRef('follow.target_did', '=', 'repost.author_did')
            .on('follow.source_did', '=', requesterDid),
        )
        .select(['repost.uri', 'repost.cid', 'repost.indexed_at', 'repost.author_did', 'repost.post_uri'])
        .execute()

  debugLog(`Queried reposts at ${Math.round(performance.now() - t0)}`)

  repostRes = repostRes
    // It's apparently faster to do this filtering in the application layer.
    .filter((x) => {
      return x.indexed_at > cutOffDate.toISOString() && x.indexed_at < oldEnoughDate.toISOString()
    })
    // Don't show reposts of posts we'd already show
    .filter((x) => !postUris.has(x.post_uri))

  let reposts = Map.groupBy(repostRes, (item, index) => {
    return item.post_uri
  }).entries().toArray()

  reposts.sort((a, b) => {
    if (a[1].length != b[1].length) {
      return b[1].length - a[1].length
    }
    // This isn't meaningful, but the sort should be predictable.
    return b[0].localeCompare(a[0])
  })

  debugLog(`Sorted reposts at ${Math.round(performance.now() - t0)}`)

  debugLog(`Filtering ${reposts.length} reposts with max ${maxReposts}`)

  reposts = reposts.slice(0, maxReposts)

  let repostArray: FeedEntry[] = reposts.map((entry) => {
    // TODO: this could be more efficient, we just need the earliest repost, not a whole sort
    entry[1].sort((a, b) => {
      let indexedAtDiff = new Date(a.indexed_at).getTime() - new Date(b.indexed_at).getTime()
      if (indexedAtDiff != 0) {
        return indexedAtDiff
      }
      return a.cid.localeCompare(b.cid)
    })
    let repost = entry[1].at(0)!
    return {
      uri: repost.post_uri,
      cid: repost.cid,
      indexed_at: repost.indexed_at,
      repost_uri: repost.uri
    }
  })

  debugLog(`Processed reposts at ${Math.round(performance.now() - t0)}`)

  posts.push(...repostArray)

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

    let cursorCid: string = strings.length == 2 ? strings[1] : ''

    posts = posts.filter((x) =>
      x.indexed_at < timeStr ||
      x.indexed_at === timeStr && x.cid < cursorCid,
    )
  }

  debugLog(`Filtered by cursor at ${Math.round(performance.now() - t0)}`)

  posts = posts.slice(0, params.limit)

  let cursor: string | undefined
  const last = posts.at(-1)
  if (last) {
    cursor = new Date(last.indexed_at).getTime().toString(10) + ':' + last.cid
  }

  const feed: AppBskyFeedDefs.SkeletonFeedPost[] = posts.map((row) => {
    if (row.repost_uri) {
      return {
        post: row.uri,
        reason: {
          $type: 'app.bsky.feed.defs#skeletonReasonRepost',
          repost: row.repost_uri
        }
      }
    } else {
      return {
        post: row.uri,
      }
    }
  })

  debugLog(`Generated feed at ${Math.round(performance.now() - t0)}`)

  return {
    cursor,
    feed,
  }
}
