import { Kysely, Migration, MigrationProvider, sql } from 'kysely'

const migrations: Record<string, Migration> = {}

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('sub_state')
      .addColumn('service', 'varchar', (col) => col.primaryKey())
      .addColumn('cursor', 'bigint', (col) => col.notNull())
      .addColumn('restart', 'boolean')
      .execute()

    await db.schema
      .createTable('actor')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .addColumn('created_at', 'timestamp', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('follow')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('source_did', 'varchar', (col) => col.notNull())
      .addColumn('target_did', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) => col.notNull())
      .addColumn('actor_score', 'integer', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('idx_follow_source_target')
      .on('follow')
      .columns(['source_did', 'target_did'])
      .execute()
    await db.schema
      .createIndex('idx_follow_target')
      .on('follow')
      .column('target_did')
      .execute()

    await db.schema
      .createTable('post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('author_did', 'varchar', (col) => col.notNull())
      .addColumn('reply_parent_uri', 'varchar')
      .addColumn('reply_root_uri', 'varchar')
      .addColumn('indexed_at', 'timestamp', (col) => col.notNull())
      .addColumn('num_likes', 'integer', (col) => col.notNull())
      .addColumn('num_replies', 'integer', (col) => col.notNull())
      .addColumn('num_reposts', 'integer', (col) => col.notNull())
      .addColumn('properties', 'varchar')
      .execute()
    await db.schema
      .createIndex('idx_post_indexed_at')
      .on('post')
      .column('indexed_at')
      .execute()
    await db.schema
      .createIndex('idx_post_author_indexed_at')
      .on('post')
      .columns(['author_did', 'indexed_at'])
      .execute()

    await db.schema
      .createTable('auth_session')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('session', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('auth_state')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('state', 'varchar', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('admin')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .execute()

    await db.schema
      .createTable('feed_settings')
      .addColumn('actor_did', 'varchar', (col) => col.notNull())
      .addColumn('shortname', 'varchar', (col) => col.notNull())
      .addColumn('updated_at', 'timestamp', (col) => col.notNull())
      .addColumn('settings', 'varchar')
      .execute()
    await db.schema
      .createIndex('idx_feed_settings_actor_shortname')
      .unique()
      .on('feed_settings')
      .columns(['actor_did', 'shortname'])
      .execute()

    await db.schema
      .createTable('profile')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .addColumn('handle', 'varchar')
      .addColumn('updated_at', 'timestamp', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('idx_profile_handle')
      .on('profile')
      .column('handle')
      .execute()

    await db.schema
      .createTable('job')
      .addColumn('id', 'bigserial', (col) => col.primaryKey())
      .addColumn('type', 'varchar', (col) => col.notNull())
      .addColumn('payload', 'varchar', (col) => col.notNull())
      .addColumn('status', 'varchar', (col) => col.notNull())
      .addColumn('owner_pid', 'varchar')
      .addColumn('run_after', 'timestamp')
      .addColumn('created_at', 'timestamp', (col) => col.notNull())
      .addColumn('updated_at', 'timestamp', (col) => col.notNull())
      .addColumn('error', 'varchar')
      .addColumn('failure_count', 'integer', (col) => col.notNull().defaultTo(0))
      .execute()
    await db.schema
      .createIndex('idx_job_status_created_at')
      .on('job')
      .column('status')
      .column('type')
      .column('created_at')
      .execute()
    await db.schema
      .createIndex('idx_job_status_updated_at')
      .on('job')
      .column('status')
      .column('updated_at')
      .execute()
    await db.schema
      .createIndex('idx_job_status_type_run_after_created_at')
      .on('job')
      .column('status')
      .column('type')
      .column('run_after')
      .column('created_at')
      .execute()

    await db.schema
      .createTable('repost')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('author_did', 'varchar', (col) => col.notNull())
      .addColumn('post_uri', 'varchar', (col) => col.notNull())
      .addColumn('indexed_at', 'timestamp', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('idx_repost_indexed_at')
      .on('repost')
      .column('indexed_at')
      .execute()
    await db.schema
      .createIndex('idx_repost_post_uri_indexed_at')
      .on('repost')
      .columns(['post_uri', 'indexed_at'])
      .execute()
    await db.schema
      .createIndex('idx_repost_author_indexed_at')
      .on('repost')
      .columns(['author_did', 'indexed_at'])
      .execute()
  },
}

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('post')
      .addColumn('reply_parent_did', 'varchar')
      .addColumn('reply_root_did', 'varchar')
      .execute()
  },
}

migrations['003'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('post')
      .alterColumn('num_likes', ac => ac.dropNotNull())
      .execute()
    await db.schema
      .alterTable('post')
      .alterColumn('num_replies', ac => ac.dropNotNull())
      .execute()
    await db.schema
      .alterTable('post')
      .alterColumn('num_reposts', ac => ac.dropNotNull())
      .execute()

    await db.schema
      .alterTable('post')
      .addColumn('engagement_count', 'integer')
      .execute()

    await db.schema
      .createIndex('idx_post_author_engagement')
      .on('post')
      .columns(['author_did', 'engagement_count desc'])
      .execute()
  },
}

migrations['004'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createIndex('idx_post_indexed_at_desc')
      .on('post')
      .column('indexed_at desc')
      .execute()
  },
}

migrations['005'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createIndex('idx_repost_indexed_at_desc')
      .on('repost')
      .column('indexed_at desc')
      .execute()
  },
}

migrations['006'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('post')
      .dropColumn('num_likes')
      .dropColumn('num_replies')
      .dropColumn('num_reposts')
      .execute()
  },
}

migrations['007'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('temp_engagement')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('increment', 'integer', (col) => col.notNull())
      .execute()
  }
}