import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'
import { Search, LayoutGrid, List, SlidersHorizontal, Minus, Plus, ArrowDownAZ, ArrowUpAZ, Clock, HardDrive, Calendar, Minimize2, Square, X, Type, Upload, Download, Loader2, Check, Package, FolderOpen, Ban, CheckCircle2 } from 'lucide-react'

const SORT_OPTIONS = [
  { value: 'date', label: '导入时间', icon: Calendar },
  { value: 'name', label: '文件名', icon: ArrowDownAZ },
  { value: 'duration', label: '时长', icon: Clock },
  { value: 'size', label: '大小', icon: HardDrive }
] as const

const FORMAT_OPTIONS = [
  { value: null, label: '全部格式' },
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
  { value: 'ogg', label: 'OGG' },
  { value: 'm4a', label: 'M4A' },
  { value: 'aiff', label: 'AIFF' }
]

// Human-friendly elapsed time for the export progress panel.
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

// Lightweight cancellation token (no crypto dependency needed).
function makeToken(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function Toolbar(): JSX.Element {
  const { searchQuery, setSearchQuery, fontSize, setFontSize } = useAppStore()
  const [showFilter, setShowFilter] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [busy, setBusy] = useState<null | 'import'>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  // Export progress state
  const [exportState, setExportState] = useState<null | {
    token: string
    done: number
    total: number
    copied: number
    missing: number
    currentFile: string
    startTime: number
  }>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const exportStartRef = useRef(0)
  const exportRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)

  // 清理无效文件（本地音频已丢失的条目）
  const [showCleanupDlg, setShowCleanupDlg] = useState(false)
  const [cleanupCount, setCleanupCount] = useState(0)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const refreshStats = useAppStore((s) => s.refreshStats)

  // Resizable search box width (persisted in settings)
  const MIN_W = 180
  const MAX_W = 680
  const [searchWidth, setSearchWidth] = useState(320)
  const [isResizing, setIsResizing] = useState(false)
  const widthRef = useRef(searchWidth)
  widthRef.current = searchWidth

  // 全局快捷搜索的呼出快捷键（用于界面提示徽标）
  const [spotShortcut, setSpotShortcut] = useState('Ctrl+Shift+Space')
  useEffect(() => {
    window.api?.getSetting('spotlight.shortcut').then((v) => {
      if (v) {
        const isMac = /mac/i.test(navigator.platform)
        const disp = v
          .split('+')
          .map((p: string) =>
            p === 'CommandOrControl' ? (isMac ? 'Cmd' : 'Ctrl')
            : p === 'Command' ? 'Cmd'
            : p === 'Control' ? 'Ctrl'
            : p === 'Space' ? 'Space'
            : p
          )
          .join('+')
        setSpotShortcut(disp)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.api?.getSetting('toolbar.searchWidth').then((v) => {
      if (v) {
        const n = parseInt(v, 10)
        if (!Number.isNaN(n)) setSearchWidth(Math.min(MAX_W, Math.max(MIN_W, n)))
      }
    }).catch(() => {})
  }, [])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    const startX = e.clientX
    const startW = widthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX)))
      setSearchWidth(next)
    }
    const onUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.api?.setSetting('toolbar.searchWidth', String(widthRef.current))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Track maximize state for correct icon toggle
  useEffect(() => {
    if (window.api?.maximizeRestoreWindow) {
      // We can't easily track state from renderer; use a simple approach:
      // the button toggles, and we just call maximize/restore
    }
  }, [])

  const handleSearch = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchQuery(value)
      const sounds = value ? await window.api.searchSounds(value) : await window.api.getSounds()
      useAppStore.getState().setSounds(sounds)
    },
    [setSearchQuery]
  )

  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const sortBy = useAppStore((s) => s.sortBy)
  const setSortBy = useAppStore((s) => s.setSortBy)
  const sortOrder = useAppStore((s) => s.sortOrder)
  const setSortOrder = useAppStore((s) => s.setSortOrder)
  const formatFilter = useAppStore((s) => s.formatFilter)
  const setFormatFilter = useAppStore((s) => s.setFormatFilter)

  // ---- Library export / import ----

  const sounds = useAppStore((s) => s.sounds)
  const collections = useAppStore((s) => s.collections)
  const selectedSoundIds = useAppStore((s) => s.selectedSoundIds)

  /** Open the export scope picker (not the folder dialog yet). */
  const handleExportClick = useCallback(() => {
    setShowExportMenu((v) => !v)
  }, [])

  /** Execute export with a given set of sound IDs (undefined = all). */
  const doExport = useCallback(async (exportSoundIds?: string[]) => {
    setShowExportMenu(false)
    const dirs = await window.api.selectFolder()
    if (!dirs || dirs.length === 0) return
    const token = makeToken()
    const startTime = Date.now()
    exportStartRef.current = startTime
    setElapsedMs(0)
    setExportState({ token, done: 0, total: 0, copied: 0, missing: 0, currentFile: '', startTime })
    // Subscribe to main-process progress events before starting the export.
    const unsub = window.api.onExportProgress((p) => {
      setExportState((prev) =>
        prev
          ? { ...prev, done: p.done, total: p.total, copied: p.copied, missing: p.missing, currentFile: p.fileName }
          : prev
      )
    })
    try {
      const res = await window.api.exportLibrary(dirs[0], exportSoundIds, token)
      if (res.cancelled) {
        toast('已取消导出，未生成导出包')
      } else if (res.success) {
        const secs = ((res.elapsedMs ?? 0) / 1000).toFixed(1)
        toast((t) => (
          <div className="flex items-center gap-2.5 max-w-xs">
            <CheckCircle2 size={16} className="text-green-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-light leading-snug">导出完成</div>
              <div className="text-[10px] text-muted mt-0.5">
                {res.total} 个音效 · 复制 {res.copied} 个音频 · 缺失 {res.missing ?? 0} · 用时 {secs}s
              </div>
            </div>
            <button
              onClick={() => {
                if (res.path) window.api.openPath(res.path)
                toast.dismiss(t.id)
              }}
              className="shrink-0 flex items-center gap-1 px-1.5 py-1 rounded-md bg-accent/20 text-accent-light text-[10px] hover:bg-accent/30 transition-colors"
            >
              <FolderOpen size={11} />打开
            </button>
          </div>
        ), { duration: 8000 })
      } else {
        toast.error('导出失败：' + (res.error || '未知错误'))
      }
    } catch (err) {
      toast.error('导出出错：' + (err as Error).message)
    } finally {
      unsub()
      setExportState(null)
    }
  }, [])

  /** Cancel the in-flight export. */
  const cancelExport = useCallback(() => {
    if (exportState) window.api.cancelExport(exportState.token)
  }, [exportState])

  const handleImport = useCallback(async () => {
    const dirs = await window.api.selectFolder()
    if (!dirs || dirs.length === 0) return
    setBusy('import')
    try {
      const res = await window.api.importLibrary(dirs[0])
      if (res.success) {
        // 全量刷新：让刚导入的音效/标签/收藏夹/智能文件夹立刻可见
        const store = useAppStore.getState()
        await Promise.all([
          store.refreshSounds(),
          store.refreshTags(),
          store.refreshTagStats(),
          store.refreshStats(),
          store.refreshCollections(),
          store.refreshSmartFolders()
        ])
        toast.success(`已导入资源库（${res.imported} 个音效）`)
      } else {
        toast.error(res.error || '导入失败')
      }
    } catch (err) {
      toast.error('导入出错：' + (err as Error).message)
    } finally {
      setBusy(null)
    }
  }, [])

  // 清理无效文件：先扫描统计，再确认永久删除缺失条目
  const handleCleanupScan = useCallback(async () => {
    try {
      const res = await window.api.cleanupMissing('scan')
      if (res.success && res.missing > 0) {
        setCleanupCount(res.missing)
        setShowCleanupDlg(true)
      } else {
        toast('没有发现无效文件（本地音频均存在）')
      }
    } catch {
      toast.error('检测失败')
    }
  }, [])

  const handleCleanupConfirm = useCallback(async () => {
    setCleanupBusy(true)
    try {
      const res = await window.api.cleanupMissing('remove')
      if (res.success) {
        toast.success(`已清理 ${res.removed} 个无效文件`)
        await Promise.all([refreshSounds(), refreshStats()])
        setShowCleanupDlg(false)
      } else {
        toast.error(res.message || '清理失败')
      }
    } catch {
      toast.error('清理失败')
    } finally {
      setCleanupBusy(false)
    }
  }, [refreshSounds, refreshStats])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false)
      }
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    if (showFilter || showExportMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFilter, showExportMenu])

  // Live elapsed-time ticker while an export is running.
  const exporting = exportState !== null
  useEffect(() => {
    if (!exporting) {
      setElapsedMs(0)
      return
    }
    const t = setInterval(() => setElapsedMs(Date.now() - exportStartRef.current), 250)
    return () => clearInterval(t)
  }, [exporting])

  const activeSort = SORT_OPTIONS.find((s) => s.value === sortBy)

  return (
    <div className="h-11 border-b border-surface-border flex items-center gap-3 px-4 shrink-0 drag-region">
      {/* Search (resizable) */}
      <div
        className="flex items-center gap-2 min-w-0 no-drag relative"
        style={{ width: searchWidth }}
      >
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearch}
          placeholder="搜索音效、场景、情绪..."
          className="flex-1 bg-transparent text-sm text-muted-light placeholder:text-muted outline-none min-w-0"
        />
        {searchQuery && (
          <button
            onClick={async () => {
              setSearchQuery('')
              const sounds = await window.api.getSounds()
              useAppStore.getState().setSounds(sounds)
            }}
            className="text-muted hover:text-muted-light text-sm no-drag shrink-0"
          >
            清除
          </button>
        )}
      </div>

      {/* 全局快捷搜索入口提示（点击呼出） */}
      <button
        onClick={() => window.api?.openSpotlight?.()}
        title="点击呼出全局快捷搜索（也可随时按快捷键）"
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted hover:bg-surface-hover hover:text-muted-light transition-colors shrink-0 no-drag"
      >
        <span className="text-[13px] leading-none">⌨</span>
        <span className="tabular-nums">{spotShortcut}</span>
      </button>

      {/* Drag handle to resize search box */}
      <div
        onMouseDown={startResize}
        title="拖动调整搜索框宽度"
        className={`w-1.5 h-5 mx-0.5 cursor-col-resize no-drag flex items-center justify-center group ${
          isResizing ? 'bg-accent' : 'hover:bg-accent/60'
        } transition-colors`}
      >
        <div className={`w-px h-3.5 ${isResizing ? 'bg-white/70' : 'bg-surface-border group-hover:bg-accent-light'} transition-colors`} />
      </div>

      {/* Library export / import */}
      <div className="flex items-center gap-0.5 no-drag relative" ref={exportRef}>
        <div className="w-px h-5 bg-surface-border mx-1" />
        <button
          onClick={handleExportClick}
          disabled={busy !== null || exportState !== null}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
            showExportMenu
              ? 'bg-accent/20 text-accent-light'
              : 'text-muted hover:bg-surface-hover hover:text-muted-light'
          } disabled:opacity-30 disabled:cursor-default`}
        >
          <Download size={14} />
          导出
        </button>

        {/* Export scope picker panel */}
        {showExportMenu && (
          <div className="absolute right-0 top-full mt-2 w-60 bg-[#1f1f1d] border border-surface-border rounded-xl shadow-2xl py-3 z-50">
            <p className="px-3 pb-2 text-xs text-muted font-medium">选择导出范围</p>

            {/* Export all */}
            <button
              onClick={() => doExport()}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-muted-light hover:bg-surface-hover rounded-lg transition-colors"
            >
              <Package size={14} className="text-accent-light" />
              <div className="text-left">
                <div>全部导出</div>
                <div className="text-[10px] text-muted/60">导出整个资源库（{sounds.length} 个音效）</div>
              </div>
            </button>

            {/* Export selected */}
            {selectedSoundIds.length > 0 && (
              <button
                onClick={() => doExport(selectedSoundIds)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-muted-light hover:bg-surface-hover rounded-lg transition-colors"
              >
                <Check size={14} className="text-green-400" />
                <div className="text-left">
                  <div>选中项导出</div>
                  <div className="text-[10px] text-muted/60">仅导出选中的 {selectedSoundIds.length} 个音效</div>
                </div>
              </button>
            )}

            {/* Export by collection */}
            {collections.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] text-muted/50 uppercase tracking-wider">按收藏夹导出</div>
                <div className="max-h-40 overflow-y-auto px-1">
                  {collections.map((col) => (
                    <button
                      key={col.id}
                      onClick={async () => {
                        const colSounds = await window.api.getCollectionSounds(col.id)
                        doExport(colSounds.map((s) => s.id))
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-light hover:bg-surface-hover rounded-lg transition-colors"
                    >
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: col.color || '#534AB7' }} />
                      {col.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={busy !== null || exportState !== null}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors text-muted hover:bg-surface-hover hover:text-muted-light disabled:opacity-30 disabled:cursor-default"
        >
          <Upload size={14} />
          导入
        </button>

        {/* 清理无效文件：本地音频已丢失的条目 */}
        <button
          onClick={handleCleanupScan}
          disabled={busy !== null || exportState !== null}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors text-muted hover:bg-surface-hover hover:text-muted-light disabled:opacity-30 disabled:cursor-default"
          title="清理本地音频已丢失的无效条目"
        >
          <Ban size={14} />
          清理
        </button>
      </div>

      {/* Font size control — polished pill */}
      <div className="flex items-center no-drag ml-auto" title="调整界面文字大小">
        <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg bg-surface-card/60 border border-surface-border/50">
          <Type size={12} className="text-muted/60" />
          <button
            onClick={() => setFontSize(Math.max(12, fontSize - 1))}
            disabled={fontSize <= 12}
            className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-light hover:bg-surface-hover disabled:opacity-25 disabled:cursor-default transition-colors"
            title="缩小"
          >
            <Minus size={11} strokeWidth={2.5} />
          </button>
          <span
            className="text-[10px] font-medium text-muted-light tabular-nums min-w-[22px] text-center leading-none cursor-default select-none"
          >
            {fontSize}
          </span>
          <button
            onClick={() => setFontSize(Math.min(20, fontSize + 1))}
            disabled={fontSize >= 20}
            className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-light hover:bg-surface-hover disabled:opacity-25 disabled:cursor-default transition-colors"
            title="放大"
          >
            <Plus size={11} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 no-drag">
        {/* Filter / Sort */}
        <div className="relative" ref={filterRef}>
          <button
            onClick={() => setShowFilter(!showFilter)}
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              showFilter || sortBy !== 'date' || formatFilter
                ? 'bg-accent/20 text-accent-light'
                : 'text-muted hover:bg-surface-hover hover:text-muted-light'
            }`}
            title="筛选与排序"
          >
            <SlidersHorizontal size={16} />
            {(sortBy !== 'date' || formatFilter) && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-light" />
            )}
          </button>

          {showFilter && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-[#1f1f1d] border border-surface-border rounded-xl shadow-2xl py-3 z-50">
              {/* Sort by */}
              <div className="px-3 pb-2 mb-2 border-b border-surface-border/50">
                <p className="text-xs text-muted mb-2">排序方式</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSortBy(opt.value)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                        sortBy === opt.value
                          ? 'bg-accent/20 text-accent-light'
                          : 'text-muted-light hover:bg-surface-hover'
                      }`}
                    >
                      <opt.icon size={13} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Order */}
              <div className="px-3 pb-2 mb-2 border-b border-surface-border/50">
                <p className="text-xs text-muted mb-2">排序方向</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSortOrder('asc')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                      sortOrder === 'asc' ? 'bg-accent/20 text-accent-light' : 'text-muted-light hover:bg-surface-hover'
                    }`}
                  >
                    <ArrowUpAZ size={13} />
                    升序
                  </button>
                  <button
                    onClick={() => setSortOrder('desc')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                      sortOrder === 'desc' ? 'bg-accent/20 text-accent-light' : 'text-muted-light hover:bg-surface-hover'
                    }`}
                  >
                    <ArrowDownAZ size={13} />
                    降序
                  </button>
                </div>
              </div>

              {/* Format filter */}
              <div className="px-3">
                <p className="text-xs text-muted mb-2">格式过滤</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {FORMAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value ?? 'all'}
                      onClick={() => setFormatFilter(opt.value)}
                      className={`px-2 py-1.5 rounded-lg text-xs transition-colors ${
                        formatFilter === opt.value
                          ? 'bg-accent/20 text-accent-light'
                          : 'text-muted-light hover:bg-surface-hover'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-surface-border mx-1" />

        <button
          onClick={() => setViewMode('grid')}
          className={`p-1.5 rounded-md transition-colors ${
            viewMode === 'grid'
              ? 'bg-accent/20 text-accent-light'
              : 'text-muted hover:bg-surface-hover hover:text-muted-light'
          }`}
          title="网格视图"
        >
          <LayoutGrid size={16} />
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`p-1.5 rounded-md transition-colors ${
            viewMode === 'list'
              ? 'bg-accent/20 text-accent-light'
              : 'text-muted hover:bg-surface-hover hover:text-muted-light'
          }`}
          title="列表视图"
        >
          <List size={16} />
        </button>
      </div>

      {/* Window Controls (frameless mode) */}
      <div className="flex items-center gap-0.5 no-drag ml-2">
        <button
          onClick={() => window.api?.minimizeWindow()}
          className="p-1.5 rounded hover:bg-surface-hover text-muted hover:text-muted-light transition-colors"
          title="最小化"
        >
          <Minimize2 size={14} />
        </button>
        <button
          onClick={() => window.api?.maximizeRestoreWindow()}
          className="p-1.5 rounded hover:bg-surface-hover text-muted hover:text-muted-light transition-colors"
          title={isMaximized ? '还原' : '最大化'}
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => window.api?.closeWindow()}
          className="p-1.5 rounded hover:bg-red-500/80 text-muted hover:text-white transition-colors"
          title="关闭"
        >
          <X size={15} />
        </button>
      </div>

      {/* Library export progress panel (live progress + cancel) */}
      {exportState && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="relative w-[360px] bg-[#232321] border border-surface-border rounded-2xl shadow-2xl p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <Loader2 size={18} className="text-accent-light animate-spin shrink-0" />
              <div className="text-sm text-muted-light font-medium">正在导出资源库…</div>
            </div>

            {/* progress bar */}
            <div className="h-2 rounded-full bg-surface-border overflow-hidden mb-2">
              <div
                className="h-full bg-accent rounded-full transition-all duration-200"
                style={{ width: `${exportState.total > 0 ? (exportState.done / exportState.total) * 100 : 0}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted mb-3 tabular-nums">
              <span>已处理 {exportState.done} / {exportState.total} 个</span>
              <span>{formatElapsed(elapsedMs)}</span>
            </div>

            <div className="text-[11px] text-muted-light/80 mb-1 truncate" title={exportState.currentFile}>
              当前：{exportState.currentFile || '准备中…'}
            </div>
            <div className="text-[10px] text-muted mb-4">
              已复制 {exportState.copied} 个音频 · 缺失 {exportState.missing} 个
            </div>

            <button
              onClick={cancelExport}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25 text-xs transition-colors"
            >
              <Ban size={13} />取消导出
            </button>
          </div>
        </div>
      )}

      {/* Library import progress overlay */}
      {busy === 'import' && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-sm">
          <Loader2 size={32} className="text-accent-light animate-spin" />
          <p className="text-sm text-muted-light">正在导入资源库…</p>
          <p className="text-xs text-muted">请稍候，正在复制音频文件</p>
        </div>
      )}

      {/* 清理无效文件确认弹窗 */}
      {showCleanupDlg && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="w-[360px] bg-[#1f1f1d] border border-surface-border rounded-2xl shadow-2xl p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <AlertTriangle size={18} className="text-amber-400 shrink-0" />
              <h3 className="text-sm font-semibold text-[#f0ede6]">清理无效文件</h3>
            </div>
            <p className="text-xs text-muted-light leading-relaxed mb-1">
              检测到 <span className="text-amber-400 font-medium">{cleanupCount}</span> 个音效的本地音频文件已不存在（可能被外部删除或移动）。
            </p>
            <p className="text-xs text-muted leading-relaxed mb-4">
              确认后将从音效库中永久移除这些条目（含其标签与收藏关系，不可恢复）。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowCleanupDlg(false)}
                disabled={cleanupBusy}
                className="px-3 py-1.5 rounded-lg text-xs text-muted-light hover:bg-surface-hover transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleCleanupConfirm}
                disabled={cleanupBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/90 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {cleanupBusy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                {cleanupBusy ? '清理中…' : `确认清理 ${cleanupCount} 个`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
