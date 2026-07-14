import { app, BrowserWindow, shell, Menu, protocol, net, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync, readFileSync, statSync } from 'fs'
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
    })
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[window] did-fail-load', code, desc, url)
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // 拖放导入：主进程原生 drop 事件捕获文件路径（渲染层 File.path 在新版 Chromium 不可靠）
    // 注意：Electron drop 事件的第二参数是「文件路径字符串数组」，不是对象数组
    let lastDropAt = 0
    const handleNativeDrop = (_event: any, files: any): void => {
      const now = Date.now()
      if (now - lastDropAt < 600) return // 去重：mainWindow 与 webContents 可能都触发
      lastDropAt = now
      const raw = Array.isArray(files) ? files : []
      const paths: string[] = raw
        .map((f: any) => (typeof f === 'string' ? f : f?.path))
        .filter((p: any): p is string => typeof p === 'string' && p.length > 0)
      if (paths.length > 0) {
        mainWindow?.webContents.send('app:drop-paths', paths)
      }
    }
    // drag-over 必须 preventDefault，drop 事件才会触发（阻止系统默认"用关联程序打开文件"）
    mainWindow.webContents.on('drag-over', (e: any) => e.preventDefault())
    mainWindow.on('drop', handleNativeDrop)
    mainWindow.webContents.on('drop', handleNativeDrop)

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
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
