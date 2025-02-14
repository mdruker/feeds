import http from 'http'
import events from 'events'
import express from 'express'
import { DidResolver, MemoryCache } from '@atproto/identity'
import { createServer } from './lexicon'
import feedGeneration from './methods/get-feed-skeleton'
import describeGenerator from './methods/describe-generator'
import { createDb, Database, migrateToLatest } from './db/database'
import { FirehoseSubscription } from './subscription'
import { AppContext, Config } from './config'
import wellKnown from './well-known'
import testing from './pages/testing'
import { createOauthClient } from './oauth/client'
import { loginRouter } from './oauth/handlers'
import path from 'node:path'

export class FeedGenerator {
  public app: express.Application
  public server: http.Server
  public db: Database
  public firehose: FirehoseSubscription
  public cfg: Config

  constructor(
    app: express.Application,
    db: Database,
    firehose: FirehoseSubscription,
    cfg: Config,
  ) {
    this.app = app
    this.db = db
    this.firehose = firehose
    this.cfg = cfg
  }

  static create(cfg: Config) {
    const app = express()
    const db = createDb(cfg.sqliteLocation)
    const firehose = new FirehoseSubscription(db)

    const didCache = new MemoryCache()
    const didResolver = new DidResolver({
      timeout: 20000,
      plcUrl: 'https://plc.directory',
      didCache,
    })

    const server = createServer({
      validateResponse: true,
      payload: {
        jsonLimit: 100 * 1024, // 100kb
        textLimit: 100 * 1024, // 100kb
        blobLimit: 5 * 1024 * 1024, // 5mb
      },
    })

    let oauthClient = createOauthClient(db, cfg)

    const ctx: AppContext = {
      db,
      didResolver,
      cfg,
      oauthClient
    }

    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))
    feedGeneration(server, ctx)

    // Static assets
    app.use('/public', express.static(path.join(__dirname, 'pages', 'public')))

    describeGenerator(server, ctx)
    app.use(server.xrpc.router)
    app.use(wellKnown(ctx))
    app.use(loginRouter(ctx))

    app.use(testing(ctx))

    app.use((_req, res) => res.sendStatus(404))

    return new FeedGenerator(app, db, firehose, cfg)
  }

  async start(): Promise<http.Server> {
    await migrateToLatest(this.db)
    this.firehose.run()
    this.server = this.app.listen(this.cfg.port, this.cfg.listenhost, () => {
      console.log(`App listening on port ${this.cfg.port}`)
    })
    await events.once(this.server, 'listening')
    return this.server
  }
}

export default FeedGenerator
