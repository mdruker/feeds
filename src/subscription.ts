import { FirehoseSubscriptionBase, OperationsByType } from './util/subscription'
import { isLink } from './lexicon/types/app/bsky/richtext/facet'
import { isMain as isExternalEmbed } from './lexicon/types/app/bsky/embed/external'
import { Post, Repost } from './db/schema'
import { PostProperties } from './util/properties'
import { AtUri } from '@atproto/syntax'
import { debugLog } from './lib/env'
import { sql } from 'kysely'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleOps(ops: OperationsByType) {
    let t0 = performance.now()

    let batchProcessDate = new Date()

    let identityUpdateDids = ops.identityEvents
      .filter(x => x.handle)
      .map(x => x.did)

    if (identityUpdateDids.length > 0) {
      let res = await this.db
        .selectFrom('profile')
        .select('did')
        .where('did', 'in', identityUpdateDids)
        .execute()

      let knownProfileDids = res.map(x => x.did)

      const profileUpdatedDids = new Set<string>()
      const profileUpdates = ops.identityEvents
        .filter(x => knownProfileDids.includes(x.did))
        .filter(x => {
          if (profileUpdatedDids.has(x.did)) {
            return false
          }
          profileUpdatedDids.add(x.did)
          return true
        })

        .map(update => ({
          did: update.did,
          handle: update.handle,
          updated_at: batchProcessDate
        }))

      if (profileUpdates.length > 0) {
        await this.db
          .insertInto('profile')
          .values(profileUpdates)
          .onDuplicateKeyUpdate({
            handle: sql`VALUES(handle)`,
            updated_at: sql`VALUES(updated_at)`
          })
          .execute()
      }
    }

    let actorResult = await this.db
      .selectFrom('actor')
      .select('did')
      .execute()
    let actors = new Set(actorResult.map(x => x.did))

    // Create new follow relationships we don't know about.
    const followsToCreate = ops.follows.creates
      .filter((x) => actors.has(x.author))
      .map((followCreate) => {
        return {
          uri: followCreate.uri,
          source_did: followCreate.author,
          target_did: followCreate.record.subject,
          created_at: batchProcessDate,
          actor_score: 0
        }
      })
    if (followsToCreate.length > 0) {
      await this.db
        .insertInto('follow')
        .values(followsToCreate)
        .ignore()
        .execute()
    }

    // Reflect follow relationship deletions.
    const followsToDelete = ops.follows.deletes
      .map((followDelete) => followDelete.uri)
    let followsDeleted = 0
    if (followsToDelete.length > 0) {
      // The full entries we're going to delete.
      let followDeleteResults = await this.db
        .selectFrom('follow')
        .selectAll()
        .where('uri', 'in', followsToDelete)
        .execute()

      // Now we can delete them.
      await this.db
        .deleteFrom('follow')
        .where('uri', 'in', followsToDelete)
        .execute()

      followsDeleted = followDeleteResults.length
    }

    // We don't want backdated posts in our feeds.
    let archivedPostCutoff = new Date()
    archivedPostCutoff.setHours(archivedPostCutoff.getHours() - 24*7)

    // This is where we'd filter by known follows, if we wanted to.

    let postUrisToCreateOrUpdate: Set<string> = new Set()

    let postsToCreate = ops.posts.creates
      .filter(create => new Date(create.record.createdAt) > archivedPostCutoff)
      .filter(create => {
        if (postUrisToCreateOrUpdate.has(create.uri)) {
          console.log('double create uri')
          return false
        } else {
          return true
        }
      })
      .map((create) => {
        let createdAt = new Date(create.record.createdAt)
        if (batchProcessDate < createdAt) {
          // Future-dated posts shouldn't go to the top of the feed.
          createdAt = batchProcessDate
        }

        let properties: PostProperties = {
          has_link:
            create.record.facets?.some(
              facet =>
                facet.features.some(feature =>
                  isLink(feature)))
            || create.record.embed && isExternalEmbed(create.record.embed.$type)
            || undefined
        }

        let newVar: Post = {
          uri: create.uri,
          cid: create.cid,
          author_did: create.author,
          reply_parent_uri: create.record.reply?.parent.uri,
          reply_parent_did: hostnameFromUri(create.record.reply?.parent.uri),
          reply_root_uri: create.record.reply?.root.uri,
          reply_root_did: hostnameFromUri(create.record.reply?.root.uri),
          indexed_at: createdAt,
          engagement_count: 0,
          properties: JSON.stringify(properties),
        }
        postUrisToCreateOrUpdate.add(create.uri)

        return newVar
      })

    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .ignore()
        .execute()
    }

    debugLog(`Inserted new posts in db at ${Math.round(performance.now() - t0)}`)

    let postsToUpdateReplyCounts = ops.posts.creates
      .map((x) => x.record.reply?.parent.uri)
      .filter((x) => x != null)
    let postsToLike = ops.likes.creates
      .map((x) => x.record.subject.uri)
    let postsToRepost = ops.reposts.creates
      .map((x) => x.record.subject.uri)

    // Calculate engagement count increments
    let postsToUpdateEngagement = postsToUpdateReplyCounts.concat(postsToLike).concat(postsToRepost)
    
    if (postsToUpdateEngagement.length > 0) {
      // Count how many times each post URI appears in engagement events
      let engagementCounts = new Map<string, number>()

      for (let postUri of postsToUpdateEngagement) {
        engagementCounts.set(postUri, (engagementCounts.get(postUri) || 0) + 1)
      }

      const engagementsByCount = engagementCounts.entries().reduce((acc, item) => {
        if (!acc.has(item[1])) {
          acc.set(item[1], []);
        }
        acc.get(item[1])!.push(item[0]);
        return acc;
      }, new Map<number, string[]>());

      for (let [count, uris] of engagementsByCount.entries()) {
        await this.db
          .updateTable('post')
          .set({
            engagement_count: sql`engagement_count + ${count}`,
          })
          .where('uri', 'in', uris)
          .execute()
      }
    }

    debugLog(`Updated engagement counts in db at ${Math.round(performance.now() - t0)}`)

    let postsToDelete = ops.posts.deletes
      .map((x) => x.uri)
    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }

    let repostsToCreate = ops.reposts.creates
      .filter(create => new Date(create.record.createdAt) > archivedPostCutoff)
      .map((create) => {
        let createdAt = new Date(create.record.createdAt)
        if (batchProcessDate < createdAt) {
          // Future-dated records shouldn't go to the top of the feed.
          createdAt = batchProcessDate
        }

        let newVar: Repost = {
          uri: create.uri,
          cid: create.cid,
          author_did: create.author,
          post_uri: create.record.subject.uri,
          indexed_at: createdAt,
        }
        return newVar
      })
    if (repostsToCreate.length > 0) {
      await this.db
        .insertInto('repost')
        .values(repostsToCreate)
        .ignore()
        .execute()
    }

    let repostsToDelete = ops.reposts.deletes
      .map((x) => x.uri)
    if (repostsToDelete.length > 0) {
      await this.db
        .deleteFrom('repost')
        .where('uri', 'in', repostsToDelete)
        .execute()
    }

    debugLog(`Updated reposts at ${Math.round(performance.now() - t0)}`)

    console.log(`${ops.posts.creates.length} posts created, ${postsToDelete.length} post deletes, ${ops.reposts.creates.length} reposts created, ${followsToCreate.length} follows added, ${followsDeleted} follows deleted, ${ops.follows.creates.length} total new follows`)

  }
}

function hostnameFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined

  try {
    return new AtUri(uri).host
  } catch (err) {}

  return undefined
}
