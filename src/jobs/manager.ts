import { Database } from '../db/database'
import { Insertable, Selectable } from 'kysely'
import { Job } from '../db/schema'
import { run } from 'node:test'

const MAX_HANDLE_ATTEMPTS = 10
const SECONDS_BACKOFF_AFTER_FAILURE = [5, 10, 30, 60, 120, 120, 120, 120, 120, 120]

const HOURS_TO_KEEP_COMPLETED_JOBS = 48

export class JobManager {
  constructor(private db: Database) {}

  async createJob(type: string, payload: any) {
    let now = new Date()
    const insertData: Insertable<Job> = {
      type,
      payload: JSON.stringify(payload),
      status: 'pending',
      owner_pid: null,
      created_at: now,
      updated_at: now,
      error: null,
      failure_count: 0
    }

    const result = await this.db
      .insertInto('job')
      .values(insertData)
      .returning('id')
      .executeTakeFirst()

    return result?.id
  }

  async claimNextJob(processId: string, jobTypes: string[]): Promise<Selectable<Job> | null> {
    // Claim the next available job atomically
    return await this.db.transaction().execute(async (trx) => {
      const job = await trx
        .selectFrom('job')
        .where('status', '=', 'pending')
        .where('type', 'in', jobTypes)
        .where((eb) =>
          eb('run_after', 'is', null).or('run_after', '<', new Date().toISOString())
        )
        .orderBy('created_at', 'asc')
        .limit(1)
        .selectAll()
        .executeTakeFirst()

      if (!job) return null

      await trx
        .updateTable('job')
        .where('id', '=', job.id)
        .set({
          status: 'running',
          owner_pid: processId,
          updated_at: new Date(),
        })
        .execute()

      return job
    })
  }

  async completeJob(job: Selectable<Job>, error?: string) {
    let status = job.status
    let failureCount = job.failure_count
    let runAfter: string | null = null
    if (!error) {
      status = 'completed'
    } else {
      failureCount = failureCount + 1

      if (failureCount >= MAX_HANDLE_ATTEMPTS) {
        status = 'failed'
      } else {
        status = 'pending'
        let date = new Date()
        let backoffSeconds = SECONDS_BACKOFF_AFTER_FAILURE.at(failureCount) || 120
        date.setSeconds(date.getSeconds() + backoffSeconds)
        runAfter = date.toISOString()
      }
    }

    await this.db
      .updateTable('job')
      .where('id', '=', job.id)
      .set((eb) => ({
        status: status,
        error: error || null,
        updated_at: new Date(),
        owner_pid: null,
        failure_count: failureCount,
        run_after: runAfter
      }))
      .execute()
  }

  async releaseOrphanedJobs() {
    const now = new Date()
    let cutOffDate = now
    cutOffDate.setMinutes(now.getMinutes() - 10)
    await this.db
      .updateTable('job')
      .where('status', '=', 'running')
      .where('updated_at', '<', cutOffDate)
      .set({
        status: 'pending',
        owner_pid: null,
        updated_at: now,
      })
      .execute()
  }

  async deleteOldJobs() {
    const now = new Date()
    let cutOffDate = now
    cutOffDate.setHours(now.getHours() - HOURS_TO_KEEP_COMPLETED_JOBS)
    await this.db
      .deleteFrom('job')
      .where('status', 'in', ['completed', 'failed'])
      .where('updated_at', '<', cutOffDate)
      .execute()
  }
}