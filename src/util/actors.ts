import { AtpAgent } from '@atproto/api'
import { Database } from '../db/database'
import { DidResolver } from '@atproto/identity'
import { JobManager } from '../jobs/manager'

const MAX_FOLLOWS_TO_INDEX = 30000

export async function populateActor(
  db: Database, 
  didResolver: DidResolver, 
  jobManager: JobManager, 
  requesterDid: string, 
  async: boolean = false
) {
  let actor = await db
    .selectFrom('actor')
    .selectAll()
    .where('did', '=', requesterDid)
    .executeTakeFirst()
  if (actor !== undefined) {
    return
  }

  if (async) {
    await jobManager.createJob('populate-actor', { did: requesterDid })
    return
  }
  // Using unauthenticated read-only API
  const agent = new AtpAgent({
    service: 'https://public.api.bsky.app/',
  })

  let resolvedDid = await didResolver.resolve(requesterDid)

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
    created_at: new Date(follow.value.createdAt),
    actor_score: 0,
  }))

  const maxRowsToInsert = 5000
  for (let i = 0; i < followsCreate.length; i = i + maxRowsToInsert) {
    await db
      .insertInto('follow')
      .values(followsCreate.slice(i, i + maxRowsToInsert))
      .onConflict((oc) => oc.doNothing())
      .execute()
  }

  await jobManager.createJob('fetch-follow-profiles', { 'did': requesterDid })

  await db
    .insertInto('actor')
    .values({
      did: requesterDid,
      created_at: new Date(),
    })
    .onConflict((oc) => oc.doNothing())
    .execute()
  console.log(`Added ${requesterDid} / ${actorResponse.data.handle}, with ${followsCreate.length} follows`)
}