import http from 'http'
import events from 'events'
import express from 'express'
import { DidResolver, MemoryCache } from '@atproto/identity'
import { createServer } from './lexicon'
import feedGeneration from './methods/get-feed-skeleton'
import sendInteractions from './methods/send-interactions'
import describeGenerator from './methods/describe-generator'
import { createDb, Database, migrateToLatest, pingDb, getPendingMigrations } from './db/database'
import { checkReadiness } from './health'
import { FirehoseSubscription } from './subscription'
import { AppContext, Config } from './config'
import wellKnown from './well-known'
import testing from './web/pages/testing'
import { createOauthClient } from './web/oauth/client'
import { webRouter } from './web/handlers'
import path from 'node:path'
import { JobManager } from './jobs/manager'
import { JobWorker } from './jobs/worker'
import { CleanupService } from './util/cleanup'

export class FeedGenerator {
  public app: express.Application
  public server: http.Server
  public db: Database
  public jobManager: JobManager
  public jobWorker: JobWorker
  public firehose: FirehoseSubscription
  public cleanup: CleanupService
  public cfg: Config
  // Shared with the /readyz handler: flipped true on shutdown so the route
  // reports not-ready and the load balancer drains this instance.
  public lifecycle: { shuttingDown: boolean }

  constructor(
    app: express.Application,
    db: Database,
    jobManager: JobManager,
    jobWorker: JobWorker,
    firehose: FirehoseSubscription,
    cleanup: CleanupService,
    cfg: Config,
    lifecycle: { shuttingDown: boolean },
  ) {
    this.app = app
    this.db = db
    this.jobManager = jobManager
    this.jobWorker = jobWorker
    this.firehose = firehose
    this.cleanup = cleanup
    this.cfg = cfg
    this.lifecycle = lifecycle
  }

  static create(cfg: Config) {
    const app = express()
    const db = createDb()
    const lifecycle = { shuttingDown: false }
    const firehose = new FirehoseSubscription(db)
    const didCache = new MemoryCache()
    const didResolver = new DidResolver({
      timeout: 20000,
      plcUrl: 'https://plc.directory',
      didCache,
    })

    const jobManager = new JobManager(db)
    const jobWorker = new JobWorker(jobManager, db, didResolver)
    const cleanup = new CleanupService(db)

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
      oauthClient,
      jobManager
    }

    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    // Liveness: the process is up and serving HTTP. Always 200 once listening;
    // used by the container healthcheck (incl. the worker, which isn't on the edge).
    app.get('/healthz', (_req, res) => {
      res.json({ status: 'ok', role: process.env.ROLE ?? 'all' })
    })

    // Readiness: 200 only when this instance can serve correctly — DB reachable
    // AND schema migrated (no pending migrations). The blue-green deploy gates
    // traffic on this so a green web instance never takes requests before the
    // deploy's migrate step has run. See docs/migrations.md. Decision logic lives
    // in ./health (unit tested); this route just maps it onto the response.
    app.get('/readyz', async (_req, res) => {
      const { statusCode, body } = await checkReadiness({
        ping: () => pingDb(db),
        getPending: () => getPendingMigrations(db),
        role: process.env.ROLE ?? 'all',
        shuttingDown: lifecycle.shuttingDown,
        onError: (err) => console.error('readiness check failed:', err),
      })
      res.status(statusCode).json(body)
    })

    feedGeneration(server, ctx)
    sendInteractions(server, ctx)

    // Static assets
    app.use('/public', express.static(path.join(__dirname, 'web/pages', 'public')))

    describeGenerator(server, ctx)
    app.use(server.xrpc.router)
    app.use(wellKnown(ctx))
    app.use(webRouter(ctx))

    app.use(testing(ctx))

    app.use((_req, res) => res.sendStatus(404))

    return new FeedGenerator(app, db, jobManager, jobWorker, firehose, cleanup, cfg, lifecycle)
  }

  async start(): Promise<http.Server> {
    // ROLE selects what this instance runs (see docs/migrations.md and the README):
    //   all (default) — everything + migrate on boot. Single process for dev/staging.
    //   web           — HTTP serving only; rolled blue-green. No boot migration.
    //   worker        — firehose + jobs + cleanup, exactly one instance. No boot migration.
    // Only `all` migrates on boot; web/worker rely on the separate `yarn migrate`
    // deploy step, so rolling web instances never race a migration.
    const role = (process.env.ROLE ?? 'all').toLowerCase()
    if (!['all', 'web', 'worker'].includes(role)) {
      throw new Error(`Invalid ROLE='${role}' (expected all|web|worker)`)
    }
    const runIngest = role === 'all' || role === 'worker'
    console.log(`Starting with ROLE=${role}`)

    if (role === 'all') {
      await migrateToLatest(this.db)
    }

    if (runIngest) {
      this.jobWorker.start()
      this.firehose.run()
      this.cleanup.start()
    }

    // All roles bind HTTP: web is what Caddy routes to; the worker uses it only
    // for its own healthcheck (it's on the internal network, not the edge).
    this.server = this.app.listen(this.cfg.port, this.cfg.listenhost, () => {
      console.log(`App listening on port ${this.cfg.port}`)
    })
    await events.once(this.server, 'listening')

    setInterval(() => {
      const used = process.memoryUsage()
      console.log(`Memory usage: rss: ${Math.round(used.rss / 1024 / 1024)} MB, heapTotal: ${Math.round(used.heapTotal / 1024 / 1024)} MB`)
    }, 60000)
    return this.server
  }

  // Graceful drain on SIGTERM/SIGINT. Order matters:
  //  1. /readyz -> 503 so the load balancer stops routing new requests here.
  //  2. stop the HTTP listener and let in-flight requests finish (these may hit
  //     the DB, so this must happen before we close the pool).
  //  3. stop ingest (no-ops for ROLE=web, which never started them) so nothing
  //     keeps querying once we close the pool.
  //  4. close the DB pool.
  // Safe to call more than once; idempotent via the shuttingDown guard.
  async shutdown(signal: string): Promise<void> {
    if (this.lifecycle.shuttingDown) return
    this.lifecycle.shuttingDown = true
    const role = process.env.ROLE ?? 'all'
    console.log(`${signal} received — draining (ROLE=${role})`)

    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
      // Nudge idle keep-alive sockets so close() doesn't wait on them.
      this.server.closeIdleConnections?.()
    })

    this.cleanup.stop()
    await Promise.all([this.firehose.stop(), this.jobWorker.stop()])

    try {
      await this.db.destroy()
    } catch (err) {
      console.error('db destroy:', err)
    }
    console.log('drain complete')
  }
}

export default FeedGenerator
