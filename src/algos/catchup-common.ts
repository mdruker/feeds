import { AppContext } from '../config'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { debugLog } from '../lib/env'
import * as AppBskyFeedDefs from '../lexicon/types/app/bsky/feed/defs'
import { SelectQueryBuilder, sql } from 'kysely'
import { HIGHLINE_CHRON_30_MIN_END_POST, NEW_ACTOR_PLACEHOLDER_FEED, NO_POSTS_PLACEHOLDER_FEED } from './helpers'
import { populateActor } from '../util/actors'
import * as highlineChron from './highline-chron'
import { getCursor } from '../util/cursors'

export type CatchupSettings = {
  include_replies: boolean | undefined
  posts_per_account: number | undefined
  repost_percent: number | undefined
  num_recent_posts: number | undefined
}

const CATCHUP_FEED_SHORTNAME = 'catchup'

const DEFAULT_INCLUDE_REPLIES = true
const DEFAULT_POSTS_PER_ACCOUNT = 2
const DEFAULT_REPOST_PERCENT = 10
const DEFAULT_NUM_RECENT_POSTS = 10

export async function getSettingsWithDefaults(ctx: AppContext, requesterDid: string): Promise<CatchupSettings> {
  let settingsResult = await ctx.db
    .selectFrom('feed_settings')
    .select('settings')
    .where('actor_did', '=', requesterDid)
    .where('shortname', '=', CATCHUP_FEED_SHORTNAME)
    .executeTakeFirst()
  let settingsJson = settingsResult?.settings
  let settings = settingsJson ? JSON.parse(settingsJson) as CatchupSettings : undefined

  return {
    include_replies: DEFAULT_INCLUDE_REPLIES,
    posts_per_account: DEFAULT_POSTS_PER_ACCOUNT,
    repost_percent: DEFAULT_REPOST_PERCENT,
    num_recent_posts: DEFAULT_NUM_RECENT_POSTS,
    ...settings,
  }
}

export async function handleCatchupFeed(ctx: AppContext, requesterDid: string, params: QueryParams, shortname: string) {
  // If we don't know the actor, fetch their follows
  let actor = await ctx.db
    .selectFrom('actor')
    .selectAll()
    .where('did', '=', requesterDid)
    .executeTakeFirst()
  if (actor === undefined) {
    console.log(`Did not find ${requesterDid} in the db, starting to populate`)

    // Enqueue the job to populate the actor
    await populateActor(ctx.db, ctx.didResolver, ctx.jobManager, requesterDid, true)

    // If the job finishes quickly enough, we can return the feed immediately.
    await new Promise(resolve => setTimeout(resolve, 5000))
    actor = await ctx.db
      .selectFrom('actor')
      .selectAll()
      .where('did', '=', requesterDid)
      .executeTakeFirst()

    if (actor === undefined) {
      console.log(`Actor ${requesterDid} still not found after waiting, returning placeholder`)
      return { feed: NEW_ACTOR_PLACEHOLDER_FEED }
    }
  }

  return await generateCatchupFeed(ctx, requesterDid, params, shortname)
}

export async function updateSettings(ctx: AppContext, actorDid: string, settings: CatchupSettings) {
  let settingsJson = JSON.stringify(settings)

  console.log(`Updating settings for ${actorDid} to: ${settingsJson}`)

  await ctx.db
    .insertInto('feed_settings')
    .values({
      actor_did: actorDid,
      shortname: CATCHUP_FEED_SHORTNAME,
      settings: settingsJson,
      updated_at: new Date(),
    })
    .onDuplicateKeyUpdate({
      settings: sql`VALUES(settings)`,
      updated_at: sql`VALUES(updated_at)`
    })
    .execute()
}

export async function generateCatchupFeed(ctx: AppContext, requesterDid: string, params: QueryParams, shortname: string) {
  let t0 = performance.now()

  const settings = await getSettingsWithDefaults(ctx, requesterDid)
  debugLog(`Got settings at ${Math.round(performance.now() - t0)}`)

  let cursor = params.cursor
  let cursorDate: Date
  let cursorCid: string

  if (!cursor && shortname == highlineChron.shortname) {
    const feedState = await ctx.db
      .selectFrom('feed_state')
      .select('latest_seen_cursor')
      .where('actor_did', '=', requesterDid)
      .where('shortname', '=', highlineChron.shortname)
      .executeTakeFirst()
    cursor = feedState?.latest_seen_cursor
  }

  // TODO: ignore the cursor if it's too old or malformed
  if (cursor) {
    let strings = cursor.split(':')
    cursorDate = new Date(parseInt(strings[0], 10))
    cursorCid = strings.length == 2 ? strings[1] : ''
  } else {
    cursorDate = new Date()
    if (shortname === highlineChron.shortname) {
      cursorDate.setHours(cursorDate.getHours() - 24)
      cursorCid = "aaaaaaaaaaaaaa" // They all start with a metadata prefix
    } else {
      // What if there's some posts from the future... those count, right?
      cursorDate.setMinutes(cursorDate.getMinutes() + 10)
      cursorCid = "zzzzzzzzzzzzzz" // They all start with a metadata prefix
    }
  }

  let newsUri: string | undefined
  const newsPost = await ctx.db
    .selectFrom('news_post')
    .selectAll()
    .where('actor_did', '=', requesterDid)
    .where('shortname', '=', shortname)
    .executeTakeFirst()

  if (newsPost !== undefined) {
    if (params.cursor !== undefined && newsPost.cursor_when_shown === params.cursor) {
      await ctx.db
        .deleteFrom('news_post')
        .where('actor_did', '=', requesterDid)
        .where('shortname', '=', shortname)
        .execute()
    } else if (params.cursor === undefined && params.limit > 10) {
      // Only want to show news when it's a regular new load of the feed.

      newsUri = newsPost.post_uri
    }
  }

  let postsPerAccount = settings.posts_per_account || DEFAULT_POSTS_PER_ACCOUNT
  let repostPercent = settings.repost_percent || DEFAULT_REPOST_PERCENT
  let numRecentPosts = Number(settings.num_recent_posts) || 0
  if (shortname === highlineChron.shortname) {
    numRecentPosts = 0
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
          .orderBy('indexed_at', 'desc')
          .limit(numRecentPosts)
      },
    )
    .with('rankedPosts', (db) => {
        let query: SelectQueryBuilder<any, any, any> = db.selectFrom('post')
          .innerJoin(
            'follow as author_follow',
            (join) => join
              .onRef('author_follow.target_did', '=', 'post.author_did')
              .on('author_follow.source_did', '=', requesterDid),
          )

        if (settings.include_replies) {
          query = query
            .leftJoin(
              'follow as root_follow',
              (join) => join
                .onRef('root_follow.target_did', '=', 'post.reply_root_did')
                .on('root_follow.source_did', '=', requesterDid),
            )
            .where((eb) =>
              eb('reply_parent_uri', 'is', null).or('root_follow.target_did', 'is not', null)
            )
        } else {
          query = query.where('reply_parent_uri', 'is', null)
        }

        return query
          .select(['post.uri', 'post.cid', 'post.indexed_at', 'post.author_did', 'post.engagement_count', 'author_follow.actor_score'])
          .select(
            sql<number>`row_number
            () over (partition by post.author_did order by post.engagement_count desc)`
              .as('rn'))
      },
    )
    .with('filteredPosts', (db => {
      return db
        .selectFrom('rankedPosts')
        .select(['uri', 'cid', 'indexed_at', sql<string>`null`.as('post_uri')])
        .where('rn', '<=', sql<number>`${postsPerAccount} + actor_score`)
    }))
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
    .with('postCount', (db => {
      return db
        .selectFrom('filteredPosts')
        .select(sql<number>`count(*)`.as('total_posts'))
    }))
    .with('rankedReposts', (db => {
      return db
        .selectFrom('repostDetails')
        .innerJoin('postCount', (join) => join.on(sql`1`, '=', sql`1`))
        .select([
          'repost_uri as uri',
          'cid',
          'indexed_at',
          'post_uri',
          sql<number>`row_number() over (order by repost_count desc)`.as('repost_rank'),
          'total_posts'
        ])
        .where('repost_rn', '=', 1)
        .where((eb) => eb.not(eb.exists(
          eb.selectFrom('rankedPosts')
            .select('uri')
            .whereRef('rankedPosts.uri', '=', 'repostDetails.post_uri')
        )))
    }))
    .with('limitedReposts', (db => {
      return db
        .selectFrom('rankedReposts')
        .select(['uri', 'cid', 'indexed_at', 'post_uri'])
        .where((eb) => eb('repost_rank', '<=',
          sql<number>`round(total_posts * ${repostPercent} / (100 - ${repostPercent}))`
        ))
    }))
    .with('combined', (db => {
      return db.selectFrom('filteredPosts')
        .select(['uri', 'cid', 'indexed_at', sql<string>`null`.as('post_uri')])
        .unionAll(
          db.selectFrom('limitedReposts')
            .select(['uri', 'cid', 'indexed_at', 'post_uri'])
        )
        .unionAll(
          db.selectFrom('recentPosts')
            .select(['uri', 'cid', 'indexed_at', 'post_uri'])
        )
    }))
    .selectFrom('combined')
    .selectAll()

  if (shortname === highlineChron.shortname) {
    // For chronological, we don't want to get all the way to current posts,
    // it would be too variable
    let cutOffDate = new Date()
    cutOffDate.setMinutes(cutOffDate.getMinutes() - 30)

    queryBuilder = queryBuilder
      .where('indexed_at', '<', cutOffDate)
      .where(({ eb, or, and }) => or([
        eb('indexed_at', '>', cursorDate),
        and([eb('indexed_at', '=', cursorDate), eb('cid', '<', cursorCid)])
      ]))
      .orderBy(['indexed_at asc', 'cid desc'])
  } else {
    queryBuilder = queryBuilder
      .where(({ eb, or, and }) => or([
        eb('indexed_at', '<', cursorDate),
        and([eb('indexed_at', '=', cursorDate), eb('cid', '<', cursorCid)])
      ]))
      .orderBy(['indexed_at desc', 'cid desc'])
  }

  let postResults = await queryBuilder
    .limit(params.limit)
    .execute()

  if (postResults.length === 0) {
    if (shortname === highlineChron.shortname) {
      return {
        feed: [{
          post: HIGHLINE_CHRON_30_MIN_END_POST,
          feedContext: shortname
        }]
      }
    } else {
      return { feed: NO_POSTS_PLACEHOLDER_FEED }
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

  if (newsUri !== undefined) {
    let newsPost: AppBskyFeedDefs.SkeletonFeedPost = {
      post: newsUri,
      feedContext: shortname
    }

    feed = [ newsPost ].concat(feed.slice(0, params.limit - 1))

    await ctx.db
      .updateTable('news_post')
      .where('actor_did', '=', requesterDid)
      .where('shortname', '=', shortname)
      .set('cursor_when_shown', newCursor)
      .execute()
  }

  if (shortname === highlineChron.shortname && feed.length < params.limit) {
    feed = feed.concat({
      post: HIGHLINE_CHRON_30_MIN_END_POST,
      feedContext: shortname
    })
  }

  debugLog(`Generated feed with ${feed.length} entries (${numReposts} reposts) at ${Math.round(performance.now() - t0)}, postsPerAccount: ${postsPerAccount}, repostPercent: ${repostPercent}`)

  return {
    cursor: newCursor,
    feed,
  }
}
