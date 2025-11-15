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
      .addColumn('service', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('cursor', 'bigint', (col) => col.notNull())
      .addColumn('restart', 'boolean')
      .execute()

    await db.schema
      .createTable('actor')
      .addColumn('did', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('created_at', 'datetime', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('follow')
      .addColumn('uri', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('source_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('target_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('created_at', 'datetime', (col) => col.notNull())
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
      .addColumn('uri', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('cid', 'varchar(255)', (col) => col.notNull())
      .addColumn('author_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('reply_parent_uri', 'varchar(255)')
      .addColumn('reply_parent_did', 'varchar(255)')
      .addColumn('reply_root_uri', 'varchar(255)')
      .addColumn('reply_root_did', 'varchar(255)')
      .addColumn('indexed_at', 'datetime(6)', (col) => col.notNull())
      .addColumn('engagement_count', 'integer')
      .addColumn('properties', 'varchar(1023)')
      .execute()
    await db.schema
      .createIndex('idx_post_indexed_at')
      .on('post')
      .column('indexed_at')
      .execute()
    await db.schema
      .createIndex('idx_post_author_engagement')
      .on('post')
      .columns(['author_did', 'engagement_count desc'])
      .execute()

    await db.schema
      .createTable('auth_session')
      .addColumn('key', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('session', 'text', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('auth_state')
      .addColumn('key', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('state', 'text', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('admin')
      .addColumn('did', 'varchar(255)', (col) => col.primaryKey())
      .execute()

    await db.schema
      .createTable('feed_settings')
      .addColumn('actor_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('shortname', 'varchar(255)', (col) => col.notNull())
      .addColumn('updated_at', 'datetime', (col) => col.notNull())
      .addColumn('settings', 'text')
      .execute()
    await db.schema
      .createIndex('idx_feed_settings_actor_shortname')
      .unique()
      .on('feed_settings')
      .columns(['actor_did', 'shortname'])
      .execute()

    await db.schema
      .createTable('profile')
      .addColumn('did', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('handle', 'varchar(255)')
      .addColumn('updated_at', 'datetime', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('idx_profile_handle')
      .on('profile')
      .column('handle')
      .execute()

    await db.schema
      .createTable('job')
      .addColumn('id', 'bigint', (col) => col.autoIncrement().primaryKey())
      .addColumn('type', 'varchar(255)', (col) => col.notNull())
      .addColumn('payload', 'varchar(1023)', (col) => col.notNull())
      .addColumn('status', 'varchar(255)', (col) => col.notNull())
      .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('owner_pid', 'varchar(255)')
      .addColumn('run_after', 'datetime')
      .addColumn('created_at', 'datetime', (col) => col.notNull())
      .addColumn('updated_at', 'datetime', (col) => col.notNull())
      .addColumn('error', 'varchar(1023)')
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
      .createIndex('idx_job_status_type_run_after_priority_desc_created_at')
      .on('job')
      .column('status')
      .column('type')
      .column('run_after')
      .column('priority desc')
      .column('created_at')
      .execute()

    await db.schema
      .createTable('repost')
      .addColumn('uri', 'varchar(255)', (col) => col.primaryKey())
      .addColumn('cid', 'varchar(255)', (col) => col.notNull())
      .addColumn('author_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('post_uri', 'varchar(255)', (col) => col.notNull())
      .addColumn('indexed_at', 'datetime(6)', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('idx_repost_indexed_at')
      .on('repost')
      .column('indexed_at')
      .execute()
    await db.schema
      .createIndex('idx_repost_indexed_at_desc')
      .on('repost')
      .column('indexed_at desc')
      .execute()
    await db.schema
      .createIndex('idx_repost_post_uri_indexed_at')
      .on('repost')
      .columns(['post_uri', 'indexed_at'])
      .execute()
    await db.schema
      .createIndex('idx_repost_author_indexed_at_desc')
      .on('repost')
      .columns(['author_did', 'indexed_at desc'])
      .execute()
  },
}

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('news_post')
      .addColumn('actor_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('shortname', 'varchar(255)', (col) => col.notNull())
      .addColumn('post_uri', 'varchar(255)', (col) => col.notNull())
      .addColumn('created_at', 'datetime', (col) => col.notNull())
      .addColumn('cursor_when_shown', 'varchar(255)')
      .execute()
    await db.schema
      .createIndex('unq_news_post_actor_did_shortname')
      .on('news_post')
      .columns(['actor_did', 'shortname'])
      .unique()
      .execute()
  },
}

migrations['003'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('feed_state')
      .addColumn('actor_did', 'varchar(255)', (col) => col.notNull())
      .addColumn('shortname', 'varchar(255)', (col) => col.notNull())
      .addColumn('latest_seen_cursor', 'varchar(255)')
      .execute()

    await db.schema
      .createIndex('unq_feed_state_actor_did_shortname')
      .on('feed_state')
      .columns(['actor_did', 'shortname'])
      .unique()
      .execute()
  },
}
