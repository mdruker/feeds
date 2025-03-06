import { JobManager } from './manager'
import { jobHandlers, JobTypes, JobContext } from './handlers'
import { Database } from '../db/database'
import { DidResolver } from '@atproto/identity'

const PROCESS_ID = `${process.env.FLY_MACHINE_ID || 'local'}:${process.pid}`

export class JobWorker {
  constructor(
    private jobManager: JobManager,
    private db: Database,
    private didResolver: DidResolver,
  ) {}

  private getContext(): JobContext {
    return {
      db: this.db,
      didResolver: this.didResolver
    }
  }

  async start() {
    // Get the list of job types we can handle
    const jobTypes = jobHandlers.getRegisteredTypes()

    const handlePendingJobs = async () => {
      while (true) {
        try {
          // This isn't efficient, but if we have few jobs, this doesn't run too often
          await this.jobManager.releaseOrphanedJobs()

          const job = await this.jobManager.claimNextJob(PROCESS_ID, jobTypes)
          if (!job) {
            // No jobs available, wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 1000))
            continue
          }

          console.log(`Processing job ${job.id} of type ${job.type}`)

          try {
            const ctx = this.getContext()
            await jobHandlers.runHandler(job.type, job.payload, ctx)
            await this.jobManager.completeJob(job.id)
          } catch (error) {
            console.error(`Error processing job ${job.id}:`, error)
            await this.jobManager.completeJob(job.id, error instanceof Error ? error.message : String(error))
          }
        } catch (error) {
          console.error('Job worker error:', error)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    }

    console.log(`Starting job manager.`)
    await handlePendingJobs()
  }
}

// Helper function to create a strongly typed job
export async function createJob<T extends keyof JobTypes>(
  jobManager: JobManager,
  type: T,
  payload: JobTypes[T],
) {
  return jobManager.createJob(type, payload)
}