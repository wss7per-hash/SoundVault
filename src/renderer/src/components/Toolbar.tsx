import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { Search, LayoutGrid, List, SlidersHorizontal, Minus, Plus, ArrowDownAZ, ArrowUpAZ, Clock, HardDrive, Calendar } from 'lucide-react'

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

export function Toolbar(): JSX.Element {
  const { searchQuery, setSearchQuery, fontSize, setFontSize } = useAppStore()
  const [showFilter, setShowFilter] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false)
      }
    }
    if (showFilter) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFilter])

  const activeSort = SORT_OPTIONS.find((s) => s.value === sortBy)

  return (
    <div className="h-11 border-b border-surface-border flex items-center gap-3 px-4 shrink-0 drag-region">
      {/* Search */}
      <div className="flex items-center gap-2 flex-1 min-w-0 no-drag">
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
            className="text-muted hover:text-muted-light text-sm no-drag"
          >
            清除
          </button>
        )}
      </div>

      {/* Font size control */}
      <div className="flex items-center gap-0.5 no-drag">
        <button
          onClick={() => setFontSize(Math.max(12, fontSize - 1))}
          disabled={fontSize <= 12}
          className="p-1 rounded text-muted hover:bg-surface-hover hover:text-muted-light disabled:opacity-30 disabled:cursor-default transition-colors"
          title="缩小字体"
        >
          <Minus size={14} />
        </button>
        <span className="text-xs text-muted w-10 text-center tabular-nums">{fontSize}px</span>
        <button
          onClick={() => setFontSize(Math.min(20, fontSize + 1))}
          disabled={fontSize >= 20}
          className="p-1 rounded text-muted hover:bg-surface-hover hover:text-muted-light disabled:opacity-30 disabled:cursor-default transition-colors"
          title="放大字体"
        >
          <Plus size={14} />
        </button>
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
    </div>
  )
}
