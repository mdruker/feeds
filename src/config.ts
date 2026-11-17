import { Database } from './db/database'
import { DidResolver } from '@atproto/identity'
import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { JobManager } from './jobs/manager'
import { UsageRecorder } from './util/usage'

export type AppContext = {
  db: Database
  didResolver: DidResolver
  cfg: Config
  oauthClient: NodeOAuthClient
  jobManager: JobManager
  usage: UsageRecorder
}

export type Config = {
  port: number
  listenhost: string
  hostname: string
  serviceDid: string
  publisherDid: string
}
