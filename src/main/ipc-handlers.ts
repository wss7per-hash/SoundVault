import { ipcMain, dialog, app, shell, BrowserWindow, Menu } from 'electron'
import { readdir, stat, readFile, writeFile, copyFile, rename, mkdir, access, rm, unlink } from 'fs/promises'
import { execFile, execSync } from 'child_process'
import { tmpdir } from 'os'
// @ts-ignore - ffmpeg-static 无类型声明，但运行期返回二进制路径字符串
import ffmpegPath from 'ffmpeg-static'
import { existsSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'fs'
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
import {
  generateSFX,
  checkBalance,
  cancelGeneration,
  registerGeneration,
  unregisterGeneration,
  GEN_COST_USD,
  type GenProvider
} from './sfx-generator'

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
  extFilters?: string[]   // 可选：仅扫描指定扩展名
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

// ── 一键导入 After Effects（2019+）─────────────────────────────
// 机制：写一个临时 .jsx 脚本，用 afterfx.exe -r 在「正在运行的 AE 实例」里执行
// importFile()，再把结果（导入后的素材名 / 错误）写回临时 .js 让 Node 读回。
// 前提：AE 需开启「编辑 > 首选项 > 脚本和表达式 > 允许脚本写入文件和访问网络」。

function findAEDir(): string | null {
  const roots = [
    'C:\\Program Files\\Adobe',
    'D:\\Program Files\\Adobe',
    'C:\\Program Files (x86)\\Adobe',
    'E:\\Program Files\\Adobe'
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    let subs: string[] = []
    try { subs = readdirSync(root) } catch { continue }
    const hit = subs.find((s) => s.includes('Adobe After Effects'))
    if (hit) return join(root, hit)
  }
  return null
}

function execFileAsync(cmd: string, args: string[], opts: any): Promise<void> {
  return new Promise((resolve) => {
    // afterfx.exe -r 即使脚本成功，进程退出码也常非 0，这里忽略错误只等其结束
    execFile(cmd, args, opts, () => resolve())
  })
}

// 检测 After Effects 主程序（GUI 进程 AfterFX.exe）是否正在运行。
// 仅当 AE 已打开时才允许 afterfx.exe -r 注入脚本，避免误拉起一个后台 AE 实例。
function isAeRunning(): boolean {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq AfterFX.exe"', {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    })
    return /AfterFX\.exe/i.test(out)
  } catch {
    return false
  }
}

// filePaths 支持一次传入多个音效（右键多选批量导入）。
async function importToAE(filePaths: string[]): Promise<{ success: boolean; name?: string; message?: string; code?: string; count?: number }> {
  const aeDir = findAEDir()
  if (!aeDir) {
    return { success: false, message: '未找到 After Effects，请确认已安装（默认位于 C:\\Program Files\\Adobe）' }
  }
  const supportDir = join(aeDir, 'Support Files')
  const afterfx = join(supportDir, 'afterfx.exe')
  if (!existsSync(afterfx)) {
    return { success: false, message: '未找到 afterfx.exe（AE 安装可能不完整）' }
  }

  // 若 AE 未运行，不自动拉起 AE，给出友好提示（afterfx.exe -r 会在无实例时自启一个后台 AE）
  if (!isAeRunning()) {
    return {
      success: false,
      code: 'AE_CLOSED',
      message: 'After Effects 当前未运行，请先打开 AE 后再执行「导出到 AE 工程」。'
    }
  }

  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const resultPath = join(tmpdir(), `ae-result-${uid}.js`)
  const jsxPath = join(tmpdir(), `ae-cmd-${uid}.jsx`)

  // filePaths 经 JSON.stringify 正确转义为 JS 数组字面量，支持一次导入多个音效
  const arr = JSON.stringify(filePaths)
  const rp = JSON.stringify(resultPath)

  const jsx = [
    'app.beginSuppressDialogs();',
    'var __files = ' + arr + ';',
    'var __ok = 0;',
    'var __names = [];',
    'for (var __i = 0; __i < __files.length; __i++) {',
    '  try {',
    '    var __io = new ImportOptions(File(__files[__i]));',
    '    var __it = app.project.importFile(__io);',
    '    __ok++;',
    '    if (__it) __names.push(__it.name);',
    '  } catch (e) {',
    '    if (!__names.length) __names.push("ERROR:" + (e && e.toString ? e.toString() : String(e)));',
    '  }',
    '}',
    'var __r = __ok + "|" + (__names[0] || "");',
    'app.endSuppressDialogs(false);',
    '(function(){',
    '  var f = new File(' + rp + ');',
    '  f.open("w");',
    '  f.write("module.exports = " + ({ returned: __r }).toSource());',
    '  f.close();',
    '})();'
  ].join('\n')

  try {
    writeFileSync(jsxPath, jsx, 'utf-8')
  } catch (err) {
    return { success: false, message: '写入临时脚本失败：' + (err as Error).message }
  }

  await execFileAsync('afterfx.exe', ['-r', jsxPath], {
    cwd: supportDir,
    windowsHide: true,
    timeout: 25000
  })

  // AE 在运行实例里异步执行脚本并写回结果，轮询读取（避免竞态）
  let result: any = null
  for (let i = 0; i < 30; i++) {
    if (existsSync(resultPath)) {
      try { result = require(resultPath); break } catch { /* 文件未写完，重试 */ }
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  // 清理临时文件
  try { unlinkSync(jsxPath) } catch { /* ignore */ }
  try { unlinkSync(resultPath) } catch { /* ignore */ }

  if (!result) {
    return {
      success: false,
      message:
        'AE 未返回结果。请确认：① AE 正在运行；② 已勾选「编辑 > 首选项 > 脚本和表达式 > 允许脚本写入文件和访问网络」'
    }
  }
  const parts = String(result.returned).split('|')
  const ok = parseInt(parts[0], 10) || 0
  const firstName = parts[1] || ''
  if (ok === 0) {
    return { success: false, message: firstName ? firstName.replace(/^ERROR:/, '') : '导入失败，请确认文件格式受 AE 支持' }
  }
  return { success: true, name: firstName, count: ok }
}

// ── 一键导入到其它剪辑软件（Pr / FCP / DaVinci），与 AE 完全一致 ──
// 机制：检测对应软件进程是否在运行；在则把音频 importFile 进「正在打开的工程」，
// 否则提示先打开该软件。FCP 仅 macOS 可用；DaVinci 需开启外部脚本。
// 这套逻辑与 importToAE 同源：Adobe 系走 ExtendScript 注入。

type NleKey = 'pr' | 'fcp' | 'resolve'

interface NleMeta {
  key: NleKey
  appName: string // 提示用软件名
  process: string // tasklist 进程名
  dirPattern: string // 安装目录匹配
  exeName: string // 主程序 exe
}

const NLE_LIST: NleMeta[] = [
  { key: 'pr', appName: 'Premiere Pro', process: 'Premiere Pro.exe', dirPattern: 'Adobe Premiere Pro', exeName: 'Adobe Premiere Pro.exe' },
  { key: 'fcp', appName: 'Final Cut Pro', process: 'Final Cut Pro.exe', dirPattern: 'Final Cut Pro', exeName: 'Final Cut Pro.exe' },
  { key: 'resolve', appName: 'DaVinci Resolve', process: 'Resolve.exe', dirPattern: 'DaVinci Resolve', exeName: 'Resolve.exe' }
]

function findNleDir(pattern: string): string | null {
  const roots = [
    'C:\\Program Files\\Adobe',
    'D:\\Program Files\\Adobe',
    'C:\\Program Files (x86)\\Adobe',
    'E:\\Program Files\\Adobe',
    'C:\\Program Files\\Blackmagic Design',
    'D:\\Program Files\\Blackmagic Design',
    'C:\\Program Files',
    'D:\\Program Files',
    'C:\\Program Files (x86)',
    'E:\\Program Files'
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    let subs: string[] = []
    try { subs = readdirSync(root) } catch { continue }
    const hit = subs.find((s) => s.includes(pattern))
    if (hit) return join(root, hit)
  }
  return null
}

function isProcessRunning(processName: string): boolean {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${processName}"`, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    })
    const escaped = processName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, 'i').test(out)
  } catch {
    return false
  }
}

async function importToPremiere(
  filePaths: string[],
  meta: NleMeta
): Promise<{ success: boolean; name?: string; message?: string; code?: string; count?: number }> {
  const dir = findNleDir(meta.dirPattern)
  if (!dir) return { success: false, message: `未找到 ${meta.appName}，请确认已安装。` }
  const exe = join(dir, meta.exeName)
  if (!existsSync(exe)) {
    return { success: false, message: `未找到 ${meta.exeName}（${meta.appName} 安装可能不完整）` }
  }

  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const resultPath = join(tmpdir(), `pr-result-${uid}.js`)
  const jsxPath = join(tmpdir(), `pr-cmd-${uid}.jsx`)
  const arr = JSON.stringify(filePaths)
  const rp = JSON.stringify(resultPath)

  const jsx = [
    'var __files = ' + arr + ';',
    'var __items;',
    'try {',
    '  __items = app.project.importFiles(__files, true, app.project.rootItem, false);',
    '} catch (e) {',
    '  __items = null;',
    '}',
    'var __cnt = (__items && __items.length) ? __items.length : 0;',
    'var __fn = (__items && __items[0]) ? __items[0].name : "";',
    'var __r = __cnt + "|" + __fn;',
    '(function(){',
    '  var f = new File(' + rp + ');',
    '  f.open("w");',
    '  f.write("module.exports = " + ({ returned: __r }).toSource());',
    '  f.close();',
    '})();'
  ].join('\n')

  try {
    writeFileSync(jsxPath, jsx, 'utf-8')
  } catch (err) {
    return { success: false, message: '写入临时脚本失败：' + (err as Error).message }
  }

  await execFileAsync(exe, ['-r', jsxPath], { cwd: dir, windowsHide: true, timeout: 25000 })

  let result: any = null
  for (let i = 0; i < 30; i++) {
    if (existsSync(resultPath)) {
      try { result = require(resultPath); break } catch { /* 文件未写完，重试 */ }
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  try { unlinkSync(jsxPath) } catch { /* ignore */ }
  try { unlinkSync(resultPath) } catch { /* ignore */ }

  if (!result) {
    return {
      success: false,
      message:
        `${meta.appName} 未返回结果。请确认：① ${meta.appName} 正在运行；② 已允许脚本写入文件（Premiere：编辑 > 首选项 > 脚本）`
    }
  }
  const parts = String(result.returned).split('|')
  const count = parseInt(parts[0], 10) || 0
  const firstName = parts[1] || ''
  if (count === 0) {
    return { success: false, message: `${meta.appName} 未能导入文件，请确认文件格式受支持且工程可写` }
  }
  return { success: true, name: firstName, count }
}

async function importToNLE(
  nle: NleKey,
  filePaths: string[]
): Promise<{ success: boolean; name?: string; message?: string; code?: string; count?: number }> {
  const meta = NLE_LIST.find((m) => m.key === nle)
  if (!meta) return { success: false, message: '未知剪辑软件' }

  // 第一步：检测软件是否在运行（与 AE 一致，不自动拉起）
  if (!isProcessRunning(meta.process)) {
    return {
      success: false,
      code: 'APP_CLOSED',
      message: `${meta.appName} 当前未运行，请先打开 ${meta.appName} 后再执行「导出到 ${meta.appName} 工程」。`
    }
  }

  if (nle === 'pr') {
    return importToPremiere(filePaths, meta)
  }
  if (nle === 'fcp') {
    // Final Cut Pro 仅 macOS 可用；Windows 上进程永远不可能在运行，上面已拦截。
    // 若将来在 macOS 运行，应使用 FCPXML / AppleScript 注入，此处留作后续。
    return {
      success: false,
      code: 'UNSUPPORTED',
      message: 'Final Cut Pro 仅在 macOS 上可用，当前系统（Windows）无法导入。'
    }
  }
  // resolve：需开启外部脚本
  return {
    success: false,
    code: 'SETUP_REQUIRED',
    message:
      'DaVinci Resolve 需先在「偏好设置 > 系统 > 常规」开启「外部脚本」，SoundVault 才能导入当前工程。'
  }
}

export function registerIpcHandlers(): void {
  const db = getDatabase()

  // ---- Undo stack (in-memory, per session) ----
  // 每个可撤销操作 push 一个 { label, undo() } 快照；Ctrl+Z 弹栈顶执行。
  // 覆盖：合并标签 / 删标签 / 删音效（软删）。关闭软件即清空。
  interface UndoEntry {
    label: string
    timestamp: number
    undo: () => void
  }
  const undoStack: UndoEntry[] = []
  const MAX_UNDO = 50
  const pushUndo = (label: string, undo: () => void): void => {
    undoStack.push({ label, timestamp: Date.now(), undo })
    if (undoStack.length > MAX_UNDO) undoStack.shift()
  }

  // 栈顶描述 + 剩余可撤销数，供工具栏按钮/快捷键提示显示
  ipcMain.handle('undo:peek', () => {
    if (undoStack.length === 0) return null
    const top = undoStack[undoStack.length - 1]
    return { label: top.label, count: undoStack.length }
  })

  // 执行一次撤销：弹栈顶并回滚
  ipcMain.handle('undo:perform', () => {
    const entry = undoStack.pop()
    if (!entry) return { success: false, label: null, count: 0 }
    try {
      entry.undo()
      return { success: true, label: entry.label, count: undoStack.length }
    } catch (err) {
      return { success: false, label: entry.label, count: undoStack.length, error: (err as Error).message }
    }
  })

  ipcMain.handle('undo:clear', () => {
    undoStack.length = 0
    return { success: true }
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())

  // 从渲染进程发起系统级文件拖拽：把音频作为真实文件拖出，
  // 丢进 After Effects（2019+）等外部应用即直接导入该工程。
  // icon：dev 用项目 resources/icon.png；prod 用 resources 目录；
  // 都不存在则省略（Windows 回退到文件类型默认图标），不影响功能。
  ipcMain.on('app:dragFile', (event, filePath: string) => {
    try {
      const iconPath = app.isPackaged
        ? join(process.resourcesPath, 'icon.png')
        : join(app.getAppPath(), 'resources', 'icon.png')
      const icon = existsSync(iconPath) ? iconPath : undefined
      event.sender.startDrag({ file: filePath, icon })
    } catch (err) {
      console.error('[dragFile] startDrag failed:', err)
    }
  })

  // 一键把音频导入正在运行的 After Effects 工程（通过官方 ExtendScript importFile），支持批量
  ipcMain.handle('app:importToAE', async (_event, filePaths: string[]) => {
    return importToAE(filePaths)
  })

  // 一键把音频导入正在运行的剪辑软件工程（Pr / FCP / DaVinci），与 AE 一致，支持批量
  ipcMain.handle('app:importToNLE', async (_event, nle: NleKey, filePaths: string[]) => {
    return importToNLE(nle, filePaths)
  })

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

            // 扩展名白名单过滤（用户在 UI 勾选的格式）
            if (options.extFilters && options.extFilters.length > 0) {
              if (!options.extFilters.includes(ext)) continue
            }

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

            // 始终获取时长（用于预览展示 + 可选的时间过滤）
            let fileDurationMs: number | undefined
            try {
                const dur = await getDurationFromFile(fullPath)
                fileDurationMs = Math.round(dur * 1000)
                const minSec = options.minDurationSec ?? 0
                const maxSec = options.maxDurationSec ?? 0
                if (minSec > 0 || maxSec > 0) {
                  const durSec = dur
                  if (minSec > 0 && durSec < minSec) continue
                  if (maxSec > 0 && durSec > maxSec) continue
                }
              } catch {
                // ffprobe 失败：有时长过滤条件时跳过该文件，否则忽略（durationMs 留 undefined）
                const minSec = options.minDurationSec ?? 0
                const maxSec = options.maxDurationSec ?? 0
                if (minSec > 0 || maxSec > 0) continue
              }

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
              size: fileStat.size,
              durationMs: fileDurationMs
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

  // ── 拖放导入（文件 / 文件夹）：递归收集音频并入库 ──
  ipcMain.handle('library:importPaths', async (_event, paths: string[]) => {
    const collected: Array<{ path: string; name: string; ext: string; size: number }> = []

    function walk(p: string): void {
      let st: ReturnType<typeof statSync>
      try { st = statSync(p) } catch { return }
      if (st.isDirectory()) {
        let entries: Dirent[]
        try { entries = readdirSync(p, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue
          walk(join(p, e.name))
        }
      } else if (st.isFile()) {
        const ext = extname(p).toLowerCase()
        if (!AUDIO_EXTENSIONS.has(ext)) return
        collected.push({ path: p, name: basename(p), ext, size: st.size })
      }
    }

    for (const p of paths) walk(p)

    const seen = new Set<string>()
    const uniq = collected.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)))

    const now = new Date().toISOString()
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO sounds (id, file_path, file_hash, file_name, file_ext, file_size, imported_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let imported = 0
    for (const f of uniq) {
      const buffer = await readFile(f.path, { length: 64 * 1024 })
      const hash = createHash('sha256').update(buffer).digest('hex')
      const id = uuidv4()
      const result = insertStmt.run(id, f.path, hash, f.name, f.ext, f.size, now, now)
      if (result.changes > 0) imported++
    }
    return { imported, total: uniq.length }
  })

  ipcMain.handle('sound:getAll', (_event, opts?: { sortBy?: string; sortOrder?: 'asc' | 'desc'; format?: string }) => {
    // 排序/过滤下沉到 SQL，避免渲染端对全量数组 JS 排序（规模化关键）
    const sortCol: Record<string, string> = {
      name: 's.file_name COLLATE NOCASE',
      duration: 's.duration_ms',
      size: 's.file_size',
      date: 's.imported_at'
    }
    const orderBy = opts?.sortBy && sortCol[opts.sortBy] ? sortCol[opts.sortBy] : 's.imported_at'
    const orderDir = opts?.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const params: unknown[] = []
    let where = 'WHERE (s.is_trashed = 0 OR s.is_trashed IS NULL)'
    if (opts?.format) {
      where += " AND LOWER(REPLACE(s.file_ext, '.', '')) = LOWER(REPLACE(?, '.', ''))"
      params.push(opts.format)
    }
    const sql = `
      SELECT s.*,
        (SELECT GROUP_CONCAT(t.name, ',')
         FROM tags t
         JOIN sound_tags st ON t.id = st.tag_id
         WHERE st.sound_id = s.id) AS tags
      FROM sounds s
      ${where}
      ORDER BY ${orderBy} ${orderDir}
    `
    console.log('[sound:getAll] opts=', opts, 'sql=', sql, 'params=', params)
    const rows = db.prepare(sql).all(...params)
    console.log('[sound:getAll] returned', rows.length, 'rows')
    return rows
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
      WHERE s.is_starred = 1 AND (s.is_trashed = 0 OR s.is_trashed IS NULL)
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
        WHERE s.is_trashed = 0 OR s.is_trashed IS NULL
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
      WHERE (
          s.file_name LIKE ? OR s.description LIKE ? OR s.emotion LIKE ?
          OR s.notes LIKE ? OR s.search_text LIKE ? OR s.best_for LIKE ?
          OR EXISTS (
            SELECT 1 FROM sound_tags st2
            JOIN tags t2 ON t2.id = st2.tag_id
            WHERE st2.sound_id = s.id AND t2.name LIKE ?
          )
        )
        AND (s.is_trashed = 0 OR s.is_trashed IS NULL)
      ORDER BY s.imported_at DESC
    `).all(like, like, like, like, like, like, like)
  })

  // ── 相似音频推荐：以音搜音（标签 0.7 + 文本 0.3 加权相似度）──
  // 不用 SQLite || 拼接 / GROUP_CONCAT（better-sqlite3 默认 || 是加法），
  // 改为两次查询 + JS 分组，规避编译歧义。
  ipcMain.handle('sound:similar', (_event, soundId: string) => {
    const target = db.prepare(`
      SELECT id, file_name, use_cases, emotion
      FROM sounds WHERE id = ?
    `).get(soundId) as any
    if (!target) return []

    // 目标音效的标签（name -> confidence）
    const myTagRows = db.prepare(`
      SELECT t.name, st.confidence
      FROM sound_tags st JOIN tags t ON t.id = st.tag_id
      WHERE st.sound_id = ?
    `).all(soundId) as Array<{ name: string; confidence: number }>
    const myTags = new Map<string, number>()
    for (const r of myTagRows) myTags.set(r.name, r.confidence ?? 0.8)
    const myTagSum = [...myTags.values()].reduce((a, b) => a + b, 0)

    // 目标文本 token（使用场景词 + 情绪）
    const myText = new Set<string>()
    if (target.use_cases) target.use_cases.split(/[,;，；、]/).forEach((w: string) => { const t = w.trim(); if (t) myText.add(t) })
    if (target.emotion) myText.add(String(target.emotion).trim())

    // 候选（排除自身 / 已删除 / 缺失）
    const cands = db.prepare(`
      SELECT id, file_name, use_cases, emotion
      FROM sounds
      WHERE id <> ?
        AND (is_trashed = 0 OR is_trashed IS NULL)
        AND (is_missing = 0 OR is_missing IS NULL)
    `).all(soundId) as Array<{ id: string; file_name: string; use_cases: string | null; emotion: string | null }>

    // 候选标签一次聚合（JS 分组）
    const candTagRows = db.prepare(`
      SELECT st.sound_id, t.name, st.confidence
      FROM sound_tags st JOIN tags t ON t.id = st.tag_id
      WHERE st.sound_id <> ?
    `).all(soundId) as Array<{ sound_id: string; name: string; confidence: number }>
    const candTags = new Map<string, Map<string, number>>()
    for (const r of candTagRows) {
      if (!candTags.has(r.sound_id)) candTags.set(r.sound_id, new Map())
      candTags.get(r.sound_id)!.set(r.name, r.confidence ?? 0.8)
    }

    const out: Array<{ id: string; file_name: string; score: number; reasons: string[] }> = []
    for (const c of cands) {
      // 标签相似度：加权 Jaccard（min-pool）
      const cTags = candTags.get(c.id) || new Map<string, number>()
      let shared = 0
      for (const [name, conf] of myTags) {
        const oc = cTags.get(name)
        if (oc !== undefined) shared += Math.min(conf, oc)
      }
      const cTagSum = [...cTags.values()].reduce((a, b) => a + b, 0)
      const union = myTagSum + cTagSum - shared
      const simTags = union > 0 ? shared / union : 0

      // 文本相似度：使用场景词 + 情绪重叠 / 目标词数
      const cText = new Set<string>()
      if (c.use_cases) c.use_cases.split(/[,;，；、]/).forEach((w: string) => { const t = w.trim(); if (t) cText.add(t) })
      if (c.emotion) cText.add(String(c.emotion).trim())
      let textShared = 0
      for (const t of myText) if (cText.has(t)) textShared++
      const simText = myText.size > 0 ? textShared / myText.size : 0

      const score = 0.7 * simTags + 0.3 * simText
      if (score <= 0.08) continue

      // 匹配原因
      const reasons: string[] = []
      let n = 0
      for (const [name] of myTags) {
        if (cTags.has(name) && n < 3) { reasons.push(`标签「${name}」`); n++ }
      }
      if (textShared > 0) reasons.push('使用场景相近')
      out.push({ id: c.id, file_name: c.file_name, score, reasons })
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, 8)
  })

  ipcMain.handle('sound:getStats', () => {
    // 所有统计均排除回收站中的音效，保持与库中可见数量一致
    const notTrashed = 'is_trashed = 0 OR is_trashed IS NULL'
    const total = (db.prepare(`SELECT COUNT(*) as c FROM sounds WHERE ${notTrashed}`).get() as { c: number }).c
    const starred = (db.prepare(`SELECT COUNT(*) as c FROM sounds WHERE ${notTrashed} AND is_starred = 1`).get() as { c: number }).c
    const missing = (db.prepare(`SELECT COUNT(*) as c FROM sounds WHERE ${notTrashed} AND is_missing = 1`).get() as { c: number }).c
    const totalSize = (db.prepare(`SELECT COALESCE(SUM(file_size), 0) as t FROM sounds WHERE ${notTrashed}`).get() as { t: number }).t
    const totalDurationMs = (db.prepare(`SELECT COALESCE(SUM(duration_ms), 0) as t FROM sounds WHERE ${notTrashed}`).get() as { t: number }).t
    const analyzed = (db.prepare(`SELECT COUNT(*) as c FROM sounds WHERE ${notTrashed} AND ai_analyzed_at IS NOT NULL AND ai_analyzed_at != ''`).get() as { c: number }).c
    const avgQuality = (db.prepare(`SELECT AVG(quality_score) as a FROM sounds WHERE ${notTrashed} AND quality_score IS NOT NULL`).get() as { a: number | null }).a
    const tagCount = (db.prepare('SELECT COUNT(*) as c FROM tags').get() as { c: number }).c
    const taggedSounds = (db.prepare(`SELECT COUNT(DISTINCT st.sound_id) as c FROM sound_tags st JOIN sounds s ON st.sound_id = s.id WHERE s.${notTrashed}`).get() as { c: number }).c
    const withOno = (db.prepare(`SELECT COUNT(*) as c FROM sounds WHERE ${notTrashed} AND onomatopoeia IS NOT NULL AND onomatopoeia != '' AND onomatopoeia != '[]'`).get() as { c: number }).c

    // 按 file_ext 分组后归桶：wav / mp3 / flac / other
    const extRows = db.prepare(`SELECT file_ext as ext, COUNT(*) as c FROM sounds WHERE ${notTrashed} GROUP BY file_ext`).all() as Array<{ ext: string; c: number }>
    const byExt = { wav: 0, mp3: 0, flac: 0, other: 0 }
    for (const r of extRows) {
      const e = (r.ext || '').toLowerCase().replace(/^\./, '')
      if (e === 'wav' || e === 'wave') byExt.wav += r.c
      else if (e === 'mp3') byExt.mp3 += r.c
      else if (e === 'flac') byExt.flac += r.c
      else byExt.other += r.c
    }

    const unanalyzed = Math.max(0, total - analyzed)
    return {
      total,
      starred,
      missing,
      totalSize,
      totalDurationMs,
      analyzed,
      unanalyzed,
      byExt,
      avgQuality: avgQuality === null ? null : Math.round(avgQuality * 10) / 10,
      tagCount,
      taggedSounds,
      withOnomatopoeia: withOno
    }
  })

  // 清理无效文件：扫描所有音效，检测本地音频是否仍存在
  // mode='scan'  仅更新 is_missing 标记并返回统计（不删记录）
  // mode='remove' 标记并把确实缺失的条目从库中永久删除（含关联标签/收藏，FK 级联）
  ipcMain.handle('sound:cleanupMissing', async (_event, mode: 'scan' | 'remove') => {
    try {
      const all = db.prepare(
        "SELECT id, file_path FROM sounds WHERE is_trashed = 0 OR is_trashed IS NULL"
      ).all() as Array<{ id: string; file_path: string }>
      const missingIds: string[] = []
      for (const r of all) {
        let exists = false
        try { await access(r.file_path); exists = true } catch { exists = false }
        const flag = exists ? 0 : 1
        db.prepare('UPDATE sounds SET is_missing = ? WHERE id = ?').run(flag, r.id)
        if (!exists) missingIds.push(r.id)
      }
      if (mode === 'remove' && missingIds.length > 0) {
        const placeholders = missingIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM sounds WHERE id IN (${placeholders})`).run(...missingIds)
      }
      const total = (db.prepare(
        "SELECT COUNT(*) as c FROM sounds WHERE is_trashed = 0 OR is_trashed IS NULL"
      ).get() as { c: number }).c
      return {
        success: true,
        total,
        missing: missingIds.length,
        removed: mode === 'remove' ? missingIds.length : 0
      }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
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
          ai_model = ?, onomatopoeia = ?, ai_analyzed_at = ?, updated_at = ?
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
        JSON.stringify(result.onomatopoeia || []),
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
      const onoWords = (result.onomatopoeia || []).map((o) => o.zh).filter(Boolean)
      const ftsText = [
        sound.file_name,
        result.description,
        result.detailedDescription,
        result.scenario,
        result.emotion,
        ...result.tags.map((t) => t.name),
        ...onoWords
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

  // ---- 云端音效生成（Fal.ai / ElevenLabs）：调 API → 落盘 → 自动入库 ----
  ipcMain.handle(
    'ai:generateSFX',
    async (
      _event,
      opts: {
        token: string
        provider: GenProvider
        apiKey: string
        prompt: string
        durationSeconds?: number
        guidanceScale?: number
        seed?: number
      }
    ) => {
      const controller = new AbortController()
      registerGeneration(opts.token, controller)
      const tmpDir = app.getPath('temp')
      try {
        const gen = await generateSFX(
          {
            provider: opts.provider,
            apiKey: opts.apiKey,
            prompt: opts.prompt,
            durationSeconds: opts.durationSeconds,
            guidanceScale: opts.guidanceScale,
            seed: opts.seed
          },
          controller.signal
        )

        // 落盘到 userData/generated（不污染用户素材目录）
        const genDir = join(app.getPath('userData'), 'generated')
        await mkdir(genDir, { recursive: true })
        const tmpPath = join(tmpDir, `sv_gen_${Date.now()}.tmp`)
        await writeFile(tmpPath, gen.buffer)
        const ext = (gen.fileName.split('.').pop() || (gen.contentType.includes('wav') ? 'wav' : 'mp3'))
          .toLowerCase()
        const outName = `sfx_${Date.now()}.${ext}`
        const outPath = join(genDir, outName)
        await safeMove(tmpPath, outPath)

        const outStat = await stat(outPath)
        const buf = await readFile(outPath, { length: 64 * 1024 })
        const hash = createHash('sha256').update(buf).digest('hex')
        const now = new Date().toISOString()
        const newId = uuidv4()
        let durationMs = 0
        try {
          durationMs = Math.round((await getDurationFromFile(outPath)) * 1000)
        } catch {
          durationMs = 0
        }
        const promptText = (opts.prompt || '').trim().slice(0, 200)
        const existing = db.prepare('SELECT id FROM sounds WHERE file_hash = ?').get(hash) as
          | { id: string }
          | undefined
        const targetId = existing?.id || newId
        if (!existing) {
          db.prepare(`
            INSERT OR IGNORE INTO sounds (
              id, file_path, file_hash, file_name, file_ext, file_size, duration_ms,
              description, description_en, ai_model, ai_analyzed_at,
              is_missing, is_trashed, imported_at, updated_at, preview_cache, search_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
          `).run(
            newId,
            outPath,
            hash,
            outName,
            `.${ext}`,
            outStat.size,
            durationMs,
            promptText,
            null,
            `${opts.provider}:sound-generation`,
            now,
            now,
            now,
            null,
            `AI生成 ${promptText}`
          )
          // 自动打 AI生成 标签，方便在标签树筛选
          const tagId = getOrCreateTagId('AI生成', now, null)
          db.prepare(
            'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
          ).run(newId, tagId, 1, 1)
        }

        // 累计统计（本地估算，以服务商实际扣费为准）
        const cost = GEN_COST_USD[opts.provider] ?? 0
        let stats = { count: 0, estCostUSD: 0, freeRemainingUSD: null as number | null }
        try {
          const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get('gen:stats') as
            | { value: string }
            | undefined
          if (raw) stats = { ...stats, ...JSON.parse(raw.value) }
        } catch {
          // 忽略损坏的统计
        }
        stats.count += 1
        stats.estCostUSD = Math.round((stats.estCostUSD + cost) * 100) / 100
        if (stats.freeRemainingUSD != null) {
          stats.freeRemainingUSD = Math.max(0, Math.round((stats.freeRemainingUSD - cost) * 100) / 100)
        }
        const statsJson = JSON.stringify(stats)
        db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`
        ).run('gen:stats', statsJson, now, statsJson, now)

        return {
          success: true,
          soundId: targetId,
          filePath: outPath,
          fileName: outName,
          durationMs,
          provider: opts.provider,
          cost,
          stats
        }
      } catch (err) {
        const e = err as Error
        if (e.name === 'AbortError' || /aborted|已取消/i.test(e.message)) {
          return { success: false, cancelled: true, error: '已取消' }
        }
        return { success: false, error: e.message }
      } finally {
        unregisterGeneration(opts.token)
      }
    }
  )

  // 查询账户/试用额度（Fal.ai 可读取余额；ElevenLabs 引导官网）
  ipcMain.handle('ai:getGenBalance', async (_event, provider: GenProvider, apiKey: string) => {
    return await checkBalance(provider, apiKey)
  })

  ipcMain.handle('ai:cancelGeneration', (_event, token: string) => {
    return { success: true, cancelled: cancelGeneration(token) }
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
            ai_model = ?, onomatopoeia = ?, ai_analyzed_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
          result.description, result.scenario, result.emotion,
          result.qualityScore, result.variantOf, result.detailedDescription,
          modelName, JSON.stringify(result.onomatopoeia || []), now, now, id
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
      WHERE cs.collection_id = ? AND (s.is_trashed = 0 OR s.is_trashed IS NULL)
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

  // 某标签下的音效数（供合并前显示"将迁移 N 个音效"真实计数）
  ipcMain.handle('tag:getSoundCount', (_event, tagId: string) => {
    const r = db.prepare('SELECT COUNT(*) AS c FROM sound_tags WHERE tag_id = ?').get(tagId) as { c: number }
    return r?.c || 0
  })

  // 合并标签：把 src 的所有音效关联迁移到 dst，再删除 src 标签。单条事务完成。
  // 返回真实迁移数；操作接入撤销栈（可完整回滚：重建 src 标签 + 恢复关联 + 撤掉新增到 dst 的关联）。
  ipcMain.handle('tag:merge', (_event, srcId: string, dstId: string) => {
    if (srcId === dstId) return { success: false, migrated: 0, error: '源标签与目标标签相同' }
    const srcTag = db.prepare('SELECT * FROM tags WHERE id = ?').get(srcId) as
      | { id: string; name: string; parent_id: string | null; color: string | null; icon: string | null; sort_order: number; created_at: string }
      | undefined
    const dstTag = db.prepare('SELECT id, name FROM tags WHERE id = ?').get(dstId) as { id: string; name: string } | undefined
    if (!srcTag || !dstTag) return { success: false, migrated: 0, error: '标签不存在' }

    // 回滚快照
    const srcLinks = db.prepare('SELECT sound_id, confidence, is_manual FROM sound_tags WHERE tag_id = ?').all(srcId) as
      Array<{ sound_id: string; confidence: number | null; is_manual: number }>
    const srcAliases = db.prepare('SELECT alias FROM tag_aliases WHERE tag_id = ?').all(srcId) as Array<{ alias: string }>
    const dstExisting = new Set(
      (db.prepare('SELECT sound_id FROM sound_tags WHERE tag_id = ?').all(dstId) as Array<{ sound_id: string }>).map((r) => r.sound_id)
    )
    // 迁移后"新加到 dst"的音效（原本没有 dst 的那些）——撤销时需从 dst 移除
    const newlyAddedToDst = srcLinks.map((l) => l.sound_id).filter((sid) => !dstExisting.has(sid))
    const migrated = srcLinks.length

    const tx = db.transaction(() => {
      // 能迁的迁到 dst（音效已有 dst 的会被 IGNORE 跳过，留下残留 src 行）
      db.prepare('UPDATE OR IGNORE sound_tags SET tag_id = ? WHERE tag_id = ?').run(dstId, srcId)
      // 清残留 src 关联 + 别名 + 标签本身
      db.prepare('DELETE FROM sound_tags WHERE tag_id = ?').run(srcId)
      db.prepare('DELETE FROM tag_aliases WHERE tag_id = ?').run(srcId)
      db.prepare('DELETE FROM tags WHERE id = ?').run(srcId)
    })
    tx()

    pushUndo(`合并标签「${srcTag.name}」→「${dstTag.name}」`, () => {
      const rtx = db.transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO tags (id, name, parent_id, color, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(srcTag.id, srcTag.name, srcTag.parent_id, srcTag.color, srcTag.icon, srcTag.sort_order, srcTag.created_at)
        const insLink = db.prepare('INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)')
        for (const l of srcLinks) insLink.run(l.sound_id, srcTag.id, l.confidence, l.is_manual)
        const insAlias = db.prepare('INSERT OR IGNORE INTO tag_aliases (tag_id, alias) VALUES (?, ?)')
        for (const a of srcAliases) insAlias.run(srcTag.id, a.alias)
        const delNew = db.prepare('DELETE FROM sound_tags WHERE sound_id = ? AND tag_id = ?')
        for (const sid of newlyAddedToDst) delNew.run(sid, dstId)
      })
      rtx()
    })

    return { success: true, migrated }
  })

  // ---- Metadata backup / restore (lightweight JSON, no audio copy) ----
  // 导出全库标签体系 + 每个音效的标签/备注/星标 + 收藏(collections) + 智能文件夹为 JSON。
  // 音效以 file_hash 为锚点，导入时按 hash 匹配当前库、合并叠加，不动实际音频文件。
  ipcMain.handle('metadata:export', async () => {
    try {
      const sounds = db.prepare(
        'SELECT id, file_hash, file_path, file_name, notes, is_starred FROM sounds WHERE is_trashed = 0 OR is_trashed IS NULL'
      ).all() as Array<{ id: string; file_hash: string; file_path: string; file_name: string; notes: string | null; is_starred: number }>
      const idToHash = new Map(sounds.map((s) => [s.id, s.file_hash]))
      const tags = db.prepare('SELECT * FROM tags').all() as Array<{ id: string; name: string; parent_id: string | null; color: string | null; icon: string | null }>
      const tagIdToName = new Map(tags.map((t) => [t.id, t.name]))
      const soundTags = db.prepare('SELECT sound_id, tag_id, confidence, is_manual FROM sound_tags').all() as
        Array<{ sound_id: string; tag_id: string; confidence: number | null; is_manual: number }>
      const linksBySound = new Map<string, Array<{ tag_id: string; confidence: number | null; is_manual: number }>>()
      for (const st of soundTags) {
        if (!linksBySound.has(st.sound_id)) linksBySound.set(st.sound_id, [])
        linksBySound.get(st.sound_id)!.push(st)
      }
      const collections = db.prepare('SELECT * FROM collections').all() as Array<{ id: string; name: string; description: string | null; color: string | null }>
      const collectionSounds = db.prepare('SELECT collection_id, sound_id, sort_order FROM collection_sounds').all() as
        Array<{ collection_id: string; sound_id: string; sort_order: number }>
      const smartFolders = db.prepare('SELECT name, conditions FROM smart_folders').all() as Array<{ name: string; conditions: string }>

      const soundMeta = sounds.map((s) => ({
        file_hash: s.file_hash,
        file_name: s.file_name,
        file_path: s.file_path,
        notes: s.notes || null,
        is_starred: s.is_starred ? 1 : 0,
        tags: (linksBySound.get(s.id) || [])
          .map((l) => ({ name: tagIdToName.get(l.tag_id), confidence: l.confidence, is_manual: l.is_manual }))
          .filter((t) => !!t.name)
      }))
      const cols = collections.map((c) => ({
        name: c.name,
        description: c.description,
        color: c.color,
        sounds: collectionSounds
          .filter((cs) => cs.collection_id === c.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((cs) => idToHash.get(cs.sound_id))
          .filter((h): h is string => !!h)
      }))
      const tagList = tags.map((t) => ({
        name: t.name,
        parent_name: t.parent_id ? tagIdToName.get(t.parent_id) || null : null,
        color: t.color,
        icon: t.icon
      }))

      const payload = {
        app: 'SoundVault',
        type: 'metadata-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        counts: { sounds: soundMeta.length, tags: tagList.length, collections: cols.length, smartFolders: smartFolders.length },
        tags: tagList,
        sounds: soundMeta,
        collections: cols,
        smartFolders
      }

      const defaultName = `SoundVault-Metadata-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '备份元数据',
        defaultPath: defaultName,
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      })
      if (canceled || !filePath) return { success: false, cancelled: true }
      await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
      return { success: true, filePath, counts: payload.counts }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('metadata:import', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
        title: '恢复元数据',
        filters: [{ name: 'JSON 备份', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (canceled || !filePaths[0]) return { success: false, cancelled: true }

      const raw = await readFile(filePaths[0], 'utf-8')
      let data: any
      try {
        data = JSON.parse(raw)
      } catch {
        return { success: false, error: 'JSON 解析失败，文件可能已损坏' }
      }
      if (!data || data.app !== 'SoundVault' || data.type !== 'metadata-backup') {
        return { success: false, error: '这不是有效的 SoundVault 元数据备份文件' }
      }

      const hashToId = new Map(
        (db.prepare('SELECT id, file_hash FROM sounds').all() as Array<{ id: string; file_hash: string }>).map((s) => [s.file_hash, s.id])
      )
      const now = new Date().toISOString()
      let matched = 0
      let tagsApplied = 0
      let notesApplied = 0
      let starredApplied = 0
      let colsTouched = 0
      let sfCreated = 0

      const tx = db.transaction(() => {
        // 1. 先确保所有标签存在（按 name）
        const ensureTag = db.prepare('INSERT OR IGNORE INTO tags (id, name, color, icon, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)')
        for (const t of (data.tags || []) as Array<any>) ensureTag.run(uuidv4(), t.name, t.color || null, t.icon || null, now)
        const nameToTagId = new Map(
          (db.prepare('SELECT id, name FROM tags').all() as Array<{ id: string; name: string }>).map((t) => [t.name, t.id])
        )
        // 2. 补父子关系（仅当当前无父时）
        for (const t of (data.tags || []) as Array<any>) {
          if (t.parent_name && nameToTagId.has(t.name) && nameToTagId.has(t.parent_name)) {
            db.prepare('UPDATE tags SET parent_id = ? WHERE id = ? AND parent_id IS NULL')
              .run(nameToTagId.get(t.parent_name), nameToTagId.get(t.name))
          }
        }
        // 3. 每个音效：合并叠加 标签 / 备注(仅当前空时填) / 星标
        const insLink = db.prepare('INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)')
        const fillNote = db.prepare("UPDATE sounds SET notes = ?, updated_at = ? WHERE id = ? AND (notes IS NULL OR notes = '')")
        const setStar = db.prepare('UPDATE sounds SET is_starred = 1 WHERE id = ?')
        for (const sm of (data.sounds || []) as Array<any>) {
          const sid = hashToId.get(sm.file_hash)
          if (!sid) continue
          matched++
          if (sm.notes) { const r = fillNote.run(sm.notes, now, sid); if (r.changes > 0) notesApplied++ }
          if (sm.is_starred) { setStar.run(sid); starredApplied++ }
          for (const tg of (sm.tags || []) as Array<any>) {
            const tid = nameToTagId.get(tg.name)
            if (tid) { const r = insLink.run(sid, tid, tg.confidence ?? 1, tg.is_manual ?? 1); if (r.changes > 0) tagsApplied++ }
          }
        }
        // 4. collections 按 name 合并（不存在则建），成员按 hash 叠加
        for (const c of (data.collections || []) as Array<any>) {
          let cid = (db.prepare('SELECT id FROM collections WHERE name = ?').get(c.name) as { id: string } | undefined)?.id
          if (!cid) {
            cid = uuidv4()
            db.prepare('INSERT INTO collections (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
              .run(cid, c.name, c.description || null, c.color || null, now, now)
          }
          colsTouched++
          const insCS = db.prepare('INSERT OR IGNORE INTO collection_sounds (collection_id, sound_id, sort_order, added_at) VALUES (?, ?, 0, ?)')
          for (const h of (c.sounds || []) as Array<string>) {
            const sid = hashToId.get(h)
            if (sid) insCS.run(cid, sid, now)
          }
        }
        // 5. smart_folders 按 name 合并（仅新建缺失的）
        for (const sf of (data.smartFolders || []) as Array<any>) {
          const ex = db.prepare('SELECT id FROM smart_folders WHERE name = ?').get(sf.name)
          if (!ex) {
            db.prepare('INSERT INTO smart_folders (id, name, conditions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
              .run(uuidv4(), sf.name, sf.conditions, now, now)
            sfCreated++
          }
        }
      })
      tx()

      return {
        success: true,
        matched,
        total: (data.sounds || []).length,
        tagsApplied,
        notesApplied,
        starredApplied,
        colsTouched,
        sfCreated
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ---- Library Export / Import (portable bundle, like Eagle) ----

  // Cancellation registry for in-flight exports, keyed by a token passed from the renderer.
  const exportCancels = new Map<string, { cancelled: boolean }>()

  // Cancel an in-flight export identified by its token.
  ipcMain.handle('library:cancelExport', (_event, token: string) => {
    const ref = exportCancels.get(token)
    if (ref) {
      ref.cancelled = true
      return { success: true }
    }
    return { success: false }
  })

  // Open a folder in the OS file explorer (used by the export-completion toast).
  ipcMain.handle('shell:openPath', async (_event, p: string) => {
    try {
      await shell.openPath(p)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  /**
   * Export a portable library bundle.
   * @param destDir   Target parent folder (user-chosen).
   * @param soundIds  Optional array of sound IDs to export.  Empty/undefined = export ALL sounds.
   * @param token     Optional cancellation token. Renderer can call library:cancelExport(token).
   */
  ipcMain.handle('library:export', async (event, destDir: string, soundIds?: string[], token?: string) => {
    const cancelRef = { cancelled: false }
    if (token) exportCancels.set(token, cancelRef)
    const startTime = Date.now()
    const bundleName = `SoundVault-Library-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
    const root = join(destDir, bundleName)
    const audiosDir = join(root, 'audios')

    try {
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
      const tagPlaceholders = ids.size > 0 ? [...ids].map(() => '?').join(',') : ''

      const tags = ids.size > 0
        ? db.prepare(`SELECT * FROM tags WHERE id IN (SELECT tag_id FROM sound_tags WHERE sound_id IN (${tagPlaceholders}))`).all(...ids)
        : db.prepare('SELECT * FROM tags').all()
      const soundTags = ids.size > 0
        ? db.prepare(`SELECT * FROM sound_tags WHERE sound_id IN (${tagPlaceholders})`).all(...ids)
        : db.prepare('SELECT * FROM sound_tags').all()
      const tagAliases = db.prepare('SELECT * FROM tag_aliases').all()
      const collections = db.prepare('SELECT * FROM collections').all()
      const collectionSounds = ids.size > 0
        ? db.prepare(`SELECT * FROM collection_sounds WHERE sound_id IN (${tagPlaceholders})`).all(...ids)
        : db.prepare('SELECT * FROM collection_sounds').all()
      const smartFolders = db.prepare('SELECT * FROM smart_folders').all()

      // Copy audio files using ORIGINAL filenames (with dedup on name clash).
      const total = (sounds as unknown[]).length
      let copied = 0
      let missing = 0
      let done = 0
      const nameCounter = new Map<string, number>() // baseName → next suffix
      for (const s of sounds as Array<{ id: string; file_path: string; file_ext: string; file_name: string }>) {
        // Honor cancellation between file copies (delete the half-written bundle).
        if (cancelRef.cancelled) {
          try { await rm(root, { recursive: true, force: true }) } catch { /* ignore */ }
          return { success: false, cancelled: true, path: null, copied, missing, total }
        }

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
        let isCopy = false
        try {
          await access(src)
          await copyFile(src, dest)
          isCopy = true
        } catch {
          isCopy = false
        }

        done++
        if (isCopy) copied++
        else missing++

        // Stream progress to the renderer (live bar / elapsed time).
        event.sender.send('library:export-progress', {
          done,
          total,
          copied,
          missing,
          fileName: finalName,
          elapsedMs: Date.now() - startTime
        })
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
        missing,
        total,
        elapsedMs: Date.now() - startTime
      }
    } catch (err) {
      // On failure, clean up the half-written bundle so the target folder isn't polluted.
      try { await rm(root, { recursive: true, force: true }) } catch { /* ignore */ }
      return { success: false, error: (err as Error).message, cancelled: false }
    } finally {
      if (token) exportCancels.delete(token)
    }
  })

  ipcMain.handle('library:import', async (_event, bundleDir: string) => {
    const manifestPath = join(bundleDir, 'library.json')
    if (!existsSync(manifestPath)) {
      return { success: false, error: '这不是有效的 SoundVault 资源库文件夹。请选择之前通过「导出音效库」功能导出的文件夹，或使用「导入」功能首次添加音效。' }
    }

    let data: any
    try {
      data = JSON.parse(await readFile(manifestPath, 'utf-8'))
    } catch {
      return { success: false, error: '该资源库文件已损坏或格式不兼容，无法读取。请尝试重新导出一份资源库，或使用「导入」功能添加音效。' }
    }
    if (data?.format !== 'soundvault-library') {
      return { success: false, error: '该文件夹不是有效的 SoundVault 资源库。请确认选择的是通过「导出音效库」功能导出的文件夹。' }
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
    const trashClaus = where
      ? where + ' AND (s.is_trashed = 0 OR s.is_trashed IS NULL)'
      : 'WHERE (s.is_trashed = 0 OR s.is_trashed IS NULL)'
    const sql = `
      SELECT s.*,
        (SELECT GROUP_CONCAT(t.name, ',')
         FROM tags t
         JOIN sound_tags st ON t.id = st.tag_id
         WHERE st.sound_id = s.id) AS tags
      FROM sounds s
      ${trashClaus}
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

  // ---- 智能分类：一键自动生成智能文件夹（语义聚类版） ----
  // 维度：scenario(适用场景) / emotion(情绪) / ai_tags(已分析文件按AI标签)
  //       / filename(文件名关键词) / file_ext(格式) / imported(导入时间段)
  //       / duration(时长) / quality(质量评分)
  // 设计：开放维度（场景/情绪/标签）先按主题词典聚成少量「主题文件夹」，
  //       不再「一值一夹」；并以 maxGroups 上限 + minPerGroup 频率阈值控制数量。
  type AutoClassifyResult = { created: number; skipped: number; names: string[] }
  type AutoClassifyOptions = { maxGroups?: number; minPerGroup?: number }

  ipcMain.handle('smartFolder:autoClassify', (_event, dimension: string, options?: AutoClassifyOptions): AutoClassifyResult => {
    const now = new Date().toISOString()
    const maxGroups = Math.max(2, Math.min(20, options?.maxGroups ?? 8))
    const minPerGroup = Math.max(1, options?.minPerGroup ?? 2)
    const createdNames: string[] = []
    const skippedNames: string[] = []

    // 按名称幂等创建：已存在则跳过（避免重复点击刷出一堆）
    const ensureFolder = (name: string, conditionsJson: string): boolean => {
      const ex = db.prepare('SELECT id FROM smart_folders WHERE name = ?').get(name) as
        { id: string } | undefined
      if (ex) { skippedNames.push(name); return false }
      // 频率阈值：命中素材数低于 minPerGroup 的噪声分类直接跳过
      if (countOf(conditionsJson) < minPerGroup) return false
      db.prepare(
        'INSERT INTO smart_folders (id, name, conditions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), name, conditionsJson, now, now)
      createdNames.push(name)
      return true
    }

    // 统计某组条件能命中多少音效（用于跳过空分类）
    const countOf = (conditionsJson: string): number => {
      try { return runSmartFolderQuery(conditionsJson).length } catch { return 0 }
    }

    const mk = (field: string, op: string, value: string) => ({ field, op, value })
    const grp = (logic: 'AND' | 'OR', conditions: any[]) => ({ logic, conditions })
    const toJson = (g: any) => JSON.stringify([g])

    // 主题词典：把零散的「场景/情绪/标签」值，按关键词归并成少量「主题文件夹」
    const THEME_DICTS: Record<string, Array<{ theme: string; kws: string[] }>> = {
      scenario: [
        { theme: '战斗与动作', kws: ['战斗', '打斗', '格斗', '技能', '攻击', '打击', '枪', '炮', '爆炸', '爆破', '武器', '剑', '刀', '拳', '踢', '撞击', '射击', '施法'] },
        { theme: '环境与自然', kws: ['环境', '氛围', '自然', '雨', '风', '海', '浪', '森林', '城市', '街道', '水', '火', '雷', '鸟', '虫', '天气', '山', '河', 'ambience', 'rain', 'wind', 'water', 'fire', 'forest', 'city', 'nature', 'weather', 'ocean', 'river'] },
        { theme: '角色与生物', kws: ['人声', '角色', '脚步', '动物', '怪兽', '龙', '鬼', '哭', '笑', '喊', '呼吸', '生物', '兽', 'voice', 'vocal', 'human', 'animal', 'creature', 'footstep', 'character', 'beast'] },
        { theme: 'UI与交互', kws: ['UI', '界面', '点击', '按钮', '菜单', '提示', '通知', '弹出', '滑动', '悬停', '交互', 'click', 'pop', 'button', 'menu', 'notify', 'alert', 'transition', 'hover'] },
        { theme: '机械与科技', kws: ['机械', '机器', '引擎', '科技', '电子', '机器人', '激光', '能量', '电路', '电流', '齿轮', 'engine', 'machine', 'tech', 'robot', 'laser', 'energy', 'circuit', 'mechanical'] },
        { theme: '音乐与节奏', kws: ['音乐', '旋律', '节奏', '钢琴', '吉他', '鼓', '弦乐', '管乐', '背景乐', '配乐', 'music', 'piano', 'guitar', 'drum', 'bass', 'melody'] },
        { theme: '魔法与特效', kws: ['魔法', '科幻', '恐怖', '故障', '传送', '时空', '空间', '特效', 'magic', 'scifi', 'horror', 'glitch', 'whoosh', 'explosion', 'boom', 'spatial'] },
        { theme: '物体与生活', kws: ['日常', '物体', '玻璃', '木头', '纸', '金属', '门', '钟', '铃', '厨房', 'kitchen', 'glass', 'wood', 'metal', 'door', 'bell', 'object'] }
      ],
      emotion: [
        { theme: '紧张刺激', kws: ['紧张', '刺激', '惊险', '压迫', '危机', '危险', 'tense', 'thrill'] },
        { theme: '轻松愉快', kws: ['轻松', '愉快', '欢快', '开心', '活泼', '搞笑', 'calm', 'relax', 'happy', 'playful', 'cheerful'] },
        { theme: '悲伤忧郁', kws: ['悲伤', '忧郁', '孤独', '失落', '哀伤', 'sad', 'melancholy', 'lonely'] },
        { theme: '神秘悬疑', kws: ['神秘', '悬疑', '诡异', '阴森', '未知', 'mysterious', 'eerie', 'spooky'] },
        { theme: '激昂史诗', kws: ['激昂', '史诗', '宏大', '壮丽', 'heroic', 'epic', 'grand'] },
        { theme: '温暖治愈', kws: ['温暖', '治愈', '柔情', '感动', 'warm', 'healing', 'tender'] }
      ]
    }
    // 标签维度复用场景的主题词典（领域覆盖一致）
    THEME_DICTS.ai_tags = THEME_DICTS.scenario

    // 把「值→频次」聚成 ≤ maxGroups 个主题，每个主题是一个 OR 条件组
    const clusterIntoThemes = (
      tally: Map<string, number>,
      dict: Array<{ theme: string; kws: string[] }>
    ): Array<{ theme: string; values: string[]; count: number }> => {
      const byTheme = new Map<string, { values: string[]; count: number }>()
      for (const [val, cnt] of tally) {
        let theme = '其他'
        const low = val.toLowerCase()
        for (const d of dict) {
          if (d.kws.some((k) => low.includes(k.toLowerCase()))) { theme = d.theme; break }
        }
        const cur = byTheme.get(theme) ?? { values: [], count: 0 }
        cur.values.push(val); cur.count += cnt
        byTheme.set(theme, cur)
      }
      let arr = [...byTheme.entries()].map(([theme, v]) => ({ theme, values: v.values, count: v.count }))
      arr.sort((a, b) => b.count - a.count)
      if (arr.length > maxGroups) {
        const keep = arr.slice(0, maxGroups - 1)
        const merged = arr.slice(maxGroups - 1)
        const mv = merged.flatMap((m) => m.values)
        const mc = merged.reduce((s, m) => s + m.count, 0)
        keep.push({ theme: '其他', values: mv, count: mc })
        arr = keep
      }
      return arr.filter((a) => a.count >= minPerGroup)
    }

    switch (dimension) {
      case 'scenario': {
        // 语义聚类：把零散场景值按主题词典归并成少量「主题文件夹」
        const rows = db.prepare(
          "SELECT use_cases FROM sounds WHERE use_cases IS NOT NULL AND use_cases <> ''"
        ).all() as Array<{ use_cases: string }>
        const tally = new Map<string, number>()
        for (const r of rows) {
          for (const p of r.use_cases.split(/[、,，/]/).map((s) => s.trim()).filter((s) => !!s)) {
            tally.set(p, (tally.get(p) || 0) + 1)
          }
        }
        clusterIntoThemes(tally, THEME_DICTS.scenario).forEach(({ theme, values }) => {
          const cj = toJson(grp('OR', values.map((v) => mk('use_cases', 'contains', v))))
          ensureFolder(`场景 · ${theme}`, cj)
        })
        break
      }
      case 'emotion': {
        // 语义聚类：把零散情绪值归并成少量「情绪主题文件夹」
        const rows = db.prepare(
          "SELECT emotion FROM sounds WHERE emotion IS NOT NULL AND emotion <> ''"
        ).all() as Array<{ emotion: string }>
        const tally = new Map<string, number>()
        for (const r of rows) {
          for (const p of r.emotion.split(/[、,，/]/).map((s) => s.trim()).filter((s) => !!s)) {
            tally.set(p, (tally.get(p) || 0) + 1)
          }
        }
        clusterIntoThemes(tally, THEME_DICTS.emotion).forEach(({ theme, values }) => {
          const cj = toJson(grp('OR', values.map((v) => mk('emotion', 'contains', v))))
          ensureFolder(`情绪 · ${theme}`, cj)
        })
        break
      }
      case 'ai_tags': {
        // 已分析文件按「实际 AI 标签」聚类：标签值 → 主题词典归并
        const rows = db.prepare(`
          SELECT tg.name, COUNT(st.sound_id) AS cnt FROM tags tg
          JOIN sound_tags st ON tg.id = st.tag_id
          JOIN sounds s ON s.id = st.sound_id
          WHERE s.ai_analyzed_at IS NOT NULL
          GROUP BY tg.name
        `).all() as Array<{ name: string; cnt: number }>
        const tally = new Map<string, number>()
        for (const r of rows) tally.set(r.name, r.cnt)
        clusterIntoThemes(tally, THEME_DICTS.ai_tags).forEach(({ theme, values }) => {
          const cj = toJson(grp('OR', values.map((v) => mk('tags', 'contains', v))))
          ensureFolder(`标签 · ${theme}`, cj)
        })
        break
      }
      case 'filename': {
        // 按文件名关键词自动归类（内置中英文关键词词典）
        const DICT: Array<{ label: string; kws: string[] }> = [
          { label: '人声', kws: ['voice', 'vocal', 'human', 'speak', 'shout', '人声', '喊叫', '笑声', '哭声', '男声', '女声'] },
          { label: '动物', kws: ['animal', 'dog', 'cat', 'bird', '鸡', '鸭', '牛', '羊', '狼', '虫鸣', '动物'] },
          { label: '环境氛围', kws: ['rain', 'wind', 'water', 'fire', 'thunder', 'ocean', 'forest', 'city', 'nature', 'weather', 'ambience', '雨', '海浪', '森林', '城市', '环境'] },
          { label: '动作物品', kws: ['hit', 'impact', 'crash', 'bang', 'smash', 'strike', 'footstep', 'glass', 'metal', 'wood', 'gun', 'sword', 'door', '撞击', '碎裂', '脚步', '玻璃', '金属', '木头', '枪', '刀', '门'] },
          { label: 'UI交互', kws: ['click', 'pop', 'transition', 'notify', 'alert', 'swoosh', 'button', 'hover', 'menu', '点击', '弹出', '通知', '过渡'] },
          { label: '乐器音乐', kws: ['piano', 'guitar', 'drum', 'music', 'instrument', 'synth', 'bass', '钢琴', '吉他', '鼓', '弦乐', '管乐'] },
          { label: '机械科技', kws: ['machine', 'engine', 'tech', 'robot', 'sci', 'laser', 'energy', 'circuit', '机器', '引擎', '机械', '科技', '激光', '电路', '能量'] },
          { label: '特殊效果', kws: ['magic', 'scifi', 'horror', 'explosion', 'boom', 'glitch', 'whoosh', '魔法', '科幻', '恐怖', '爆炸', '故障'] }
        ]
        for (const { label, kws } of DICT) {
          const cj = toJson(grp('OR', kws.map((k) => mk('file_name', 'contains', k))))
          if (countOf(cj) > 0) ensureFolder(`文件 · ${label}`, cj)
        }
        break
      }
      case 'file_ext': {
        // 按文件格式分类
        const rows = db.prepare(
          "SELECT DISTINCT file_ext FROM sounds WHERE file_ext IS NOT NULL AND file_ext <> ''"
        ).all() as Array<{ file_ext: string }>
        for (const r of rows) {
          const cj = toJson(grp('AND', [mk('file_ext', 'equals', r.file_ext)]))
          if (countOf(cj) > 0) ensureFolder(`格式 · ${r.file_ext}`, cj)
        }
        break
      }
      case 'imported': {
        // 按导入时间段分类
        const buckets: Array<{ name: string; g: any }> = [
          { name: '导入 · 今天', g: grp('AND', [mk('imported_at', 'lt', '1')]) },
          { name: '导入 · 近7天', g: grp('AND', [mk('imported_at', 'lt', '7')]) },
          { name: '导入 · 近30天', g: grp('AND', [mk('imported_at', 'lt', '30')]) },
          { name: '导入 · 近90天', g: grp('AND', [mk('imported_at', 'lt', '90')]) },
          { name: '导入 · 更早', g: grp('AND', [mk('imported_at', 'gt', '90')]) }
        ]
        for (const b of buckets) {
          const cj = toJson(b.g)
          if (countOf(cj) > 0) ensureFolder(b.name, cj)
        }
        break
      }
      case 'duration': {
        // 按时长分类：短(<1s) / 中(1-5s) / 长(>5s)
        const buckets: Array<{ name: string; g: any }> = [
          { name: '时长 · 短(<1秒)', g: grp('AND', [mk('duration_ms', 'lt', '1000')]) },
          { name: '时长 · 中(1-5秒)', g: grp('AND', [mk('duration_ms', 'gt', '1000'), mk('duration_ms', 'lt', '5000')]) },
          { name: '时长 · 长(>5秒)', g: grp('AND', [mk('duration_ms', 'gt', '5000')]) }
        ]
        for (const b of buckets) {
          const cj = toJson(b.g)
          if (countOf(cj) > 0) ensureFolder(b.name, cj)
        }
        break
      }
      case 'quality': {
        // 按 AI 质量评分分类
        const buckets: Array<{ name: string; g: any }> = [
          { name: '质量 · 5★', g: grp('AND', [mk('quality_score', 'equals', '5')]) },
          { name: '质量 · 4★', g: grp('AND', [mk('quality_score', 'equals', '4')]) },
          { name: '质量 · 3★及以下', g: grp('AND', [mk('quality_score', 'lt', '3')]) }
        ]
        for (const b of buckets) {
          const cj = toJson(b.g)
          if (countOf(cj) > 0) ensureFolder(b.name, cj)
        }
        break
      }
      default:
        return { created: 0, skipped: 0, names: [] }
    }

    return { created: createdNames.length, skipped: skippedNames.length, names: createdNames }
  })

  // ---- Tag Management ----

  ipcMain.handle('tag:delete', (_event, tagId: string) => {
    const tagRow = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId) as
      | { id: string; name: string; parent_id: string | null; color: string | null; icon: string | null; sort_order: number; created_at: string }
      | undefined
    if (!tagRow) return { success: true }
    const links = db.prepare('SELECT sound_id, confidence, is_manual FROM sound_tags WHERE tag_id = ?').all(tagId) as
      Array<{ sound_id: string; confidence: number | null; is_manual: number }>
    const aliases = db.prepare('SELECT alias FROM tag_aliases WHERE tag_id = ?').all(tagId) as Array<{ alias: string }>

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM sound_tags WHERE tag_id = ?').run(tagId)
      db.prepare('DELETE FROM tag_aliases WHERE tag_id = ?').run(tagId)
      db.prepare('DELETE FROM tags WHERE id = ?').run(tagId)
    })
    tx()

    pushUndo(`删除标签「${tagRow.name}」`, () => {
      const rtx = db.transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO tags (id, name, parent_id, color, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(tagRow.id, tagRow.name, tagRow.parent_id, tagRow.color, tagRow.icon, tagRow.sort_order, tagRow.created_at)
        const insLink = db.prepare('INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)')
        for (const l of links) insLink.run(l.sound_id, tagRow.id, l.confidence, l.is_manual)
        const insAlias = db.prepare('INSERT OR IGNORE INTO tag_aliases (tag_id, alias) VALUES (?, ?)')
        for (const a of aliases) insAlias.run(tagRow.id, a.alias)
      })
      rtx()
    })

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

  // 拟声词云：聚合所有音效的 onomatopoeia 字段（按中文 zh 归并）
  ipcMain.handle('tag:getOnomatopoeiaCloud', () => {
    const rows = db.prepare(
      "SELECT onomatopoeia FROM sounds WHERE onomatopoeia IS NOT NULL AND onomatopoeia != '' AND onomatopoeia != '[]'"
    ).all() as Array<{ onomatopoeia: string }>
    const counter = new Map<string, { count: number; ja?: string; en?: string; pinyin?: string }>()
    for (const r of rows) {
      try {
        const list = JSON.parse(r.onomatopoeia) as Array<{ zh: string; ja?: string; en?: string; pinyin?: string }>
        for (const o of list) {
          if (!o || !o.zh) continue
          const cur = counter.get(o.zh) || { count: 0 }
          cur.count += 1
          if (o.ja && !cur.ja) cur.ja = o.ja
          if (o.en && !cur.en) cur.en = o.en
          if (o.pinyin && !cur.pinyin) cur.pinyin = o.pinyin
          counter.set(o.zh, cur)
        }
      } catch { /* skip invalid json */ }
    }
    const arr = Array.from(counter.entries()).map(([name, v]) => ({
      id: name,
      name,
      color: '#FBBF24',
      count: v.count,
      category: '拟声词'
    }))
    arr.sort((a, b) => b.count - a.count)
    return arr
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

    // 撤销：把这批音效从回收站恢复
    const snapshotIds = [...ids]
    pushUndo(`删除 ${snapshotIds.length} 个音效`, () => {
      const ph = snapshotIds.map(() => '?').join(',')
      db.prepare(`UPDATE sounds SET is_trashed = 0, updated_at = ? WHERE id IN (${ph})`)
        .run(new Date().toISOString(), ...snapshotIds)
    })
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

  ipcMain.handle('sound:permanentDelete', async (_event, ids: string[], deleteLocalFile?: boolean) => {
    const placeholders = ids.map(() => '?').join(',')
    // 如果勾选了删除本地文件，先从磁盘移除
    if (deleteLocalFile) {
      const rows = db.prepare(`SELECT file_path FROM sounds WHERE id IN (${placeholders})`).all(...ids) as Array<{ file_path: string }>
      for (const r of rows) {
        try { await rm(r.file_path, { force: true }) } catch { /* 文件可能已不存在 */ }
      }
    }
    // 事务包裹：关联删除 + 主记录删除原子执行，防止进程崩溃时数据不一致
    const del = db.transaction(() => {
      db.prepare(`DELETE FROM sound_tags WHERE sound_id IN (${placeholders})`).run(...ids)
      db.prepare(`DELETE FROM collection_sounds WHERE sound_id IN (${placeholders})`).run(...ids)
      db.prepare(`DELETE FROM sounds WHERE id IN (${placeholders})`).run(...ids)
    })
    del()
    return { success: true, deletedLocal: !!deleteLocalFile }
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

  // 批量收藏：将一组音效标记为 is_starred=1
  ipcMain.handle('sound:batchStar', (_event, ids: string[]) => {
    if (!ids || ids.length === 0) return { success: true, affected: 0 }
    const placeholders = ids.map(() => '?').join(',')
    const res = db.prepare(`UPDATE sounds SET is_starred = 1, updated_at = ? WHERE id IN (${placeholders})`)
      .run(new Date().toISOString(), ...ids)
    return { success: true, affected: res.changes }
  })

  // 批量导出：把一组音效复制到目标目录（自动处理文件名冲突）
  ipcMain.handle('sound:batchExport', async (_event, ids: string[], targetDir: string) => {
    try {
      await access(targetDir)
      const rows = db.prepare(`
        SELECT id, file_path, file_name FROM sounds WHERE id IN (${ids.map(() => '?').join(',')})
      `).all(...ids) as Array<{ id: string; file_path: string; file_name: string }>
      let copied = 0
      let skipped = 0
      let missing = 0
      const used = new Set<string>()
      for (const r of rows) {
        try {
          await access(r.file_path)
        } catch {
          missing++
          continue
        }
        let base = basename(r.file_path)
        if (used.has(base)) {
          base = `${r.id.slice(0, 8)}_${base}`
        }
        used.add(base)
        try {
          await copyFile(r.file_path, join(targetDir, base))
          copied++
        } catch {
          skipped++
        }
      }
      return { success: true, copied, skipped, missing }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
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
      // 本地文件可能已被外部删除：存在才送回收站，缺失则跳过（仍标记已删除）
      let exists = true
      try { await access(row.file_path) } catch { exists = false }
      if (exists) {
        await shell.trashItem(row.file_path)
      }
      const nameRow = db.prepare('SELECT file_name FROM sounds WHERE id = ?').get(soundId) as { file_name: string } | undefined
      db.prepare('UPDATE sounds SET is_trashed = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), soundId)
      // 撤销：把该音效从回收站恢复（与 RecycleBin 恢复语义一致，仅还原库记录）
      pushUndo(`删除音效「${nameRow?.file_name || soundId}」`, () => {
        db.prepare('UPDATE sounds SET is_trashed = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), soundId)
      })
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  // ---- 查找重复文件：按 file_hash 分组（排除空 hash 与已移入回收站）----
  ipcMain.handle('library:findDuplicates', () => {
    const groups = db.prepare(`
      SELECT file_hash, COUNT(*) as cnt
      FROM sounds
      WHERE is_trashed = 0 AND file_hash IS NOT NULL AND file_hash != ''
      GROUP BY file_hash
      HAVING cnt > 1
    `).all() as Array<{ file_hash: string; cnt: number }>

    return groups.map((g) => {
      const items = db.prepare(`
        SELECT id, file_name, file_path, file_size, imported_at
        FROM sounds
        WHERE file_hash = ? AND is_trashed = 0
        ORDER BY imported_at ASC
      `).all(g.file_hash) as Array<{ id: string; file_name: string; file_path: string; file_size: number; imported_at: string }>
      return { hash: g.file_hash, count: g.cnt, items }
    })
  })

  // ---- 跨盘安全移动：先尝试 rename（同盘快），失败则 copyFile + unlink（跨盘兜底） ----
  async function safeMove(src: string, dest: string): Promise<void> {
    try {
      await rename(src, dest)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        // 跨设备/跨盘：Windows rename 不支持，回退到复制+删除
        await copyFile(src, dest)
        await unlink(src)
      } else {
        throw err
      }
    }
  }

  // ---- 用 ffprobe 从实际文件获取时长秒数（不依赖 DB 的 duration_ms） ----
  function getDurationFromFile(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        ['-i', filePath, '-hide_banner', '-show_entries', 'format=duration', '-of', 'csv=p=0'],
        { windowsHide: true, timeout: 10000 },
        (_err, _stdout, stderr) => {
          // ffprobe 把信息写到 stderr，从里面提取 Duration
          const match = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr)
          if (match) {
            const h = parseInt(match[1], 10)
            const m = parseInt(match[2], 10)
            const s = parseFloat(match[3])
            resolve(h * 3600 + m * 60 + s)
          } else {
            reject(new Error('无法读取音频时长'))
          }
        }
      )
    })
  }

  // ---- 首尾无缝循环：ffmpeg 把「尾音」交叉淡入到「开头」，生成新的天生无缝循环文件 ----
  // 修复：① 跨盘移动用 safeMove ② 时长用 ffprobe 实际读取 ③ 生成后自动导入音效库
  //      ④ 继承原文件的 AI 分析/描述/标签等元数据，并额外加 loop 标签 + 循环描述
  ipcMain.handle('audio:seamlessLoop', async (_event, soundId: string, crossfadeMs = 30, loopCount = 1) => {
    const tmpDir = app.getPath('temp')
    try {
      const row = db.prepare('SELECT * FROM sounds WHERE id = ?').get(soundId) as any
      if (!row) return { success: false, message: '找不到文件记录' }

      const N = Math.max(1, Math.min(50, loopCount || 1))
      // 优先用 DB 缓存的时长；若为空或 0 则用 ffprobe 从实际文件读取
      let durSec = (row.duration_ms && row.duration_ms > 0) ? row.duration_ms / 1000 : 0
      if (durSec <= 0) {
        durSec = await getDurationFromFile(row.file_path)
      }
      // 交叉长度限制 10–500ms，避免过短无声 / 过长改变听感
      const L = Math.max(10, Math.min(500, crossfadeMs)) / 1000
      if (durSec <= L * 2 + 0.1) {
        return {
          success: false,
          message: `音效太短（${durSec.toFixed(2)}s），无法生成无缝循环，至少需要 ${(L * 2).toFixed(2)}s`
        }
      }
      const DURM = (durSec - L).toFixed(4)
      const dir = dirname(row.file_path)
      const { name } = parse(row.file_path)
      // 友好命名：原名_loop次数.wav  例如 footstep_loop3.wav
      const outPath = join(dir, `${name}_loop${N}.wav`)

      // ── 阶段一：生成一个周期的无缝版本（temp）──
      const tmpPath = join(tmpDir, `sv_seamless_${Date.now()}.wav`)
      const singleFilter = [
        '[0:a]asplit=3[s1][s2][s3]',
        `[s1]atrim=0:${DURM}[a]`,
        `[s2]atrim=${DURM}[tail]`,
        `[s3]atrim=0:${L}[head]`,
        '[tail][head]acrossfade=d=' + L + ':curve1=esin:curve2=esin[cf]',
        '[a][cf]concat=n=2:v=0:a=1[out]'
      ].join(';')

      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegPath,
          ['-i', row.file_path, '-filter_complex', singleFilter, '-map', '[out]', '-c:a', 'pcm_s16le', '-y', tmpPath],
          { windowsHide: true, timeout: 120000 },
          (err, _stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
        )
      })

      // ── 阶段二：N==1 直接用临时文件；N>1 则重复拼接 ──
      if (N === 1) {
        // 单次：用 safeMove 支持跨盘（C:Temp → E: 等）
        await safeMove(tmpPath, outPath)
      } else {
        // 多次：用 concat 协议把单周期无缝文件重复 N 份
        const listPath = join(tmpDir, `sv_concat_${Date.now()}.txt`)
        const listContent = Array.from({ length: N }, () =>
          `file '${tmpPath.replace(/\\/g, '/').replace(/'/g, "\\'")}'`
        ).join('\n')
        await writeFile(listPath, listContent, 'utf-8')

        await new Promise<void>((resolve, reject) => {
          execFile(
            ffmpegPath,
            ['-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'pcm_s16le', '-y', outPath],
            { windowsHide: true, timeout: 300000 },
            (err, _stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
          )
        })

        // 清理临时文件
        try { await rm(tmpPath) } catch { /* ignore */ }
        try { await rm(listPath) } catch { /* ignore */ }
      }

      // ---- 自动导入生成的无缝循环文件到音效库（继承原文件元数据 + loop 标签） ----
      const outStat = await stat(outPath)
      const outExt = extname(outPath).toLowerCase()
      const outFileName = basename(outPath)
      const buffer = await readFile(outPath, { length: 64 * 1024 })
      const hash = createHash('sha256').update(buffer).digest('hex')
      const now = new Date().toISOString()
      const newId = uuidv4()
      // 新文件时长：单周期无缝 ≈ 原时长；N>1 则重复 N 份
      const newDurationMs = Math.round(durSec * 1000 * N)
      // 循环描述：原描述已含「循环」字样则不重复追加
      const origDesc: string = row.description || ''
      const finalDescription = origDesc.includes('循环')
        ? origDesc
        : `${origDesc}${origDesc ? ' ' : ''}无缝循环音频${N > 1 ? `，已重复 ${N} 次` : ''}`

      const existing = db.prepare('SELECT id FROM sounds WHERE file_hash = ?').get(hash) as { id: string } | undefined
      const targetId = existing?.id || newId
      if (!existing) {
        db.prepare(`
          INSERT OR IGNORE INTO sounds (
            id, file_path, file_hash, file_name, file_ext, file_size, duration_ms,
            sample_rate, bit_depth, channels, bitrate_kbps, loudness_lufs,
            description, description_en, use_cases, emotion, quality_score,
            similar_to, best_for, ai_model, ai_analyzed_at,
            is_missing, is_trashed, imported_at, updated_at, preview_cache, search_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
        `).run(newId,
          outPath,
          hash,
          outFileName,
          outExt,
          outStat.size,
          newDurationMs,
          row.sample_rate ?? null,
          row.bit_depth ?? null,
          row.channels ?? null,
          row.bitrate_kbps ?? null,
          row.loudness_lufs ?? null,
          finalDescription || null,
          row.description_en ?? null,
          row.use_cases ?? null,
          row.emotion ?? null,
          row.quality_score ?? null,
          row.similar_to ?? null,
          row.best_for ?? null,
          row.ai_model ?? null,
          row.ai_analyzed_at ?? null, now, now, null, null)

        // 继承原文件的所有标签
        const origTags = db.prepare(
          'SELECT tag_id, confidence, is_manual FROM sound_tags WHERE sound_id = ?'
        ).all(soundId) as Array<{ tag_id: string; confidence: number | null; is_manual: number }>
        const stInsert = db.prepare(
          'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
        )
        for (const t of origTags) {
          stInsert.run(newId, t.tag_id, t.confidence, t.is_manual)
        }
      }

      // 额外添加 loop 标签（确保存在，不论原文件是否已有）
      const loopTag = db.prepare("SELECT id FROM tags WHERE name = ?").get('loop') as { id: string } | undefined
      const loopTagId = loopTag?.id || (() => {
        const id = uuidv4()
        db.prepare("INSERT OR IGNORE INTO tags (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)")
          .run(id, 'loop', 999, now)
        return id
      })()
      db.prepare(
        'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
      ).run(targetId, loopTagId, 1, 1)

      return { success: true, outPath, crossfadeMs: Math.round(L * 1000), loopCount: N, importedId: targetId }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  // ---- 波形峰值：ffmpeg 抽单声道 PCM，前端渲染真实波形（结果缓存进 preview_cache） ----
  ipcMain.handle('audio:getWaveform', async (_event, soundId: string, bars = 120) => {
    try {
      const row = db.prepare('SELECT file_path, preview_cache FROM sounds WHERE id = ?').get(soundId) as
        { file_path: string; preview_cache: string | null } | undefined
      if (!row) return { success: false, message: '找不到文件记录' }

      // 已缓存则直接返回，避免重复计算
      if (row.preview_cache) {
        try {
          const cached = JSON.parse(row.preview_cache) as number[]
          if (Array.isArray(cached) && cached.length > 0) {
            return { success: true, peaks: cached, cached: true }
          }
        } catch { /* ignore，重新计算 */ }
      }

      // ffmpeg 抽单声道 8kHz 16bit PCM 到内存（stdout）
      const pcm = await new Promise<Buffer>((resolve, reject) => {
        execFile(
          ffmpegPath,
          ['-i', row.file_path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
          { windowsHide: true, timeout: 60000, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
          (err, stdout) => (err ? reject(new Error((err as Error).message)) : resolve(stdout as Buffer))
        )
      })

      const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
      const n = Math.max(16, Math.min(400, bars))
      const block = Math.max(1, Math.floor(samples.length / n))
      const raw: number[] = []
      for (let i = 0; i < n; i++) {
        let max = 0
        const start = i * block
        const end = Math.min(start + block, samples.length)
        for (let j = start; j < end; j++) {
          const v = Math.abs(samples[j])
          if (v > max) max = v
        }
        raw.push(samples.length > 0 ? max / 32768 : 0)
      }
      // 归一化到峰值 1（保留最小可见高度），观感更饱满
      const peakMax = Math.max(...raw, 1e-6)
      const norm = raw.map((p) => Math.max(0.04, p / peakMax))

      // 写回 preview_cache，下次直接读
      try {
        db.prepare('UPDATE sounds SET preview_cache = ? WHERE id = ?').run(JSON.stringify(norm), soundId)
      } catch { /* ignore */ }

      return { success: true, peaks: norm, cached: false }
    } catch (err) {
      return { success: false, message: (err as Error).message, peaks: [] }
    }
  })

  // ---- 裁剪截取片段：ffmpeg 按起止时间精确截取，生成新区段文件并自动入库 ----
  // 复用 seamlessLoop 的「safeMove + 入库 + 继承元数据」模板；结果加 crop 标签
  ipcMain.handle('audio:trim', async (_event, soundId: string, startSec: number, endSec: number) => {
    const tmpDir = app.getPath('temp')
    try {
      const row = db.prepare('SELECT * FROM sounds WHERE id = ?').get(soundId) as any
      if (!row) return { success: false, message: '找不到文件记录' }

      let durSec = (row.duration_ms && row.duration_ms > 0) ? row.duration_ms / 1000 : 0
      if (durSec <= 0) durSec = await getDurationFromFile(row.file_path)

      // 参数校验与归一化（交换确保 start < end）
      let s = Math.max(0, Math.min(durSec, Number(startSec) || 0))
      let e = Math.max(0, Math.min(durSec, Number(endSec) || durSec))
      if (e <= s) { const t = s; s = e; e = t }
      if (e - s < 0.05) return { success: false, message: '选区太短，至少需要 0.05 秒' }

      const dir = dirname(row.file_path)
      const { name } = parse(row.file_path)
      const outPath = join(dir, `${name}_clip_${s.toFixed(2)}-${e.toFixed(2)}.wav`)

      // ffmpeg 精确截取：-ss 快速定位 → -i 输入 → -to 相对时长精确裁剪 → 重编码保证精准
      const tmpPath = join(tmpDir, `sv_trim_${Date.now()}.wav`)
      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegPath,
          ['-ss', s.toFixed(3), '-i', row.file_path, '-to', (e - s).toFixed(3), '-c:a', 'pcm_s16le', '-y', tmpPath],
          { windowsHide: true, timeout: 120000 },
          (err, _stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
        )
      })
      // 同盘输出，safeMove 兼容跨盘
      await safeMove(tmpPath, outPath)

      // ---- 自动入库（继承元数据 + crop 标签） ----
      const outStat = await stat(outPath)
      const outExt = extname(outPath).toLowerCase()
      const outFileName = basename(outPath)
      const buffer = await readFile(outPath, { length: 64 * 1024 })
      const hash = createHash('sha256').update(buffer).digest('hex')
      const now = new Date().toISOString()
      const newId = uuidv4()
      const newDurationMs = Math.round((e - s) * 1000)
      const origDesc: string = row.description || ''
      const finalDescription = `${origDesc}${origDesc ? ' ' : ''}截取片段（${s.toFixed(2)}–${e.toFixed(2)}s）`

      const existing = db.prepare('SELECT id FROM sounds WHERE file_hash = ?').get(hash) as { id: string } | undefined
      const targetId = existing?.id || newId
      if (!existing) {
        db.prepare(`
          INSERT OR IGNORE INTO sounds (
            id, file_path, file_hash, file_name, file_ext, file_size, duration_ms,
            sample_rate, bit_depth, channels, bitrate_kbps, loudness_lufs,
            description, description_en, use_cases, emotion, quality_score,
            similar_to, best_for, ai_model, ai_analyzed_at,
            is_missing, is_trashed, imported_at, updated_at, preview_cache, search_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
        `).run(newId,
          outPath,
          hash,
          outFileName,
          outExt,
          outStat.size,
          newDurationMs,
          row.sample_rate ?? null,
          row.bit_depth ?? null,
          row.channels ?? null,
          row.bitrate_kbps ?? null,
          row.loudness_lufs ?? null,
          finalDescription || null,
          row.description_en ?? null,
          row.use_cases ?? null,
          row.emotion ?? null,
          row.quality_score ?? null,
          row.similar_to ?? null,
          row.best_for ?? null,
          row.ai_model ?? null,
          row.ai_analyzed_at ?? null, now, now, null, null)
        // 继承原文件的所有标签
        const origTags = db.prepare(
          'SELECT tag_id, confidence, is_manual FROM sound_tags WHERE sound_id = ?'
        ).all(soundId) as Array<{ tag_id: string; confidence: number | null; is_manual: number }>
        const stInsert = db.prepare(
          'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
        )
        for (const t of origTags) {
          stInsert.run(newId, t.tag_id, t.confidence, t.is_manual)
        }
      }

      // 额外添加 crop 标签
      const cropTag = db.prepare("SELECT id FROM tags WHERE name = ?").get('crop') as { id: string } | undefined
      const cropTagId = cropTag?.id || (() => {
        const id = uuidv4()
        db.prepare("INSERT OR IGNORE INTO tags (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)")
          .run(id, 'crop', 998, now)
        return id
      })()
      db.prepare(
        'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
      ).run(targetId, cropTagId, 1, 1)

      return { success: true, outPath, startSec: s, endSec: e, importedId: targetId }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  // ---- 格式转换 WAV↔MP3：ffmpeg 转码，复用 seamlessLoop 的入库 + 继承元数据模板 ----
  ipcMain.handle('audio:convert', async (_event, soundId: string, targetFormat: 'wav' | 'mp3', bitrate = 192) => {
    try {
      const row = db.prepare('SELECT * FROM sounds WHERE id = ?').get(soundId) as any
      if (!row) return { success: false, message: '找不到文件记录' }

      const curExt = (row.file_ext || '').replace(/^\./, '').toLowerCase()
      const tgt = (targetFormat || '').toLowerCase()
      if (tgt !== 'wav' && tgt !== 'mp3') return { success: false, message: '目标格式仅支持 wav / mp3' }
      if (tgt === curExt) return { success: false, message: `文件已是 .${curExt} 格式` }

      const dir = dirname(row.file_path)
      const { name } = parse(row.file_path)
      const outPath = join(dir, `${name}_conv.${tgt}`)

      const args: string[] = ['-i', row.file_path, '-y', outPath]
      if (tgt === 'mp3') {
        const br = Math.max(64, Math.min(320, Number(bitrate) || 192))
        args.push('-c:a', 'libmp3lame', '-b:a', `${br}k`)
      } else {
        args.push('-c:a', 'pcm_s16le')
      }
      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegPath,
          args,
          { windowsHide: true, timeout: 120000 },
          (err, _stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
        )
      })

      // ---- 自动入库（继承元数据 + 目标格式标签） ----
      const outStat = await stat(outPath)
      const outExt = extname(outPath).toLowerCase()
      const outFileName = basename(outPath)
      const buffer = await readFile(outPath, { length: 64 * 1024 })
      const hash = createHash('sha256').update(buffer).digest('hex')
      const now = new Date().toISOString()
      const newId = uuidv4()
      const newDurationMs = row.duration_ms && row.duration_ms > 0 ? row.duration_ms : 0
      const origDesc: string = row.description || ''
      const finalDescription = `${origDesc}${origDesc ? ' ' : ''}转换为 ${tgt.toUpperCase()}`

      const existing = db.prepare('SELECT id FROM sounds WHERE file_hash = ?').get(hash) as { id: string } | undefined
      const targetId = existing?.id || newId
      if (!existing) {
        db.prepare(`
          INSERT OR IGNORE INTO sounds (
            id, file_path, file_hash, file_name, file_ext, file_size, duration_ms,
            sample_rate, bit_depth, channels, bitrate_kbps, loudness_lufs,
            description, description_en, use_cases, emotion, quality_score,
            similar_to, best_for, ai_model, ai_analyzed_at,
            is_missing, is_trashed, imported_at, updated_at, preview_cache, search_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
        `).run(newId,
          outPath,
          hash,
          outFileName,
          outExt,
          outStat.size,
          newDurationMs,
          row.sample_rate ?? null,
          tgt === 'wav' ? (row.bit_depth ?? 16) : null,
          row.channels ?? null,
          tgt === 'mp3' ? Math.max(64, Math.min(320, Number(bitrate) || 192)) : null,
          row.loudness_lufs ?? null,
          finalDescription || null,
          row.description_en ?? null,
          row.use_cases ?? null,
          row.emotion ?? null,
          row.quality_score ?? null,
          row.similar_to ?? null,
          row.best_for ?? null,
          row.ai_model ?? null,
          row.ai_analyzed_at ?? null, now, now, null, null)
        // 继承原文件的所有标签
        const origTags = db.prepare(
          'SELECT tag_id, confidence, is_manual FROM sound_tags WHERE sound_id = ?'
        ).all(soundId) as Array<{ tag_id: string; confidence: number | null; is_manual: number }>
        const stInsert = db.prepare(
          'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
        )
        for (const t of origTags) {
          stInsert.run(newId, t.tag_id, t.confidence, t.is_manual)
        }
      }

      // 额外添加目标格式标签（wav / mp3，便于按格式筛选）
      const fmtTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tgt) as { id: string } | undefined
      const fmtTagId = fmtTag?.id || (() => {
        const id = uuidv4()
        db.prepare('INSERT OR IGNORE INTO tags (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)')
          .run(id, tgt, 997, now)
        return id
      })()
      db.prepare(
        'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
      ).run(targetId, fmtTagId, 1, 1)

      return { success: true, outPath, format: tgt, importedId: targetId }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  // ---- 变速不变调（ffmpeg atempo 滤镜，改变速度但保持音高） ----
  // 复用 seamlessLoop / convert 的「直写 outPath + 继承元数据 + 加标签」模板
  ipcMain.handle('audio:stretch', async (_event, soundId: string, speed: number) => {
    try {
      const row = db.prepare('SELECT * FROM sounds WHERE id = ?').get(soundId) as any
      if (!row) return { success: false, message: '找不到文件记录' }

      // 速度倍率：0.25x（放慢 4 倍）~ 4x（加快 4 倍），1x 视为无效
      const factor = Math.max(0.25, Math.min(4, Number(speed) || 1))
      if (Math.abs(factor - 1) < 0.001) return { success: false, message: '速度需不等于 1x' }

      // ffmpeg 的 atempo 仅支持 [0.5, 2.0]，超出范围需串联多段
      const buildAtempo = (f: number): string => {
        const chain: string[] = []
        let rem = f
        while (rem > 2.0001) { chain.push('atempo=2.0'); rem /= 2 }
        while (rem < 0.4999) { chain.push('atempo=0.5'); rem /= 0.5 }
        if (rem > 1.0001 || rem < 0.9999) chain.push(`atempo=${rem.toFixed(4)}`)
        return chain.join(',')
      }
      const af = buildAtempo(factor)
      if (!af) return { success: false, message: '无效的速度值' }

      let durSec = (row.duration_ms && row.duration_ms > 0) ? row.duration_ms / 1000 : 0
      if (durSec <= 0) durSec = await getDurationFromFile(row.file_path)

      const dir = dirname(row.file_path)
      const { name } = parse(row.file_path)
      const curExt = (row.file_ext || extname(row.file_path) || '.wav').replace(/^\./, '').toLowerCase()
      // 直接写到源文件同目录（避免跨盘 + 同名重跑用 -y 覆盖）
      const outPath = join(dir, `${name}_${factor}x.${curExt}`)

      const args: string[] = ['-i', row.file_path, '-filter:a', af, '-y', outPath]
      if (curExt === 'mp3') {
        const br = Math.max(64, Math.min(320, Number(row.bitrate_kbps) || 192))
        args.push('-c:a', 'libmp3lame', '-b:a', `${br}k`)
      } else {
        args.push('-c:a', 'pcm_s16le')
      }
      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegPath,
          args,
          { windowsHide: true, timeout: 120000 },
          (err, _stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
        )
      })

      // ---- 自动入库（继承元数据 + 变速标签） ----
      const outStat = await stat(outPath)
      const outExt = extname(outPath).toLowerCase()
      const outFileName = basename(outPath)
      const buffer = await readFile(outPath, { length: 64 * 1024 })
      const hash = createHash('sha256').update(buffer).digest('hex')
      const now = new Date().toISOString()
      const newId = uuidv4()
      const newDurationMs = durSec > 0 ? Math.round((durSec / factor) * 1000) : (row.duration_ms || 0)
      const origDesc: string = row.description || ''
      const finalDescription = `${origDesc}${origDesc ? ' ' : ''}变速 ${factor}x（不变调）`

      const existing = db.prepare('SELECT id FROM sounds WHERE file_hash = ?').get(hash) as { id: string } | undefined
      const targetId = existing?.id || newId
      if (!existing) {
        db.prepare(`
          INSERT OR IGNORE INTO sounds (
            id, file_path, file_hash, file_name, file_ext, file_size, duration_ms,
            sample_rate, bit_depth, channels, bitrate_kbps, loudness_lufs,
            description, description_en, use_cases, emotion, quality_score,
            similar_to, best_for, ai_model, ai_analyzed_at,
            is_missing, is_trashed, imported_at, updated_at, preview_cache, search_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
        `).run(newId,
          outPath,
          hash,
          outFileName,
          outExt,
          outStat.size,
          newDurationMs,
          row.sample_rate ?? null,
          curExt === 'wav' ? (row.bit_depth ?? 16) : null,
          row.channels ?? null,
          curExt === 'mp3' ? Math.max(64, Math.min(320, Number(row.bitrate_kbps) || 192)) : null,
          row.loudness_lufs ?? null,
          finalDescription || null,
          row.description_en ?? null,
          row.use_cases ?? null,
          row.emotion ?? null,
          row.quality_score ?? null,
          row.similar_to ?? null,
          row.best_for ?? null,
          row.ai_model ?? null,
          row.ai_analyzed_at ?? null, now, now, null, null)
        // 继承原文件的所有标签
        const origTags = db.prepare(
          'SELECT tag_id, confidence, is_manual FROM sound_tags WHERE sound_id = ?'
        ).all(soundId) as Array<{ tag_id: string; confidence: number | null; is_manual: number }>
        const stInsert = db.prepare(
          'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
        )
        for (const t of origTags) {
          stInsert.run(newId, t.tag_id, t.confidence, t.is_manual)
        }
      }

      // 额外添加 变速 标签（便于按变速结果筛选）
      const spTag = db.prepare("SELECT id FROM tags WHERE name = ?").get('变速') as { id: string } | undefined
      const spTagId = spTag?.id || (() => {
        const id = uuidv4()
        db.prepare("INSERT OR IGNORE INTO tags (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)")
          .run(id, '变速', 996, now)
        return id
      })()
      db.prepare(
        'INSERT OR IGNORE INTO sound_tags (sound_id, tag_id, confidence, is_manual) VALUES (?, ?, ?, ?)'
      ).run(targetId, spTagId, 1, 1)

      const newDurSec = durSec > 0 ? durSec / factor : 0
      return { success: true, outPath, speed: factor, newDurationMs, newDurationSec: newDurSec, importedId: targetId }
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

  // 备注 / 笔记：更新 sounds.notes 字段（Phase 1-2）
  ipcMain.handle('sound:setNotes', async (_event, soundId: string, notes: string) => {
    try {
      const row = db.prepare('SELECT id FROM sounds WHERE id = ?').get(soundId)
      if (!row) return { success: false, message: '找不到文件记录' }
      db.prepare('UPDATE sounds SET notes = ?, updated_at = ? WHERE id = ?').run(notes, new Date().toISOString(), soundId)
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  // 拟声词（多语种 + 拼音）：更新 sounds.onomatopoeia 字段（Phase 5+）
  ipcMain.handle('sound:setOnomatopoeia', async (_event, soundId: string, json: string) => {
    try {
      const row = db.prepare('SELECT id FROM sounds WHERE id = ?').get(soundId)
      if (!row) return { success: false, message: '找不到文件记录' }
      db.prepare('UPDATE sounds SET onomatopoeia = ?, updated_at = ? WHERE id = ?').run(json, new Date().toISOString(), soundId)
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  // 描述（形象描述）：更新 sounds.description 字段
  ipcMain.handle('sound:setDescription', async (_event, soundId: string, description: string) => {
    try {
      const row = db.prepare('SELECT id FROM sounds WHERE id = ?').get(soundId)
      if (!row) return { success: false, message: '找不到文件记录' }
      db.prepare('UPDATE sounds SET description = ?, updated_at = ? WHERE id = ?').run(description, new Date().toISOString(), soundId)
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  // 详细分析（应用场景）：更新 sounds.best_for 字段
  ipcMain.handle('sound:setBestFor', async (_event, soundId: string, bestFor: string) => {
    try {
      const row = db.prepare('SELECT id FROM sounds WHERE id = ?').get(soundId)
      if (!row) return { success: false, message: '找不到文件记录' }
      db.prepare('UPDATE sounds SET best_for = ?, updated_at = ? WHERE id = ?').run(bestFor, new Date().toISOString(), soundId)
      return { success: true }
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

  // 获取常用目录路径（供扫描快捷入口使用）
  ipcMain.handle('common:getPaths', () => {
    return {
      desktop: app.getPath('desktop'),
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      music: app.getPath('music'),
      videos: app.getPath('videos'),
    }
  })

  // ── 原生右键菜单（备用：PopupMenu portal 定位异常时使用）──
  // 接收菜单项定义 + 坐标，用 Electron Menu.popup() 在主进程弹出。
  // 返回被点击的 item label；未点击（关闭）返回 null。
  interface NativeContextMenuItem {
    label: string
    enabled?: boolean
    danger?: boolean   // 不影响原生样式，仅标记供前端识别
    type?: 'separator' | 'normal'
  }
  ipcMain.handle('contextmenu:native', async (_e, items: NativeContextMenuItem[], x: number, y: number) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) { return null }

    const menuItems = items.map((it) => {
      if (it.type === 'separator') { return { type: 'separator' as const } }
      return {
        label: it.label,
        enabled: it.enabled !== false,
        click: () => {}, // 占位：实际动作由前端通过返回的 label 匹配执行
      }
    })

    const menu = Menu.buildFromTemplate(menuItems)
    // popup 是同步的，但我们在 async handler 中需要 await 它
    return new Promise<string | null>((resolve) => {
      menu.popup({
        window: win,
        x: Math.round(x),
        y: Math.round(y),
        callback: (_menu, winRef, ev) => {
          const clicked = (ev as { label?: string })?.label ?? null
          resolve(clicked)
        },
      })
      // 用户未点击任何项直接关闭时也需要 resolve
      const onClosed = () => {
        win.removeListener('closed', onClosed)
        resolve(null)
      }
      win.on('closed', onClosed)
    })
  })

  // 渲染进程未捕获错误写日志（崩溃精准排查用，落盘 userData/sv-error.log）
  ipcMain.handle('log:rendererError', (_e, msg: string) => {
    try {
      const logPath = join(app.getPath('userData'), 'sv-error.log')
      writeFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, { flag: 'a' })
    } catch { /* ignore */ }
    return { success: true }
  })

  console.log('[IPC] All handlers registered')
}
