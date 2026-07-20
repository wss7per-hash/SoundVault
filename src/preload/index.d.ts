import type { PetConfigStored } from '../shared/pet-types'

declare global {
  interface Window {
    api: SoundVaultAPI
  }
}

export interface SoundVaultAPI {
  // App
  getVersion: () => Promise<string>
  // 拖放导入：Electron 32+ 用 webUtils.getPathForFile 取代已移除的 File.path
  getPathForFile: (file: File) => string
  // 系统级文件拖拽（拖到 AE 等外部应用直接导入）
  startDragFile: (filePath: string) => void
  // 一键导入正在运行的 After Effects（官方 ExtendScript importFile），支持批量（传入路径数组）
  importToAE: (filePaths: string[]) => Promise<{ success: boolean; name?: string; message?: string; code?: string; count?: number }>

  // Dialog
  selectFolder: () => Promise<string[]>

  // Scan & Import
  scanFolder: (options: ScanOptions) => Promise<ScanResult>
  importSounds: (files: ImportFile[]) => Promise<{ imported: number }>
  importPaths: (paths: string[]) => Promise<{ imported: number; total: number }>

  // Sound CRUD
  getSounds: (opts?: { sortBy?: 'name' | 'duration' | 'size' | 'date'; sortOrder?: 'asc' | 'desc'; format?: string }) => Promise<SoundData[]>
  getSoundById: (id: string) => Promise<SoundData | undefined>
  deleteSound: (id: string) => Promise<{ success: boolean }>
  toggleStar: (id: string) => Promise<{ success: boolean; is_starred: boolean }>
  getStarred: () => Promise<SoundData[]>
  incrementPlayCount: (id: string) => Promise<void>
  searchSounds: (query: string) => Promise<SoundData[]>
  // 相似音频推荐（以音搜音）：输入音效 id，返回相似度最高的 top 8
  getSimilarSounds: (soundId: string) => Promise<SimilarSound[]>
  getStats: () => Promise<StatsData>
  // 清理无效文件：扫描本地音频丢失的条目。mode='scan' 仅返回统计；'remove' 永久删除缺失条目
  cleanupMissing: (mode: 'scan' | 'remove') => Promise<{ success: boolean; total: number; missing: number; removed: number; message?: string }>
  renameSound: (id: string, newName: string) => Promise<{ success: boolean; fileName?: string; message?: string }>
  setNotes: (id: string, notes: string) => Promise<{ success: boolean; message?: string }>
  setDescription: (id: string, description: string) => Promise<{ success: boolean; message?: string }>
  setBestFor: (id: string, bestFor: string) => Promise<{ success: boolean; message?: string }>

  // File Operations (Context Menu)
  showItemInFolder: (soundId: string) => Promise<{ success: boolean; message?: string }>
  copyFileTo: (soundId: string, targetDir: string) => Promise<{ success: boolean; path?: string; message?: string }>
  copyFilesTo: (filePaths: string[], targetDir: string) => Promise<{ success: boolean; copied?: number; failed?: number; errors?: string[] }>
  moveFileTo: (soundId: string, targetDir: string) => Promise<{ success: boolean; path?: string; message?: string }>
  trashFile: (soundId: string) => Promise<{ success: boolean; message?: string }>
  findDuplicates: () => Promise<DuplicateGroup[]>
  seamlessLoop: (soundId: string, crossfadeMs?: number, loopCount?: number) => Promise<{ success: boolean; outPath?: string; crossfadeMs?: number; loopCount?: number; importedId?: string; message?: string }>
  // 波形峰值（ffmpeg 抽 PCM，结果缓存进 preview_cache）
  getWaveform: (soundId: string) => Promise<{ success: boolean; peaks?: number[]; cached?: boolean; message?: string }>
  // 裁剪截取片段（ffmpeg 按起止时间精确截取，自动入库 + crop 标签）
  trimSound: (soundId: string, startSec: number, endSec: number) => Promise<{ success: boolean; outPath?: string; startSec?: number; endSec?: number; importedId?: string; message?: string }>
  // 格式转换 WAV↔MP3（ffmpeg 转码，自动入库 + 目标格式标签）
  convertSound: (soundId: string, targetFormat: 'wav' | 'mp3', bitrate?: number) => Promise<{ success: boolean; outPath?: string; format?: string; importedId?: string; message?: string }>
  stretchSound: (soundId: string, speed: number) => Promise<{ success: boolean; outPath?: string; speed?: number; newDurationMs?: number; newDurationSec?: number; importedId?: string; message?: string }>

  // AI Analysis
  getAIConfig: () => Promise<AIConfig>
  saveAIConfig: (config: Partial<AIConfig>) => Promise<{ success: boolean }>
  testAIConnection: (config: AIConfig) => Promise<{ success: boolean; message: string }>
  analyzeSingle: (soundId: string) => Promise<AnalyzeResult>
  analyzeBatch: (soundIds: string[], token?: string) => Promise<{ success: boolean; analyzed: number; cancelled?: boolean }>
  cancelAnalysis: (tokens: string[]) => Promise<{ success: boolean; cancelled: number }>

  // 云端音效生成（Fal.ai / ElevenLabs）
  generateSFX: (opts: GenOptions) => Promise<GenResult>
  getGenBalance: (provider: GenProvider, apiKey: string) => Promise<{ balance: number | null; message: string }>
  cancelGeneration: (token: string) => Promise<{ success: boolean; cancelled: boolean }>

  // Tags
  getTags: () => Promise<TagData[]>
  getTagsForSound: (soundId: string) => Promise<TagWithMeta[]>
  addTag: (name: string, parentId: string | null, color: string | null) => Promise<{ id: string }>
  addTagToSound: (soundId: string, tagName: string, confidence: number) => Promise<{ success: boolean }>
  removeTagFromSound: (soundId: string, tagId: string) => Promise<{ success: boolean }>
  deleteTag: (tagId: string) => Promise<{ success: boolean }>
  updateTag: (tagId: string, updates: { name?: string; color?: string; parent_id?: string | null }) => Promise<{ success: boolean }>
  // 合并标签前预览真实影响数（该标签关联的音效数）
  getTagSoundCount: (tagId: string) => Promise<number>
  // 合并标签：src→dst 单条 SQL 事务完成迁移+删除，返回真实迁移数，接入撤销栈
  mergeTags: (srcId: string, dstId: string) => Promise<{ success: boolean; migrated: number; error?: string }>
  getTagStats: () => Promise<TagStatData[]>

  // Collections
  getCollections: () => Promise<CollectionData[]>
  createCollection: (name: string, description: string) => Promise<{ id: string }>
  getCollectionSounds: (collectionId: string) => Promise<SoundData[]>
  addToCollection: (collectionId: string, soundId: string) => Promise<{ success: boolean }>
  removeFromCollection: (collectionId: string, soundId: string) => Promise<{ success: boolean }>
  deleteCollection: (id: string) => Promise<{ success: boolean }>
  updateCollection: (id: string, updates: { name?: string; description?: string }) => Promise<{ success: boolean }>

  // Smart Folders
  saveSmartFolder: (data: SmartFolderInput) => Promise<{ id: string }>
  getSmartFolders: () => Promise<SmartFolderData[]>
  deleteSmartFolder: (id: string) => Promise<{ success: boolean }>
  getSmartFolderSounds: (folderId: string) => Promise<SoundData[]>
  previewSmartFolder: (conditionsJson: string) => Promise<SoundData[]>
  // 一键智能分类：按维度自动生成智能文件夹，返回创建/跳过摘要
  autoClassify: (dimension: string, options?: { maxGroups?: number; minPerGroup?: number }) => Promise<{ created: number; skipped: number; names: string[] }>

  // Library Export / Import (portable bundle)
  exportLibrary: (destDir: string, soundIds?: string[], token?: string) => Promise<ExportResult>
  importLibrary: (bundleDir: string) => Promise<{
    success: boolean
    imported?: number
    tags?: number
    collections?: number
    error?: string
  }>
  // Cancel an in-flight export (by token)
  cancelExport: (token: string) => Promise<{ success: boolean }>
  // Subscribe to live export progress; returns an unsubscribe function
  onExportProgress: (cb: (p: ExportProgress) => void) => () => void
  // Open a folder in the OS file explorer
  openPath: (p: string) => Promise<{ success: boolean; error?: string }>

  // Batch Operations
  batchDelete: (ids: string[]) => Promise<{ success: boolean }>
  batchTag: (soundIds: string[], tagNames: string[], action: 'add' | 'remove') => Promise<{ success: boolean; affected: number }>
  batchStar: (ids: string[]) => Promise<{ success: boolean; affected: number }>
  batchExport: (ids: string[], targetDir: string) => Promise<{ success: boolean; copied?: number; skipped?: number; missing?: number; message?: string }>
  importToNLE: (nle: 'pr' | 'fcp' | 'resolve', filePaths: string[]) => Promise<{ success: boolean; name?: string; message?: string; code?: string; count?: number }>

  // Trash / Recycle Bin
  getTrash: () => Promise<SoundData[]>
  restoreSounds: (ids: string[]) => Promise<{ success: boolean }>
  permanentDelete: (ids: string[], deleteLocalFile?: boolean) => Promise<{ success: boolean; deletedLocal?: boolean }>

  // Metadata backup / restore (lightweight JSON, no audio copy)
  exportMetadata: () => Promise<{
    success: boolean
    cancelled?: boolean
    filePath?: string
    counts?: { sounds: number; tags: number; collections: number; smartFolders: number }
    error?: string
  }>
  importMetadata: () => Promise<{
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
  }>

  // Undo stack (in-memory session stack, multi-step Ctrl+Z)
  undoPeek: () => Promise<{ label: string; count: number } | null>
  undoPerform: () => Promise<{ success: boolean; label: string | null; count: number; error?: string }>
  undoClear: () => Promise<{ success: boolean }>

  // Settings
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<{ success: boolean }>

  // Global Quick Search (Spotlight overlay)
  hideSpotlight: () => void
  revealSound: (soundId: string) => void
  setSpotlightShortcut: (accelerator: string) => Promise<{ success: boolean; shortcut?: string; error?: string }>
  openSpotlight: () => void
  moveSpotlight: (dx: number, dy: number) => void
  onSpotlightOpened: (cb: () => void) => () => void
  onSelectSound: (cb: (soundId: string) => void) => () => void

  // 获取常用目录路径（扫描快捷入口用）
  getCommonPaths: () => Promise<{ desktop: string; documents: string; downloads: string; music: string; videos: string }>

  // Native context menu (Electron Menu.popup — guaranteed correct positioning)
  showNativeContextMenu: (
    items: { label: string; enabled?: boolean; danger?: boolean; type?: 'separator' | 'normal' }[],
    x: number,
    y: number
  ) => Promise<string | null>  // returns clicked item label, or null if dismissed

  // 渲染进程未捕获错误上报（落盘 userData/sv-error.log 供排查）
  logRendererError: (msg: string) => Promise<{ success: boolean }>

  // Window Controls (frameless mode)
  minimizeWindow: () => Promise<void>
  maximizeRestoreWindow: () => Promise<void>
  closeWindow: () => Promise<void>

  // 宠物（声波小精灵）· 精简配置存于 settings 表，渲染端补全完整规则集
  pet: PetAPI
}

// 宠物 API（声波小精灵）
export interface PetAudioEvent {
  type: 'level' | 'start' | 'stop'
  level?: number
}

export interface PetAPI {
  getConfig: () => Promise<PetConfigStored | null>
  saveConfig: (config: PetConfigStored) => Promise<{ success: boolean }>
  setDisplay: (display: PetConfigStored['display']) => Promise<{ success: boolean }>
  setBehavior: (behavior: { audioBreath?: boolean; paused?: boolean }) => void
  resetPosition: () => void
  toggle: () => void
  show: () => void
  hide: () => void
  setEnabled: (enabled: boolean) => void
  openSettings: () => void
  // 主窗口播放音效时上报音频事件（电平/起停），由主进程转发给宠物窗口
  sendAudioEvent: (event: PetAudioEvent) => void
  // 主进程 → 宠物窗口 推送
  onAudioEvent: (cb: (event: PetAudioEvent) => void) => () => void
  onConfigChanged: (cb: () => void) => () => void
  onStateChange: (cb: (state: { visible: boolean }) => void) => () => void
  // 宠物窗口请求打开主窗口设置面板（声波小精灵「设置」动作）
  onOpenSettings: (cb: () => void) => () => void
  // 宠物右键菜单「AI 生成音效」→ 打开生成面板
  onOpenGenerate: (cb: () => void) => () => void
  // 宠物右键菜单「库洞察」→ 切到统计面板
  onOpenStats: (cb: () => void) => () => void
  // 宠物窗口拖动：按屏幕坐标增量移动
  move: (dx: number, dy: number) => void
  // 取宠物窗口屏幕坐标/尺寸
  getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>
  // 按绝对屏幕坐标定位宠物窗口
  moveTo: (x: number, y: number) => void
  // 退出整个应用
  quit: () => void
  // 请求主进程弹出原生右键菜单（定位到精灵右侧，不遮挡本体）
  showContextMenu: () => void
  // 主进程「关于」原生菜单触发后转发文本，渲染端据此显示气泡
  onAbout: (cb: (text: string) => void) => () => void
  // 主窗口选中音效 → 通知宠物做 AI 点评
  notifySelection: (payload: PetSelectionPayload) => void
  // 主进程 → 宠物窗口 推送选中音效分析
  onSelectionChanged: (cb: (payload: PetSelectionPayload) => void) => () => void
  // B2 试听拖拽：主窗口卡片拖拽开始/结束上报
  beginTrialDrag: (id: string) => void
  endTrialDrag: () => void
  // 主进程 → 宠物窗口：光标是否悬停在宠物窗口上方（高亮提示）
  onTrialHover: (cb: (armed: boolean) => void) => () => void
  // 主进程 → 主窗口：拖卡片到宠物窗口松手后，请求主窗口试听该音效
  onPlayTrial: (cb: (id: string) => void) => () => void
  // 主进程 → 宠物窗口：右键菜单「重新引导」触发，重跑新手气泡序列
  onReplayOnboarding: (cb: () => void) => () => void
  // Petpack 导入/导出（jszip）
  exportPetpack: () => Promise<{ success: boolean; path?: string; message?: string }>
  importPetpack: () => Promise<{ success: boolean; message?: string }>
}

// ---- Types ----

export interface ExportProgress {
  done: number
  total: number
  copied: number
  missing: number
  fileName: string
  elapsedMs: number
}

export interface ExportResult {
  success: boolean
  cancelled?: boolean
  error?: string
  path?: string | null
  counts?: Record<string, number>
  copied?: number
  missing?: number
  total?: number
  elapsedMs?: number
}

export interface ScanOptions {
  targetPath: string
  recursive: boolean
  filenameIncludes: string[]
  filenameExcludes: string[]
  minSizeKB: number
  maxSizeKB: number
  minDurationSec?: number   // 最小时长（秒），0 = 不限
  maxDurationSec?: number   // 最大时长（秒），0 = 不限
  skipHidden: boolean
  includeVideo: boolean
  extFilters?: string[]   // 可选：仅扫描指定扩展名（如 ['.wav', '.mp3']）
}

export interface ScanResult {
  total: number
  newFiles: number
  skipped: number
  totalSize: number
  byFormat: Record<string, number>
  files: ImportFile[]
}

export interface ImportFile {
  path: string
  name: string
  ext: string
  size: number
  durationMs?: number   // 音频时长（毫秒），扫描时可选填充
}

export interface OnomatopoeiaItem {
  zh: string
  ja?: string
  en?: string
  pinyin?: string
  confidence?: number
}

export interface SoundData {
  id: string
  file_path: string
  file_hash: string
  file_name: string
  file_ext: string
  file_size: number
  duration_ms: number | null
  sample_rate: number | null
  bit_depth: number | null
  channels: number | null
  bitrate_kbps: number | null
  loudness_lufs: number | null
  description: string | null
  description_en: string | null
  use_cases: string | null
  emotion: string | null
  quality_score: number | null
  similar_to: string | null
  best_for: string | null
  ai_model: string | null
  ai_analyzed_at: string | null
  notes: string | null
  onomatopoeia: string | null
  is_starred: number
  is_missing: number
  is_trashed?: number
  play_count: number
  export_count: number
  preview_cache: string | null
  imported_at: string
  updated_at: string
  search_text: string | null
  tags: string | null
}

export interface TagData {
  id: string
  name: string
  parent_id: string | null
  color: string | null
  icon: string | null
  sort_order: number
  created_at: string
}

export interface TagWithMeta extends TagData {
  confidence: number | null
  is_manual: number
}

export interface TagStatData {
  id: string
  name: string
  color: string | null
  count: number
  category?: string | null
}

export interface DuplicateItem {
  id: string
  file_name: string
  file_path: string
  file_size: number
  imported_at: string
}

export interface DuplicateGroup {
  hash: string
  count: number
  items: DuplicateItem[]
}

export interface SimilarSound {
  id: string
  file_name: string
  // 综合相似度 0-1（标签 0.7 + 文本 0.3 加权）
  score: number
  // 匹配原因（共享标签名 / 使用场景相近）
  reasons: string[]
}

export interface CollectionData {
  id: string
  name: string
  description: string | null
  cover_sound_id: string | null
  created_at: string
  updated_at: string
}

export interface SmartFolderInput {
  id?: string
  name: string
  conditions: string
}

export interface SmartFolderData {
  id: string
  name: string
  conditions: string
  created_at: string
  updated_at: string
}

export interface StatsData {
  total: number
  starred: number
  missing: number
  totalSize: number
  totalDurationMs: number
  analyzed: number
  unanalyzed: number
  byExt: { wav: number; mp3: number; flac: number; other: number }
  avgQuality: number | null
  tagCount: number
  taggedSounds: number
  withOnomatopoeia: number
}

export interface AIConfig {
  provider: 'openai' | 'deepseek' | 'qwen' | 'anthropic' | 'gemini' | 'kimi' | 'doubao' | 'siliconflow' | 'azure' | 'ollama' | 'tokendance' | 'custom'
  apiKey: string
  endpoint: string
  model: string
  maxTokens: number
  temperature: number
}

// ── 云端音效生成（与 AI 语义分析配置相互独立）──
export type GenProvider = 'fal' | 'elevenlabs'

export interface GenOptions {
  token: string // 取消令牌，主进程据此 abort 对应生成
  provider: GenProvider
  apiKey: string
  prompt: string
  durationSeconds?: number
  guidanceScale?: number // fal 专用
  seed?: number // -1 = 随机
}

export interface GenStats {
  count: number
  estCostUSD: number
  freeRemainingUSD: number | null // 用户手动/自动记录的免费额度剩余
}

export interface GenResult {
  success: boolean
  cancelled?: boolean
  error?: string
  soundId?: string
  filePath?: string
  fileName?: string
  durationMs?: number
  provider?: GenProvider
  cost?: number
  stats?: GenStats
}

export interface AIAnalysisResult {
  description: string
  detailedDescription: string
  scenario: string
  tags: Array<{ name: string; category: string; confidence: number }>
  onomatopoeia: OnomatopoeiaItem[]
  emotion: string
  qualityScore: number
  moodEnergy: number
  isLoopable: boolean
  variantOf: string | null
}

export interface AnalyzeResult {
  success: boolean
  error?: string
  cancelled?: boolean
  metadata?: {
    duration: number
    sampleRate: number
    channels: number
    bitrate: number
    codec: string
    fileSize: number
    format: string
  }
  result?: AIAnalysisResult
}
