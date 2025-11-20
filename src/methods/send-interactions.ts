import { Server } from '../lexicon'
import { AppContext } from '../config'
import { validateAuth } from '../auth'
import { AtUri } from '@atproto/syntax'
import { sql } from 'kysely'
import { debugLog } from '../lib/env'
import * as highlineChron from '../algos/highline-chron'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.sendInteractions(async ({ input, req }) => {
    try {
      const requesterDid = await validateAuth(
        req,
        ctx.cfg.serviceDid,
        ctx.didResolver,
      )
      let latestSeenHighlineChronCursor: string | undefined = undefined

      for (let interaction of input.body.interactions) {
        if (interaction.item === undefined) {
          continue
        }

        debugLog('Processing interaction:', interaction.item, 'Event:', interaction.event, 'Feed context:', interaction.feedContext)
        const postUri = new AtUri(interaction.item)
        if (interaction.event === 'app.bsky.feed.defs#requestLess') {
          await updateScore(requesterDid, postUri.host, -1)
        } else if (interaction.event === 'app.bsky.feed.defs#requestMore') {
          await updateScore(requesterDid, postUri.host, 1)
        } else if (interaction.event === 'app.bsky.feed.defs#interactionSeen'
          && interaction.feedContext?.startsWith(highlineChron.shortname + "::")) {
          const cursor = interaction.feedContext.split("::").at(1)
          if (cursor && isCursor(cursor) &&
            (!latestSeenHighlineChronCursor || cursor > latestSeenHighlineChronCursor)) {
            latestSeenHighlineChronCursor = cursor
          }
        }
      }

      if (latestSeenHighlineChronCursor) {
        await ctx.db
          .insertInto('feed_state')
          .values({
            actor_did: requesterDid,
            shortname: highlineChron.shortname,
            latest_seen_cursor: latestSeenHighlineChronCursor,
          })
          .onDuplicateKeyUpdate({
            latest_seen_cursor: (eb) => eb.fn('GREATEST', [
              eb.ref('latest_seen_cursor'),
              eb.val(latestSeenHighlineChronCursor)
            ])
          })
          .execute()
      }

      return {
        encoding: 'application/json',
        body: {},
      }
    } catch (err) {
      console.error(`Error in sendInteractions handler:`, err);
      throw err;  // Re-throw to let Express error handler catch it
    }
  })

  async function updateScore(requesterDid: string, targetDid: string, actorUpdate: number) {
    await ctx.db
      .updateTable('follow')
      .set({
        actor_score: sql`actor_score + ${actorUpdate}`,
      })
      .where('source_did', '=', requesterDid)
      .where('target_did', '=', targetDid)
      .execute()
  }

  function isCursor(cursor: string) {
    let strings = cursor.split(':')
    if (strings.length !== 2) {
      return false
    }
    return /^[0-9]+$/.test(strings[0])
      && /^[a-zA-Z0-9]+$/.test(strings[1]);
  }
}
