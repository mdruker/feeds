import { Database } from './db/database'
import { DidResolver } from '@atproto/identity'
import { NodeOAuthClient } from '@atproto/oauth-client-node'

export type AppContext = {
  db: Database
  didResolver: DidResolver
  cfg: Config
  oauthClient: NodeOAuthClient
}

export type Config = {
  port: number
  listenhost: string
  hostname: string
  sqliteLocation: string
  serviceDid: string
  publisherDid: string
}
