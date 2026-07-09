import { app, BrowserWindow, shell, Menu, protocol, net } from 'electron'
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { mainWindow }
