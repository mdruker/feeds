import { Database } from '../db/database'
import { debugLog } from '../lib/env'

export class CleanupService {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  async deleteOldRecords(): Promise<void> {
    const t0 = performance.now()
    
    const cutOffDate = new Date()
    cutOffDate.setHours(cutOffDate.getHours() - 24)

    await this.db
      .deleteFrom('post')
      .where('indexed_at', '<', cutOffDate)
      .limit(10000)
      .execute()

    await this.db
      .deleteFrom('repost')
      .where('indexed_at', '<', cutOffDate)
      .limit(10000)
      .execute()

    debugLog(`Completed cleanup task in ${Math.round(performance.now() - t0)}`)
  }

  start(intervalMs: number = 5000): void {
    const scheduleNext = () => {
      setTimeout(async () => {
        try {
          await this.deleteOldRecords()
        } catch (error) {
          console.error('Error during cleanup:', error)
        }
        scheduleNext()
      }, intervalMs)
    }

    scheduleNext()
    console.log(`Cleanup service started with ${intervalMs}ms interval between runs`)
  }
}