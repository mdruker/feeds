import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { generateCatchupFeed } from './catchup-common'
import { populateActor } from '../util/actors'

// max 15 chars
export const shortname = 'catchup'

const NEW_ACTOR_PLACEHOLDER_FEED: { post: any }[] = [{
  post: 'at://did:plc:spjnerrczdlc4mt3zf3pnjg2/app.bsky.feed.post/3lpudze4prs2w',
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

  return await generateCatchupFeed(ctx, requesterDid, params)
}

