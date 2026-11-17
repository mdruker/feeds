import { sql } from 'kysely'
import { Database } from '../db/database'
import { FeedUsage } from '../db/schema'

// First pages this short are previews or polls, not someone reading the feed.
const MAX_SHORT_LOAD_LIMIT = 10

type InteractionCounter = 'seen' | 'opens' | 'engaged' | 'shaped'

const EVENT_COUNTERS: Record<string, InteractionCounter> = {
  'app.bsky.feed.defs#interactionSeen': 'seen',
  'app.bsky.feed.defs#clickthroughItem': 'opens',
  'app.bsky.feed.defs#clickthroughAuthor': 'opens',
  'app.bsky.feed.defs#clickthroughReposter': 'opens',
  'app.bsky.feed.defs#clickthroughEmbed': 'opens',
  'app.bsky.feed.defs#interactionShare': 'opens',
  'app.bsky.feed.defs#interactionLike': 'engaged',
  'app.bsky.feed.defs#interactionRepost': 'engaged',
  'app.bsky.feed.defs#interactionReply': 'engaged',
  'app.bsky.feed.defs#interactionQuote': 'engaged',
  'app.bsky.feed.defs#requestLess': 'shaped',
  'app.bsky.feed.defs#requestMore': 'shaped',
}

const COUNT_COLUMNS = ['first_pages', 'next_pages', 'items_served', 'seen', 'opens', 'engaged', 'shaped'] as const

// Tallies feed usage in memory and periodically adds it to feed_usage.
export class UsageRecorder {
  private pending = new Map<string, FeedUsage>()
  private timer?: NodeJS.Timeout
  private inFlight?: Promise<void>

  constructor(
    private db: Database,
    private shortnames: Set<string>,
    private now: () => Date = () => new Date(),
  ) {}

  recordFeedRequest(
    shortname: string,
    actorDid: string | null,
    { cursor, limit, itemsServed }: { cursor?: string, limit: number, itemsServed: number },
  ) {
    if (cursor === undefined && limit <= MAX_SHORT_LOAD_LIMIT) return

    const row = this.row(this.today(), shortname, actorDid ?? '')
    if (cursor === undefined) {
      row.first_pages++
    } else {
      row.next_pages++
    }
    row.items_served += itemsServed
  }

  recordInteractions(actorDid: string, interactions: { event?: string, feedContext?: string }[]) {
    const day = this.today()
    for (const { event, feedContext } of interactions) {
      const counter = event ? EVENT_COUNTERS[event] : undefined
      // feedContext comes back from the client, so only trust feeds we serve.
      const shortname = feedContext?.split('::')[0]
      if (!counter || !shortname || !this.shortnames.has(shortname)) continue

      this.row(day, shortname, actorDid)[counter]++
    }
  }

  // Everything recorded since the last call.
  take(): FeedUsage[] {
    const rows = [...this.pending.values()]
    this.pending = new Map()
    return rows
  }

  flush(): Promise<void> {
    const rows = this.take()
    if (rows.length === 0) return Promise.resolve()

    this.inFlight = this.db
      .insertInto('feed_usage')
      .values(rows)
      .onDuplicateKeyUpdate({
        first_pages: sql`first_pages + VALUES(first_pages)`,
        next_pages: sql`next_pages + VALUES(next_pages)`,
        items_served: sql`items_served + VALUES(items_served)`,
        seen: sql`seen + VALUES(seen)`,
        opens: sql`opens + VALUES(opens)`,
        engaged: sql`engaged + VALUES(engaged)`,
        shaped: sql`shaped + VALUES(shaped)`,
      })
      .execute()
      .then(() => {})
      .catch((err) => {
        console.error('Error flushing feed usage, will retry:', err)
        for (const failed of rows) {
          const row = this.row(failed.day, failed.shortname, failed.actor_did)
          for (const column of COUNT_COLUMNS) {
            row[column] += failed[column]
          }
        }
      })
    return this.inFlight
  }

  start(intervalMs: number = 60_000): void {
    this.timer = setInterval(() => this.flush(), intervalMs)
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.inFlight
    await this.flush()
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10)
  }

  private row(day: string, shortname: string, actorDid: string): FeedUsage {
    const key = `${day} ${shortname} ${actorDid}`
    let row = this.pending.get(key)
    if (!row) {
      row = {
        day,
        shortname,
        actor_did: actorDid,
        first_pages: 0,
        next_pages: 0,
        items_served: 0,
        seen: 0,
        opens: 0,
        engaged: 0,
        shaped: 0,
      }
      this.pending.set(key, row)
    }
    return row
  }
}
