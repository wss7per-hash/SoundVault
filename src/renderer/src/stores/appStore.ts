import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { SoundData, TagData, TagStatData, CollectionData, SmartFolderData, DuplicateGroup } from '../../preload/index.d'

/** 判断是否为「未配置 API 密钥」类错误 */
function isApiKeyError(msg: string, code?: string): boolean {
  return !!msg && (msg.includes('API 密钥') || msg.includes('API_KEY') || code === 'AI_API_KEY_NOT_SET')
}

interface AppState {
  // Data
  sounds: SoundData[]
  tags: TagData[]
  tagStats: TagStatData[]
  onoStats: TagStatData[]
  duplicates: DuplicateGroup[]
  collections: CollectionData[]
  smartFolders: SmartFolderData[]
  selectedSoundId: string | null
  selectedSoundIds: string[]
  selectedTagId: string | null
  activeCollectionId: string | null
  activeSmartFolderId: string | null
  searchQuery: string
  searchMode: 'normal' | 'semantic'
  viewMode: 'grid' | 'list'
  gridDensity: 'comfortable' | 'compact'
  activeView: 'library' | 'stats' | 'tools' | 'settings'
  sidebarTab: 'tags' | 'folders' | 'collections' | 'smart' | 'trash'
  stats: { total: number; starred: number; missing: number; totalSize: number; totalDurationMs: number; analyzed: number; unanalyzed: number; byExt: { wav: number; mp3: number; flac: number; other: number }; avgQuality: number | null; tagCount: number; taggedSounds: number; withOnomatopoeia: number }
  fontSize: number
  theme: 'dark' | 'light'
  defaultExportFormat: string
  autoAnalyzeOnImport: boolean
  sortBy: 'name' | 'duration' | 'size' | 'date'
  sortOrder: 'asc' | 'desc'
  formatFilter: string | null

  // UI modals
  showScanDialog: boolean
  showGenerate: boolean
  showExportNLE: boolean
  // 回收站跨组件同步：Sidebar 与 RecycleBin 各自持有独立状态，
  // 任一处发生恢复/清空后 bump 此计数，另一处订阅后自动刷新。
  trashVersion: number
  // Per-sound analysis state (allows concurrent analyses + cancellation).
  analyzingIds: string[]
  batchAnalyzing: boolean
  batchToken: string | null

  // Setters
  setSounds: (sounds: SoundData[]) => void
  setTags: (tags: TagData[]) => void
  setTagStats: (stats: TagStatData[]) => void
  setOnoStats: (stats: TagStatData[]) => void
  selectSound: (id: string | null) => void
  toggleSoundSelection: (id: string) => void
  clearSelection: () => void
  setSelection: (ids: string[]) => void
  selectRange: (fromIndex: number, toIndex: number, soundIds: string[]) => void
  selectAll: (soundIds: string[]) => void
  setSelectedTag: (id: string | null) => void
  setActiveCollection: (id: string | null) => void
  setActiveSmartFolder: (id: string | null) => void
  setSearchQuery: (query: string) => void
  setSearchMode: (mode: 'normal' | 'semantic') => void
  setViewMode: (mode: 'grid' | 'list') => void
  setGridDensity: (density: 'comfortable' | 'compact') => void
  setActiveView: (view: 'library' | 'stats' | 'tools' | 'settings') => void
  setFontSize: (size: number) => void
  setTheme: (theme: 'dark' | 'light') => void
  setDefaultExportFormat: (format: string) => void
  setAutoAnalyzeOnImport: (v: boolean) => void
  setSidebarTab: (tab: 'tags' | 'folders' | 'collections' | 'smart' | 'trash') => void
  setStats: (stats: { total: number; starred: number; missing: number; totalSize: number; totalDurationMs: number; analyzed: number; unanalyzed: number; byExt: { wav: number; mp3: number; flac: number; other: number }; avgQuality: number | null; tagCount: number; taggedSounds: number; withOnomatopoeia: number }) => void
  setSortBy: (by: 'name' | 'duration' | 'size' | 'date') => void
  setSortOrder: (order: 'asc' | 'desc') => void
  setFormatFilter: (format: string | null) => void
  toggleScanDialog: () => void
  toggleGenerate: () => void
  toggleExportNLE: () => void
  bumpTrashVersion: () => void
  handleAnalyzeError: (msg: string, code: string | undefined, fallback: string) => void

  // Refresh
  refreshSounds: () => Promise<void>
  refreshTags: () => Promise<void>
  refreshTagStats: () => Promise<void>
  refreshStats: () => Promise<void>
  refreshCollections: () => Promise<void>
  refreshSmartFolders: () => Promise<void>

  // Actions
  analyzeSound: (soundId: string) => Promise<boolean>
  analyzeBatch: (soundIds: string[]) => Promise<void>
  cancelAnalysis: (tokens: string[]) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  sounds: [],
  tags: [],
  tagStats: [],
  onoStats: [],
  duplicates: [],
  collections: [],
  smartFolders: [],
  selectedSoundId: null,
  selectedSoundIds: [],
  selectedTagId: null,
  activeCollectionId: null,
  activeSmartFolderId: null,
  searchQuery: '',
  searchMode: 'semantic',
  viewMode: 'grid',
  gridDensity: (typeof localStorage !== 'undefined' ? (localStorage.getItem('sv-grid-density') as 'comfortable' | 'compact') : null) || 'comfortable',
  activeView: 'library',
  sidebarTab: 'tags',
  stats: { total: 0, starred: 0, missing: 0, totalSize: 0, totalDurationMs: 0, analyzed: 0, unanalyzed: 0, byExt: { wav: 0, mp3: 0, flac: 0, other: 0 }, avgQuality: null, tagCount: 0, taggedSounds: 0, withOnomatopoeia: 0 },
  fontSize: 14,
  theme: (typeof localStorage !== 'undefined' ? (localStorage.getItem('sv-theme') as 'dark' | 'light') : null) || 'dark',
  defaultExportFormat: (typeof localStorage !== 'undefined' ? localStorage.getItem('sv-export-format') : null) || 'wav',
  autoAnalyzeOnImport: (typeof localStorage !== 'undefined' ? localStorage.getItem('sv-auto-analyze') : null) === '1',
  sortBy: 'date',
  sortOrder: 'desc',
  formatFilter: null,
  showScanDialog: false,
  showGenerate: false,
  showExportNLE: false,
  trashVersion: 0,
  analyzingIds: [],
  batchAnalyzing: false,
  batchToken: null,

  setSounds: (sounds) => set({ sounds }),
  setTags: (tags) => set({ tags }),
  setTagStats: (tagStats) => set({ tagStats }),
  selectSound: (id) => set({ selectedSoundId: id }),
  toggleSoundSelection: (id) =>
    set((s) => {
      const next = s.selectedSoundIds.includes(id)
        ? s.selectedSoundIds.filter((i) => i !== id)
        : [...s.selectedSoundIds, id]
      return { selectedSoundIds: next }
    }),
  clearSelection: () => set({ selectedSoundIds: [] }),
  setSelection: (ids) => set({ selectedSoundIds: ids }),
  selectRange: (fromIndex: number, toIndex: number, soundIds: string[]) => {
    const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
    const rangeIds = soundIds.slice(start, end + 1)
    set((s) => {
      const existing = new Set(s.selectedSoundIds)
      for (const id of rangeIds) existing.add(id)
      return { selectedSoundIds: [...existing] }
    })
  },
  selectAll: (soundIds: string[]) => set({ selectedSoundIds: [...soundIds] }),
  setSelectedTag: (id) => set({ selectedTagId: id }),
  setActiveCollection: (id) => set({ activeCollectionId: id }),
  setActiveSmartFolder: (id) => set({ activeSmartFolderId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setGridDensity: (density) => {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('sv-grid-density', density) } catch { /* ignore */ }
    set({ gridDensity: density })
  },
  setActiveView: (view) => set({ activeView: view }),
  setFontSize: (size) => set({ fontSize: size }),
  setTheme: (theme) => {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('sv-theme', theme) } catch { /* ignore */ }
    set({ theme })
  },
  setDefaultExportFormat: (format) => {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('sv-export-format', format) } catch { /* ignore */ }
    set({ defaultExportFormat: format })
  },
  setAutoAnalyzeOnImport: (v) => {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('sv-auto-analyze', v ? '1' : '0') } catch { /* ignore */ }
    set({ autoAnalyzeOnImport: v })
  },
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setStats: (stats) => set({ stats }),
  setSortBy: (by) => set({ sortBy: by }),
  setSortOrder: (order) => set({ sortOrder: order }),
  setFormatFilter: (format) => set({ formatFilter: format }),
  toggleScanDialog: () => set((s) => ({ showScanDialog: !s.showScanDialog })),
  toggleGenerate: () => set((s) => ({ showGenerate: !s.showGenerate })),
  toggleExportNLE: () => set((s) => ({ showExportNLE: !s.showExportNLE })),
  bumpTrashVersion: () => set((s) => ({ trashVersion: s.trashVersion + 1 })),

  handleAnalyzeError: (msg, code, fallback) => {
    if (isApiKeyError(msg, code)) {
      // 引导新手去配置 API：友好提示 + 自动打开设置面板
      toast('请先在设置中配置 AI 服务商和 API 密钥，才能使用智能分析', {
        icon: '⚙️',
        duration: 5000,
        style: { background: 'rgb(var(--color-surface-card))', color: 'rgb(var(--color-fg-muted))', border: '1px solid rgb(var(--color-surface-border))' }
      })
      // 自动跳转到设置面板（若未在设置页）
      if (get().activeView !== 'settings') set({ activeView: 'settings' })
    } else {
      toast.error(msg || fallback)
    }
  },

  refreshSounds: async () => {
    const { searchQuery, searchMode, sidebarTab, activeCollectionId, activeSmartFolderId, sortBy, sortOrder, formatFilter } = get()
    let sounds: SoundData[]
    if (sidebarTab === 'smart' && activeSmartFolderId) {
      // 智能文件夹：按规则过滤
      sounds = await window.api.getSmartFolderSounds(activeSmartFolderId)
    } else if (sidebarTab === 'collections' && activeCollectionId) {
      // 收藏夹：显示该收藏夹内的音效；虚拟「收藏」项用哨兵 id 取已星标音效
      if (activeCollectionId === '__starred__') {
        sounds = await window.api.getStarred()
      } else {
        sounds = await window.api.getCollectionSounds(activeCollectionId)
      }
    } else if (searchQuery && searchMode === 'normal') {
      // 文本搜索
      sounds = await window.api.searchSounds(searchQuery)
    } else {
      // 普通模式：排序与格式过滤下沉 SQL
      sounds = await window.api.getSounds({
        sortBy,
        sortOrder,
        format: formatFilter || undefined
      })
    }

    // 对专用 handler（智能文件夹/收藏夹/搜索）结果做客户端排序与格式过滤
    // 这些 handler 不接受 sort/filter 参数，但 UI 控件在特殊视图下仍可交互
    const needsClientSort = sidebarTab === 'smart' || sidebarTab === 'collections' || (searchQuery && searchMode === 'normal')
    if (needsClientSort) {
      // 格式过滤
      if (formatFilter) {
        sounds = sounds.filter((s) => (s.file_ext || '').toLowerCase().replace(/^\./, '') === formatFilter.toLowerCase())
      }
      // 排序
      sounds = [...sounds].sort((a, b) => {
        let va: any, vb: any
        switch (sortBy) {
          case 'name':
            va = (a.file_name || '').toLowerCase()
            vb = (b.file_name || '').toLowerCase()
            break
          case 'duration':
            va = a.duration_ms ?? 0
            vb = b.duration_ms ?? 0
            break
          case 'size':
            va = a.file_size ?? 0
            vb = b.file_size ?? 0
            break
          case 'date':
          default:
            va = new Date(a.imported_at || a.created_at || 0).getTime()
            vb = new Date(b.imported_at || b.created_at || 0).getTime()
            break
        }
        if (typeof va === 'string') {
          return sortOrder === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        }
        return sortOrder === 'asc' ? va - vb : vb - va
      })
    }

    set({ sounds })
  },

  refreshTags: async () => {
    const tags = await window.api.getTags()
    set({ tags })
  },

  refreshTagStats: async () => {
    try {
      const stats = await window.api.getTagStats()
      set({ tagStats: stats })
    } catch {
      // tagStats may not be available
    }
  },

  refreshOnoStats: async () => {
    try {
      const stats = await window.api.getOnomatopoeiaCloud()
      set({ onoStats: stats })
    } catch {
      // onoStats may not be available
    }
  },

  refreshDuplicates: async () => {
    try {
      const groups = await window.api.findDuplicates()
      set({ duplicates: groups })
    } catch {
      // duplicates may not be available
    }
  },

  refreshStats: async () => {
    const stats = await window.api.getStats()
    set({ stats })
  },

  refreshCollections: async () => {
    const collections = await window.api.getCollections()
    set({ collections })
  },

  refreshSmartFolders: async () => {
    const smartFolders = await window.api.getSmartFolders()
    set({ smartFolders })
  },

  analyzeSound: async (soundId: string) => {
    // Avoid double-trigger for the same sound.
    if (get().analyzingIds.includes(soundId)) return false
    set((s) => ({ analyzingIds: [...s.analyzingIds, soundId] }))
    try {
      const result = await window.api.analyzeSingle(soundId)
      if (result.cancelled) {
        toast('已取消分析')
        return false
      }
      if (result.success) {
        await get().refreshSounds()
        toast.success('AI 分析完成')
        return true
      } else {
        // handler 内部已 try/catch，未配置 API 时会走这里（result.success=false）
        get().handleAnalyzeError(result.error || '', undefined, '分析失败')
        return false
      }
    } catch (err) {
      // 极端情况：IPC 本身抛错
      get().handleAnalyzeError((err as Error).message || '', (err as any)?.code, '分析失败')
      return false
    } finally {
      set((s) => ({ analyzingIds: s.analyzingIds.filter((id) => id !== soundId) }))
    }
  },

  analyzeBatch: async (soundIds: string[]) => {
    if (get().batchAnalyzing || soundIds.length === 0) return
    const token = `batch-${Date.now()}`
    set((s) => ({
      batchAnalyzing: true,
      batchToken: token,
      analyzingIds: Array.from(new Set([...s.analyzingIds, ...soundIds]))
    }))
    try {
      const result = await window.api.analyzeBatch(soundIds, token)
      if (result.cancelled) {
        toast('已取消批量分析')
      } else if (result.success) {
        toast.success(`已完成 ${result.analyzed} 个音效的 AI 分析`)
      } else {
        get().handleAnalyzeError(result.error || '', undefined, '批量分析失败')
      }
      await get().refreshSounds()
    } catch (err) {
      get().handleAnalyzeError((err as Error).message || '', (err as any)?.code, '批量分析失败')
    } finally {
      set((s) => ({
        batchAnalyzing: false,
        batchToken: null,
        analyzingIds: s.analyzingIds.filter((id) => !soundIds.includes(id))
      }))
    }
  },

  cancelAnalysis: async (tokens: string[]) => {
    try {
      await window.api.cancelAnalysis(tokens)
    } catch {
      // ignore
    }
  }
}))
