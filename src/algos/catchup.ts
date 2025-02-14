import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { AtpAgent } from '@atproto/api'
import { isRelationship } from '@atproto/api/dist/client/types/app/bsky/graph/defs'
import { generateCatchupFeed } from './catchup-common'

// max 15 chars
export const shortname = 'catchup'

const NEW_ACTOR_PLACEHOLDER_FEED: { post: any }[] = [{
  post: 'at://did:plc:prng5tkqrb4b7f5xoishgpjl/app.bsky.feed.post/3lfzsvc6vkc2c',
}]

const MAX_FOLLOWS_TO_INDEX = 30000

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

  return await generateCatchupFeed(ctx, requesterDid, params, true)
}

async function populateActor(ctx: AppContext, requesterDid: string) {
  // Using unauthenticated read-only API
  const agent = new AtpAgent({
    service: 'https://public.api.bsky.app/',
  })

  let resolvedDid = await ctx.didResolver.resolve(requesterDid)

  let serviceEndpoint = resolvedDid?.service?.at(0)?.serviceEndpoint
  if (!serviceEndpoint) {
    throw new Error(`Did not resolve ${requesterDid}`)
  }

  const pdsAgent = new AtpAgent({
    service: serviceEndpoint as string
  })
  let actorResponse = await agent.app.bsky.actor.getProfile({ actor: requesterDid })

  let listRecordsResponse = await pdsAgent.com.atproto.repo.listRecords({
    repo: requesterDid,
    collection: 'app.bsky.graph.follow',
    limit: 100,
  })

  let listRecords: any[] = []

  while (listRecords.length < MAX_FOLLOWS_TO_INDEX
  && listRecordsResponse.data.records.length > 0
  && listRecordsResponse.data.cursor !== undefined) {
    listRecords = listRecords.concat(listRecordsResponse.data.records)

    listRecordsResponse = await pdsAgent.com.atproto.repo.listRecords({
      repo: requesterDid,
      collection: 'app.bsky.graph.follow',
      cursor: listRecordsResponse.data.cursor,
      limit: 100,
    })
  }

  let followsCreate = listRecords.map((follow) => ({
    uri: follow.uri,
    source_did: follow.uri.split('/')[2],
    target_did: follow.value.subject,
    created_at: new Date(follow.value.createdAt).toISOString(),
    is_mutual: 0,
    actor_score: 0,
  }))

  const maxRowsToInsert = 5000
  for (let i = 0; i < followsCreate.length; i = i + maxRowsToInsert) {
    await ctx.db
      .insertInto('follow')
      .values(followsCreate.slice(i, i + maxRowsToInsert))
      .onConflict((oc) => oc.doNothing())
      .execute()
  }

  await ctx.db
    .insertInto('actor')
    .values({
      did: requesterDid,
      handle: actorResponse.data.handle,
      created_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.doNothing())
    .execute()
  console.log(`Added ${requesterDid} / ${actorResponse.data.handle}, with ${followsCreate.length} follows`)
}
