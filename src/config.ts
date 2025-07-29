import { Database } from './db/database'
import { DidResolver } from '@atproto/identity'
import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { JobManager } from './jobs/manager'

export type AppContext = {
  db: Database
  didResolver: DidResolver
  cfg: Config
  oauthClient: NodeOAuthClient
  jobManager: JobManager
}

export type Config = {
  port: number
  listenhost: string
  hostname: string
  serviceDid: string
  publisherDid: string
}
