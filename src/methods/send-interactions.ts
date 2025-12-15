import { Server } from '../lexicon'
import { AppContext } from '../config'
import { validateAuth } from '../auth'
import { AtUri } from '@atproto/syntax'
import { sql } from 'kysely'
import { debugLog } from '../lib/env'
import * as highlineChron from '../algos/highline-chron'
import * as followingChron from '../algos/following-chron'
import { getCursor, isCursor } from '../util/cursors'
import { hasAdminPermission } from '../web/utils'
import { LIKE_TO_JUMP_TO_30_MIN_AGO_POST } from '../algos/helpers'

export default function (server: Server, ctx: AppContext) {
  async function updateCursor(requesterDid: string, shortname: string, latestCursor: string) {
    await ctx.db
      .insertInto('feed_state')
      .values({
        actor_did: requesterDid,
        shortname: shortname,
        latest_seen_cursor: latestCursor,
      })
      .onDuplicateKeyUpdate({
        latest_seen_cursor: (eb) => eb.fn('GREATEST', [
          eb.ref('latest_seen_cursor'),
          eb.val(latestCursor),
        ]),
      })
      .execute()
  }

  server.app.bsky.feed.sendInteractions(async ({ input, req }) => {
    try {
      const requesterDid = await validateAuth(
        req,
        ctx.cfg.serviceDid,
        ctx.didResolver,
      )
      let latestSeenHighlineChronCursor: string | undefined
      let latestSeenFollowingChronCursor: string | undefined

      const isAdmin = await hasAdminPermission(ctx, requesterDid)

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
        } else if (interaction.event === 'app.bsky.feed.defs#interactionSeen'
          && interaction.feedContext?.startsWith(followingChron.shortname + "::")) {
          const cursor = interaction.feedContext.split("::").at(1)
          if (cursor && isCursor(cursor) &&
            (!latestSeenFollowingChronCursor || cursor > latestSeenFollowingChronCursor)) {
            latestSeenFollowingChronCursor = cursor
          }
        } else if (interaction.event === 'app.bsky.feed.defs#interactionLike'
          && interaction.feedContext?.startsWith(followingChron.shortname + "::")
          && interaction.item === LIKE_TO_JUMP_TO_30_MIN_AGO_POST) {
          let cursorDate = new Date()
          cursorDate.setMinutes(cursorDate.getMinutes() - 30)
          let cursorCid = "aaaaaaaaaaaaaa"
          latestSeenFollowingChronCursor = getCursor(cursorDate, cursorCid)
        }
      }

      const seenCursors = new Map<string, string[]>([
        [followingChron.shortname, []],
        [highlineChron.shortname, []],
      ])

      input.body.interactions
        .filter(interaction => interaction.item !== undefined
          && interaction.event === 'app.bsky.feed.defs#interactionSeen'
        )
        .forEach(interaction => {
          if (interaction.feedContext !== undefined) {
            const split = interaction.feedContext.split("::")
            if (split.length === 2 && seenCursors[split[0]] !== undefined) {
              seenCursors[split[0]].push(split[1])
            }
          }
        })

      for (const [shortname, cursors] of seenCursors) {
        if (cursors.length > 0) {
          cursors.sort();
          cursors.reverse();
          // await updateCursor(requesterDid, shortname, cursors[0])
          if (shortname == highlineChron.shortname && cursors[0] !== latestSeenHighlineChronCursor) {
            console.log(`Mismatch in cursor updates: ${cursors[0]} vs ${latestSeenHighlineChronCursor}`)
          }
        }
      }

      if (latestSeenHighlineChronCursor !== undefined) {
        await updateCursor(requesterDid, highlineChron.shortname, latestSeenHighlineChronCursor)
      }
      if (latestSeenFollowingChronCursor !== undefined) {
        await updateCursor(requesterDid, followingChron.shortname, latestSeenFollowingChronCursor)
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
}
