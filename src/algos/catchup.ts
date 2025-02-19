import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { generateCatchupFeed } from './catchup-common'
import { populateActor } from '../util/actors'

// max 15 chars
export const shortname = 'catchup'

const NEW_ACTOR_PLACEHOLDER_FEED: { post: any }[] = [{
  post: 'at://did:plc:prng5tkqrb4b7f5xoishgpjl/app.bsky.feed.post/3lfzsvc6vkc2c',
}]

export const handler = async (ctx: AppContext, params: QueryParams, requesterDid: string) => {
  // If we don't know the actor, fetch their follows
  let actor = await ctx.db
    .selectFrom('actor')
    .selectAll()
    .where('did', '=', requesterDid)
    .executeTakeFirst()
  if (actor === undefined) {
    console.log(`Did not find ${requesterDid} in the db, starting to populate`)

    // This might take a while, but usually seems OK to wait for it to finish.
    await populateActor(ctx, requesterDid)
  }

  return await generateCatchupFeed(ctx, requesterDid, params)
}

