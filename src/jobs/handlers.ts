import { Database } from '../db/database'
import { DidResolver } from '@atproto/identity'
import { Profile } from '../db/schema'
import { populateActor } from '../util/actors'
import { JobManager } from './manager'

export interface JobTypes {
  'fetch-follow-profiles': {
    did: string
  }
  'populate-actor': {
    did: string
  }
}

export interface JobContext {
  db: Database
  didResolver: DidResolver
  jobManager: JobManager
}

// Type helper for job handlers with context
export type JobHandler<T extends keyof JobTypes> = {
  type: T
  handler: (payload: JobTypes[T], ctx: JobContext) => Promise<void>
}

// Class to manage job handlers
export class JobHandlerRegistry {
  private handlers = new Map<string, (payload: any, ctx: JobContext) => Promise<void>>()

  register<T extends keyof JobTypes>(
    handler: JobHandler<T>
  ) {
    this.handlers.set(handler.type, handler.handler)
  }

  async runHandler(type: string, payload: unknown, ctx: JobContext) {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw new Error(`No handler registered for job type: ${type}`)
    }
    await handler(payload, ctx)
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys())
  }
}

export const jobHandlers = new JobHandlerRegistry()

jobHandlers.register({
  type: 'fetch-follow-profiles',
  handler: async (payload, ctx) => {
    console.log(`Fetching follow profiles for ${payload.did}`)

    // Follows that we need to populate.
    const follows = await ctx.db
      .selectFrom('follow')
      .select('target_did')
      .distinct()
      .leftJoin('profile', 'profile.did', 'follow.target_did')
      .where('source_did', '=', payload.did)
      .where('profile.handle', 'is', null)
      .execute()

    let dids = follows.map(follow => follow.target_did)
    // Look up the acting account too
    if (!dids.includes(payload.did)) {
      dids.push(payload.did)
    }

    const atPrefix = 'at://'
    const didWebPrefix = 'did:web:'
    let newProfiles: Profile[] = []
    let failedFetches = 0

    for (const did of dids) {
      let resolvedDid
      try {
        resolvedDid = await ctx.didResolver.resolve(did)
      } catch (err) {
        console.log(`Error resolving did: ${did}`, err)
        failedFetches++
      }

      if (failedFetches > 20) {
        throw Error('Too many failed fetches')
      }

      let alsoKnownAs = resolvedDid?.alsoKnownAs?.at(0)
      let handle: string | undefined

      if (alsoKnownAs?.startsWith(atPrefix)) {
        handle = alsoKnownAs.slice(atPrefix.length)
      } else if (did.startsWith('did:web:')) {
        handle = did.slice(didWebPrefix.length)
      }

      newProfiles.push({
        'did': did,
        'handle': handle,
        'updated_at': new Date()
      })

      if (newProfiles.length % 1000 === 0) {
        await insertProfiles(newProfiles)
        console.log(`Inserted ${newProfiles.length} profiles for ${payload.did}`)
        newProfiles = []
      }
    }

    if (newProfiles.length > 0) {
      await insertProfiles(newProfiles)
      console.log(`Inserted ${newProfiles.length} profiles for ${payload.did}`)
    }

    async function insertProfiles(profiles: Profile[]) {
      await ctx.db
        .insertInto('profile')
        .values(profiles)
        .onConflict((oc) => oc
          .constraint('profile_pkey')
          .doUpdateSet({
            handle: (eb) => eb.ref('excluded.handle'),
            updated_at: (eb) => eb.ref('excluded.updated_at'),
          }))
        .execute()
    }
  }
})

jobHandlers.register({
  type: 'populate-actor',
  handler: async (payload, ctx) => {
    await populateActor(ctx.db, ctx.didResolver, ctx.jobManager, payload.did)
  }
})
