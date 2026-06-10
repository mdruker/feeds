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
