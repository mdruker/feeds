import { Kysely, Migrator, PostgresDialect, SqliteDialect } from 'kysely'
import { Pool } from 'pg'
import { DatabaseSchema } from './schema'
import { migrationProvider } from './migrations'

export const createDb = (): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        user: 'postgres',
        database: 'postgres',
        password: process.env.DATABASE_PASSWORD,
        host: process.env.DATABASE_URL,
        port: process.env.DATABASE_PORT,
        ssl: process.env.DATABASE_SSL_CERT ? {
          rejectUnauthorized: false,
          cert: process.env.DATABASE_SSL_CERT,
        } : null,
      })
    })
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export type Database = Kysely<DatabaseSchema>
