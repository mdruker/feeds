import type { IncomingMessage, ServerResponse } from 'node:http'
import { AppContext } from '../config'
import { getSessionAgent } from './handlers'

export async function hasAdminPermission(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<boolean> {
  let oauthAgent = await getSessionAgent(req, res, ctx)
  if (!oauthAgent || !oauthAgent.did) {
    return false
  }

  let admin = await ctx.db
    .selectFrom('admin')
    .selectAll()
    .where('did', '=', oauthAgent.did)
    .executeTakeFirst()

  return admin !== undefined
}