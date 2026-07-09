import { ipcMain, dialog, app, shell, BrowserWindow } from 'electron'
import { readdir, stat, readFile, writeFile, copyFile, rename, mkdir, access } from 'fs/promises'
import { existsSync } from 'fs'
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

  // 收藏视图：列出所有已收藏（is_starred=1）的音效
  ipcMain.handle('sound:getStarred', () => {
    return db.prepare(`
      SELECT s.*,
        (SELECT GROUP_CONCAT(t.name, ',')
         FROM tags t
         JOIN sound_tags st ON t.id = st.tag_id
         WHERE st.sound_id = s.id) AS tags
      FROM sounds s
      WHERE s.is_starred = 1
      ORDER BY s.imported_at DESC
    `).all()
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
// PRD §3.3.1 八大分类（人声/动物/环境氛围/动作物品/UI交互/乐器音乐/机械科技/特殊效果）
const PRD_CATEGORIES = ['人声', '动物', '环境氛围', '动作物品', 'UI交互', '乐器音乐', '机械科技', '特殊效果']

function getOrCreateTagId(name: string, now: string, parentId: string | null = null): string {
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as
    | { id: string }
    | undefined
  if (existing) return existing.id

  const tagId = uuidv4()
  db.prepare(
    'INSERT OR IGNORE INTO tags (id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, 0, ?)'
  ).run(tagId, name, parentId, now)
  return tagId
}

// 确保分类父节点存在，返回其父标签 id（用于把子标签挂到分类下，实现自动归类）
function ensureParentCategory(category: string, now: string): string | null {
  if (!PRD_CATEGORIES.includes(category)) return null
  return getOrCreateTagId(category, now, null)
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
        const parentId = tag.name !== tag.category ? ensureParentCategory(tag.category, now) : null
        const tagId = getOrCreateTagId(tag.name, now, parentId)
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
          const parentId = tag.name !== tag.category ? ensureParentCategory(tag.category, now) : null
          const tagId = getOrCreateTagId(tag.name, now, parentId)
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
    const result = db.prepare(`
      INSERT OR IGNORE INTO collection_sounds (collection_id, sound_id, added_at)
      VALUES (?, ?, ?)
    `).run(collectionId, soundId, new Date().toISOString())
    return { success: result.changes > 0 }
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

  // ---- Library Export / Import (portable bundle, like Eagle) ----

  /**
   * Export a portable library bundle.
   * @param destDir   Target parent folder (user-chosen).
   * @param soundIds  Optional array of sound IDs to export.  Empty/undefined = export ALL sounds.
   */
  ipcMain.handle('library:export', async (_event, destDir: string, soundIds?: string[]) => {
    const bundleName = `SoundVault-Library-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
    const root = join(destDir, bundleName)
    const audiosDir = join(root, 'audios')
    await mkdir(audiosDir, { recursive: true })

    // Support selective export
    let sounds
    if (soundIds && soundIds.length > 0) {
      const placeholders = soundIds.map(() => '?').join(',')
      sounds = db.prepare(`SELECT * FROM sounds WHERE id IN (${placeholders})`).all(...soundIds)
    } else {
      sounds = db.prepare('SELECT * FROM sounds').all()
    }

    const ids = new Set((sounds as Array<{ id: string }>).map((s) => s.id))

    const tags = ids.size > 0
      ? db.prepare(`SELECT * FROM tags WHERE id IN (SELECT tag_id FROM sound_tags WHERE sound_id IN (${[...ids].map(() => '?').join(',')}))`).all(...ids)
      : db.prepare('SELECT * FROM tags').all()
    const soundTags = ids.size > 0
      ? db.prepare(`SELECT * FROM sound_tags WHERE sound_id IN (${[...ids].map(() => '?').join(',')}))`).all(...ids)
      : db.prepare('SELECT * FROM sound_tags').all()
    const tagAliases = db.prepare('SELECT * FROM tag_aliases').all()
    const collections = db.prepare('SELECT * FROM collections').all()
    const collectionSounds = ids.size > 0
      ? db.prepare(`SELECT * FROM collection_sounds WHERE sound_id IN (${[...ids].map(() => '?').join(',')}))`).all(...ids)
      : db.prepare('SELECT * FROM collection_sounds').all()
    const smartFolders = db.prepare('SELECT * FROM smart_folders').all()

    // Copy audio files using ORIGINAL filenames (with dedup on name clash).
    let copied = 0
    let missing = 0
    const nameCounter = new Map<string, number>() // baseName → next suffix
    for (const s of sounds as Array<{ id: string; file_path: string; file_ext: string; file_name: string }>) {
      const ext = (s.file_ext || extname(s.file_path) || '').toLowerCase()
      const safeExt = ext.startsWith('.') ? ext : `.${ext}`
      // Prefer stored file_name, fall back to basename of path.
      let baseName = (s.file_name || basename(s.file_path) || s.id).trim()
      // Strip extension if it's already included in file_name to avoid double-ext.
      if (baseName.toLowerCase().endsWith(safeExt)) {
        baseName = baseName.slice(0, baseName.length - safeExt.length)
      }
      // Sanitize: remove characters invalid on Windows/macOS/Linux.
      baseName = baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'audio'
      // Dedup: if same filename already used, append _2 _3 ...
      const candidate = `${baseName}${safeExt}`
      const count = nameCounter.get(candidate) || 0
      const finalName = count === 0 ? candidate : `${baseName}_${count}${safeExt}`
      nameCounter.set(candidate, count + 1)

      const src = s.file_path
      const dest = join(audiosDir, finalName)
      try {
        await access(src)
        await copyFile(src, dest)
        copied++
      } catch {
        missing++
      }
    }

    const manifest = {
      format: 'soundvault-library',
      version: 1,
      appVersion: app.getVersion(),
      exportedAt: new Date().toISOString(),
      counts: {
        sounds: (sounds as unknown[]).length,
        tags: (tags as unknown[]).length,
        sound_tags: (soundTags as unknown[]).length,
        collections: (collections as unknown[]).length,
        collection_sounds: (collectionSounds as unknown[]).length,
        smart_folders: (smartFolders as unknown[]).length
      },
      audio: { copied, missing }
    }

    const payload = {
      ...manifest,
      sounds,
      tags,
      sound_tags: soundTags,
      tag_aliases: tagAliases,
      collections,
      collection_sounds: collectionSounds,
      smart_folders: smartFolders
    }

    await writeFile(join(root, 'library.json'), JSON.stringify(payload, null, 2))
    await writeFile(
      join(root, 'README.txt'),
      [
        'SoundVault 资源库导出包',
        '============================',
        `导出时间：${manifest.exportedAt}`,
        `包含音效：${manifest.counts.sounds} 个（音频文件已复制 ${copied} 个，缺失 ${missing} 个）`,
        `标签：${manifest.counts.tags} 个`,
        `收藏夹：${manifest.counts.collections} 个`,
        '',
        '在另一台电脑的 SoundVault 中点「导入库」并选择本文件夹即可迁移全部数据。'
      ].join('\n')
    )

    return {
      success: true,
      path: root,
      counts: manifest.counts,
      copied,
      missing
    }
  })

  ipcMain.handle('library:import', async (_event, bundleDir: string) => {
    const manifestPath = join(bundleDir, 'library.json')
    if (!existsSync(manifestPath)) {
      return { success: false, error: '未找到 library.json，请选择 SoundVault 导出的资源库文件夹' }
    }

    let data: any
    try {
      data = JSON.parse(await readFile(manifestPath, 'utf-8'))
    } catch {
      return { success: false, error: 'library.json 解析失败，文件可能已损坏' }
    }
    if (data?.format !== 'soundvault-library') {
      return { success: false, error: '文件格式不正确，不是有效的 SoundVault 资源库' }
    }

    const libraryRoot = join(app.getPath('userData'), 'library')
    await mkdir(libraryRoot, { recursive: true })
    const audioSrcDir = join(bundleDir, 'audios')
    const now = () => new Date().toISOString()

    // ---- Tags: match by name (UNIQUE) ----
    const existingTags = db.prepare('SELECT id, name FROM tags').all() as Array<{ id: string; name: string }>
    const tagNameToId = new Map(existingTags.map((t) => [t.name, t.id]))
    const oldTagToNew = new Map<string, string>()
    for (const t of (data.tags || []) as Array<any>) {
      const finalId = tagNameToId.has(t.name)
        ? (tagNameToId.get(t.name) as string)
        : uuidv4()
      if (!tagNameToId.has(t.name)) {
        tagNameToId.set(t.name, finalId)
        db.prepare(
          'INSERT OR IGNORE INTO tags (id, name, parent_id, color, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(finalId, t.name, t.parent_id ?? null, t.color ?? null, t.icon ?? null, t.sort_order ?? 0, t.created_at ?? now())
      }
      oldTagToNew.set(t.id, finalId)
    }

    // ---- Sounds: dedupe by file_hash, copy audio locally ----
    const existingHashes = new Set(
      (db.prepare('SELECT file_hash FROM sounds').all() as Array<{ file_hash: string }>).map((r) => r.file_hash)
    )
    const soundCols = (db.prepare('PRAGMA table_info(sounds)').all() as Array<{ name: string }>).map((c) => c.name)
    const soundInsert = db.prepare(
      `INSERT OR IGNORE INTO sounds (${soundCols.join(',')}) VALUES (${soundCols.map(() => '?').join(',')})`
    )
    const oldSoundToNew = new Map<string, string>()
    let imported = 0

    for (const s of (data.sounds || []) as Array<any>) {
      if (existingHashes.has(s.file_hash)) {
        const ex = db.prepare('SELECT id FROM sounds WHERE file_hash = ?').get(s.file_hash) as { id: string } | undefined
        if (ex) {
          oldSoundToNew.set(s.id, ex.id)
          continue
        }
      }
      const newId = uuidv4()
      oldSoundToNew.set(s.id, newId)

      const ext = (s.file_ext || extname(s.file_path) || '').toLowerCase()
      const safeExt = ext.startsWith('.') ? ext : `.${ext}`
      const srcAudio = join(audioSrcDir, `${s.id}${safeExt}`)
      const destAudio = join(libraryRoot, `${newId}${safeExt}`)
      let audioOk = false
      try {
        await access(srcAudio)
        await copyFile(srcAudio, destAudio)
        audioOk = true
      } catch {
        audioOk = false
      }

      const row: any = { ...s }
      row.id = newId
      row.file_path = destAudio
      row.is_missing = audioOk ? 0 : 1
      row.imported_at = now()
      row.updated_at = now()

      const values = soundCols.map((c) => (row[c] === undefined ? null : row[c]))
      try {
        soundInsert.run(...values)
        if (audioOk) imported++
        else imported++ // 元数据仍导入，仅标记缺失
      } catch (err) {
        console.error('[library:import] sound insert failed:', (err as Error).message)
      }
    }

    // ---- sound_tags (remap) ----
    const stInsert = db.prepare(
      'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
    )
    for (const st of (data.sound_tags || []) as Array<any>) {
      const sid = oldSoundToNew.get(st.sound_id)
      const tid = oldTagToNew.get(st.tag_id)
      if (!sid || !tid) continue
      stInsert.run(sid, tid, st.confidence ?? null, st.is_manual ?? 0)
    }

    // ---- tag_aliases (remap) ----
    const taInsert = db.prepare('INSERT OR IGNORE INTO tag_aliases (tag_id, alias) VALUES (?, ?)')
    for (const ta of (data.tag_aliases || []) as Array<any>) {
      const tid = oldTagToNew.get(ta.tag_id)
      if (!tid) continue
      taInsert.run(tid, ta.alias)
    }

    // ---- Collections: match by name ----
    const existingCols = db.prepare('SELECT id, name FROM collections').all() as Array<{ id: string; name: string }>
    const colNameToId = new Map(existingCols.map((c) => [c.name, c.id]))
    const oldColToNew = new Map<string, string>()
    for (const c of (data.collections || []) as Array<any>) {
      const finalId = colNameToId.has(c.name) ? (colNameToId.get(c.name) as string) : uuidv4()
      if (!colNameToId.has(c.name)) {
        colNameToId.set(c.name, finalId)
        db.prepare(
          'INSERT OR IGNORE INTO collections (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(finalId, c.name, c.description ?? null, c.color ?? null, c.created_at ?? now(), c.updated_at ?? now())
      }
      oldColToNew.set(c.id, finalId)
    }

    // ---- collection_sounds (remap) ----
    const csInsert = db.prepare(
      'INSERT OR IGNORE INTO collection_sounds (collection_id, sound_id, sort_order, added_at) VALUES (?, ?, ?, ?)'
    )
    for (const cs of (data.collection_sounds || []) as Array<any>) {
      const cid = oldColToNew.get(cs.collection_id)
      const sid = oldSoundToNew.get(cs.sound_id)
      if (!cid || !sid) continue
      csInsert.run(cid, sid, cs.sort_order ?? 0, cs.added_at ?? now())
    }

    // ---- smart_folders: match by name ----
    const existingSF = db.prepare('SELECT id, name FROM smart_folders').all() as Array<{ id: string; name: string }>
    const sfNameToId = new Map(existingSF.map((c) => [c.name, c.id]))
    for (const sf of (data.smart_folders || []) as Array<any>) {
      if (sfNameToId.has(sf.name)) {
        db.prepare('UPDATE smart_folders SET conditions = ?, updated_at = ? WHERE id = ?').run(
          sf.conditions,
          now(),
          sfNameToId.get(sf.name) as string
        )
      } else {
        db.prepare(
          'INSERT OR IGNORE INTO smart_folders (id, name, conditions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), sf.name, sf.conditions, now(), now())
      }
    }

    // ---- keep FTS index in sync (if available) ----
    try {
      db.prepare(`INSERT INTO sounds_fts(sounds_fts) VALUES('rebuild')`).run()
    } catch {
      /* FTS5 not available */
    }

    return {
      success: true,
      imported,
      tags: (data.tags || []).length,
      collections: (data.collections || []).length
    }
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

  // ---- Smart Folder 条件求值 ----
  // 支持字段：文件名/AI描述/情绪/适用场景/格式/时长/质量评分/
  //            收藏/缺失/未分析/导入时间/标签
  type SFCondition = { field: string; op: string; value: string }
  type SFGroup = { logic: 'AND' | 'OR'; conditions: SFCondition[] }

  function buildConditionSql(c: SFCondition): { sql: string; params: any[] } {
    const value = (c.value ?? '').toString().trim()

    // 标签：关联 sound_tags / tags 表
    if (c.field === 'tags') {
      const like = `%${value}%`
      if (c.op === 'not_contains') {
        return { sql: `NOT EXISTS (SELECT 1 FROM sound_tags st JOIN tags tg ON tg.id = st.tag_id WHERE st.sound_id = s.id AND tg.name LIKE ?)`, params: [like] }
      }
      return { sql: `EXISTS (SELECT 1 FROM sound_tags st JOIN tags tg ON tg.id = st.tag_id WHERE st.sound_id = s.id AND tg.name LIKE ?)`, params: [like] }
    }

    // 布尔字段：收藏 / 缺失
    if (c.field === 'is_starred' || c.field === 'is_missing') {
      const col = c.field === 'is_starred' ? 's.is_starred' : 's.is_missing'
      const want = (value === 'false' || value === '0' || value === '否') ? 0 : 1
      return { sql: `${col} = ?`, params: [want] }
    }

    // 分析状态：未分析 = ai_analyzed_at IS NULL
    if (c.field === 'ai_analyzed_at') {
      const isNull = !(value === 'analyzed' || value === '是' || value === '1' || value === 'true')
      return isNull
        ? { sql: `s.ai_analyzed_at IS NULL`, params: [] }
        : { sql: `s.ai_analyzed_at IS NOT NULL`, params: [] }
    }

    // 导入时间：值填天数 N（lt = 最近 N 天内；gt = N 天以前）
    if (c.field === 'imported_at') {
      const n = parseFloat(value)
      if (!isNaN(n)) {
        if (c.op === 'gt') return { sql: `julianday(s.imported_at) < julianday('now') - ?`, params: [n] }
        return { sql: `julianday(s.imported_at) > julianday('now') - ?`, params: [n] }
      }
    }

    const colMap: Record<string, string> = {
      file_name: 's.file_name', description: 's.description', emotion: 's.emotion',
      use_cases: 's.use_cases', file_ext: 's.file_ext',
      duration_ms: 'CAST(s.duration_ms AS REAL)', quality_score: 'CAST(s.quality_score AS REAL)'
    }
    const col = colMap[c.field]
    if (!col) return { sql: '', params: [] }

    switch (c.op) {
      case 'not_contains':
        return { sql: `(${col} IS NULL OR ${col} NOT LIKE ?)`, params: [`%${value}%`] }
      case 'equals':
        return { sql: `${col} = ?`, params: [value] }
      case 'starts_with':
        return { sql: `${col} LIKE ?`, params: [`${value}%`] }
      case 'gt': {
        const num = parseFloat(value)
        return isNaN(num) ? { sql: '', params: [] } : { sql: `${col} > ?`, params: [num] }
      }
      case 'lt': {
        const num = parseFloat(value)
        return isNaN(num) ? { sql: '', params: [] } : { sql: `${col} < ?`, params: [num] }
      }
      case 'is':
        return { sql: `(${col} IS NOT NULL AND ${col} <> '')`, params: [] }
      case 'contains':
      default:
        return { sql: `${col} LIKE ?`, params: [`%${value}%`] }
    }
  }

  function buildSmartWhere(groups: SFGroup[]): { where: string; params: any[] } {
    if (!groups || groups.length === 0) return { where: '', params: [] }
    const groupFrags: string[] = []
    const params: any[] = []
    for (const g of groups) {
      if (!g.conditions || g.conditions.length === 0) continue
      const condFrags: string[] = []
      for (const c of g.conditions) {
        const built = buildConditionSql(c)
        if (built.sql) { condFrags.push(built.sql); params.push(...built.params) }
      }
      if (condFrags.length === 0) continue
      const joiner = g.logic === 'OR' ? ' OR ' : ' AND '
      groupFrags.push(`(${condFrags.join(joiner)})`)
    }
    if (groupFrags.length === 0) return { where: '', params: [] }
    return { where: `WHERE ${groupFrags.join(' AND ')}`, params }
  }

  function runSmartFolderQuery(conditionsJson: string): any[] {
    let groups: SFGroup[] = []
    try { groups = JSON.parse(conditionsJson) } catch { groups = [] }
    const { where, params } = buildSmartWhere(groups)
    const sql = `
      SELECT s.*,
        (SELECT GROUP_CONCAT(t.name, ',')
         FROM tags t
         JOIN sound_tags st ON t.id = st.tag_id
         WHERE st.sound_id = s.id) AS tags
      FROM sounds s
      ${where}
      ORDER BY s.imported_at DESC
    `
    return db.prepare(sql).all(...params)
  }

  // 按已保存的智能文件夹取数
  ipcMain.handle('smartFolder:getSounds', (_event, folderId: string) => {
    const folder = db.prepare('SELECT * FROM smart_folders WHERE id = ?').get(folderId) as
      { id: string; conditions: string } | undefined
    if (!folder) return []
    try {
      return runSmartFolderQuery(folder.conditions)
    } catch {
      return []
    }
  })

  // 实时预览：直接传 conditions JSON 返回匹配音效
  ipcMain.handle('smartFolder:preview', (_event, conditionsJson: string) => {
    try {
      return runSmartFolderQuery(conditionsJson)
    } catch {
      return []
    }
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

  // Window Controls (frameless mode)
  ipcMain.handle('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  ipcMain.handle('window:maximizeRestore', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })
  ipcMain.handle('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  console.log('[IPC] All handlers registered')
}
