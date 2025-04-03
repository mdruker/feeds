import { FirehoseSubscriptionBase, OperationsByType } from './util/subscription'
import { isLink } from './lexicon/types/app/bsky/richtext/facet'
import { isMain as isExternalEmbed } from './lexicon/types/app/bsky/embed/external'
import { Post, Repost } from './db/schema'
import { PostProperties } from './util/properties'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleOps(ops: OperationsByType) {
    let batchProcessDate = new Date().toISOString()

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

      const profileUpdates = ops.identityEvents
        .filter(x => knownProfileDids.includes(x.did))
        .map(update => ({
          did: update.did,
          handle: update.handle,
          updated_at: batchProcessDate
        }))

      if (profileUpdates.length > 0) {
        await this.db
          .insertInto('profile')
          .values(profileUpdates)
          .onConflict((oc) => oc
            .column('did')
            .doUpdateSet({
              handle: (eb) => eb.ref('excluded.handle'),
              updated_at: (eb) => eb.ref('excluded.updated_at')
            }))
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
          is_mutual: 0,
          actor_score: 0
        }
      })
    if (followsToCreate.length > 0) {
      await this.db
        .insertInto('follow')
        .values(followsToCreate)
        .onConflict((oc) => oc.doNothing())
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
    let postsToUpdateOrCreate = ops.posts.creates
      .filter(create => new Date(create.record.createdAt) > archivedPostCutoff)
      .map((create) => {
        let createdAt = new Date(create.record.createdAt).toISOString()
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
          reply_root_uri: create.record.reply?.root.uri,
          indexed_at: createdAt,
          num_likes: 0,
          num_replies: 0,
          num_reposts: 0,
          properties: JSON.stringify(properties),
        }
        return newVar
      })

    let postsToUpdateReplyCounts = ops.posts.creates
      .map((x) => x.record.reply?.parent.uri)
      .filter((x) => x != null)
    let postsToLike = ops.likes.creates
      .map((x) => x.record.subject.uri)
    let postsToRepost = ops.reposts.creates
      .map((x) => x.record.subject.uri)

    let postsToUpdateEngagement = postsToUpdateReplyCounts.concat(postsToLike).concat(postsToRepost)

    if (postsToUpdateEngagement.length > 0) {
      let posts = await this.db
        .selectFrom('post')
        .selectAll()
        .where('uri', 'in', postsToUpdateEngagement)
        .execute()

      postsToUpdateOrCreate = postsToUpdateOrCreate.concat(posts)
    }

    for (let postUri of postsToLike) {
      let i = postsToUpdateOrCreate.findIndex(x => x.uri === postUri)
      if (i >= 0) {
        postsToUpdateOrCreate[i].num_likes = postsToUpdateOrCreate[i].num_likes + 1
      }
    }

    for (let postUri of postsToUpdateReplyCounts) {
      let i = postsToUpdateOrCreate.findIndex(x => x.uri === postUri)
      if (i >= 0) {
        postsToUpdateOrCreate[i].num_replies = postsToUpdateOrCreate[i].num_replies + 1
      }
    }

    for (let postUri of postsToRepost) {
      let i = postsToUpdateOrCreate.findIndex(x => x.uri === postUri)
      if (i >= 0) {
        postsToUpdateOrCreate[i].num_reposts = postsToUpdateOrCreate[i].num_reposts + 1
      }
    }

    if (postsToUpdateOrCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToUpdateOrCreate)
        .onConflict((oc) => oc
          .column('uri')
          .doUpdateSet((eb) => ({
            num_likes: eb.ref('excluded.num_likes'),
            num_reposts: eb.ref('excluded.num_reposts'),
            num_replies: eb.ref('excluded.num_replies'),
          })))
        .execute()
    }

    let postsToDelete = ops.posts.deletes
      .map((x) => x.uri)
    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }

    ops.reposts.creates
      .map((x) => {
        if (ops.reposts.creates.length % 500 === 0) {
          console.log('here')
        }
      })

    let repostsToCreate = ops.reposts.creates
      .filter(create => new Date(create.record.createdAt) > archivedPostCutoff)
      .map((create) => {
        let createdAt = new Date(create.record.createdAt).toISOString()
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
        .onConflict((oc) => oc.doNothing())
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

    console.log(`${ops.posts.creates.length} posts created, ${postsToDelete.length} post deletes, ${ops.reposts.creates.length} reposts created, ${followsToCreate.length} follows added, ${followsDeleted} follows deleted, ${ops.follows.creates.length} total new follows`)

    // Not part of the firehose, but we want to delete stuff that's too old.
    let cutOffDate = new Date()
    cutOffDate.setHours(cutOffDate.getHours() - 24)

    await this.db
      .deleteFrom('post')
      .where('indexed_at', '<', cutOffDate.toISOString())
      .limit(10000)
      .execute()

    await this.db
      .deleteFrom('repost')
      .where('indexed_at', '<', cutOffDate.toISOString())
      .limit(10000)
      .execute()
  }
}
