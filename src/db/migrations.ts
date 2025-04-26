import { Kysely, Migration, MigrationProvider } from 'kysely'

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
      .addColumn('cursor', 'integer', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('actor')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .addColumn('handle', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('follow')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('source_did', 'varchar', (col) => col.notNull())
      .addColumn('target_did', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .addColumn('is_mutual', 'numeric', (col) => col.notNull())
      .addColumn('actor_score', 'numeric', (col) => col.notNull())
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
      .addColumn('indexed_at', 'varchar', (col) => col.notNull())
      .addColumn('num_likes', 'numeric', (col) => col.notNull())
      .addColumn('num_replies', 'numeric', (col) => col.notNull())
      .addColumn('num_reposts', 'numeric', (col) => col.notNull())
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
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('sub_state').execute()
    await db.schema.dropTable('actor').execute()
    await db.schema.dropTable('follow').execute()
    await db.schema.dropTable('post').execute()
  },
}

migrations['002'] = {
  async up(db: Kysely<unknown>) {
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
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('auth_session').execute()
    await db.schema.dropTable('auth_state').execute()
  },
}

migrations['003'] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable('sub_state')
      .addColumn('restart', 'numeric')
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('auth_session').dropColumn('restart').execute()
  },
}

migrations['004'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('admin')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('admin').execute()
  },
}

migrations['005'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('feed_settings')
      .addColumn('actor_did', 'varchar', (col) => col.notNull())
      .addColumn('shortname', 'varchar', (col) => col.notNull())
      .addColumn('updated_at', 'varchar', (col) => col.notNull())
      .addColumn('settings', 'varchar')
      .execute()

    await db.schema
      .createIndex('idx_feed_settings_actor_shortname')
      .unique()
      .on('feed_settings')
      .columns(['actor_did', 'shortname'])
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('feed_settings').execute()
  },
}

migrations['006'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('post')
      .addColumn('properties', 'varchar')
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('post')
      .dropColumn('properties')
      .execute()
  },
}

migrations['007'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('profile')
      .addColumn('did', 'varchar', (col) => col.primaryKey())
      .addColumn('handle', 'varchar')
      .addColumn('updated_at', 'varchar', (col) => col.notNull())
      .execute()

    await db.schema
      .createIndex('idx_profile_handle')
      .on('profile')
      .column('handle')
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('profile').execute()
  },
}

migrations['008'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('job')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('type', 'varchar', (col) => col.notNull())
      .addColumn('payload', 'varchar', (col) => col.notNull())
      .addColumn('status', 'varchar', (col) => col.notNull())
      .addColumn('owner_pid', 'varchar')
      .addColumn('created_at', 'varchar', (col) => col.notNull())
      .addColumn('updated_at', 'varchar', (col) => col.notNull())
      .addColumn('error', 'varchar')
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
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('job').execute()
  },
}

migrations['009'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('job')
      .addColumn('failure_count', 'integer', (col) => col.notNull().defaultTo(0))
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('job')
      .dropColumn('failure_count')
      .execute()
  },
}

migrations['010'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('job')
      .addColumn('run_after', 'varchar')
      .execute()

    await db.schema
      .createIndex('idx_job_status_type_run_after_created_at')
      .on('job')
      .column('status')
      .column('type')
      .column('run_after')
      .column('created_at')
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('job')
      .dropColumn('run_after')
      .execute()

    await db.schema
      .dropIndex('idx_job_status_type_run_after_created_at')
      .execute()
  },
}

migrations['011'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('actor')
      .dropColumn('handle')
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable('actor')
      .addColumn('handle', 'varchar', (col) => col.notNull())
      .execute()
  },
}

migrations['012'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('repost')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('author_did', 'varchar', (col) => col.notNull())
      .addColumn('post_uri', 'varchar', (col) => col.notNull())
      .addColumn('indexed_at', 'varchar', (col) => col.notNull())
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

  async down(db: Kysely<unknown>) {
    await db.schema
      .dropTable('repost')
      .execute()
  },
}
