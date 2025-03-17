import assert from 'node:assert'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isValidHandle } from '@atproto/syntax'
import { Agent } from '@atproto/api'
import express from 'express'
import { getIronSession } from 'iron-session'
import { AppContext } from '../config'
import { CatchupSettings, getSettingsWithDefaults, updateSettings } from '../algos/catchup-common'

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

    const profile = await agent.getProfile({ actor: agent.did!! })
    const settings = await getSettingsWithDefaults(ctx, agent.did!!)

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

    const settings: CatchupSettings = {
      include_replies: req.body.include_replies,
      posts_per_account: req.body.posts_per_account,
      repost_percent: req.body.repost_percent,
    }

    await updateSettings(ctx, agent.did!!, settings)
    return res.json({ success: true })
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
          scope: 'atproto transition:generic',
        })
        return res.redirect(url.toString())
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

  // Serve index.html
  router.get('/', (req, res) => {
    res.sendFile('index.html', { root: 'public' })
  })

  return router
}