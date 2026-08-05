import { Kysely, Migrator, MysqlDialect, sql } from 'kysely'
import { createPool } from 'mysql2'
import { DatabaseSchema } from './schema'
import { migrationProvider } from './migrations'
import { isDevelopment } from '../lib/env'

export const createDb = (): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new MysqlDialect({
      pool: createPool({
        database: process.env.MYSQL_DATABASE,
        host: process.env.DATABASE_URL,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_USER_PASSWORD,
        // Guard against the firehose consumer hanging forever on a dead
        // connection (a query that never returns and never errors, so the retry
        // loop can't catch it). TCP keepalive makes the OS detect a broken peer
        // and surface a socket error, which our retry then handles. Recycling
        // idle connections well before the server's wait_timeout avoids reusing
        // a connection the server has already closed.
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000, // start probing after 10s idle
        idleTimeout: 60_000, // close a pooled connection after 60s idle
        // Must stay below connectionLimit (default 10) — mysql2 only starts the
        // idle reaper when maxIdle < connectionLimit, so equal values silently
        // disable idleTimeout entirely.
        maxIdle: 5,
        typeCast(field, next) {
          if (field.type === 'TINY' && field.length === 1) {
            return field.string() === '1'
          } else {
            return next()
          }
        },
      }),
    }),
    log: (event) => {
      // For easier debugging of queries:
      // let map = event.query.parameters.map(p => p)
      // let queryString = replaceNumberedParams(event.query.sql, map)

      if (isDevelopment() && event.level === 'error') {
        console.log('Query:', event.query.sql)
        console.log('Parameters:', event.query.parameters)
      }
    }
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

// Cheap connectivity probe for the readiness check. Throws if the pool can't
// reach the DB.
export const pingDb = async (db: Database): Promise<void> => {
  await sql`select 1`.execute(db)
}

// Names of migrations defined in code but not yet applied. Empty = schema is at
// the version this code expects. Used by the readiness check so a rolling web
// instance won't take traffic before the deploy's migrate step has run.
export const getPendingMigrations = async (db: Database): Promise<string[]> => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const migrations = await migrator.getMigrations()
  return migrations.filter((m) => !m.executedAt).map((m) => m.name)
}

export type Database = Kysely<DatabaseSchema>
