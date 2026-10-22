import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AddressInfo } from 'node:net'
import { CompiledQuery, DatabaseConnection, DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely'
import { DidResolver } from '@atproto/identity'
import { Secp256k1Keypair } from '@atproto/crypto'
import FeedGenerator from '../src/server'
import { Database } from '../src/db/database'
import * as followingChron from '../src/algos/following-chron'

const serviceDid = 'did:web:feeds.test'
const userDid = 'did:plc:testuser'

// A DB that answers every query with no rows and records what was sent.
function recordingDb(): { db: Database, queries: CompiledQuery[] } {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    executeQuery: async (query) => {
      queries.push(query)
      return { rows: [] }
    },
    streamQuery: async function* () {},
  }
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => Object.assign(new DummyDriver(), { acquireConnection: async () => connection }),
      createIntrospector: (db) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  })
  return { db, queries }
}

// A service-auth JWT as the user's PDS would mint it for this feed generator.
async function serviceJwt(keypair: Secp256k1Keypair, lxm: string): Promise<string> {
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const header = encode({ alg: keypair.jwtAlg, typ: 'JWT' })
  const payload = encode({ iss: userDid, aud: serviceDid, lxm, exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = await keypair.sign(Buffer.from(`${header}.${payload}`))
  return `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`
}

test('a seen interaction advances the user\'s feed cursor', async () => {
  const keypair = await Secp256k1Keypair.create()
  const didResolver = { resolveAtprotoKey: async () => keypair.did() } as unknown as DidResolver
  const { db, queries } = recordingDb()

  const gen = FeedGenerator.create({
    port: 0,
    listenhost: '127.0.0.1',
    hostname: '127.0.0.1',
    serviceDid,
    publisherDid: 'did:plc:publisher',
  }, { db, didResolver })
  const server = gen.app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const { port } = server.address() as AddressInfo
    const nsid = 'app.bsky.feed.sendInteractions'
    const res = await fetch(`http://127.0.0.1:${port}/xrpc/${nsid}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await serviceJwt(keypair, nsid)}`,
      },
      body: JSON.stringify({
        interactions: [{
          item: 'at://did:plc:author/app.bsky.feed.post/3abc',
          event: 'app.bsky.feed.defs#interactionSeen',
          feedContext: `${followingChron.shortname}::seen-cursor-123::post`,
        }],
      }),
    })
    assert.equal(res.status, 200, await res.text())

    const cursorWrite = queries.find((q) => q.sql.startsWith('insert into `feed_state`'))
    assert.ok(cursorWrite, 'expected a feed_state write')
    assert.deepEqual(cursorWrite.parameters.slice(0, 3), [userDid, followingChron.shortname, 'seen-cursor-123'])
  } finally {
    server.closeAllConnections()
    server.close()
  }
})
