import { app, BrowserWindow, shell, Menu, Tray, protocol, net, globalShortcut, ipcMain, dialog, screen, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import { initDatabase, closeDatabase, getDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'

// ---- Global crash diagnostics ----
process.on('uncaughtException', (err) => {
  console.error('[FATAL uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL unhandledRejection]', reason)
})
app.on('render-process-gone', (_e, webContents, details) => {
  console.error('[render-process-gone]', webContents.getURL(), details)
})
app.on('child-process-gone', (_e, details) => {
  console.error('[child-process-gone]', details)
})

// Audio: run the Audio Service in-process.
// The out-of-process Audio Service (AudioServiceOutOfProcess) crashes
// repeatedly on headless / RDP / server / no-audio-device setups
// (child-process-gone: Audio Service, exitCode 1). That both blocks
// playback AND destabilizes the renderer (black/frozen window). Running it
// in-process is stable. Relax autoplay so <audio> can load/seek freely.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Register a privileged custom scheme for streaming local audio files.
// Loading file:// from an http(s) (dev) renderer is blocked by webSecurity,
// so we serve audio via sv://<id>, which works in BOTH dev and packaged builds.
protocol.registerSchemesAsPrivileged([
  { scheme: 'sv', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let spotlightWindow: BrowserWindow | null = null
// 全局快捷搜索快捷键（持久化在 settings 表，key=spotlight.shortcut）
const DEFAULT_SPOTLIGHT_SHORTCUT = 'CommandOrControl+Shift+Space'
let currentSpotlightShortcut: string = DEFAULT_SPOTLIGHT_SHORTCUT

/**
 * 从 settings 表读取已保存的呼出快捷键；无记录则返回默认。
 */
function loadSpotlightShortcut(): string {
  try {
    const db = getDatabase()
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('spotlight.shortcut') as { value: string } | undefined
    return row?.value || DEFAULT_SPOTLIGHT_SHORTCUT
  } catch {
    return DEFAULT_SPOTLIGHT_SHORTCUT
  }
}

/**
 * 全局快捷搜索 overlay 窗口（复用同一个 renderer bundle，通过 #spotlight
 * hash 分支渲染 Spotlight 组件，避免多入口构建配置）。懒加载：首次呼出才创建。
 */
function createSpotlightWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 440,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    center: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: true
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#spotlight`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'spotlight' })
  }

  // 失焦即隐藏（点到别处/切走应用），像系统 Spotlight 一样
  win.on('blur', () => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) spotlightWindow.hide()
  })
  win.on('closed', () => {
    spotlightWindow = null
  })
  return win
}

function toggleSpotlight(): void {
  if (!spotlightWindow || spotlightWindow.isDestroyed()) {
    spotlightWindow = createSpotlightWindow()
  }
  if (spotlightWindow.isVisible()) {
    spotlightWindow.hide()
  } else {
    spotlightWindow.center()
    spotlightWindow.show()
    spotlightWindow.focus()
    // 通知渲染端清空/聚焦输入框
    spotlightWindow.webContents.send('spotlight:opened')
  }
}

// ============================================================
// 宠物窗口（声波小精灵）· 透明常驻 / 可开关
// 移植自 duzexu/desktop-pet 的交互思路（GPL-3.0），渲染层为自绘 canvas 精灵。
// 配置以「精简结构」存于 settings 表(key=pet.config)，渲染端用 DEFAULT_PET_CONFIG
// 补全完整规则集（避免主进程重复维护 9 条默认规则）。
// ============================================================
let petWindow: BrowserWindow | null = null
let petTray: Tray | null = null
const PET_CONFIG_KEY = 'pet.config'

interface PetDisplay {
  x: number
  y: number
  scale: number
  opacity: number
  alwaysOnTop: boolean
  clickThrough: boolean
  locked: boolean
}
interface PetBehaviorStored {
  audioBreath?: boolean
  paused?: boolean
}
interface PetConfigStored {
  enabled?: boolean
  display?: Partial<PetDisplay>
  sprite?: { hue?: number; name?: string }
  behavior?: PetBehaviorStored
  messages?: { clickMessages?: string[]; randomMessages?: string[]; bubbleDurationMs?: number }
  ruleEnabled?: Record<string, boolean>
}

const DEFAULT_PET_STORED: PetConfigStored = {
  enabled: true,
  display: { x: 80, y: 160, scale: 0.35, opacity: 1, alwaysOnTop: true, clickThrough: false, locked: false },
  sprite: { hue: 265, name: '声波小精灵' },
  behavior: { audioBreath: true, paused: false },
  messages: {
    clickMessages: ['♪ 这个我喜欢！', '♫ 听起来不错~', '嗨，继续放！'],
    randomMessages: ['在听什么呢？', '需要我帮你找音效吗？', 'SoundVault 随时待命~'],
    bubbleDurationMs: 2000
  },
  ruleEnabled: {}
}

function defaultPetStored(): PetConfigStored {
  return JSON.parse(JSON.stringify(DEFAULT_PET_STORED))
}

function loadPetStored(): PetConfigStored {
  let s: PetConfigStored = defaultPetStored()
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PET_CONFIG_KEY) as
      | { value: string }
      | undefined
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      s = {
        ...defaultPetStored(),
        ...parsed,
        display: { ...defaultPetStored().display, ...(parsed.display || {}) },
        sprite: { ...defaultPetStored().sprite, ...(parsed.sprite || {}) },
        behavior: { ...defaultPetStored().behavior, ...(parsed.behavior || {}) },
        messages: { ...defaultPetStored().messages, ...(parsed.messages || {}) },
        ruleEnabled: { ...(parsed.ruleEnabled || {}) }
      }
    }
  } catch {
    /* 解析失败回退默认 */
  }
  // ── 迁移：宠物默认尺寸逐步收紧 ──
  // 旧装/旧默认把 scale 存成了 1 或 0.7，统一纠正到当前默认（0.35），
  // 仅当存储值恰好为旧默认值时执行，避免覆盖用户主动调整过的尺寸。
  if (s.display && (s.display.scale === 1 || s.display.scale === 0.7)) {
    s.display.scale = DEFAULT_PET_STORED.display.scale
    persistPetStored(s)
  }
  return s
}

function persistPetStored(s: PetConfigStored): void {
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `).run(PET_CONFIG_KEY, JSON.stringify(s), new Date().toISOString(), JSON.stringify(s), new Date().toISOString())
  } catch {
    /* 持久化失败不阻断 */
  }
}

/** 深合并两个精简配置（用于 saveConfig 的部分覆盖，避免丢失 behavior / display 等子对象） */
function mergePetStored(base: PetConfigStored, patch: PetConfigStored): PetConfigStored {
  return {
    ...base,
    ...patch,
    display: { ...(base.display || {}), ...(patch.display || {}) },
    sprite: { ...(base.sprite || {}), ...(patch.sprite || {}) },
    behavior: { ...(base.behavior || {}), ...(patch.behavior || {}) },
    messages: { ...(base.messages || {}), ...(patch.messages || {}) },
    ruleEnabled: { ...(base.ruleEnabled || {}), ...(patch.ruleEnabled || {}) }
  }
}

function applyDisplayToWindow(win: BrowserWindow, d: PetDisplay): void {
  win.setAlwaysOnTop(!!d.alwaysOnTop, 'screen-saver')
  win.setIgnoreMouseEvents(!!d.clickThrough)
}

function createPetWindow(): BrowserWindow {
  const cfg = loadPetStored()
  const d = cfg.display as PetDisplay
  const win = new BrowserWindow({
    width: 240,
    height: 300,
    x: d.x,
    y: d.y,
    show: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: !!d.alwaysOnTop,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: true
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#pet`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'pet' })
  }

  applyDisplayToWindow(win, d)

  win.on('closed', () => {
    petWindow = null
  })
  return win
}

// 销毁宠物窗口（同步关闭，供主窗口关闭 / app 退出时清理）
function closePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy()
  }
  petWindow = null
}

// 销毁全局快捷搜索 overlay（隐藏态仍存活，会阻塞 app 退出，一并清理）
function closeSpotlightWindow(): void {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    spotlightWindow.destroy()
  }
  spotlightWindow = null
}

function showPetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow()
  } else {
    petWindow.show()
    const d = loadPetStored().display as PetDisplay
    applyDisplayToWindow(petWindow, d)
  }
}

function hidePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.hide()
}

function setPetEnabled(enabled: boolean): void {
  const s = loadPetStored()
  s.enabled = enabled
  persistPetStored(s)
  if (enabled) showPetWindow()
  else hidePetWindow()
  // 通知主窗口（设置面板）同步开关状态
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:state', { visible: enabled })
  }
}

function togglePetWindow(): void {
  setPetEnabled(!loadPetStored().enabled)
}

/** 部分更新宠物显示态（位置/缩放/透明度/置顶/点击穿透/锁定）并立即应用到窗口 */
function setPetDisplay(patch: Partial<PetDisplay>): void {
  const s = loadPetStored()
  s.display = { ...(s.display || {}), ...patch } as PetDisplay
  persistPetStored(s)
  if (petWindow && !petWindow.isDestroyed()) {
    const d = s.display as PetDisplay
    applyDisplayToWindow(petWindow, d)
    if (typeof d.x === 'number' && typeof d.y === 'number') petWindow.setPosition(d.x, d.y)
  }
}

/** 部分更新宠物行为（暂停互动 / 跟随音量呼吸）并通知渲染端重载 */
function setPetBehavior(patch: PetBehaviorStored): void {
  const s = loadPetStored()
  s.behavior = { ...(s.behavior || {}), ...patch }
  persistPetStored(s)
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:config')
}

/** 重置宠物到默认位置（屏幕左下 80,160） */
function resetPetPosition(): void {
  const s = loadPetStored()
  s.display = { ...(s.display || {}), x: 80, y: 160 } as PetDisplay
  persistPetStored(s)
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setPosition(80, 160)
    applyDisplayToWindow(petWindow, s.display as PetDisplay)
    petWindow.webContents.send('pet:config')
  }
}

/** 构建系统托盘右键菜单（标签随当前状态动态变化） */
function buildPetTrayMenu(): Menu {
  const s = loadPetStored()
  const d = (s.display || {}) as PetDisplay
  const b = s.behavior || {}
  const items: MenuItemConstructorOptions[] = [
    {
      label: '打开 SoundVault',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    { label: s.enabled ? '隐藏小精灵' : '显示小精灵', click: () => togglePetWindow() },
    { label: `${d.locked ? '解锁' : '锁定'}拖动`, click: () => setPetDisplay({ locked: !d.locked }) },
    { label: `点击穿透：${d.clickThrough ? '开' : '关'}`, click: () => setPetDisplay({ clickThrough: !d.clickThrough }) },
    { label: `置顶：${d.alwaysOnTop ? '开' : '关'}`, click: () => setPetDisplay({ alwaysOnTop: !d.alwaysOnTop }) },
    { label: `暂停互动：${b.paused ? '开' : '关'}`, click: () => setPetBehavior({ paused: !b.paused }) },
    { label: `跟随音量呼吸：${b.audioBreath ? '开' : '关'}`, click: () => setPetBehavior({ audioBreath: !b.audioBreath }) },
    { type: 'separator' },
    { label: '缩放 35%', click: () => setPetDisplay({ scale: 0.35 }) },
    { label: '缩放 50%', click: () => setPetDisplay({ scale: 0.5 }) },
    { label: '缩放 70%', click: () => setPetDisplay({ scale: 0.7 }) },
    { label: '缩放 100%', click: () => setPetDisplay({ scale: 1 }) },
    { label: '重置位置', click: () => resetPetPosition() },
    { type: 'separator' },
    { label: '退出 SoundVault', click: () => app.quit() }
  ]
  return Menu.buildFromTemplate(items)
}

/** 创建系统托盘图标与菜单（复用应用可执行文件图标，避免额外素材依赖） */
function createPetTray(): void {
  if (petTray) return
  petTray = new Tray(nativeImage.createEmpty())
  petTray.setToolTip('SoundVault · 声波小精灵')
  petTray.on('click', () => {
    if (petTray) petTray.popupContextMenu(buildPetTrayMenu())
  })
  // 用应用图标作为托盘图标（Windows 托盘需要有效图标）
  try {
    const exePath = app.getPath('exe')
    app.getFileIcon(exePath).then((icon) => {
      if (petTray && !icon.isEmpty()) petTray.setImage(icon)
    }).catch(() => {})
  } catch {
    /* 图标获取失败不阻断托盘创建 */
  }
}

/** 销毁系统托盘 */
function destroyPetTray(): void {
  if (petTray) {
    petTray.destroy()
    petTray = null
  }
}

function createWindow(): void {
  try {
    console.log('[createWindow] building BrowserWindow...')
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      show: false,
      center: true,
      title: 'SoundVault',
      backgroundColor: '#1a1a18',
      frame: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: true
      }
    })
    console.log('[createWindow] BrowserWindow created. preload=', join(__dirname, '../preload/index.js'))

    mainWindow.on('ready-to-show', () => {
      console.log('[window] ready-to-show -> show() + focus + bringToFront')
      mainWindow?.show()
      mainWindow?.focus()
      mainWindow?.setAlwaysOnTop(true)
      setTimeout(() => mainWindow?.setAlwaysOnTop(false), 2000)
    })
    mainWindow.on('closed', () => {
      console.log('[window] closed')
      mainWindow = null
      // 主窗口关闭时一并销毁宠物（声波小精灵）与搜索浮层，
      // 否则宠物窗口常驻会使 app 永不退出、宠物随之残留。
      closePetWindow()
      closeSpotlightWindow()
    })
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[window] did-fail-load', code, desc, url)
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // 拖放导入由渲染层处理：Electron 32+ 用 webUtils.getPathForFile 取路径（BrowserWindow/webContents 无原生 drop 事件）

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      console.log('[createWindow] loadURL', process.env['ELECTRON_RENDERER_URL'])
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      console.log('[createWindow] loadFile', join(__dirname, '../renderer/index.html'))
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // Hide the default menu bar on Windows/Linux so the dark UI feels unified.
    // macOS keeps a minimal native app menu for copy/paste shortcuts.
    if (process.platform === 'win32' || process.platform === 'linux') {
      mainWindow.setMenu(null)
      Menu.setApplicationMenu(null)
    }
    console.log('[createWindow] done.')
  } catch (err) {
    console.error('[createWindow] FAILED', err)
  }
}

app.whenReady().then(() => {
  // Stream local audio through the privileged 'sv://<id>' scheme.
  //
  // Two serving strategies:
  //  - Small files (< 8 MB): read into memory with fs.readFileSync → Response
  //    (most reliable, guarantees correct MIME type, avoids Range issues)
  //  - Large files: use net.fetch on file:// URL with explicit Content-Type
  //    (preserves memory, supports Range for seeking)
  const MIME_MAP: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.mp4': 'video/mp4',
    '.webm': 'audio/webm',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.opus': 'audio/ogg; codecs=opus',
  }
  const SMALL_FILE_THRESHOLD = 8 * 1024 * 1024 // 8 MB

  protocol.handle('sv', async (request) => {
    try {
      const id = decodeURIComponent(new URL(request.url).hostname)
      const row = getDatabase()
        .prepare('SELECT file_path FROM sounds WHERE id = ?')
        .get(id) as { file_path: string } | undefined
      if (!row) {
        console.error('[sv protocol] sound not found for id=', id)
        return new Response('Not Found', { status: 404 })
      }
      const filePath = row.file_path
      if (!existsSync(filePath)) {
        console.error('[sv protocol] file not found:', filePath)
        return new Response('File not found', { status: 404 })
      }
      const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
      const contentType = MIME_MAP[ext] || 'application/octet-stream'
      const stat = statSync(filePath)

      if (stat.size <= SMALL_FILE_THRESHOLD) {
        // Small file: read fully into Response body (most reliable playback)
        const buf = readFileSync(filePath)
        console.log('[sv protocol] serving in-memory', filePath, `(${buf.length}B ${contentType})`)
        return new Response(buf, {
          headers: {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(buf.length),
          },
        })
      }

      // Large file: stream via net.fetch with correct Content-Type header
      console.log('[sv protocol] streaming', filePath, `(${stat.size}B ${contentType})`)
      const fileUrl = pathToFileURL(filePath).toString()
      return net.fetch(fileUrl, { headers: request.headers }).then((res) => {
        // Clone response to override headers (Response headers are immutable)
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: {
            ...Object.fromEntries(res.headers.entries()),
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          },
        })
      })
    } catch (err) {
      console.error('[sv protocol] error:', err)
      return new Response(String(err), { status: 500 })
    }
  })

  initDatabase()
  registerIpcHandlers()
  createWindow()

  // 宠物（声波小精灵）：默认常驻显示，enabled=false 时不创建窗口
  if (loadPetStored().enabled) {
    // 延迟一帧创建，避免与主窗口抢首屏资源
    setTimeout(() => {
      if (!petWindow) petWindow = createPetWindow()
    }, 300)
  }

  // 系统托盘：始终创建（即便宠物隐藏，也可从托盘恢复 / 退出应用）
  createPetTray()

  // 全局快捷搜索：注册系统级快捷键（默认 Ctrl/Cmd+Shift+Space，可在 Spotlight 内自定义并持久化）
  currentSpotlightShortcut = loadSpotlightShortcut()
  const ok = globalShortcut.register(currentSpotlightShortcut, toggleSpotlight)
  if (!ok) console.warn(`[globalShortcut] 注册 ${currentSpotlightShortcut} 失败（可能被占用）`)

  // spotlight → 隐藏自身
  ipcMain.on('spotlight:hide', () => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) spotlightWindow.hide()
  })
  // spotlight → 在主窗口中定位并选中某音效
  ipcMain.on('spotlight:reveal', (_e, soundId: string) => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) spotlightWindow.hide()
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('main:selectSound', soundId)
    }
  })
  // spotlight → 重新注册呼出快捷键（unregister 旧 + register 新，并持久化）
  ipcMain.handle('spotlight:setShortcut', (_e, accelerator: string) => {
    try {
      globalShortcut.unregister(currentSpotlightShortcut)
    } catch {
      /* 旧的可能本就未注册，忽略 */
    }
    const ok = globalShortcut.register(accelerator, toggleSpotlight)
    if (ok) {
      currentSpotlightShortcut = accelerator
      try {
        const db = getDatabase()
        db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
        `).run(
          'spotlight.shortcut',
          accelerator,
          new Date().toISOString(),
          accelerator,
          new Date().toISOString()
        )
      } catch {
        /* 持久化失败不阻断本次注册 */
      }
      return { success: true, shortcut: accelerator }
    }
    // 注册失败：回退到旧快捷键，避免搜索彻底失效
    globalShortcut.register(currentSpotlightShortcut, toggleSpotlight)
    return { success: false, error: '该快捷键可能已被系统或其他程序占用' }
  })
  // spotlight → 从主窗口 / 工具栏呼出搜索浮层
  ipcMain.on('spotlight:open', () => {
    toggleSpotlight()
  })
  // spotlight → 拖动浮层（渲染进程按屏幕坐标增量上报，主进程 setPosition）
  ipcMain.on('spotlight:move', (_e, dx: number, dy: number) => {
    if (!spotlightWindow || spotlightWindow.isDestroyed()) return
    const [x, y] = spotlightWindow.getPosition()
    spotlightWindow.setPosition(Math.round(x + dx), Math.round(y + dy))
  })

  // ── 宠物（声波小精灵）IPC ──
  ipcMain.handle('pet:getConfig', () => loadPetStored())
  ipcMain.handle('pet:saveConfig', (_e, cfg: PetConfigStored) => {
    // 合并而非整体覆盖：防止设置面板仅保存部分字段时丢失 behavior / display
    const merged = mergePetStored(loadPetStored(), cfg)
    persistPetStored(merged)
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:config')
    return { success: true }
  })
  // 行为开关（暂停互动 / 跟随音量呼吸）独立持久化，便于右键菜单 / 托盘直接切换
  ipcMain.on('pet:setBehavior', (_e, behavior: PetBehaviorStored) => {
    setPetBehavior(behavior)
  })
  ipcMain.handle('pet:setDisplay', (_e, display: Partial<PetDisplay>) => {
    setPetDisplay(display)
    return { success: true }
  })
  // 渲染进程拖动宠物：按屏幕坐标增量移动窗口，并持久化新位置
  ipcMain.on('pet:move', (_e, dx: number, dy: number) => {
    if (!petWindow || petWindow.isDestroyed()) return
    const [x, y] = petWindow.getPosition()
    const nx = Math.round(x + dx)
    const ny = Math.round(y + dy)
    petWindow.setPosition(nx, ny)
    const s = loadPetStored()
    s.display = { ...(s.display || {}), x: nx, y: ny } as PetDisplay
    persistPetStored(s)
  })
  // 渲染进程按绝对屏幕坐标定位宠物窗口（绝对定位拖动，避免累积抖动）
  ipcMain.handle('pet:getBounds', () => {
    if (!petWindow || petWindow.isDestroyed()) return null
    const [x, y] = petWindow.getPosition()
    const [w, h] = petWindow.getSize()
    return { x, y, width: w, height: h }
  })
  ipcMain.on('pet:moveTo', (_e, x: number, y: number) => {
    if (!petWindow || petWindow.isDestroyed()) return
    // 限制在屏幕工作区内，避免宠物被拖出可视范围
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const [w, h] = petWindow.getSize()
    const nx = Math.max(0, Math.min(sw - w, Math.round(x)))
    const ny = Math.max(0, Math.min(sh - h, Math.round(y)))
    petWindow.setPosition(nx, ny)
    const s = loadPetStored()
    s.display = { ...(s.display || {}), x: nx, y: ny } as PetDisplay
    persistPetStored(s)
  })
  // 退出整个应用（右键菜单「退出 SoundVault」）
  ipcMain.on('pet:quit', () => {
    app.quit()
  })
  ipcMain.on('pet:resetPosition', () => resetPetPosition())
  ipcMain.on('pet:toggle', () => togglePetWindow())
  ipcMain.on('pet:show', () => showPetWindow())
  ipcMain.on('pet:hide', () => hidePetWindow())
  ipcMain.on('pet:setEnabled', (_e, enabled: boolean) => setPetEnabled(enabled))
  // 设置面板请求打开宠物设置（定位到主窗口设置面板宠物标签页）
  ipcMain.on('pet:openSettings', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('pet:openSettings')
    }
  })
  // 音频联动：主窗口播放音效时上报电平/起停，转发给宠物窗口
  ipcMain.on('pet:audio', (_e, payload: { type: 'level' | 'start' | 'stop'; level?: number }) => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:audio', payload)
  })
  // 设置变更后通知宠物窗口重载配置
  ipcMain.on('pet:configChanged', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:config')
  })

  // ── Petpack 导入 / 导出（jszip 打包精简配置 + manifest） ──
  ipcMain.handle('pet:exportPetpack', async () => {
    try {
      const cfg = loadPetStored()
      const manifest = {
        format: 'soundvault-petpack',
        version: 1,
        appVersion: '0.1.0',
        exportedAt: new Date().toISOString(),
        config: cfg
      }
      const zip = new JSZip()
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))
      const buf = await zip.generateAsync({ type: 'nodebuffer' })
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow ?? undefined, {
        title: '导出声波小精灵配置 (Petpack)',
        defaultPath: 'soundvault-petpack.svpet',
        filters: [{ name: 'SoundVault Petpack', extensions: ['svpet', 'zip'] }]
      })
      if (canceled || !filePath) return { success: false, message: '已取消' }
      writeFileSync(filePath, buf)
      return { success: true, path: filePath }
    } catch (e) {
      return { success: false, message: String((e as Error)?.message || e) }
    }
  })

  ipcMain.handle('pet:importPetpack', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: '导入声波小精灵配置 (Petpack)',
        properties: ['openFile'],
        filters: [{ name: 'SoundVault Petpack', extensions: ['svpet', 'zip'] }]
      })
      if (canceled || !filePaths || filePaths.length === 0) return { success: false, message: '已取消' }
      const data = readFileSync(filePaths[0])
      const zip = await JSZip.loadAsync(data)
      const mf = zip.file('manifest.json')
      if (!mf) return { success: false, message: '无效的 Petpack：缺少 manifest.json' }
      const manifest = JSON.parse(await mf.async('string'))
      if (manifest?.format !== 'soundvault-petpack' || !manifest?.config) {
        return { success: false, message: 'Petpack 格式不匹配' }
      }
      const imported = manifest.config as PetConfigStored
      const base = defaultPetStored()
      const merged: PetConfigStored = {
        ...base,
        ...imported,
        display: { ...base.display, ...(imported.display || {}) },
        sprite: { ...base.sprite, ...(imported.sprite || {}) },
        messages: { ...base.messages, ...(imported.messages || {}) },
        ruleEnabled: { ...(imported.ruleEnabled || {}) }
      }
      persistPetStored(merged)
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:config')
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pet:openSettings')
      return { success: true }
    } catch (e) {
      return { success: false, message: String((e as Error)?.message || e) }
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  // 退出前确保常驻窗口 / 托盘都被销毁，避免宠物 / 浮层残留导致进程不退出
  destroyPetTray()
  closePetWindow()
  closeSpotlightWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { mainWindow }
