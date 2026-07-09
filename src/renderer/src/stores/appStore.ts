import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { SoundData, TagData, TagStatData, CollectionData, SmartFolderData } from '../../preload/index.d'

/** 判断是否为「未配置 API 密钥」类错误 */
function isApiKeyError(msg: string, code?: string): boolean {
  return !!msg && (msg.includes('API 密钥') || msg.includes('API_KEY') || code === 'AI_API_KEY_NOT_SET')
}

interface AppState {
  // Data
  sounds: SoundData[]
  tags: TagData[]
  tagStats: TagStatData[]
  collections: CollectionData[]
  smartFolders: SmartFolderData[]
  selectedSoundId: string | null
  selectedSoundIds: string[]
  selectedTagId: string | null
  activeCollectionId: string | null
  activeSmartFolderId: string | null
  searchQuery: string
  viewMode: 'grid' | 'list'
  sidebarTab: 'tags' | 'folders' | 'collections' | 'smart' | 'trash'
  stats: { total: number; starred: number; missing: number; totalSize: number }
  fontSize: number
  sortBy: 'name' | 'duration' | 'size' | 'date'
  sortOrder: 'asc' | 'desc'
  formatFilter: string | null

  // UI modals
  showScanDialog: boolean
  showModelConfig: boolean
  // Per-sound analysis state (allows concurrent analyses + cancellation).
  analyzingIds: string[]
  batchAnalyzing: boolean
  batchToken: string | null

  // Setters
  setSounds: (sounds: SoundData[]) => void
  setTags: (tags: TagData[]) => void
  setTagStats: (stats: TagStatData[]) => void
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
  setViewMode: (mode: 'grid' | 'list') => void
  setFontSize: (size: number) => void
  setSidebarTab: (tab: 'tags' | 'folders' | 'collections' | 'smart' | 'trash') => void
  setStats: (stats: { total: number; starred: number; missing: number; totalSize: number }) => void
  setSortBy: (by: 'name' | 'duration' | 'size' | 'date') => void
  setSortOrder: (order: 'asc' | 'desc') => void
  setFormatFilter: (format: string | null) => void
  getFilteredSounds: () => SoundData[]
  toggleScanDialog: () => void
  toggleModelConfig: () => void
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
  collections: [],
  smartFolders: [],
  selectedSoundId: null,
  selectedSoundIds: [],
  selectedTagId: null,
  activeCollectionId: null,
  activeSmartFolderId: null,
  searchQuery: '',
  viewMode: 'grid',
  sidebarTab: 'tags',
  stats: { total: 0, starred: 0, missing: 0, totalSize: 0 },
  fontSize: 14,
  sortBy: 'date',
  sortOrder: 'desc',
  formatFilter: null,
  showScanDialog: false,
  showModelConfig: false,
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
  setViewMode: (mode) => set({ viewMode: mode }),
  setFontSize: (size) => set({ fontSize: size }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setStats: (stats) => set({ stats }),
  setSortBy: (by) => set({ sortBy: by }),
  setSortOrder: (order) => set({ sortOrder: order }),
  setFormatFilter: (format) => set({ formatFilter: format }),
  toggleScanDialog: () => set((s) => ({ showScanDialog: !s.showScanDialog })),
  toggleModelConfig: () => set((s) => ({ showModelConfig: !s.showModelConfig })),

  handleAnalyzeError: (msg, code, fallback) => {
    if (isApiKeyError(msg, code)) {
      // 引导新手去配置 API：友好提示 + 自动打开设置面板
      toast('请先在设置中配置 AI 服务商和 API 密钥，才能使用智能分析', {
        icon: '⚙️',
        duration: 5000,
        style: { background: '#2a2a28', color: '#e5e5e5', border: '1px solid #555' }
      })
      // 面板未打开时才自动弹出（避免把已打开的面板 toggle 关掉）
      if (!get().showModelConfig) {
        setTimeout(() => {
          if (!get().showModelConfig) set({ showModelConfig: true })
        }, 400)
      }
    } else {
      toast.error(msg || fallback)
    }
  },

  refreshSounds: async () => {
    const { searchQuery, sidebarTab, activeCollectionId, activeSmartFolderId } = get()
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
    } else {
      sounds = searchQuery
        ? await window.api.searchSounds(searchQuery)
        : await window.api.getSounds()
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

  getFilteredSounds: () => {
    const { sounds, sortBy, sortOrder, formatFilter, selectedTagId, tags } = get()
    let result = [...sounds]
    if (formatFilter) {
      result = result.filter((s) => s.file_ext.toLowerCase() === formatFilter.toLowerCase())
    }
    if (selectedTagId) {
      const tagName = tags.find((t) => t.id === selectedTagId)?.name
      if (tagName) {
        result = result.filter(
          (s) => !!s.tags && s.tags.split(',').some((n) => n.trim() === tagName)
        )
      }
    }
    result.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'name':
          cmp = a.file_name.localeCompare(b.file_name, undefined, { sensitivity: 'base' })
          break
        case 'duration':
          cmp = (a.duration_ms || 0) - (b.duration_ms || 0)
          break
        case 'size':
          cmp = a.file_size - b.file_size
          break
        case 'date':
          cmp = new Date(a.imported_at).getTime() - new Date(b.imported_at).getTime()
          break
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })
    return result
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
