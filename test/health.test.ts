import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkReadiness } from '../src/health'

const ok = async () => {}
const fail = async () => {
  throw new Error('connection refused')
}

test('ready: DB reachable and no pending migrations -> 200', async () => {
  const res = await checkReadiness({ ping: ok, getPending: async () => [], role: 'web' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { status: 'ready', role: 'web' })
})

test('not ready: shutting down -> 503 short-circuits before any DB call', async () => {
  let pinged = false
  const res = await checkReadiness({
    ping: async () => {
      pinged = true
    },
    getPending: async () => [],
    role: 'web',
    shuttingDown: true,
  })
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, { status: 'not_ready', reason: 'shutting_down', role: 'web' })
  assert.equal(pinged, false, 'a draining instance should not bother probing the DB')
})

test('not ready: pending migrations -> 503 with the pending names', async () => {
  const res = await checkReadiness({
    ping: ok,
    getPending: async () => ['012_add_col', '013_index'],
    role: 'web',
  })
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, {
    status: 'not_ready',
    reason: 'pending_migrations',
    pending: ['012_add_col', '013_index'],
    role: 'web',
  })
})

test('not ready: DB unreachable -> 503 db_unavailable, ping failure short-circuits getPending', async () => {
  let getPendingCalled = false
  const res = await checkReadiness({
    ping: fail,
    getPending: async () => {
      getPendingCalled = true
      return []
    },
    role: 'worker',
  })
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, { status: 'not_ready', reason: 'db_unavailable', role: 'worker' })
  assert.equal(getPendingCalled, false, 'should not check migrations once the DB ping fails')
})

test('not ready: a throw from getPending is also treated as db_unavailable', async () => {
  const res = await checkReadiness({ ping: ok, getPending: fail, role: 'web' })
  assert.equal(res.statusCode, 503)
  assert.equal(res.body.status, 'not_ready')
  assert.equal((res.body as { reason: string }).reason, 'db_unavailable')
})

test('onError receives the underlying error when the DB is unreachable', async () => {
  let seen: unknown
  await checkReadiness({
    ping: fail,
    getPending: async () => [],
    role: 'web',
    onError: (err) => {
      seen = err
    },
  })
  assert.ok(seen instanceof Error)
  assert.equal((seen as Error).message, 'connection refused')
})
