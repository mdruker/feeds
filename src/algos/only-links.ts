import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { populateActor } from '../util/actors'
import { AtUri } from '@atproto/syntax'
import { PostProperties } from '../util/properties'

// max 15 chars
export const shortname = 'only-links'

export const handler = async (ctx: AppContext, params: QueryParams, requesterDid: string) => {
  // If we don't know the actor, fetch their follows
  let actor = await ctx.db
    .selectFrom('actor')
    .selectAll()
    .where('did', '=', requesterDid)
    .executeTakeFirst()
  if (actor === undefined) {
    console.log(`Did not find ${requesterDid} in the db, starting to populate`)

    // This might take a while, but usually seems OK to wait for it to finish.
    await populateActor(ctx, requesterDid)
  }

  // Fetch all of actor's follows from the db
  let follows = await ctx.db
    .selectFrom('follow')
    .selectAll()
    .where('source_did', '=', requesterDid)
    .execute()

  if (follows.length == 0) {
    return {
      feed: [],
    }
  }

  let posts = await ctx.db
    .selectFrom('post')
    .innerJoin(
      'follow',
      (join) => join
        .onRef('follow.target_did', '=', 'post.author_did')
        .on('follow.source_did', '=', requesterDid)
    )
    .select(['post.uri', 'post.cid', 'post.indexed_at', 'post.author_did', 'post.reply_parent_uri', 'post.reply_root_uri', 'post.properties'])
    .execute()

  let cutOffDate = new Date()
  cutOffDate.setHours(cutOffDate.getHours() - 24)

  // We only want top level posts or posts from a threads.
  // Imperfect heuristic: the reply root and the reply parent being the same as the author.
  // To do better we need to compute more.
  posts = posts.filter((x) =>
    !x.reply_root_uri ||
    !x.reply_parent_uri ||
    (x.author_did === new AtUri(x.reply_root_uri).host &&
      x.author_did === new AtUri(x.reply_parent_uri).host))

  posts = posts.filter(x => {
    if (!x.properties) {
      return false
    }
    let properties = JSON.parse(x.properties) as PostProperties
    return properties.has_link
  })

  posts.sort((a, b) => {
    let indexedAtDiff = new Date(b.indexed_at).getTime() - new Date(a.indexed_at).getTime()
    if (indexedAtDiff != 0) {
      return indexedAtDiff
    }
    return b.cid.localeCompare(a.cid)
  })

  // Apply the cursor only after so we're relatively consistently calculating the posts needed.
  if (params.cursor) {
    let strings = params.cursor.split(':')
    const timeStr = new Date(parseInt(strings[0], 10)).toISOString()

    let cursorCid: string = strings.length == 2 ? strings[1] : ""

    posts = posts.filter((x) =>
      x.indexed_at < timeStr ||
      x.indexed_at === timeStr && x.cid < cursorCid
    )
  }

  posts = posts.slice(0, params.limit)

  let cursor: string | undefined
  const last = posts.at(-1)
  if (last) {
    cursor = new Date(last.indexed_at).getTime().toString(10) + ':' + last.cid
  }

  const feed = posts.map((row) => ({
    post: row.uri,
  }))

  return {
    cursor,
    feed,
  }
}
