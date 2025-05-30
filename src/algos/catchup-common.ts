import { AppContext } from '../config'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { debugLog } from '../lib/env'
import * as AppBskyFeedDefs from '../lexicon/types/app/bsky/feed/defs'
import { SelectQueryBuilder, sql } from 'kysely'

export type CatchupSettings = {
  include_replies: boolean | undefined
  posts_per_account: number | undefined
  repost_percent: number | undefined
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
    .onConflict((oc) => oc
      .columns(['actor_did', 'shortname'])
      .doUpdateSet({ settings: settingsJson, updated_at: new Date().toISOString() }))
    .execute()
}

export async function generateCatchupFeed(ctx: AppContext, requesterDid: string, params: QueryParams) {
  let t0 = performance.now()

  const settings = await getSettingsWithDefaults(ctx, requesterDid)
  debugLog(`Got settings at ${Math.round(performance.now() - t0)}`)

  let cutOffDate = new Date()
  cutOffDate.setHours(cutOffDate.getHours() - 24)

  let cursorDate: Date
  let cursorCid: string

  if (params.cursor) {
    let strings = params.cursor.split(':')
    cursorDate = new Date(parseInt(strings[0], 10))
    cursorCid = strings.length == 2 ? strings[1] : ''
  } else {
    cursorDate = new Date()
    cursorDate.setMinutes(cursorDate.getMinutes() + 10)
    cursorCid = "zzzzzzzzzzzzzz" // They all start with a metadata prefix
  }

  let postsPerAccount = settings.posts_per_account || DEFAULT_POSTS_PER_ACCOUNT
  let repostPercent = settings.repost_percent || DEFAULT_REPOST_PERCENT

  let postResults = await ctx.db
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
                .onRef('root_follow.target_did', '=', sql`split_part
                (replace(post.reply_root_uri, 'at://', ''), '/', 1)`)
                .on('root_follow.source_did', '=', requesterDid),
            )
            .where((eb) =>
              eb('reply_parent_uri', 'is', null).or('root_follow.target_did', 'is not', null)
          )

        } else {
          query = query.where('reply_parent_uri', 'is', null)
        }

        return query
          .where('post.indexed_at', '>', cutOffDate.toISOString())
          .select(['post.uri', 'post.cid', 'post.indexed_at', 'post.author_did', 'post.num_likes', 'post.num_reposts', 'post.num_replies', 'author_follow.actor_score'])
          .select(
            sql<number>`row_number
            () over (partition by post.author_did order by post.num_likes + post.num_reposts + post.num_replies desc)`
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
        .where('repost.indexed_at', '>', cutOffDate.toISOString())
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
      return db.selectFrom('rankedPosts')
        .select(['uri', 'cid', 'indexed_at', sql<string>`null`.as('post_uri')])
        .where('rn', '<=', sql<number>`${postsPerAccount} + actor_score`)
        .unionAll(
          db.selectFrom('limitedReposts')
            .select(['uri', 'cid', 'indexed_at', 'post_uri'])
        )
    }))
    .selectFrom('combined')
    .selectAll()
    .where(({ eb, or, and }) => or([
        eb('indexed_at', '<', cursorDate),
        and([eb('indexed_at', '=', cursorDate), eb('cid', '<', cursorCid)])
      ]))
    .orderBy(['indexed_at desc', 'cid desc'])
    .limit(params.limit)
    .execute()

  let cursor: string | undefined
  const last = postResults.at(-1)
  if (last) {
    cursor = new Date(last.indexed_at).getTime().toString(10) + ':' + last.cid
  }

  const feed: AppBskyFeedDefs.SkeletonFeedPost[] = postResults.map((row) => {
    if (row.post_uri) {
      return {
        post: row.uri,
        reason: {
          $type: 'app.bsky.feed.defs#skeletonReasonRepost',
          repost: row.post_uri
        }
      }
    } else {
      return {
        post: row.uri,
      }
    }
  })

  debugLog(`Generated feed with ${feed.length} entries at ${Math.round(performance.now() - t0)}`)

  return {
    cursor,
    feed,
  }
}
