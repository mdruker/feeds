import type { IncomingMessage, ServerResponse } from 'node:http'
import { AppContext } from '../config'
import { getSessionAgent } from './handlers'

export async function hasAdminPermission(ctx: AppContext, did: string): Promise<boolean> {
  let admin = await ctx.db
    .selectFrom('admin')
    .selectAll()
    .where('did', '=', did)
    .executeTakeFirst()

  return admin !== undefined
}

export async function sessionHasAdminPermission(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<boolean> {
  let oauthAgent = await getSessionAgent(req, res, ctx)
  if (!oauthAgent || !oauthAgent.did) {
    return false
  }

  return hasAdminPermission(ctx, oauthAgent.did)
}