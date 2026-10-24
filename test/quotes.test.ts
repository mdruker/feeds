import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotedPostUri } from '../src/subscription'

const postUri = 'at://did:plc:author/app.bsky.feed.post/3abc'
const strongRef = (uri: string) => ({ uri, cid: 'bafyquoted' })

test('a plain quote yields the quoted post', () => {
  assert.equal(quotedPostUri({ $type: 'app.bsky.embed.record', record: strongRef(postUri) }), postUri)
})

test('a quote with media yields the quoted post', () => {
  assert.equal(quotedPostUri({
    $type: 'app.bsky.embed.recordWithMedia',
    record: { record: strongRef(postUri) },
    media: { $type: 'app.bsky.embed.images', images: [] },
  }), postUri)
})

test('embedding a non-post record is not a quote', () => {
  const feedUri = 'at://did:plc:author/app.bsky.feed.generator/cool-feed'
  assert.equal(quotedPostUri({ $type: 'app.bsky.embed.record', record: strongRef(feedUri) }), undefined)
})

test('posts without a record embed are not quotes', () => {
  assert.equal(quotedPostUri(undefined), undefined)
  assert.equal(quotedPostUri({ $type: 'app.bsky.embed.external', external: { uri: 'https://example.com', title: '', description: '' } }), undefined)
})
