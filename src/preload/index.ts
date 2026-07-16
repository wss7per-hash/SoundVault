import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // App
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  // 拖放导入：Electron 32+ 移除了渲染层 File.path，官方替代为 webUtils.getPathForFile
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
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

  // 拖放导入：渲染层收集 file.path 后统一交给主进程递归入库
  importPaths: (paths: string[]) => ipcRenderer.invoke('library:importPaths', paths),

  // Sound CRUD
  getSounds: () => ipcRenderer.invoke('sound:getAll'),
  getSoundById: (id: string) => ipcRenderer.invoke('sound:getById', id),
  deleteSound: (id: string) => ipcRenderer.invoke('sound:delete', id),
  toggleStar: (id: string) => ipcRenderer.invoke('sound:toggleStar', id),
  getStarred: () => ipcRenderer.invoke('sound:getStarred'),
  incrementPlayCount: (id: string) => ipcRenderer.invoke('sound:incrementPlayCount', id),
  searchSounds: (query: string) => ipcRenderer.invoke('sound:search', query),
  // 相似音频推荐（以音搜音：标签+文本加权相似度，返回 top 8 + 匹配原因）
  getSimilarSounds: (soundId: string) => ipcRenderer.invoke('sound:similar', soundId) as Promise<SimilarSound[]>,
  getStats: () => ipcRenderer.invoke('sound:getStats'),
  renameSound: (id: string, newName: string) => ipcRenderer.invoke('sound:rename', id, newName),
  setNotes: (id: string, notes: string) => ipcRenderer.invoke('sound:setNotes', id, notes) as Promise<{ success: boolean; message?: string }>,

  // File Operations (Context Menu)
  showItemInFolder: (soundId: string) => ipcRenderer.invoke('file:showItemInFolder', soundId),
  copyFileTo: (soundId: string, targetDir: string) => ipcRenderer.invoke('file:copyTo', soundId, targetDir),
  moveFileTo: (soundId: string, targetDir: string) => ipcRenderer.invoke('file:moveTo', soundId, targetDir),
  trashFile: (soundId: string) => ipcRenderer.invoke('file:trash', soundId),
  findDuplicates: () => ipcRenderer.invoke('library:findDuplicates'),

  // Cleanup missing files (scan or remove)
  cleanupMissing: (mode: 'scan' | 'remove') =>
    ipcRenderer.invoke('sound:cleanupMissing', mode) as Promise<{ success: boolean; total: number; missing: number; removed: number; message?: string }>,

  // Seamless Loop (ffmpeg crossfade)
  seamlessLoop: (soundId: string, crossfadeMs?: number, loopCount?: number) =>
    ipcRenderer.invoke('audio:seamlessLoop', soundId, crossfadeMs, loopCount),
  // 波形峰值（ffmpeg 抽 PCM，结果缓存进 preview_cache）
  getWaveform: (soundId: string) =>
    ipcRenderer.invoke('audio:getWaveform', soundId) as Promise<{ success: boolean; peaks?: number[]; cached?: boolean; message?: string }>,
  // 裁剪截取片段（ffmpeg 按起止时间精确截取，自动入库 + crop 标签）
  trimSound: (soundId: string, startSec: number, endSec: number) =>
    ipcRenderer.invoke('audio:trim', soundId, startSec, endSec) as Promise<{ success: boolean; outPath?: string; startSec?: number; endSec?: number; importedId?: string; message?: string }>,
  // 格式转换 WAV↔MP3（ffmpeg 转码，自动入库 + 目标格式标签）
  convertSound: (soundId: string, targetFormat: 'wav' | 'mp3', bitrate?: number) =>
    ipcRenderer.invoke('audio:convert', soundId, targetFormat, bitrate) as Promise<{ success: boolean; outPath?: string; format?: string; importedId?: string; message?: string }>,
  // 变速不变调（ffmpeg atempo 滤镜，改变速度保持音高，自动入库 + 变速标签）
  stretchSound: (soundId: string, speed: number) =>
    ipcRenderer.invoke('audio:stretch', soundId, speed) as Promise<{ success: boolean; outPath?: string; speed?: number; newDurationMs?: number; newDurationSec?: number; importedId?: string; message?: string }>,

  // AI Analysis
  getAIConfig: () => ipcRenderer.invoke('ai:getConfig'),
  saveAIConfig: (config: any) => ipcRenderer.invoke('ai:saveConfig', config),
  testAIConnection: (config: any) => ipcRenderer.invoke('ai:testConnection', config),
  analyzeSingle: (soundId: string) => ipcRenderer.invoke('ai:analyzeSingle', soundId),
  analyzeBatch: (soundIds: string[], token?: string) => ipcRenderer.invoke('ai:analyzeBatch', soundIds, token),
  cancelAnalysis: (tokens: string[]) => ipcRenderer.invoke('ai:cancelAnalysis', tokens),

  // 云端音效生成（Fal.ai / ElevenLabs）
  generateSFX: (opts: GenOptions) => ipcRenderer.invoke('ai:generateSFX', opts) as Promise<GenResult>,
  getGenBalance: (provider: GenProvider, apiKey: string) =>
    ipcRenderer.invoke('ai:getGenBalance', provider, apiKey) as Promise<{ balance: number | null; message: string }>,
  cancelGeneration: (token: string) => ipcRenderer.invoke('ai:cancelGeneration', token),

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
  // 合并标签前预览真实影响数（该标签关联的音效数）
  getTagSoundCount: (tagId: string) => ipcRenderer.invoke('tag:getSoundCount', tagId) as Promise<number>,
  // 合并标签：src→dst 单条 SQL 事务完成迁移+删除，返回真实迁移数，接入撤销栈
  mergeTags: (srcId: string, dstId: string) =>
    ipcRenderer.invoke('tag:merge', srcId, dstId) as Promise<{ success: boolean; migrated: number; error?: string }>,
  getTagStats: () => ipcRenderer.invoke('tag:getStats'),
  getOnomatopoeiaCloud: () => ipcRenderer.invoke('tag:getOnomatopoeiaCloud') as Promise<TagStatData[]>,
  setOnomatopoeia: (soundId: string, json: string) =>
    ipcRenderer.invoke('sound:setOnomatopoeia', soundId, json) as Promise<{ success: boolean; message?: string }>,

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

  // Metadata backup / restore (lightweight JSON, no audio copy)
  exportMetadata: () =>
    ipcRenderer.invoke('metadata:export') as Promise<{
      success: boolean
      cancelled?: boolean
      filePath?: string
      counts?: { sounds: number; tags: number; collections: number; smartFolders: number }
      error?: string
    }>,
  importMetadata: () =>
    ipcRenderer.invoke('metadata:import') as Promise<{
      success: boolean
      cancelled?: boolean
      matched?: number
      total?: number
      tagsApplied?: number
      notesApplied?: number
      starredApplied?: number
      colsTouched?: number
      sfCreated?: number
      error?: string
    }>,

  // Undo stack (in-memory session stack, multi-step Ctrl+Z)
  undoPeek: () => ipcRenderer.invoke('undo:peek') as Promise<{ label: string; count: number } | null>,
  undoPerform: () =>
    ipcRenderer.invoke('undo:perform') as Promise<{ success: boolean; label: string | null; count: number; error?: string }>,
  undoClear: () => ipcRenderer.invoke('undo:clear') as Promise<{ success: boolean }>,

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  // Native context menu (Electron Menu.popup, guaranteed correct positioning)
  showNativeContextMenu: (
    items: { label: string; enabled?: boolean; danger?: boolean; type?: 'separator' | 'normal' }[],
    x: number,
    y: number
  ) => ipcRenderer.invoke('contextmenu:native', items, x, y) as Promise<string | null>,

  // Window Controls (frameless mode)
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeRestoreWindow: () => ipcRenderer.invoke('window:maximizeRestore'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Global Quick Search (Spotlight overlay)
  hideSpotlight: () => ipcRenderer.send('spotlight:hide'),
  revealSound: (soundId: string) => ipcRenderer.send('spotlight:reveal', soundId),
  // 设置新的呼出快捷键（主进程重注册 + 持久化到 settings 表）
  setSpotlightShortcut: (accelerator: string) => ipcRenderer.invoke('spotlight:setShortcut', accelerator),
  // 从主窗口/工具栏呼出搜索浮层
  openSpotlight: () => ipcRenderer.send('spotlight:open'),
  // 拖动浮层：渲染进程按屏幕坐标增量上报，主进程 setPosition（透明窗口下 -webkit-app-region 不可靠）
  moveSpotlight: (dx: number, dy: number) => ipcRenderer.send('spotlight:move', dx, dy),
  // spotlight 窗口被呼出时的通知（清空/聚焦输入）
  onSpotlightOpened: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('spotlight:opened', listener)
    return () => ipcRenderer.removeListener('spotlight:opened', listener)
  },
  // 主窗口收到「定位选中某音效」的推送
  onSelectSound: (cb: (soundId: string) => void) => {
    const listener = (_e: unknown, soundId: string): void => cb(soundId)
    ipcRenderer.on('main:selectSound', listener)
    return () => ipcRenderer.removeListener('main:selectSound', listener)
  },

  // 获取常用目录路径（扫描快捷入口用）
  getCommonPaths: () =>
    ipcRenderer.invoke('common:getPaths') as Promise<{ desktop: string; documents: string; downloads: string; music: string; videos: string }>
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
