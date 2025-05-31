import { Generated } from 'kysely'

export type DatabaseSchema = {
  sub_state: SubState
  actor: Actor
  follow: Follow
  post: Post
  auth_session: AuthSession
  auth_state: AuthState
  admin: Admin
  feed_settings: FeedSettings
  profile: Profile
  job: Job
  repost: Repost
}

export type SubState = {
  service: string
  cursor: number
  restart: number | undefined
}

export type Actor = {
  did: string
  created_at: string
}

export type Follow = {
  uri: string
  source_did: string
  target_did: string
  created_at: string
  actor_score: number
}

export type Post = {
  uri: string
  cid: string
  author_did: string
  reply_parent_uri: string | undefined
  reply_parent_did: string | undefined
  reply_root_uri: string | undefined
  reply_root_did: string | undefined
  indexed_at: string
  num_likes: number
  num_replies: number
  num_reposts: number
  properties: string | undefined
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
  settings: SettingsJson,
  updated_at: string
}

type SettingsJson = string

export type Profile = {
  did: string
  handle: string | undefined
  updated_at: string
}

export type Job = {
  id: Generated<number>
  type: string  
  payload: string // JSON payload
  status: 'pending' | 'running' | 'completed' | 'failed'
  owner_pid: string | null
  created_at: string
  updated_at: string
  error: string | null
  failure_count: number
  run_after: string | null
}

export type Repost = {
  uri: string
  cid: string
  author_did: string
  post_uri: string
  indexed_at: string
}