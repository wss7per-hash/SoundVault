import { ipcMain, dialog, app, shell } from 'electron'
import { readdir, stat, readFile, copyFile, rename, mkdir, access } from 'fs/promises'
import { createHash } from 'crypto'
import { join, extname, basename, dirname, parse, format } from 'path'
import { getDatabase } from './database'
import { v4 as uuidv4 } from 'uuid'
import {
  extractAudioMetadata,
  analyzeAudio,
  batchAnalyze,
  testConnection,
  setModelConfig,
  getModelConfig,
  cancelAnalysis,
  registerAnalysis,
  unregisterAnalysis,
  type ModelConfig,
  type AudioMetadata,
  type AIAnalysisResult
} from './ai-analyzer'

const AUDIO_EXTENSIONS = new Set([
  '.wav', '.mp3', '.aac', '.ogg', '.flac', '.aiff', '.m4a', '.wma', '.opus'
])

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm'])

interface ScanOptions {
  targetPath: string
  recursive: boolean
  filenameIncludes: string[]
  filenameExcludes: string[]
  minSizeKB: number
  maxSizeKB: number
  skipHidden: boolean
  includeVideo: boolean
}

interface ScanResult {
  total: number
  newFiles: number
  skipped: number
  totalSize: number
  byFormat: Record<string, number>
  files: Array<{
    path: string
    name: string
    ext: string
    size: number
  }>
}

export function registerIpcHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('scan:folder', async (_event, options: ScanOptions): Promise<ScanResult> => {
    const result: ScanResult = {
      total: 0,
      newFiles: 0,
      skipped: 0,
      totalSize: 0,
      byFormat: {},
      files: []
    }

    const existingHashes = new Set<string>()
    const rows = db.prepare('SELECT file_hash FROM sounds').all() as Array<{ file_hash: string }>
    for (const row of rows) {
      existingHashes.add(row.file_hash)
    }

    async function scanDir(dirPath: string): Promise<void> {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name)

          if (options.skipHidden && entry.name.startsWith('.')) {
            continue
          }

          if (entry.isDirectory() && options.recursive) {
            await scanDir(fullPath)
            continue
          }

          if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase()
            const isAudio = AUDIO_EXTENSIONS.has(ext)
            const isVideo = VIDEO_EXTENSIONS.has(ext) && options.includeVideo

            if (!isAudio && !isVideo) continue

            if (options.filenameIncludes.length > 0) {
              const name = entry.name.toLowerCase()
              const matches = options.filenameIncludes.some((k) => name.includes(k.toLowerCase()))
              if (!matches) continue
            }

            if (options.filenameExcludes.length > 0) {
              const name = entry.name.toLowerCase()
              const matches = options.filenameExcludes.some((k) => name.includes(k.toLowerCase()))
              if (matches) continue
            }

            const fileStat = await stat(fullPath)
            const sizeKB = fileStat.size / 1024

            if (options.minSizeKB > 0 && sizeKB < options.minSizeKB) continue
            if (options.maxSizeKB > 0 && sizeKB > options.maxSizeKB) continue

            result.total++
            result.totalSize += fileStat.size
            result.byFormat[ext] = (result.byFormat[ext] || 0) + 1

            const buffer = await readFile(fullPath, { length: 64 * 1024 })
            const hash = createHash('sha256').update(buffer).digest('hex')

            if (existingHashes.has(hash)) {
              result.skipped++
              continue
            }

            result.newFiles++
            existingHashes.add(hash)

            result.files.push({
              path: fullPath,
              name: entry.name,
              ext,
              size: fileStat.size
            })
          }
        }
      } catch (err) {
        console.error(`[Scanner] Error scanning ${dirPath}:`, err)
      }
    }

    await scanDir(options.targetPath)
    return result
  })

  ipcMain.handle('sound:import', async (_event, files: Array<{ path: string; name: string; ext: string; size: number }>) => {
    const now = new Date().toISOString()
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO sounds (id, file_path, file_hash, file_name, file_ext, file_size, imported_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let imported = 0
    for (const file of files) {
      const buffer = await readFile(file.path, { length: 64 * 1024 })
      const hash = createHash('sha256').update(buffer).digest('hex')
      const id = uuidv4()

      const result = insertStmt.run(id, file.path, hash, file.name, file.ext, file.size, now, now)
      if (result.changes > 0) imported++
    }

    return { imported }
  })

  ipcMain.handle('sound:getAll', () => {
    return db.prepare(`
      SELECT s.*,
        (SELECT GROUP_CONCAT(t.name, ',')
         FROM tags t
         JOIN sound_tags st ON t.id = st.tag_id
         WHERE st.sound_id = s.id) AS tags
      FROM sounds s
      ORDER BY s.imported_at DESC
    `).all()
  })

  ipcMain.handle('sound:getById', (_event, id: string) => {
    return db.prepare('SELECT * FROM sounds WHERE id = ?').get(id)
  })

  ipcMain.handle('sound:delete', (_event, id: string) => {
    db.prepare('DELETE FROM sounds WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('sound:toggleStar', (_event, id: string) => {
    const sound = db.prepare('SELECT is_starred FROM sounds WHERE id = ?').get(id) as { is_starred: number } | undefined
    if (!sound) return { success: false }

    const newVal = sound.is_starred ? 0 : 1
    db.prepare('UPDATE sounds SET is_starred = ? WHERE id = ?').run(newVal, id)
    return { success: true, is_starred: !!newVal }
  })

  ipcMain.handle('sound:incrementPlayCount', (_event, id: string) => {
    db.prepare('UPDATE sounds SET play_count = play_count + 1 WHERE id = ?').run(id)
    db.prepare('INSERT INTO play_history (sound_id, played_at) VALUES (?, ?)').run(id, new Date().toISOString())
  })

  ipcMain.handle('tag:getAll', () => {
    return db.prepare('SELECT * FROM tags ORDER BY sort_order').all()
  })

  ipcMain.handle('tag:getForSound', (_event, soundId: string) => {
    return db.prepare(`
      SELECT t.*, st.confidence, st.is_manual
      FROM tags t
      JOIN sound_tags st ON t.id = st.tag_id
      WHERE st.sound_id = ?
    `).all(soundId)
  })

  ipcMain.handle('sound:search', (_event, query: string) => {
    if (!query.trim()) {
      return db.prepare(`
        SELECT s.*,
          (SELECT GROUP_CONCAT(t.name, ',')
           FROM tags t
           JOIN sound_tags st ON t.id = st.tag_id
           WHERE st.sound_id = s.id) AS tags
        FROM sounds s
        ORDER BY s.imported_at DESC
      `).all()
    }

    const like = `%${query}%`
    return db.prepare(`
      SELECT s.*,
        (SELECT GROUP_CONCAT(t.name, ',')
         FROM tags t
         JOIN sound_tags st ON t.id = st.tag_id
         WHERE st.sound_id = s.id) AS tags
      FROM sounds s
      WHERE s.file_name LIKE ? OR s.description LIKE ? OR s.emotion LIKE ?
      ORDER BY s.imported_at DESC
    `).all(like, like, like)
  })

  ipcMain.handle('sound:getStats', () => {
    const total = (db.prepare('SELECT COUNT(*) as count FROM sounds').get() as { count: number }).count
    const starred = (db.prepare('SELECT COUNT(*) as count FROM sounds WHERE is_starred = 1').get() as { count: number }).count
    const missing = (db.prepare('SELECT COUNT(*) as count FROM sounds WHERE is_missing = 1').get() as { count: number }).count
    const totalSize = (db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM sounds').get() as { total: number }).total

    return { total, starred, missing, totalSize }
  })

  // ---- AI Analysis ----

  ipcMain.handle('ai:getConfig', () => {
    return getModelConfig()
  })

  ipcMain.handle('ai:saveConfig', (_event, config: Partial<ModelConfig>) => {
    setModelConfig({ ...getModelConfig(), ...config })
    return { success: true }
  })

  ipcMain.handle('ai:testConnection', async (_event, config: ModelConfig) => {
    return await testConnection(config)
  })

/**
 * Get an existing tag id by name, or create a new tag and return its id.
 * Avoids the previous bug where INSERT OR IGNORE skipped a duplicate name
 * but we still linked sound_tags to a non-existent uuid -> FK violation.
 */
function getOrCreateTagId(name: string, now: string): string {
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as
    | { id: string }
    | undefined
  if (existing) return existing.id

  const tagId = uuidv4()
  db.prepare(
    'INSERT OR IGNORE INTO tags (id, name, parent_id, sort_order, created_at) VALUES (?, ?, NULL, 0, ?)'
  ).run(tagId, name, now)
  return tagId
}

  ipcMain.handle('ai:analyzeSingle', async (_event, soundId: string) => {
    const sound = db.prepare('SELECT * FROM sounds WHERE id = ?').get(soundId) as any
    if (!sound) throw new Error('Sound not found')

    // Register a per-sound abort controller so the UI can interrupt a stuck
    // analysis without affecting other in-flight analyses.
    const controller = new AbortController()
    registerAnalysis(soundId, controller)

    try {
      const metadata = await extractAudioMetadata(sound.file_path)
      const result = await analyzeAudio(sound.file_path, sound.file_name, metadata, undefined, { signal: controller.signal })

      // Store metadata
      db.prepare(`
        UPDATE sounds SET
          duration_ms = ?, sample_rate = ?, bitrate_kbps = ?, channels = ?,
          loudness_lufs = ?, description = ?, use_cases = ?, emotion = ?,
          quality_score = ?, similar_to = ?, best_for = ?,
          ai_model = ?, ai_analyzed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        Math.round(metadata.duration * 1000),
        metadata.sampleRate,
        metadata.bitrate,
        metadata.channels,
        Math.round(metadata.loudnessIntegratedLUFS),
        result.description,
        result.scenario,
        result.emotion,
        result.qualityScore,
        result.variantOf,
        result.detailedDescription,
        getModelConfig().model,
        new Date().toISOString(),
        new Date().toISOString(),
        soundId
      )

      // Update tags
      db.prepare('DELETE FROM sound_tags WHERE sound_id = ? AND is_manual = 0').run(soundId)

      const soundTagInsert = db.prepare(`
        INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual)
        VALUES (?, ?, ?, 0)
      `)

      const now = new Date().toISOString()
      for (const tag of result.tags) {
        const tagId = getOrCreateTagId(tag.name, now)
        soundTagInsert.run(soundId, tagId, tag.confidence)
      }

      // Update FTS index
      const ftsText = [
        sound.file_name,
        result.description,
        result.detailedDescription,
        result.scenario,
        result.emotion,
        ...result.tags.map((t) => t.name)
      ].filter(Boolean).join(' ')

      db.prepare(`
        UPDATE sounds SET search_text = ? WHERE id = ?
      `).run(ftsText, soundId)

      return { success: true, metadata, result }
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError' || /aborted/i.test(e.message)) {
        return { success: false, cancelled: true, error: '已取消' }
      }
      return { success: false, error: e.message }
    } finally {
      unregisterAnalysis(soundId)
    }
  })

  ipcMain.handle('ai:cancelAnalysis', (_event, tokens: string[]) => {
    let cancelled = 0
    for (const token of tokens) {
      if (cancelAnalysis(token)) cancelled++
    }
    return { success: true, cancelled }
  })

  ipcMain.handle('ai:analyzeBatch', async (_event, soundIds: string[], token?: string) => {
    const sounds = db.prepare(`
      SELECT id, file_path, file_name FROM sounds WHERE id IN (${soundIds.map(() => '?').join(',')})
    `).all(...soundIds) as Array<{ id: string; file_path: string; file_name: string }>

    const analysisToken = token || uuidv4()
    const controller = new AbortController()
    registerAnalysis(analysisToken, controller)

    try {
      const results = await batchAnalyze(sounds, (current, total, id) => {
        // Progress sent via IPC could go here
      }, { signal: controller.signal })

      // Save results to DB
      const now = new Date().toISOString()
      const modelName = getModelConfig().model

      for (const { id, result } of results) {
        db.prepare(`
          UPDATE sounds SET
            description = ?, use_cases = ?, emotion = ?,
            quality_score = ?, similar_to = ?, best_for = ?,
            ai_model = ?, ai_analyzed_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
          result.description, result.scenario, result.emotion,
          result.qualityScore, result.variantOf, result.detailedDescription,
          modelName, now, now, id
        )

        db.prepare('DELETE FROM sound_tags WHERE sound_id = ? AND is_manual = 0').run(id)

        const soundTagInsert = db.prepare(`
          INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual)
          VALUES (?, ?, ?, 0)
        `)

        for (const tag of result.tags) {
          const tagId = getOrCreateTagId(tag.name, now)
          soundTagInsert.run(id, tagId, tag.confidence)
        }
      }

      return { success: true, analyzed: results.length, cancelled: controller.signal.aborted }
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError' || /aborted/i.test(e.message)) {
        return { success: true, analyzed: 0, cancelled: true }
      }
      return { success: false, error: e.message }
    } finally {
      unregisterAnalysis(analysisToken)
    }
  })

  // ---- Collections ----

  ipcMain.handle('collection:getAll', () => {
    return db.prepare('SELECT * FROM collections ORDER BY created_at DESC').all()
  })

  ipcMain.handle('collection:create', (_event, name: string, description: string) => {
    const id = uuidv4()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO collections (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, description, now, now)
    return { id }
  })

  ipcMain.handle('collection:getSounds', (_event, collectionId: string) => {
    return db.prepare(`
      SELECT s.* FROM sounds s
      JOIN collection_sounds cs ON s.id = cs.sound_id
      WHERE cs.collection_id = ?
      ORDER BY cs.sort_order
    `).all(collectionId)
  })

  ipcMain.handle('collection:addSound', (_event, collectionId: string, soundId: string) => {
    db.prepare(`
      INSERT OR IGNORE INTO collection_sounds (collection_id, sound_id) VALUES (?, ?)
    `).run(collectionId, soundId)
    return { success: true }
  })

  ipcMain.handle('collection:removeSound', (_event, collectionId: string, soundId: string) => {
    db.prepare(`
      DELETE FROM collection_sounds WHERE collection_id = ? AND sound_id = ?
    `).run(collectionId, soundId)
    return { success: true }
  })

  ipcMain.handle('tag:add', (_event, name: string, parentId: string | null, color: string | null) => {
    const id = uuidv4()
    const now = new Date().toISOString()
    const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM tags').get() as { m: number })?.m || 0

    db.prepare(`
      INSERT INTO tags (id, name, parent_id, color, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, parentId, color, maxOrder + 1, now)

    return { id }
  })

  ipcMain.handle('tag:addToSound', (_event, soundId: string, tagName: string, confidence: number) => {
    const now = new Date().toISOString()
    let tagId = (db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: string } | undefined)?.id

    if (!tagId) {
      tagId = uuidv4()
      db.prepare('INSERT INTO tags (id, name, sort_order, created_at) VALUES (?, ?, 0, ?)').run(tagId, tagName, now)
    }

    db.prepare(`
      INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual)
      VALUES (?, ?, ?, 1)
    `).run(soundId, tagId, confidence || 1)

    return { success: true }
  })

  ipcMain.handle('tag:removeFromSound', (_event, soundId: string, tagId: string) => {
    db.prepare('DELETE FROM sound_tags WHERE sound_id = ? AND tag_id = ?').run(soundId, tagId)
    return { success: true }
  })

  // ---- Smart Folders ----

  ipcMain.handle('smartFolder:save', (_event, data: { id?: string; name: string; conditions: string }) => {
    const id = data.id || uuidv4()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO smart_folders (id, name, conditions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = ?, conditions = ?, updated_at = ?
    `).run(id, data.name, data.conditions, now, now, data.name, data.conditions, now)

    return { id }
  })

  ipcMain.handle('smartFolder:getAll', () => {
    return db.prepare('SELECT * FROM smart_folders ORDER BY created_at').all()
  })

  ipcMain.handle('smartFolder:delete', (_event, id: string) => {
    db.prepare('DELETE FROM smart_folders WHERE id = ?').run(id)
    return { success: true }
  })

  // ---- Tag Management ----

  ipcMain.handle('tag:delete', (_event, tagId: string) => {
    db.prepare('DELETE FROM sound_tags WHERE tag_id = ?').run(tagId)
    db.prepare('DELETE FROM tag_aliases WHERE tag_id = ?').run(tagId)
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId)
    return { success: true }
  })

  ipcMain.handle('tag:update', (_event, tagId: string, updates: { name?: string; color?: string; parent_id?: string | null }) => {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color) }
    if (updates.parent_id !== undefined) { fields.push('parent_id = ?'); values.push(updates.parent_id) }

    if (fields.length === 0) return { success: true }
    values.push(tagId)
    db.prepare(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return { success: true }
  })

  ipcMain.handle('tag:getStats', () => {
    return db.prepare(`
      SELECT t.id, t.name, t.color, COUNT(st.sound_id) as count
      FROM tags t
      LEFT JOIN sound_tags st ON t.id = st.tag_id
      GROUP BY t.id
      ORDER BY count DESC
    `).all()
  })

  // ---- Collection Management ----

  ipcMain.handle('collection:delete', (_event, id: string) => {
    db.prepare('DELETE FROM collection_sounds WHERE collection_id = ?').run(id)
    db.prepare('DELETE FROM collections WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('collection:update', (_event, id: string, updates: { name?: string; description?: string }) => {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    fields.push('updated_at = ?'); values.push(new Date().toISOString())

    if (fields.length === 0) return { success: true }
    values.push(id)
    db.prepare(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return { success: true }
  })

  // ---- Recycle Bin / Trash ----

  ipcMain.handle('sound:batchDelete', (_event, ids: string[]) => {
    const placeholders = ids.map(() => '?').join(',')
    // Soft delete: set is_trashed flag
    db.prepare(`
      UPDATE sounds SET is_trashed = 1, updated_at = ? WHERE id IN (${placeholders})
    `).run(new Date().toISOString(), ...ids)
    return { success: true }
  })

  ipcMain.handle('sound:getTrash', () => {
    try {
      return db.prepare('SELECT * FROM sounds WHERE is_trashed = 1 ORDER BY updated_at DESC').all()
    } catch {
      return []
    }
  })

  ipcMain.handle('sound:restore', (_event, ids: string[]) => {
    const placeholders = ids.map(() => '?').join(',')
    try {
      db.prepare(`UPDATE sounds SET is_trashed = 0, updated_at = ? WHERE id IN (${placeholders})`)
        .run(new Date().toISOString(), ...ids)
    } catch {}
    return { success: true }
  })

  ipcMain.handle('sound:permanentDelete', (_event, ids: string[]) => {
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM sounds WHERE id IN (${placeholders})`).run(...ids)
    return { success: true }
  })

  ipcMain.handle('sound:batchTag', (_event, soundIds: string[], tagNames: string[], action: 'add' | 'remove') => {
    const now = new Date().toISOString()
    let affected = 0

    for (const soundId of soundIds) {
      for (const tagName of tagNames) {
        if (action === 'add') {
          let tagId = (db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: string } | undefined)?.id
          if (!tagId) {
            tagId = uuidv4()
            db.prepare('INSERT INTO tags (id, name, sort_order, created_at) VALUES (?, ?, 0, ?)').run(tagId, tagName, now)
          }
          const r = db.prepare('INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, 1, 1)').run(soundId, tagId)
          affected += r.changes
        } else {
          const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: string } | undefined
          if (tag) {
            const r = db.prepare('DELETE FROM sound_tags WHERE sound_id = ? AND tag_id = ?').run(soundId, tag.id)
            affected += r.changes
          }
        }
      }
    }

    return { success: true, affected }
  })

  // ---- Settings ----

  ipcMain.handle('settings:get', (_event, key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value || null
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `).run(key, value, value, new Date().toISOString())
    return { success: true }
  })

  // ---- File Operations (Context Menu) ----

  ipcMain.handle('file:showItemInFolder', async (_event, soundId: string) => {
    try {
      const row = db.prepare('SELECT file_path FROM sounds WHERE id = ?').get(soundId) as { file_path: string } | undefined
      if (!row) return { success: false, message: '找不到文件记录' }
      await stat(row.file_path)
      shell.showItemInFolder(row.file_path)
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('file:copyTo', async (_event, soundId: string, targetDir: string) => {
    try {
      const row = db.prepare('SELECT file_path FROM sounds WHERE id = ?').get(soundId) as { file_path: string } | undefined
      if (!row) return { success: false, message: '找不到文件记录' }
      await access(targetDir)
      const fileName = basename(row.file_path)
      const dest = join(targetDir, fileName)
      await copyFile(row.file_path, dest)
      return { success: true, path: dest }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('file:moveTo', async (_event, soundId: string, targetDir: string) => {
    try {
      const row = db.prepare('SELECT file_path FROM sounds WHERE id = ?').get(soundId) as { file_path: string } | undefined
      if (!row) return { success: false, message: '找不到文件记录' }
      await access(targetDir)
      const fileName = basename(row.file_path)
      const dest = join(targetDir, fileName)
      await rename(row.file_path, dest)
      db.prepare('UPDATE sounds SET file_path = ?, updated_at = ? WHERE id = ?').run(dest, new Date().toISOString(), soundId)
      return { success: true, path: dest }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('file:trash', async (_event, soundId: string) => {
    try {
      const row = db.prepare('SELECT file_path FROM sounds WHERE id = ?').get(soundId) as { file_path: string } | undefined
      if (!row) return { success: false, message: '找不到文件记录' }
      await shell.trashItem(row.file_path)
      db.prepare('UPDATE sounds SET is_trashed = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), soundId)
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('sound:rename', async (_event, soundId: string, newName: string) => {
    try {
      const row = db.prepare('SELECT file_path, file_name, file_ext FROM sounds WHERE id = ?').get(soundId) as { file_path: string; file_name: string; file_ext: string } | undefined
      if (!row) return { success: false, message: '找不到文件记录' }
      const dir = dirname(row.file_path)
      const ext = row.file_ext
      const cleanName = newName.replace(/[\\/:*?"<>|]/g, '_')
      const newFileName = cleanName.endsWith(ext) ? cleanName : `${cleanName}${ext}`
      const dest = join(dir, newFileName)
      await rename(row.file_path, dest)
      db.prepare('UPDATE sounds SET file_name = ?, file_path = ?, updated_at = ? WHERE id = ?').run(newFileName, dest, new Date().toISOString(), soundId)
      return { success: true, fileName: newFileName }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  console.log('[IPC] All handlers registered')
}
