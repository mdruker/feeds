import assert from 'node:assert'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isValidHandle } from '@atproto/syntax'
import { Agent, AtpAgent } from '@atproto/api'
import express from 'express'
import { getIronSession } from 'iron-session'
import { AppContext } from '../config'
import { CatchupSettings, getSettingsWithDefaults, updateSettings } from '../algos/catchup-common'
import { sessionHasAdminPermission } from './utils'
import { allShortnames } from '../algos'
import * as followingMinus from '../algos/following-minus'
import { sql } from 'kysely'

type Session = { did: string }

// Helper function for defining routes
const handler =
  (fn: express.Handler) =>
    async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        await fn(req, res, next)
      } catch (err) {
        next(err)
      }
    }

// Helper function to get the Atproto Agent for the active session
export async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  ctx: AppContext
) {
  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: process.env.FEEDGEN_COOKIE_SECRET!!,
  })
  if (!session.did) return null
  try {
    const oauthSession = await ctx.oauthClient.restore(session.did)
    return oauthSession ? new Agent(oauthSession) : null
  } catch (err) {
    console.warn({ err }, 'oauth restore failed')
    session.destroy()
    return null
  }
}

export const webRouter = (ctx: AppContext) => {
  const router = express.Router()

  // Serve static files
  router.use(express.static('public'))

  // API endpoints
  router.get('/api/me', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }
    const settings = await getSettingsWithDefaults(ctx, agent.did!!)

    const atpAgent = new AtpAgent({
      service: 'https://api.bsky.app'
    })
    const profile = await atpAgent.getProfile({ actor: agent.did!! })

    return res.json({
      handle: profile.data.handle,
      settings
    })
  }))

  router.post('/api/settings', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    if (req.body.posts_per_account < 0 || req.body.posts_per_account > 100) {
      return res.status(400).json({ error: 'Invalid value for posts_per_account' })
    }

    if (req.body.repost_percent < 0 || req.body.repost_percent > 50) {
      return res.status(400).json({ error: 'Invalid value for repost_percent' })
    }

    if (req.body.num_recent_posts < 0 || req.body.num_recent_posts > 1000) {
      return res.status(400).json({ error: 'Invalid value for num_recent_posts' })
    }

    const settings: CatchupSettings = {
      include_replies: req.body.include_replies,
      posts_per_account: req.body.posts_per_account,
      repost_percent: req.body.repost_percent,
      num_recent_posts: req.body.num_recent_posts,
    }

    await updateSettings(ctx, agent.did!!, settings)
    return res.json({ success: true })
  }))

  router.get('/api/actor-scores', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    const actorScores = await ctx.db
      .selectFrom('follow')
      .select(['target_did', 'actor_score'])
      .where('source_did', '=', agent.did!!)
      .where('actor_score', '!=', 0)
      .orderBy('target_did', 'asc')
      .execute()

    return res.json({ 
      actorScores: actorScores.map(score => ({
        did: score.target_did,
        score: score.actor_score
      }))
    })
  }))

  router.post('/api/actor-scores', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    const { did, score } = req.body
    
    if (!did || typeof did !== 'string' || !did.startsWith('did:')) {
      return res.status(400).json({ error: 'Invalid DID' })
    }

    if (typeof score !== 'number' || score < -10 || score > 10) {
      return res.status(400).json({ error: 'Score must be a number between -10 and 10' })
    }

    // Check if follow relationship exists
    const existingFollow = await ctx.db
      .selectFrom('follow')
      .selectAll()
      .where('source_did', '=', agent.did!!)
      .where('target_did', '=', did)
      .executeTakeFirst()

    if (!existingFollow) {
      return res.status(400).json({ error: 'You must follow this user to set a score' })
    }

    // Update the actor score
    await ctx.db
      .updateTable('follow')
      .set({ actor_score: score })
      .where('source_did', '=', agent.did!!)
      .where('target_did', '=', did)
      .execute()

    return res.json({ success: true })
  }))

  router.post('/api/check-follow', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    const { did } = req.body
    
    if (!did || typeof did !== 'string' || !did.startsWith('did:')) {
      return res.status(400).json({ error: 'Invalid DID' })
    }

    // Check if the user follows this account
    const followExists = await ctx.db
      .selectFrom('follow')
      .select(['actor_score'])
      .where('source_did', '=', agent.did!!)
      .where('target_did', '=', did)
      .executeTakeFirst()

    if (!followExists) {
      return res.json({
        currentScore: 0,
        follows: false
      })
    } else {
      return res.json({
        currentScore: followExists.actor_score,
        follows: true
      })
    }
  }))

  // The viewer's following-minus mutes: accounts whose posts and/or reposts are
  // hidden from that feed.
  router.get('/api/following-minus/mutes', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    const mutes = await ctx.db
      .selectFrom('feed_subject_settings')
      .select(['subject_did', 'muted', 'hide_reposts'])
      .where('actor_did', '=', agent.did!!)
      .where('shortname', '=', followingMinus.shortname)
      .where((eb) => eb.or([eb('muted', '=', true), eb('hide_reposts', '=', true)]))
      .orderBy('subject_did', 'asc')
      .execute()

    return res.json({
      mutes: mutes.map((m) => ({
        did: m.subject_did,
        muted: m.muted,
        hide_reposts: m.hide_reposts,
      })),
    })
  }))

  // Set or clear a following-minus mute. Unlike the "show less" interaction
  // (which only escalates), this sets the exact state, so it's also the un-mute
  // path: muted=false, hide_reposts=false removes the row.
  router.post('/api/following-minus/mutes', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    const { did, muted, hide_reposts } = req.body

    if (!did || typeof did !== 'string' || !did.startsWith('did:')) {
      return res.status(400).json({ error: 'Invalid DID' })
    }
    if (typeof muted !== 'boolean' || typeof hide_reposts !== 'boolean') {
      return res.status(400).json({ error: 'muted and hide_reposts must be booleans' })
    }

    // following-minus shows your follows and yourself, so a mute is meaningful
    // for an account you follow or your own — but not for anyone else.
    if (did !== agent.did!!) {
      const existingFollow = await ctx.db
        .selectFrom('follow')
        .select('uri')
        .where('source_did', '=', agent.did!!)
        .where('target_did', '=', did)
        .executeTakeFirst()

      if (!existingFollow) {
        return res.status(400).json({ error: 'You must follow this user to mute them' })
      }
    }

    if (!muted && !hide_reposts) {
      await ctx.db
        .deleteFrom('feed_subject_settings')
        .where('actor_did', '=', agent.did!!)
        .where('subject_did', '=', did)
        .where('shortname', '=', followingMinus.shortname)
        .execute()
    } else {
      await ctx.db
        .insertInto('feed_subject_settings')
        .values({
          actor_did: agent.did!!,
          subject_did: did,
          shortname: followingMinus.shortname,
          muted,
          hide_reposts,
          updated_at: new Date(),
        })
        .onDuplicateKeyUpdate({
          muted: sql`VALUES(muted)`,
          hide_reposts: sql`VALUES(hide_reposts)`,
          updated_at: sql`VALUES(updated_at)`,
        })
        .execute()
    }

    return res.json({ success: true })
  }))

  router.post('/jobs/populate-actor/', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    if (!(await sessionHasAdminPermission(req, res, ctx))) {
      return res.status(403).json({ error: 'Need admin permission' })
    }

    let dids: string[]
    try {
      dids = req.body.dids
    } catch (err) {
      return res.status(400).json({ error: 'Invalid input for dids parameter' })
    }

    console.log(`Adding ${dids.length} populate-actor jobs`)

    for (const did of dids) {
      await ctx.jobManager.createJob('populate-actor', { 'did': did })
    }

    return res.json({ success: true })
  }))

  router.post('/api/news-post', handler(async (req, res) => {
    const agent = await getSessionAgent(req, res, ctx)
    if (!agent) {
      return res.status(401).json({ error: 'Not logged in' })
    }

    if (!(await sessionHasAdminPermission(req, res, ctx))) {
      return res.status(403).json({ error: 'Need admin permission' })
    }

    const { post_uri, shortname } = req.body
    
    if (!post_uri || typeof post_uri !== 'string' || !post_uri.startsWith('at://')) {
      return res.status(400).json({ error: 'Invalid post URI - must start with at://' })
    }

    if (!shortname || !allShortnames.has(shortname)) {
      return res.status(400).json({ error: 'Invalid shortname' })
    }

    try {
      const actors = await ctx.db
        .selectFrom('actor')
        .select(['did'])
        .execute()

      console.log(`Creating news post for ${actors.length} actors`)

      const newsPostEntries = actors.map(actor => ({
        actor_did: actor.did,
        shortname: shortname,
        post_uri: post_uri,
        created_at: new Date(),
        cursor_when_shown: ''
      }))

      // Add news entry, updating it to the latest if there's already one.
      if (newsPostEntries.length > 0) {
        for (const entry of newsPostEntries) {
          await ctx.db
            .insertInto('news_post')
            .values(entry)
            .onDuplicateKeyUpdate({
              post_uri: entry.post_uri,
              created_at: entry.created_at,
              cursor_when_shown: entry.cursor_when_shown
            })
            .execute()
        }
      }

      return res.json({ 
        success: true, 
        count: actors.length,
        message: `News post created for ${actors.length} users` 
      })
    } catch (error) {
      console.error('Error creating news post:', error)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }))

  // OAuth metadata
  router.get(
    '/client-metadata.json',
    handler((_req, res) => {
      return res.json(ctx.oauthClient.clientMetadata)
    })
  )

  // OAuth callback to complete session creation
  router.get(
    '/oauth/callback',
    handler(async (req, res) => {
      const params = new URLSearchParams(req.originalUrl.split('?')[1])
      try {
        const { session } = await ctx.oauthClient.callback(params)
        const clientSession = await getIronSession<Session>(req, res, {
          cookieName: 'sid',
          password: process.env.FEEDGEN_COOKIE_SECRET!!,
        })
        // TODO: handle idempotence without errors
        assert(!clientSession.did, 'session already exists')
        clientSession.did = session.did
        await clientSession.save()
      } catch (err) {
        console.error({ err }, 'oauth callback failed')
        return res.redirect('/?error')
      }
      return res.redirect('/')
    })
  )

  // Login handler
  router.post(
    '/login',
    handler(async (req, res) => {
      const handle = req.body?.handle
      if (typeof handle !== 'string' || !isValidHandle(handle)) {
        // TODO: surface error
        return res.json({ success: false })
      }

      // Initiate the OAuth flow
      try {
        const url = await ctx.oauthClient.authorize(handle, {
          scope: 'atproto',
        })
        return res.json({ url: url.toString(), success: true })
      } catch (err) {
        console.error({ err }, 'oauth authorize failed')
        // TODO: surface error
        return res.json({ success: false })
      }
    })
  )

  // Logout handler
  router.post(
    '/logout',
    handler(async (req, res) => {
      const session = await getIronSession<Session>(req, res, {
        cookieName: 'sid',
        password: process.env.FEEDGEN_COOKIE_SECRET!!,
      })
      session.destroy()
      return res.redirect('/')
    })
  )

  // Admin page
  router.get('/admin', handler(async (req, res) => {
    if (!(await sessionHasAdminPermission(req, res, ctx))) {
      return res.status(403).json({ error: 'Need admin permission' })
    }
    res.sendFile('admin.html', { root: 'public' })
  }))

  // Serve index.html
  router.get('/', (req, res) => {
    res.sendFile('index.html', { root: 'public' })
  })

  return router
}