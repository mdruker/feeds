import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { SessionStore, StateStore } from './storage'
import { Database } from '../../db/database'
import { Config } from '../../config'

export const createOauthClient = (db: Database, cfg: Config) => {
  const publicUrl = cfg.hostname !== '127.0.0.1'
    ? "https://" + cfg.hostname
    : undefined
  const url = publicUrl || `http://127.0.0.1:3000`

  const enc = encodeURIComponent
  return new NodeOAuthClient({
    clientMetadata: {
      client_name: 'feeds.mdruker.app - feed settings',
      client_id: publicUrl
        ? `${url}/client-metadata.json`
        : `http://localhost?redirect_uri=${enc(`${url}/oauth/callback`)}&scope=${enc('atproto')}`,
      client_uri: url,
      redirect_uris: [`${url}/oauth/callback`],
      scope: 'atproto',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    },
    stateStore: new StateStore(db),
    sessionStore: new SessionStore(db),
  })
}