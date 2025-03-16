import { AuthRequiredError, InvalidRequestError } from '@atproto/xrpc-server'
import { Server } from '../lexicon'
import { AppContext } from '../config'
import algos from '../algos'
import { validateAuth } from '../auth'
import { AtUri } from '@atproto/syntax'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.getFeedSkeleton(async ({ params, req }) => {
    const feedUri = new AtUri(params.feed)
    const algo = algos[feedUri.rkey]
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

    const requesterDid = await validateAuth(
      req,
      ctx.cfg.serviceDid,
      ctx.didResolver,
    )

    try {
      console.log(`Request for ${feedUri.rkey} for ${requesterDid}, cursor ${params.cursor}, limit ${params.limit}`)

      let t0 = performance.now()
      const body = await algo(ctx, params, requesterDid)

      let profile = await ctx.db
        .selectFrom('profile')
        .select('handle')
        .where('did', '=', requesterDid)
        .executeTakeFirst()

      let t1 = performance.now()
      console.log(`Returning ${body.feed.length} posts in ${Math.round(t1-t0)} ms for ${feedUri.rkey} for ${requesterDid} (${profile?.handle})`)

      return {
        encoding: 'application/json',
        body: body,
      }
    } catch (err) {
      console.error(`Error in ${feedUri.rkey} feed handler:`, err);
      throw err;  // Re-throw to let Express error handler catch it
    }
  })
}
