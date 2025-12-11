import express from 'express'
import { AppContext } from '../../config'
import { QueryParams as GetPostsParams } from '../../lexicon/types/app/bsky/feed/getPosts'
import { QueryParams as ResolveHandleParams } from '../../lexicon/types/com/atproto/identity/resolveHandle'
import { AppBskyFeedPost, AtpAgent } from '@atproto/api'
import { sessionHasAdminPermission } from '../utils'
import { Database } from '../../db/database'
import { getFeedSkeleton } from '../../methods/get-feed-skeleton'

const makeRouter = (ctx: AppContext) => {
  const router = express.Router()

  router.get('/showAll', async (_req, res, next) => {
    console.log(`handling /showAll`)

    if (!(await sessionHasAdminPermission(_req, res, ctx))) {
      return res
        .status(403)
        .type('html')
        .send('<h1>Error: admin permission required</h1>')
    }

    try {
      let posts = await ctx.db
        .selectFrom('post')
        .select('uri')
        .where('reply_parent_uri', 'is', null)
        .orderBy('indexed_at', 'desc')
        .orderBy('cid', 'desc')
        .limit(100)
        .execute()
      let postUris = posts.map(x => x.uri)

      res.setHeader('Content-Type', 'text/html');
      res.send(await hydrateFeedHtml(ctx.db, postUris));

    } catch (err) {
      next(err)
    }
  })

  router.get('/jobs/fetch-follow-profiles/:did', async (_req, res, next) => {
    console.log(`Adding fetch-follow-profiles job for ${_req.params.did}`)

    if (!(await sessionHasAdminPermission(_req, res, ctx))) {
      return res
        .status(403)
        .type('html')
        .send('<h1>Error: admin permission required</h1>')
    }

    await ctx.jobManager.createJob('fetch-follow-profiles', { 'did': _req.params.did })

    res.setHeader('Content-Type', 'text/html');
    res.send('Success: job created');
  })

  router.get('/showTimeline/:handle', async (_req, res, next) => {
    console.log(`handling /showTimeline for ${_req.params.handle}`)

    if (!(await sessionHasAdminPermission(_req, res, ctx))) {
      return res
        .status(403)
        .type('html')
        .send('<h1>Error: admin permission required</h1>')
    }

    try {
      const agent = new AtpAgent({
        service: 'https://api.bsky.app'
      })
      let params: ResolveHandleParams = {
        handle: _req.params.handle
      }
      let resolveHandleResponse = await agent.resolveHandle(params)

      let posts = await ctx.db
        .selectFrom('post')
        .selectAll()
        .where('author_did', '=', resolveHandleResponse.data.did)
        .where('reply_parent_uri', 'is', null)
        .orderBy('indexed_at', 'desc')
        .orderBy('cid', 'desc')
        .limit(25)
        .execute()

      let postUris = posts.map(x => x.uri)

      res.setHeader('Content-Type', 'text/html');
      res.send(await hydrateFeedHtml(ctx.db, postUris));

    } catch (err) {
      next(err)
    }
  })

  router.get('/showFeed/:shortname/:handle', async (_req, res, next) => {
    console.log(`handling ${_req.path}`)

    if (!(await sessionHasAdminPermission(_req, res, ctx))) {
      return res
        .status(403)
        .type('html')
        .send('<h1>Error: admin permission required</h1>')
    }

    try {
      const agent = new AtpAgent({
        service: 'https://api.bsky.app'
      })
      let params: ResolveHandleParams = {
        handle: _req.params.handle
      }
      let resolveHandleResponse = await agent.resolveHandle(params)

      if (!resolveHandleResponse?.data?.did) {
        return next(new Error())
      }

      let t0 = performance.now()

      let feedResponse = await getFeedSkeleton(ctx, resolveHandleResponse.data.did, _req.params.shortname, {feed: _req.params.shortname, limit: 30})
      let postUris = feedResponse.feed.map((x) => x.post)
      let t1 = performance.now()
      console.log(`Testing: generated the feed for ${_req.params.handle} in ${Math.round(t1-t0)} ms`)

      if (postUris.length == 0) {
        return res.status(204).end();
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(await hydrateFeedHtml(ctx.db, postUris));

    } catch (err) {
      console.log(`Error in showFeed`, err)
      next(err)
    }
  })

  return router
}

  const hydrateFeedHtml = async (db: Database, postUris: string[]): Promise<string> => {
    const agent = new AtpAgent({
      service: 'https://api.bsky.app'
    })
    let params: GetPostsParams = {
      uris: postUris.slice(0, 25)
    }

    let followsResponse = postUris.length > 0 ? (await agent.getPosts(params)).data.posts : []

    let storedPosts =
      postUris.length > 0
        ? await db
          .selectFrom('post')
          .selectAll()
          .where('uri', 'in', postUris)
          .execute()
        : []

    // Transform the posts into a readable format
    const renderedPosts = followsResponse.map(x => {
      let storedPost = storedPosts.find((y) => y.uri === x.uri)!!

      return {
        uri: x.uri,
        author: {
          handle: x.author.handle,
          displayName: x.author.displayName
        },
        text: (x.record as AppBskyFeedPost.Record).text,
        createdAt: (x.record as AppBskyFeedPost.Record).createdAt,
        likeCount: x.likeCount,
        replyCount: x.replyCount,
        repostCount: x.repostCount,
        engagement_count: storedPost?.engagement_count,
      }
    })

    return `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Bluesky Feed</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: #f5f5f5;
              }
              .post {
                background: white;
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 20px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              }
              .author {
                font-weight: bold;
                margin-bottom: 10px;
              }
              .handle {
                color: #666;
                font-weight: normal;
              }
              .post-text {
                margin: 10px 0;
                white-space: pre-wrap;
              }
              .post-stats {
                color: #666;
                font-size: 0.9em;
                margin-top: 10px;
              }
              .post-time {
                color: #666;
                font-size: 0.9em;
              }
            </style>
          </head>
          <body>
            <h1>Bluesky Feed</h1>
            ${renderedPosts.map(post => `
              <div class="post">
                <div class="author">
                  ${post.author.displayName || post.author.handle}
                  <span class="handle">@${post.author.handle}</span>
                </div>
                <div class="post-text">${post.text}</div>
                <div class="post-time">${new Date(post.createdAt).toLocaleString()}</div>
                <div class="post-stats">
                  ❤️ ${post.likeCount || 0} &nbsp;
                  🔄 ${post.repostCount || 0} &nbsp;
                  💬 ${post.replyCount || 0} &nbsp;
                  (Bluesky)
                </div class="post-stats">
                  ✨ ${post.engagement_count || 0} &nbsp;
                  (Feed storage)
                </div>
              </div>
            `).join('')}
          </body>
        </html>
      `;
  }

export default makeRouter