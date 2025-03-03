export interface JobTypes {
  'fetch-follow-profiles': {
    did: string
  }
}

// Type helper for job handlers
export type JobHandler<T extends keyof JobTypes> = {
  type: T
  handler: (payload: JobTypes[T]) => Promise<void>
}

// Class to manage job handlers
export class JobHandlerRegistry {
  private handlers = new Map<string, (payload: any) => Promise<void>>()

  register<T extends keyof JobTypes>(
    handler: JobHandler<T>
  ) {
    this.handlers.set(handler.type, handler.handler)
  }

  async runHandler(type: string, payload: unknown) {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw new Error(`No handler registered for job type: ${type}`)
    }
    await handler(payload)
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys())
  }
}

// Create and export the singleton registry
export const jobHandlers = new JobHandlerRegistry()

// Example handler registration
jobHandlers.register({
  type: 'fetch-follow-profiles',
  handler: async (payload) => {
    console.log(`Fetching follow profiles for ${payload.did}`)



  }
})
