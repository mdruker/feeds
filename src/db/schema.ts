export type DatabaseSchema = {
  sub_state: SubState
  actor: Actor
  follow: Follow
  post: Post
  auth_session: AuthSession
  auth_state: AuthState
  admin: Admin
  feed_settings: FeedSettings
}

export type SubState = {
  service: string
  cursor: number
  restart: number | undefined
}

export type Actor = {
  did: string
  handle: string
  created_at: string
}

export type Follow = {
  uri: string
  source_did: string
  target_did: string
  created_at: string
  is_mutual: number // No longer updated
  actor_score: number
}

export type Post = {
  uri: string
  cid: string
  author_did: string
  reply_parent_uri: string | undefined
  reply_root_uri: string | undefined
  indexed_at: string
  num_likes: number
  num_replies: number
  num_reposts: number
}

export type AuthSession = {
  key: string
  session: AuthSessionJson
}

export type AuthState = {
  key: string
  state: AuthStateJson
}

type AuthStateJson = string

type AuthSessionJson = string

export type Admin = {
  did: string
}

export type FeedSettings = {
  shortname: string
  actor_did: string
  settings: SettingsJson
}

type SettingsJson = string