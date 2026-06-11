import { Database } from '../db/database'
import { debugLog } from '../lib/env'

export class CleanupService {
  private db: Database
  private timer?: NodeJS.Timeout
  private stopping = false

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

    await this.db
      .deleteFrom('seen_post')
      .where('created_at', '<', cutOffDate)
      .limit(10000)
      .execute()

    debugLog(`Completed cleanup task in ${Math.round(performance.now() - t0)}`)
  }

  start(intervalMs: number = 5000): void {
    this.stopping = false
    const scheduleNext = () => {
      this.timer = setTimeout(async () => {
        if (this.stopping) return
        try {
          await this.deleteOldRecords()
        } catch (error) {
          console.error('Error during cleanup:', error)
        }
        if (!this.stopping) scheduleNext()
      }, intervalMs)
    }

    scheduleNext()
    console.log(`Cleanup service started with ${intervalMs}ms interval between runs`)
  }

  // Stop scheduling further runs. A run already in flight finishes on its own.
  stop(): void {
    this.stopping = true
    if (this.timer) clearTimeout(this.timer)
  }
}