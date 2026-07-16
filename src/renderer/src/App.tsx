import { useEffect, useCallback, useMemo, useState, useRef } from 'react'
import type * as React from 'react'
import { useAppStore } from './stores/appStore'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { SoundGrid } from './components/SoundGrid'
import { DetailPanel } from './components/DetailPanel'
import { SimilarSoundsBar } from './components/SimilarSoundsBar'
import { StatisticsPanel } from './components/StatisticsPanel'
import { ToolsPanel } from './components/ToolsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { EmptyState } from './components/EmptyState'
import { FloatingQuickBar } from './components/FloatingQuickBar'
import { RecycleBin } from './components/RecycleBin'
import { OnboardingTour } from './components/OnboardingTour'
import ScanDialog from './components/ScanDialog'
import GeneratePanel from './components/GeneratePanel'
import ExportNLEModal from './components/ExportNLEModal'
import { Toaster, toast } from 'react-hot-toast'
import { Star, Upload, FileInput, Tag, Search, RefreshCw, LayoutGrid, BarChart3, Undo2 } from 'lucide-react'
import { SplashScreen } from './components/SplashScreen'
import { PopupMenu, useContextMenu, type MenuItem } from './components/PopupMenu'
import { performUndo } from './utils/undo'
import { rankSoundsBySemantic } from './utils/semanticSearch'

export default function App(): JSX.Element {
  const [showSplash, setShowSplash] = useState(true)
  const [dragActive, setDragActive] = useState(false)
  const [dataReady, setDataReady] = useState(false)
  const {
    sounds,
    sidebarTab,
    activeCollectionId,
    activeView,
    setActiveView,
    selectedSoundId,
    showScanDialog,
    showGenerate,
    showExportNLE,
    fontSize,
    theme,
    sortBy,
    sortOrder,
    formatFilter,
    selectedTagId,
    tags,
    viewMode,
    setViewMode,
    searchQuery,
    searchMode,
    refreshSounds,
    refreshTags,
    refreshTagStats,
    refreshStats,
    refreshCollections,
    refreshSmartFolders,
    selectSound,
    toggleScanDialog,
    toggleGenerate,
    toggleExportNLE
  } = useAppStore()

  const filteredSounds = useMemo(() => {
    let result = [...sounds]
    if (formatFilter) {
      result = result.filter((s) => s.file_ext.toLowerCase() === formatFilter.toLowerCase())
    }
    // Tag filter: resolve selected tag id -> name, then keep sounds whose
    // comma-joined `tags` string contains that name.
    if (selectedTagId) {
      const tag = tags.find((t) => t.id === selectedTagId)
      if (tag) {
        result = result.filter(
          (s) => !!s.tags && s.tags.split(',').some((n) => n.trim() === tag.name)
        )
      }
    }
    // 语义搜索：按 AI 字段加权相关度排序（覆盖普通排序，相关度降序）
    if (searchMode === 'semantic' && searchQuery.trim()) {
      return rankSoundsBySemantic(result, searchQuery)
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
  }, [sounds, sortBy, sortOrder, formatFilter, selectedTagId, tags, searchQuery, searchMode])

  const selectedSound = filteredSounds.find((s) => s.id === selectedSoundId) ?? sounds.find((s) => s.id === selectedSoundId) ?? null

  const loadData = useCallback(async () => {
    await Promise.all([
      refreshSounds(),
      refreshTags(),
      refreshTagStats(),
      refreshStats(),
      refreshCollections(),
      refreshSmartFolders()
    ])
    setDataReady(true)
  }, [refreshSounds, refreshTags, refreshTagStats, refreshStats, refreshCollections, refreshSmartFolders])

  useEffect(() => { loadData() }, [loadData])

  // Reset selection & refresh data when switching sidebar tabs.
  // This prevents stale state like "collection sounds still showing after switching to tags".
  // Only clear selection when LEAVING the relevant tab (not when entering it).
  const prevSidebarTabRef = useRef(sidebarTab)
  useEffect(() => {
    if (prevSidebarTabRef.current === sidebarTab) return
    const prevTab = prevSidebarTabRef.current
    prevSidebarTabRef.current = sidebarTab
    // Clear any active filter selection from the PREVIOUS tab
    const store = useAppStore.getState()
    if (prevTab === 'collections' && store.activeCollectionId) store.setActiveCollection(null)
    if (prevTab === 'smart' && store.activeSmartFolderId) store.setActiveSmartFolder(null)
    if (store.selectedTagId && sidebarTab !== 'tags') store.setSelectedTag(null)
    // Always refresh to show the correct dataset for the new tab
    loadData()
  }, [sidebarTab, loadData])

  // 切换搜索模式（普通/语义）时，若已有查询需重新拉取正确数据集
  // （语义模式取全量由渲染端排序；普通模式走 SQL LIKE）
  const prevSearchModeRef = useRef(searchMode)
  useEffect(() => {
    if (prevSearchModeRef.current === searchMode) return
    prevSearchModeRef.current = searchMode
    if (searchQuery.trim()) {
      void useAppStore.getState().refreshSounds()
    }
  }, [searchMode, searchQuery])

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`
  }, [fontSize]  )

  // ── 主题：把 theme 写到 <html data-theme>，CSS 变量据此切换 ──
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // ── 拖放导入：接收从系统拖入窗口的音频文件 / 文件夹 ──
  const hasFilesInDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types || []).includes('Files')

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragActive(false)
  }, [])

  // 拖放导入实际入库逻辑
  const importDroppedPaths = useCallback(async (paths: string[]) => {
    if (paths.length === 0) {
      toast('没有检测到可导入的文件')
      return
    }
    try {
      const res = await window.api.importPaths(paths)
      await Promise.all([refreshSounds(), refreshStats()])
      // 自动标注：导入成功后对未分析音效批量分析
      const store = useAppStore.getState()
      if (store.autoAnalyzeOnImport) {
        const ids = store.sounds.filter((s) => !s.ai_analyzed_at).map((s) => s.id)
        if (ids.length) {
          toast('已开启自动标注，正在分析新导入的音效…', { icon: '✨' })
          store.analyzeBatch(ids)
        }
      }
      if (res.imported > 0) {
        toast.success(
          `已导入 ${res.imported} 个音效` +
            (res.total > res.imported ? `（跳过 ${res.total - res.imported} 个重复）` : '')
        )
      } else {
        toast('没有可导入的新音效（可能都已存在）')
      }
    } catch (err) {
      toast.error('导入音效时出错，请检查文件格式或磁盘空间后重试')
    }
  }, [refreshSounds, refreshStats])

  // 渲染层 onDrop：Electron 32+ 已移除 File.path，改用 webUtils.getPathForFile 取真实路径
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDrag(e)) return
    e.preventDefault()
    setDragActive(false)

    const files = e.dataTransfer.files
    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const p = window.api.getPathForFile(files[i])
      if (p) paths.push(p)
    }
    void importDroppedPaths(paths)
  }, [importDroppedPaths])

  // 全局快捷搜索定位：spotlight 选中某音效后，清掉过滤条件、回到主视图、
  // 刷新并选中目标，保证它在网格里可见并打开详情面板。
  useEffect(() => {
    const unsub = window.api.onSelectSound(async (soundId: string) => {
      const store = useAppStore.getState()
      store.setSidebarTab('tags')
      store.setSelectedTag(null)
      store.setActiveCollection(null)
      store.setActiveSmartFolder(null)
      store.setFormatFilter(null)
      store.setSearchQuery('')
      await store.refreshSounds()
      store.selectSound(soundId)
    })
    return unsub
  }, [])

  // Ctrl+A / Ctrl+D select all；Ctrl+Z 撤销
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when in input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        useAppStore.getState().selectAll(filteredSounds.map((s) => s.id))
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault()
        void performUndo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        useAppStore.getState().clearSelection()
      }
      if (e.key === 'Escape') {
        useAppStore.getState().clearSelection()
        useAppStore.getState().selectSound(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredSounds])

  // ── 音频库空白处右键菜单 ──
  const libraryMenu = useContextMenu()

  const refreshLibrary = useCallback(async () => {
    await Promise.all([
      refreshSounds(),
      refreshTags(),
      refreshTagStats(),
      refreshStats(),
      refreshCollections(),
      refreshSmartFolders()
    ])
  }, [refreshSounds, refreshTags, refreshTagStats, refreshStats, refreshCollections, refreshSmartFolders])

  const focusSearch = useCallback(() => {
    const el = document.getElementById('global-search-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  }, [])

  const handleNewTagFromMenu = useCallback(async () => {
    const name = window.prompt('新标签名称')
    if (!name || !name.trim()) return
    try {
      await window.api.addTag(name.trim(), null, '#534AB7')
      await Promise.all([refreshTags(), refreshTagStats()])
      toast.success('已创建标签：' + name.trim())
    } catch {
      toast.error('创建标签失败，可能名称已存在')
    }
  }, [refreshTags, refreshTagStats])

  const buildLibraryMenu = useCallback((): MenuItem[] => {
    const store = useAppStore.getState()
    return [
      { type: 'item', label: '导入音效', icon: <FileInput size={14} />, onClick: () => store.toggleScanDialog() },
      { type: 'item', label: '新建标签', icon: <Tag size={14} />, onClick: () => void handleNewTagFromMenu() },
      { type: 'item', label: '聚焦搜索', icon: <Search size={14} />, onClick: focusSearch },
      { type: 'separator' },
      { type: 'item', label: '刷新库', icon: <RefreshCw size={14} />, onClick: () => void refreshLibrary() },
      {
        type: 'item',
        label: viewMode === 'grid' ? '切换为列表视图' : '切换为网格视图',
        icon: <LayoutGrid size={14} />,
        onClick: () => store.setViewMode(viewMode === 'grid' ? 'list' : 'grid')
      },
      { type: 'separator' },
      { type: 'item', label: '打开库洞察', icon: <BarChart3 size={14} />, onClick: () => store.setActiveView('stats') },
      { type: 'item', label: '撤销', icon: <Undo2 size={14} />, shortcut: 'Ctrl+Z', onClick: () => void performUndo() }
    ]
  }, [handleNewTagFromMenu, focusSearch, refreshLibrary, viewMode])

  const handleSelectSound = useCallback(
    (id: string) => { selectSound(selectedSoundId === id ? null : id) },
    [selectedSoundId, selectSound]
  )

  return (
    <div className="flex h-full" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {/* 拖放导入遮罩 */}
      {dragActive && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/70 bg-surface-panel px-10 py-8">
            <Upload size={40} className="text-accent-light" />
            <p className="text-base font-medium text-fg">松开即可导入音效</p>
            <p className="text-xs text-muted">支持音频文件与文件夹（自动递归）</p>
          </div>
        </div>
      )}

      {/* Startup splash animation */}
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} ready={dataReady} />}

      <Toaster position="bottom-right" toastOptions={{
        style: { background: 'rgb(var(--color-surface-card))', color: 'rgb(var(--color-fg-muted))', border: '0.5px solid rgb(var(--color-surface-border))', fontSize: '12px' }
      }} />

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />

        <div className="flex-1 flex min-h-0">
          {sidebarTab === 'trash' ? (
            <RecycleBin />
          ) : activeView === 'settings' ? (
            <SettingsPanel onClose={() => setActiveView('library')} />
          ) : activeView === 'tools' ? (
            <ToolsPanel onClose={() => setActiveView('library')} />
          ) : activeView === 'stats' ? (
            <StatisticsPanel onClose={() => setActiveView('library')} />
          ) : (
            <>
              <div
                className="flex-1 flex flex-col min-w-0"
                onContextMenu={libraryMenu.open}
              >
                {sidebarTab === 'collections' && activeCollectionId === '__starred__' && (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-surface-border text-xs text-amber-400 shrink-0">
                    <Star size={13} className="fill-amber-400" />
                    <span>收藏 · 已星标的音效（不归属于任何收藏夹）</span>
                  </div>
                )}
                {sounds.length === 0 ? (
                  <TabEmptyState tab={sidebarTab} onImport={loadData} />
                ) : (
                  <SoundGrid sounds={filteredSounds} selectedId={selectedSoundId} onSelect={handleSelectSound} />
                )}
                <SimilarSoundsBar soundId={selectedSoundId} />
                <StatusBar />
              </div>

              {selectedSound && (
                <DetailPanel sound={selectedSound} onClose={() => selectSound(null)} onUpdate={loadData} />
              )}
            </>
          )}
        </div>
      </div>

      <FloatingQuickBar />

      {/* 首次启动引导 */}
      <OnboardingTour />

      {/* Modals */}
      <ScanDialog isOpen={showScanDialog} onClose={() => toggleScanDialog()} />
      <GeneratePanel isOpen={showGenerate} onClose={() => toggleGenerate()} />
      <ExportNLEModal isOpen={showExportNLE} onClose={() => toggleExportNLE()} />

      {/* 音频库空白处右键菜单 */}
      {libraryMenu.pos && (
        <PopupMenu
          x={libraryMenu.pos.x}
          y={libraryMenu.pos.y}
          items={buildLibraryMenu()}
          onClose={libraryMenu.close}
        />
      )}
    </div>
  )
}

function TabEmptyState({ tab, onImport }: { tab: string; onImport: () => void }): JSX.Element {
  const activeCollectionId = useAppStore((s) => s.activeCollectionId)
  const isStarred = tab === 'collections' && activeCollectionId === '__starred__'
  const messages: Record<string, { title: string; sub: string }> = {
    smart: { title: '这个智能文件夹没有匹配的音效', sub: '试着放宽筛选条件，或点击编辑修改规则' },
    collections: { title: '这个收藏夹还是空的', sub: '在音效上右键「加入收藏夹」即可添加' },
  }
  const starredMsg = { title: '还没有收藏的音效', sub: '在任意音效详情里点「收藏」即可加入这里' }
  const msg = isStarred ? starredMsg : messages[tab]
  if (msg) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm text-muted-light mb-1">{msg.title}</p>
        <p className="text-xs text-muted">{msg.sub}</p>
      </div>
    )
  }
  return <EmptyState onImport={onImport} />
}

function StatusBar(): JSX.Element {
  const stats = useAppStore((s) => s.stats)
  const sounds = useAppStore((s) => s.sounds)
  const selectedSoundIds = useAppStore((s) => s.selectedSoundIds)
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const analyzingIds = useAppStore((s) => s.analyzingIds)
  const batchAnalyzing = useAppStore((s) => s.batchAnalyzing)

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  if (sidebarTab === 'trash') return <></>

  return (
    <div className="h-8 border-t border-surface-border flex items-center px-4 text-xs text-muted-light shrink-0">
      <span className="mr-5">{sounds.length} / {stats.total} 个音效</span>
      <span className="mr-5">{stats.starred} 个收藏</span>
      <span>共 {formatSize(stats.totalSize)}</span>
      {selectedSoundIds.length > 0 && (
        <span className="ml-auto text-accent-light">已选中 {selectedSoundIds.length} 个</span>
      )}
      {analyzingIds.length > 0 && (
        <span className="ml-auto text-amber-400 animate-pulse">
          AI 分析中（{analyzingIds.length}{batchAnalyzing ? ' · 批量' : ''}）…
        </span>
      )}
    </div>
  )
}
