import assert from 'node:assert'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import { isValidHandle } from '@atproto/syntax'
import { Agent } from '@atproto/api'
import express from 'express'
import { getIronSession } from 'iron-session'
import { AppContext } from '../config'
import { page } from '../lib/view'
import { login } from '../pages/login'
import { home } from '../pages/home'

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

export const loginRouter = (ctx: AppContext) => {
  const router = express.Router()

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

  // Login page
  router.get(
    '/login',
    handler(async (_req, res) => {
      return res.type('html').send(page(login({})))
    })
  )

  // Login handler
  router.post(
    '/login',
    handler(async (req, res) => {
      // Validate
      const handle = req.body?.handle
      if (typeof handle !== 'string' || !isValidHandle(handle)) {
        return res.type('html').send(page(login({ error: 'invalid handle' })))
      }

      // Initiate the OAuth flow
      try {
        const url = await ctx.oauthClient.authorize(handle, {
          scope: 'atproto transition:generic',
        })
        return res.redirect(url.toString())
      } catch (err) {
        console.error({ err }, 'oauth authorize failed')
        return res.type('html').send(
          page(
            login({
              error:
                err instanceof OAuthResolverError
                  ? err.message
                  : "couldn't initiate login",
            })
          )
        )
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

  // Homepage
  router.get(
    '/',
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx)

      if (!agent) {
        // Serve the logged-out view
        return res.type('html').send(page(login({ })))
      }

      let profile = await agent.getProfile({ actor: agent.did!! })

      // Serve the logged-in view
      return res.type('html').send(
        page(home({ handle: profile.data.handle }))
      )
    })
  )

  // "Set status" handler
  router.post(
    '/status',
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res
          .status(401)
          .type('html')
          .send('<h1>Error: Session required</h1>')
      }

      return res.redirect('/')
    })
  )

  return router
}