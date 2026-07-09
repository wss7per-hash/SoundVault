import { useEffect, useCallback, useMemo } from 'react'
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

export default function App(): JSX.Element {
  const {
    sounds,
    sidebarTab,
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
  }, [refreshSounds, refreshTags, refreshTagStats, refreshStats, refreshCollections, refreshSmartFolders])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`
  }, [fontSize])

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
                {sounds.length === 0 ? (
                  <EmptyState onImport={loadData} />
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
