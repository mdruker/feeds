import express from 'express'
import { AppContext } from '../../config'
import { handler } from '../../algos/catchup'
import { QueryParams as GetPostsParams } from '../../lexicon/types/app/bsky/feed/getPosts'
import { QueryParams as ResolveHandleParams } from '../../lexicon/types/com/atproto/identity/resolveHandle'
import { AppBskyFeedPost, AtpAgent } from '@atproto/api'
import { Post } from '../../db/schema'
import { hasAdminPermission } from '../utils'
import algos from '../../algos'

const makeRouter = (ctx: AppContext) => {
  const router = express.Router()

  router.get('/showAll', async (_req, res, next) => {
    console.log(`handling /showAll`)

    if (!(await hasAdminPermission(_req, res, ctx))) {
      return res
        .status(403)
        .type('html')
        .send('<h1>Error: admin permission required</h1>')
    }

    try {
      let posts = await ctx.db
        .selectFrom('post')
        .selectAll()
        .where('reply_parent_uri', 'is', null)
        .orderBy('indexed_at', 'desc')
        .orderBy('cid', 'desc')
        .limit(100)
        .execute()

      if (posts.length == 0) {
        return res.sendStatus(204).end()
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(await hydrateFeedHtml(posts));

    } catch (err) {
      next(err)
    }
  })

  router.get('/jobs/fetch-follow-profiles/:did', async (_req, res, next) => {
    console.log(`Adding fetch-follow-profiles job for ${_req.params.did}`)

    if (!(await hasAdminPermission(_req, res, ctx))) {
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

    if (!(await hasAdminPermission(_req, res, ctx))) {
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

      if (posts.length == 0) {
        return res.sendStatus(204).end()
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(await hydrateFeedHtml(posts));

    } catch (err) {
      next(err)
    }
  })

  router.get('/showFeed/:shortname/:handle', async (_req, res, next) => {
    console.log(`handling ${_req.path}`)

    if (!(await hasAdminPermission(_req, res, ctx))) {
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

      const algo = algos[_req.params.shortname]
      if (!algo) {
        return next(new Error())
      }

      let feedResponse = await algo(ctx, {feed: _req.params.shortname, limit: 30}, resolveHandleResponse.data.did)
      let postUris = feedResponse.feed.map((x) => x.post)
      let t1 = performance.now()
      console.log(`Testing: generated the feed for ${_req.params.handle} in ${Math.round(t1-t0)} ms`)

      if (postUris.length == 0) {
        return res.status(204).end();
      }

      let posts = await ctx.db
        .selectFrom('post')
        .selectAll()
        .where('uri', 'in', postUris)
        .orderBy('indexed_at', 'desc')
        .orderBy('cid', 'desc')
        .execute()

      res.setHeader('Content-Type', 'text/html');
      res.send(await hydrateFeedHtml(posts));

    } catch (err) {
      console.log(`Error in showFeed`, err)
      next(err)
    }
  })

  return router
}

  const hydrateFeedHtml = async (posts: Post[]): Promise<string> => {
    const agent = new AtpAgent({
      service: 'https://api.bsky.app'
    })
    let params: GetPostsParams = {
      uris: posts.slice(0, 25)
        .map(x => x.uri)
    }

    let followsResponse = await agent.getPosts(params)

    // Transform the posts into a readable format
    const renderedPosts = followsResponse.data.posts.map(x => {
      let storedPost = posts.find((y) => y.uri === x.uri)!!

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
        storedLikeCount: storedPost.num_likes,
        storedReplyCount: storedPost.num_replies,
        storedRepostCount: storedPost.num_reposts
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
                  ❤️ ${post.storedLikeCount || 0} &nbsp;
                  🔄 ${post.storedRepostCount || 0} &nbsp;
                  💬 ${post.storedReplyCount || 0} &nbsp;
                  (Feed storage)
                </div>
              </div>
            `).join('')}
          </body>
        </html>
      `;
  }

export default makeRouter