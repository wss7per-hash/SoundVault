import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

let db: Database.Database | null = null

export function getDbPath(): string {
  return join(app.getPath('userData'), 'soundvault.db')
}

export function initDatabase(): void {
  const dbPath = getDbPath()
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  createTables()
  seedDefaultCategories()
  cleanupLegacyQualityNotes()

  console.log('[Database] Initialized at', dbPath)
}

/**
 * One-time, idempotent cleanup: strip the old "编码质量较低，建议替换为无损
 * 版本" note from previously-analyzed sounds so the library doesn't keep
 * showing a useless reminder. Runs on the app's own DB connection.
 */
function cleanupLegacyQualityNotes(): void {
  if (!db) return
  const phrase = '（注意：编码质量较低，建议替换为无损版本）'
  try {
    const info = db.prepare(`
      UPDATE sounds
      SET best_for = REPLACE(best_for, ?, ''),
          description = REPLACE(description, ?, ''),
          search_text = REPLACE(search_text, ?, '')
      WHERE best_for LIKE ? OR description LIKE ?
    `).run(phrase, phrase, phrase, '%编码质量较低%', '%编码质量较低%')
    if (info.changes > 0) {
      console.log(`[Database] Cleaned legacy encoding-quality notes from ${info.changes} sound(s)`)
    }
  } catch (err) {
    console.warn('[Database] Legacy quality-note cleanup skipped:', (err as Error).message)
  }
}

// 预置 PRD §3.3.1 八大分类，让标签树一开始就展示标准分类体系
const DEFAULT_CATEGORIES = ['人声', '动物', '环境氛围', '动作物品', 'UI交互', '乐器音乐', '机械科技', '特殊效果']

function seedDefaultCategories(): void {
  if (!db) return
  const now = new Date().toISOString()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO tags (id, name, parent_id, sort_order, created_at) VALUES (?, ?, NULL, ?, ?)'
  )
  DEFAULT_CATEGORIES.forEach((name, i) => {
    stmt.run(uuidv4(), name, i, now)
  })
}

function createTables(): void {
  if (!db) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS sounds (
      id              TEXT PRIMARY KEY,
      file_path       TEXT NOT NULL,
      file_hash       TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      file_ext        TEXT NOT NULL,
      file_size       INTEGER NOT NULL,
      duration_ms     INTEGER,
      sample_rate     INTEGER,
      bit_depth       INTEGER,
      channels        INTEGER,
      bitrate_kbps    INTEGER,
      loudness_lufs   REAL,

      description     TEXT,
      description_en  TEXT,
      use_cases       TEXT,
      emotion         TEXT,
      quality_score   INTEGER,
      similar_to      TEXT,
      best_for        TEXT,
      ai_model        TEXT,
      ai_analyzed_at  TEXT,

      is_starred      INTEGER DEFAULT 0,
      is_missing      INTEGER DEFAULT 0,
      is_trashed      INTEGER DEFAULT 0,
      play_count      INTEGER DEFAULT 0,
      export_count    INTEGER DEFAULT 0,
      preview_cache   TEXT,

      imported_at     TEXT NOT NULL,
      updated_at      TEXT NOT NULL,

      search_text     TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      parent_id   TEXT,
      color       TEXT,
      icon        TEXT,
      sort_order  INTEGER DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sound_tags (
      sound_id    TEXT NOT NULL,
      tag_id      TEXT NOT NULL,
      confidence  REAL,
      is_manual   INTEGER DEFAULT 0,
      PRIMARY KEY (sound_id, tag_id),
      FOREIGN KEY (sound_id) REFERENCES sounds(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tag_aliases (
      tag_id  TEXT NOT NULL,
      alias   TEXT NOT NULL,
      PRIMARY KEY (tag_id, alias),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collections (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      color       TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_sounds (
      collection_id TEXT NOT NULL,
      sound_id      TEXT NOT NULL,
      sort_order    INTEGER DEFAULT 0,
      added_at      TEXT NOT NULL,
      PRIMARY KEY (collection_id, sound_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (sound_id) REFERENCES sounds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      sound_id  TEXT NOT NULL,
      played_at TEXT NOT NULL,
      FOREIGN KEY (sound_id) REFERENCES sounds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_models (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      base_url          TEXT NOT NULL,
      model_id          TEXT NOT NULL,
      api_key_encrypted TEXT,
      system_prompt     TEXT,
      max_tokens        INTEGER DEFAULT 4096,
      is_default        INTEGER DEFAULT 0,
      created_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS smart_folders (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      conditions  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sounds_hash ON sounds(file_hash);
    CREATE INDEX IF NOT EXISTS idx_sounds_starred ON sounds(is_starred);
    CREATE INDEX IF NOT EXISTS idx_sounds_missing ON sounds(is_missing);
    CREATE INDEX IF NOT EXISTS idx_sounds_imported ON sounds(imported_at);
    CREATE INDEX IF NOT EXISTS idx_sound_tags_tag ON sound_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_collection_sounds ON collection_sounds(collection_id);
    CREATE INDEX IF NOT EXISTS idx_play_history_sound ON play_history(sound_id);
    CREATE INDEX IF NOT EXISTS idx_play_history_time ON play_history(played_at);
    CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);
  `)

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sounds_fts USING fts5(
        file_name, description, description_en, emotion, similar_to,
        content='sounds', content_rowid='rowid'
      );
    `)
  } catch {
    console.log('[Database] FTS5 not available or already exists')
  }

  console.log('[Database] Tables created successfully')
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    console.log('[Database] Closed')
  }
}
