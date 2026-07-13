import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // App
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  // 系统级文件拖拽（拖到 AE 等外部应用直接导入）
  startDragFile: (filePath: string) => ipcRenderer.send('app:dragFile', filePath),
  // 一键导入正在运行的 After Effects（官方 ExtendScript importFile）
  importToAE: (filePath: string) =>
    ipcRenderer.invoke('app:importToAE', filePath) as Promise<{ success: boolean; name?: string; message?: string }>,

  // Dialog
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // Scan & Import
  scanFolder: (options: {
    targetPath: string
    recursive: boolean
    filenameIncludes: string[]
    filenameExcludes: string[]
    minSizeKB: number
    maxSizeKB: number
    skipHidden: boolean
    includeVideo: boolean
  }) => ipcRenderer.invoke('scan:folder', options),

  importSounds: (files: Array<{ path: string; name: string; ext: string; size: number }>) =>
    ipcRenderer.invoke('sound:import', files),

  // Sound CRUD
  getSounds: () => ipcRenderer.invoke('sound:getAll'),
  getSoundById: (id: string) => ipcRenderer.invoke('sound:getById', id),
  deleteSound: (id: string) => ipcRenderer.invoke('sound:delete', id),
  toggleStar: (id: string) => ipcRenderer.invoke('sound:toggleStar', id),
  getStarred: () => ipcRenderer.invoke('sound:getStarred'),
  incrementPlayCount: (id: string) => ipcRenderer.invoke('sound:incrementPlayCount', id),
  searchSounds: (query: string) => ipcRenderer.invoke('sound:search', query),
  getStats: () => ipcRenderer.invoke('sound:getStats'),
  renameSound: (id: string, newName: string) => ipcRenderer.invoke('sound:rename', id, newName),

  // File Operations (Context Menu)
  showItemInFolder: (soundId: string) => ipcRenderer.invoke('file:showItemInFolder', soundId),
  copyFileTo: (soundId: string, targetDir: string) => ipcRenderer.invoke('file:copyTo', soundId, targetDir),
  moveFileTo: (soundId: string, targetDir: string) => ipcRenderer.invoke('file:moveTo', soundId, targetDir),
  trashFile: (soundId: string) => ipcRenderer.invoke('file:trash', soundId),

  // Seamless Loop (ffmpeg crossfade)
  seamlessLoop: (soundId: string, crossfadeMs?: number, loopCount?: number) =>
    ipcRenderer.invoke('audio:seamlessLoop', soundId, crossfadeMs, loopCount),
  // 波形峰值（ffmpeg 抽 PCM，结果缓存进 preview_cache）
  getWaveform: (soundId: string) =>
    ipcRenderer.invoke('audio:getWaveform', soundId) as Promise<{ success: boolean; peaks?: number[]; cached?: boolean; message?: string }>,

  // AI Analysis
  getAIConfig: () => ipcRenderer.invoke('ai:getConfig'),
  saveAIConfig: (config: any) => ipcRenderer.invoke('ai:saveConfig', config),
  testAIConnection: (config: any) => ipcRenderer.invoke('ai:testConnection', config),
  analyzeSingle: (soundId: string) => ipcRenderer.invoke('ai:analyzeSingle', soundId),
  analyzeBatch: (soundIds: string[], token?: string) => ipcRenderer.invoke('ai:analyzeBatch', soundIds, token),
  cancelAnalysis: (tokens: string[]) => ipcRenderer.invoke('ai:cancelAnalysis', tokens),

  // Tags
  getTags: () => ipcRenderer.invoke('tag:getAll'),
  getTagsForSound: (soundId: string) => ipcRenderer.invoke('tag:getForSound', soundId),
  addTag: (name: string, parentId: string | null, color: string | null) =>
    ipcRenderer.invoke('tag:add', name, parentId, color),
  addTagToSound: (soundId: string, tagName: string, confidence: number) =>
    ipcRenderer.invoke('tag:addToSound', soundId, tagName, confidence),
  removeTagFromSound: (soundId: string, tagId: string) =>
    ipcRenderer.invoke('tag:removeFromSound', soundId, tagId),
  deleteTag: (tagId: string) => ipcRenderer.invoke('tag:delete', tagId),
  updateTag: (tagId: string, updates: { name?: string; color?: string; parent_id?: string | null }) =>
    ipcRenderer.invoke('tag:update', tagId, updates),
  getTagStats: () => ipcRenderer.invoke('tag:getStats'),

  // Collections
  getCollections: () => ipcRenderer.invoke('collection:getAll'),
  createCollection: (name: string, description: string) =>
    ipcRenderer.invoke('collection:create', name, description),
  getCollectionSounds: (collectionId: string) =>
    ipcRenderer.invoke('collection:getSounds', collectionId),
  addToCollection: (collectionId: string, soundId: string) =>
    ipcRenderer.invoke('collection:addSound', collectionId, soundId),
  removeFromCollection: (collectionId: string, soundId: string) =>
    ipcRenderer.invoke('collection:removeSound', collectionId, soundId),
  deleteCollection: (id: string) => ipcRenderer.invoke('collection:delete', id),
  updateCollection: (id: string, updates: { name?: string; description?: string }) =>
    ipcRenderer.invoke('collection:update', id, updates),

  // Smart Folders
  saveSmartFolder: (data: { id?: string; name: string; conditions: string }) =>
    ipcRenderer.invoke('smartFolder:save', data),
  getSmartFolders: () => ipcRenderer.invoke('smartFolder:getAll'),
  deleteSmartFolder: (id: string) => ipcRenderer.invoke('smartFolder:delete', id),
  getSmartFolderSounds: (folderId: string) => ipcRenderer.invoke('smartFolder:getSounds', folderId),
  previewSmartFolder: (conditionsJson: string) => ipcRenderer.invoke('smartFolder:preview', conditionsJson),
  autoClassify: (dimension: string, options?: { maxGroups?: number; minPerGroup?: number }) =>
    ipcRenderer.invoke('smartFolder:autoClassify', dimension, options),

  // Library Export / Import (portable bundle)
  exportLibrary: (destDir: string, soundIds?: string[], token?: string) =>
    ipcRenderer.invoke('library:export', destDir, soundIds, token),
  importLibrary: (bundleDir: string) => ipcRenderer.invoke('library:import', bundleDir),
  // Cancel an in-flight export (by token)
  cancelExport: (token: string) => ipcRenderer.invoke('library:cancelExport', token),
  // Subscribe to live export progress events; returns an unsubscribe fn.
  onExportProgress: (cb: (p: any) => void) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('library:export-progress', listener)
    return () => ipcRenderer.removeListener('library:export-progress', listener)
  },
  // Open a folder in the OS file explorer
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),

  // Batch Operations
  batchDelete: (ids: string[]) => ipcRenderer.invoke('sound:batchDelete', ids),
  batchTag: (soundIds: string[], tagNames: string[], action: 'add' | 'remove') =>
    ipcRenderer.invoke('sound:batchTag', soundIds, tagNames, action),

  // Trash / Recycle Bin
  getTrash: () => ipcRenderer.invoke('sound:getTrash'),
  restoreSounds: (ids: string[]) => ipcRenderer.invoke('sound:restore', ids),
  permanentDelete: (ids: string[], deleteLocalFile?: boolean) => ipcRenderer.invoke('sound:permanentDelete', ids, deleteLocalFile),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  // Window Controls (frameless mode)
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeRestoreWindow: () => ipcRenderer.invoke('window:maximizeRestore'),
  closeWindow: () => ipcRenderer.invoke('window:close')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
