import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UsageRecorder } from '../src/util/usage'
import { Database } from '../src/db/database'

const alice = 'did:plc:alice'

function recorder(now = new Date('2026-11-17T12:00:00Z')) {
  // take() never touches the DB.
  return new UsageRecorder({} as Database, new Set(['catchup', 'most-100']), () => now)
}

test('short first-page loads are not counted at all', () => {
  const usage = recorder()
  usage.recordFeedRequest('catchup', alice, { limit: 1, itemsServed: 1 })
  usage.recordFeedRequest('catchup', alice, { limit: 10, itemsServed: 10 })
  assert.deepEqual(usage.take(), [])
})

test('first pages over the cutoff and every next page are counted', () => {
  const usage = recorder()
  usage.recordFeedRequest('catchup', alice, { limit: 11, itemsServed: 11 })
  usage.recordFeedRequest('catchup', alice, { limit: 30, itemsServed: 30 })
  usage.recordFeedRequest('catchup', alice, { cursor: 'abc', limit: 5, itemsServed: 5 })

  const [row] = usage.take()
  assert.equal(row.day, '2026-11-17')
  assert.equal(row.first_pages, 2)
  assert.equal(row.next_pages, 1)
  assert.equal(row.items_served, 46)
})

test('anonymous requests share one row per feed', () => {
  const usage = recorder()
  usage.recordFeedRequest('most-100', null, { limit: 30, itemsServed: 30 })
  usage.recordFeedRequest('most-100', null, { limit: 30, itemsServed: 30 })

  const rows = usage.take()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].actor_did, '')
  assert.equal(rows[0].first_pages, 2)
})

test('interactions are grouped into seen, opens, engaged, and shaped', () => {
  const usage = recorder()
  const on = (event: string) => ({ event: `app.bsky.feed.defs#${event}`, feedContext: 'catchup::123:abc' })
  usage.recordInteractions(alice, [
    on('interactionSeen'), on('interactionSeen'),
    on('clickthroughItem'), on('clickthroughAuthor'), on('interactionShare'),
    on('interactionLike'), on('interactionQuote'),
    on('requestLess'),
  ])

  const [row] = usage.take()
  assert.deepEqual(
    { seen: row.seen, opens: row.opens, engaged: row.engaged, shaped: row.shaped },
    { seen: 2, opens: 3, engaged: 2, shaped: 1 },
  )
})

test('interactions without a known feed or event are ignored', () => {
  const usage = recorder()
  usage.recordInteractions(alice, [
    { event: 'app.bsky.feed.defs#interactionSeen' },
    { event: 'app.bsky.feed.defs#interactionSeen', feedContext: 'someone-elses-feed::1' },
    { event: 'app.bsky.feed.defs#somethingNew', feedContext: 'catchup::1' },
  ])
  assert.deepEqual(usage.take(), [])
})

test('take() hands back each count once', () => {
  const usage = recorder()
  usage.recordFeedRequest('catchup', alice, { limit: 30, itemsServed: 30 })
  assert.equal(usage.take().length, 1)
  assert.deepEqual(usage.take(), [])
})
