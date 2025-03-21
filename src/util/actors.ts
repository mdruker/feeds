import { AppContext } from '../config'
import { AtpAgent } from '@atproto/api'

const MAX_FOLLOWS_TO_INDEX = 30000

export async function populateActor(ctx: AppContext, requesterDid: string) {
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
    service: serviceEndpoint as string,
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

  await ctx.jobManager.createJob('fetch-follow-profiles', { 'did': requesterDid })

  await ctx.db
    .insertInto('actor')
    .values({
      did: requesterDid,
      created_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.doNothing())
    .execute()
  console.log(`Added ${requesterDid} / ${actorResponse.data.handle}, with ${followsCreate.length} follows`)
}