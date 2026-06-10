import dotenv from 'dotenv'
import { Env } from './lib/env'
import { createDb, migrateToLatest } from './db/database'

// Standalone migration entrypoint for the production deploy step. web/worker
// instances do NOT migrate on boot (see docs/zero-downtime-deploys.md) — the
// deploy runs `yarn migrate` once, reviewed against the migration safeguards.
// In dev you usually don't need this: `yarn start` (ROLE=all) migrates on boot.

if (!process.env.ENVIRONMENT) {
  process.env.ENVIRONMENT = Env.development
}
dotenv.config({ path: '.env.' + process.env.ENVIRONMENT })

const run = async () => {
  const db = createDb()
  try {
    await migrateToLatest(db)
    console.log('Migrations complete.')
  } finally {
    await db.destroy()
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
