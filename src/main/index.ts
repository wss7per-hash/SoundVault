import { app, BrowserWindow, shell, Menu, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
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
  // net.fetch on the underlying file:// path transparently forwards Range
  // headers, so the <audio> element can seek (drag the progress bar).
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
      console.log('[sv protocol] serving', row.file_path)
      const fileUrl = pathToFileURL(row.file_path).toString()
      return net.fetch(fileUrl, { headers: request.headers })
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
