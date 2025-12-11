import { InvalidRequestError } from '@atproto/xrpc-server'
import { Server } from '../lexicon'
import { AppContext } from '../config'
import algos from '../algos'
import { validateAuth } from '../auth'
import { AtUri } from '@atproto/syntax'
import { populateActor } from '../util/actors'
import { NEW_ACTOR_PLACEHOLDER_FEED } from '../algos/helpers'
import { OutputSchema, QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.getFeedSkeleton(async ({ params, req }) => {
    const feedUri = new AtUri(params.feed)
    const shortname = feedUri.rkey
    const algo = algos[shortname]
    if (
      feedUri.hostname !== ctx.cfg.publisherDid ||
      feedUri.collection !== 'app.bsky.feed.generator' ||
      !algo
    ) {
      throw new InvalidRequestError(
        'Unsupported algorithm',
        'UnsupportedAlgorithm',
      )
    }

    let requesterDid: string, body: OutputSchema
    try {
      requesterDid = await validateAuth(
        req,
        ctx.cfg.serviceDid,
        ctx.didResolver,
      )

      console.log(`Request for ${shortname} for ${requesterDid}, cursor ${params.cursor}, limit ${params.limit}`)
      let t0 = performance.now()

      body = await getFeedSkeleton(ctx, requesterDid, shortname, params)

      let t1 = performance.now()
      console.log(`Returning ${body.feed.length} posts in ${Math.round(t1 - t0)} ms for ${feedUri.rkey} for ${requesterDid}`)
    } catch (err) {
      console.error(`Error in handling ${shortname} feed:`, err)
      throw err  // Re-throw to let Express error handler catch it
    }

    return {
      encoding: 'application/json',
      body: body
    }
  })
}

export async function getFeedSkeleton(ctx: AppContext, requesterDid: string, shortname: string, params: QueryParams) : Promise<OutputSchema> {
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
  }

  if (actor === undefined) {
    console.log(`Actor ${requesterDid} still not found after waiting, returning placeholder`)
    return { feed: NEW_ACTOR_PLACEHOLDER_FEED }
  }

  const algo = algos[shortname]
  if (!algo) {
    throw new InvalidRequestError('Unsupported algorithm',
      'UnsupportedAlgorithm')
  }
  return await algo(ctx, params, requesterDid)
}
