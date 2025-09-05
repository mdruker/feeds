import { Server } from '../lexicon'
import { AppContext } from '../config'
import { validateAuth } from '../auth'
import { AtUri } from '@atproto/syntax'
import { hasAdminPermission } from '../web/utils'
import { sql } from 'kysely'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.sendInteractions(async ({ input, req }) => {
    const requesterDid = await validateAuth(
      req,
      ctx.cfg.serviceDid,
      ctx.didResolver,
    )

    for (let interaction of input.body.interactions) {
      if (interaction.item === undefined) {
        continue
      }
      console.log('Processing interaction:', interaction.item, 'Event:', interaction.event)
      const postUri = new AtUri(interaction.item)
      let actorUpdate: number
      if (interaction.event === 'app.bsky.feed.defs#requestLess') {
        actorUpdate = -1
      } else if (interaction.event === 'app.bsky.feed.defs#requestMore') {
        actorUpdate = 1
      } else {
        continue
      }

      await ctx.db
        .updateTable('follow')
        .set({
          actor_score: sql`actor_score + ${actorUpdate}`,
        })
        .where('source_did', '=', requesterDid)
        .where('target_did', '=', postUri.host)
        .execute()
    }
    return {
      encoding: 'application/json',
      body: {},
    }
  })
}
