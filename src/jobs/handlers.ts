import { Database } from '../db/database'
import { DidResolver } from '@atproto/identity'
import { populateActor } from '../util/actors'
import { JobManager } from './manager'

export interface JobTypes {
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
  type: 'populate-actor',
  handler: async (payload, ctx) => {
    await populateActor(ctx.db, ctx.didResolver, ctx.jobManager, payload.did)
  }
})
