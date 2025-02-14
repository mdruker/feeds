import { ids } from '../lexicon/lexicons'
import { Database } from '../db/database'
import { Jetstream, CommitType, CommitEvent } from '@skyware/jetstream'
import WebSocket from 'ws'
import { Semaphore } from 'async-mutex'
import Queue from 'yocto-queue'

const semaphore = new Semaphore(128)

const JETSTREAM_ENDPOINT = 'wss://jetstream2.us-east.bsky.network/subscribe'

export abstract class FirehoseSubscriptionBase {
  public jetstream: Jetstream

  constructor(public db: Database) {}

  abstract handleOps(ops: OperationsByType): Promise<void>

  async run() {
    let lastSuccessfulCursor = await this.getCursor()
    const eventQueue = new Queue<CommitEvent<any>>()

    this.jetstream = new Jetstream({
      ws: WebSocket,
      cursor: lastSuccessfulCursor,
      endpoint: JETSTREAM_ENDPOINT,
    })

    this.jetstream.on('open', async () => {
      console.log('Jetstream opening')
    })

    this.jetstream.on('close', async () => {
      console.log('Jetstream closing')
    })

    this.jetstream.on('error', async (error, cursor) => {
      console.log(`Jetstream error at ${cursor}`, error)
    })

    this.jetstream.on('commit', (event) => {
      eventQueue.enqueue(event)
    })

    const processQueue = async () => {
      let t0: number = performance.now()
      let opsByType: OperationsByType = opsByTypeClean()

      while (true) {
        if (eventQueue.size === 0) {
          // TODO: understand why this is necessary
          await new Promise((resolve) => setTimeout(resolve, 50))
        }

        const event = eventQueue.dequeue()
        if (!event) continue

        let batchRaceWon = false
        await semaphore.acquire().then(async ([value, release]) => {
          if (opsByType.opsProcessed === 0) {
            console.log(`Starting firehose batch at time ${event.time_us}`)
            t0 = performance.now()
          }
          addOpsByType(event, opsByType)

          batchRaceWon = true
          release()
        })
        if (!batchRaceWon) {
          console.log(`Lost a race to process a batch`)
        }

        if (opsByType.opsProcessed >= 5000) {
          let t1 = performance.now()

          let handledHere = false
          await semaphore.acquire().then(async ([value, release]) => {
            await this.handleOps(opsByType)
              .then(() => {
                lastSuccessfulCursor = opsByType.cursor
                opsByType = opsByTypeClean()

                handledHere = true
              })
              .finally(() => {
                release()
              })
          })

          if (handledHere) {
            let t2 = performance.now()
            await this.updateDbCursorAndCheckForRestart(lastSuccessfulCursor!!)
            console.log(`Processed batch in ${Math.round(t1 - t0)} ms (fetching) and ${Math.round(t2 - t1)} ms (handling), updated cursor to ${lastSuccessfulCursor}`)
          } else {
            console.log(`Lost a race to handle a batch`)
          }
        }
      }
    }

    console.log(`Starting jetstream.`)
    this.jetstream.cursor = lastSuccessfulCursor
    this.jetstream.start()

    await processQueue()
  }

  private async getDbCursor() {
    return await this.db
      .selectFrom('sub_state')
      .selectAll()
      .where('service', '=', JETSTREAM_ENDPOINT)
      .executeTakeFirst()
  }

  async updateDbCursorAndCheckForRestart(cursor: number) {
    let dbCursor = await this.getDbCursor()

    if (dbCursor?.restart == 1) {
      await this.db
        .updateTable('sub_state')
        .where('service', '=', JETSTREAM_ENDPOINT)
        .set('restart', undefined)
        .execute()

      // TODO: actually figure out a way to make this work. Currently it gets overridden.
      this.jetstream.cursor = dbCursor.cursor
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    await this.db
      .insertInto('sub_state')
      .values({ service: JETSTREAM_ENDPOINT, cursor: cursor})
      .onConflict((oc) => oc.doUpdateSet( {cursor}))
      .execute()
  }

  async getCursor(): Promise<number | undefined> {
    const res = await this.getDbCursor()
    if (res) {
      console.log(`Fetching fresh cursor: ${res.cursor}`)
      return res.cursor
    }
    return undefined
  }
}

function addOpsByType(event: CommitEvent<any>, opsByType: OperationsByType) {
  const uri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`
  const collection = event.commit.collection

  opsByType.cursor = event.time_us
  opsByType.opsProcessed++

  if (event.commit.operation === CommitType.Update) {
    return
  }

  if (event.commit.operation === CommitType.Create) {
    if (!event.commit.cid) return

    const entry = {
      uri,
      cid: event.commit.cid.toString(),
      author: event.did,
      record: event.commit.record
    }

    if (collection === ids.AppBskyFeedPost) {
      opsByType.posts.creates.push(entry)
    } else if (collection === ids.AppBskyFeedRepost) {
      opsByType.reposts.creates.push(entry)
    } else if (collection === ids.AppBskyFeedLike) {
      opsByType.likes.creates.push(entry)
    } else if (collection === ids.AppBskyGraphFollow) {
      opsByType.follows.creates.push(entry)
    } else {
      return
    }
  }

  if (event.commit.operation === CommitType.Delete) {
    if (collection === ids.AppBskyFeedPost) {
      opsByType.posts.deletes.push({ uri })
    } else if (collection === ids.AppBskyFeedRepost) {
      opsByType.reposts.deletes.push({ uri })
    } else if (collection === ids.AppBskyFeedLike) {
      opsByType.likes.deletes.push({ uri })
    } else if (collection === ids.AppBskyGraphFollow) {
      opsByType.follows.deletes.push({ uri })
    } else {
      return
    }
  }
}

function opsByTypeClean() {
  return {
    posts: { creates: [], deletes: [] },
    reposts: { creates: [], deletes: [] },
    likes: { creates: [], deletes: [] },
    follows: { creates: [], deletes: [] },
    cursor: undefined,
    opsProcessed: 0
  }
}

export type OperationsByType = {
  posts: Operations<any>
  reposts: Operations<any>
  likes: Operations<any>
  follows: Operations<any>
  cursor: number | undefined
  opsProcessed: number
}

type Operations<T = Record<string, unknown>> = {
  creates: CreateOp<T>[]
  deletes: DeleteOp[]
}

type CreateOp<T> = {
  uri: string
  cid: string
  author: string
  record: T
}

type DeleteOp = {
  uri: string
}

