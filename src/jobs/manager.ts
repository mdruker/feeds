import { Database } from '../db/database'
import { Insertable } from 'kysely'
import { Job } from '../db/schema'

export class JobManager {
  constructor(private db: Database) {}

  async createJob(type: string, payload: any) {
    const now = new Date()
    const insertData: Insertable<Job> = {
      type,
      payload: JSON.stringify(payload),
      status: 'pending',
      owner_pid: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      error: null,
    }

    const result = await this.db
      .insertInto('job')
      .values(insertData)
      .returning('id')
      .executeTakeFirst()

    return result?.id
  }

  async claimNextJob(processId: string, jobTypes: string[]) {
    // Claim the next available job atomically
    const result = await this.db.transaction().execute(async (trx) => {
      const job = await trx
        .selectFrom('job')
        .where('status', '=', 'pending')
        .where('type', 'in', jobTypes)
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
          updated_at: new Date().toISOString(),
        })
        .execute()

      return job
    })

    if (!result) return null

    return {
      ...result,
      payload: JSON.parse(result.payload),
    }
  }

  async completeJob(jobId: number, error?: string) {
    await this.db
      .updateTable('job')
      .where('id', '=', jobId)
      .set({
        status: error ? 'failed' : 'completed',
        error: error || null,
        updated_at: new Date().toISOString(),
        owner_pid: null,
      })
      .execute()
  }

  async releaseOrphanedJobs() {
    const now = new Date()
    let cutOffDate = now
    cutOffDate.setMinutes(now.getMinutes() - 10)
    await this.db
      .updateTable('job')
      .where('status', '=', 'running')
      .where('updated_at', '<', cutOffDate.toISOString())
      .set({
        status: 'pending',
        owner_pid: null,
        updated_at: now.toISOString(),
      })
      .execute()
  }

  async getJobById(jobId: number) {
    const job = await this.db
      .selectFrom('job')
      .where('id', '=', jobId)
      .selectAll()
      .executeTakeFirst()

    if (!job) return null

    return {
      ...job,
      payload: JSON.parse(job.payload),
    }
  }

  async deleteJob(jobId: number) {
    await this.db
      .deleteFrom('job')
      .where('id', '=', jobId)
      .execute()
  }
}