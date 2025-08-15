import { AtpAgent } from '@atproto/api'
import { Database } from '../db/database'
import { DidResolver } from '@atproto/identity'
import { JobManager } from '../jobs/manager'
import { sql } from 'kysely'

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
    await jobManager.createJob('populate-actor', { did: requesterDid }, 10)
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
      .ignore()
      .execute()
  }

  await fetchProfile(db, didResolver, requesterDid)

  await db
    .insertInto('actor')
    .values({
      did: requesterDid,
      created_at: new Date(),
    })
    .ignore()
    .execute()
  console.log(`Added ${requesterDid} / ${actorResponse.data.handle}, with ${followsCreate.length} follows`)
}

async function fetchProfile(
  db: Database,
  didResolver: DidResolver,
  did: string,
) {
  console.log(`Fetching profile for ${did}`)

  const atPrefix = 'at://'
  const didWebPrefix = 'did:web:'

  let resolvedDid
  try {
    resolvedDid = await didResolver.resolve(did)
  } catch (err) {
    console.log(`Error resolving did: ${did}`, err)
    return
  }

  let alsoKnownAs = resolvedDid?.alsoKnownAs?.at(0)
  let handle: string | undefined

  if (alsoKnownAs?.startsWith(atPrefix)) {
    handle = alsoKnownAs.slice(atPrefix.length)
  } else if (did.startsWith('did:web:')) {
    handle = did.slice(didWebPrefix.length)
  }

  await db
    .insertInto('profile')
    .values([{
      'did': did,
      'handle': handle,
      'updated_at': new Date()
    }])
    .onDuplicateKeyUpdate({
      handle: sql`VALUES(handle)`,
      updated_at: sql`VALUES(updated_at)`
    })
    .execute()
}