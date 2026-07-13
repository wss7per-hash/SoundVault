import { useEffect, useCallback, useMemo, useState, useRef } from 'react'
import { useAppStore } from './stores/appStore'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { SoundGrid } from './components/SoundGrid'
import { DetailPanel } from './components/DetailPanel'
import { EmptyState } from './components/EmptyState'
import { FloatingQuickBar } from './components/FloatingQuickBar'
import { RecycleBin } from './components/RecycleBin'
import ScanDialog from './components/ScanDialog'
import ModelConfig from './components/ModelConfig'
import { Toaster } from 'react-hot-toast'
import { Star } from 'lucide-react'
import { SplashScreen } from './components/SplashScreen'

export default function App(): JSX.Element {
  const [showSplash, setShowSplash] = useState(true)
  const [dataReady, setDataReady] = useState(false)
  const {
    sounds,
    sidebarTab,
    activeCollectionId,
    selectedSoundId,
    showScanDialog,
    showModelConfig,
    fontSize,
    sortBy,
    sortOrder,
    formatFilter,
    selectedTagId,
    tags,
    refreshSounds,
    refreshTags,
    refreshTagStats,
    refreshStats,
    refreshCollections,
    refreshSmartFolders,
    selectSound,
    toggleScanDialog,
    toggleModelConfig
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
  }, [sounds, sortBy, sortOrder, formatFilter, selectedTagId, tags])

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

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`
  }, [fontSize])

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

  // Ctrl+A / Ctrl+D select all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when in input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        useAppStore.getState().selectAll(filteredSounds.map((s) => s.id))
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

  const handleSelectSound = useCallback(
    (id: string) => { selectSound(selectedSoundId === id ? null : id) },
    [selectedSoundId, selectSound]
  )

  return (
    <div className="flex h-full">
      {/* Startup splash animation */}
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} ready={dataReady} />}

      <Toaster position="bottom-right" toastOptions={{
        style: { background: '#2C2C2A', color: '#D3D1C7', border: '0.5px solid #3E3E3C', fontSize: '12px' }
      }} />

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />

        <div className="flex-1 flex min-h-0">
          {sidebarTab === 'trash' ? (
            <RecycleBin />
          ) : (
            <>
              <div className="flex-1 flex flex-col min-w-0">
                {sidebarTab === 'collections' && activeCollectionId === '__starred__' && (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-[#2a2a28] text-xs text-amber-400 shrink-0">
                    <Star size={13} className="fill-amber-400" />
                    <span>收藏 · 已星标的音效（不归属于任何收藏夹）</span>
                  </div>
                )}
                {sounds.length === 0 ? (
                  <TabEmptyState tab={sidebarTab} onImport={loadData} />
                ) : (
                  <SoundGrid sounds={filteredSounds} selectedId={selectedSoundId} onSelect={handleSelectSound} />
                )}
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

      {/* Modals */}
      <ScanDialog isOpen={showScanDialog} onClose={() => toggleScanDialog()} />
      <ModelConfig isOpen={showModelConfig} onClose={() => toggleModelConfig()} />
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
    <div className="h-8 border-t border-[#2a2a28] flex items-center px-4 text-xs text-[#6a6a64] shrink-0">
      <span className="mr-5">{sounds.length} / {stats.total} 个音效</span>
      <span className="mr-5">{stats.starred} 个收藏</span>
      <span>共 {formatSize(stats.totalSize)}</span>
      {selectedSoundIds.length > 0 && (
        <span className="ml-auto text-[#7C72E6]">已选中 {selectedSoundIds.length} 个</span>
      )}
      {analyzingIds.length > 0 && (
        <span className="ml-auto text-[#F59E0B] animate-pulse">
          AI 分析中（{analyzingIds.length}{batchAnalyzing ? ' · 批量' : ''}）…
        </span>
      )}
    </div>
  )
}
