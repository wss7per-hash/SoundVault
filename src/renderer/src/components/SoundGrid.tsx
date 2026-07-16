import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { SoundData, CollectionData, TagData } from '../../preload/index.d'
import {
  Play, Pause, Star, Check, Music, FolderOpen, Folder, Copy, FileInput, Pencil, Tag, FolderPlus,
  Sparkles, Trash2, X, Volume2, Heart, MoreHorizontal, Film, Wrench, Download
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'

interface SoundGridProps {
  sounds: SoundData[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function SoundGrid({ sounds, selectedId, onSelect }: SoundGridProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sound: SoundData } | null>(null)
  const [tagInputVisible, setTagInputVisible] = useState(false)
  const [collectionMenuVisible, setCollectionMenuVisible] = useState(false)
  const [renameSound, setRenameSound] = useState<SoundData | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // ---- Rubber band selection state ----
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)

  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const selectedIds = useAppStore((s) => s.selectedSoundIds)
  const toggleSoundSelection = useAppStore((s) => s.toggleSoundSelection)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const selectSound = useAppStore((s) => s.selectSound)
  const setSelection = useAppStore((s) => s.setSelection)
  const selectRange = useAppStore((s) => s.selectRange)
  const viewMode = useAppStore((s) => s.viewMode)
  const collections = useAppStore((s) => s.collections)
  const tags = useAppStore((s) => s.tags)
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const gridDensity = useAppStore((s) => s.gridDensity)
  const isMultiSelecting = selectedIds.length > 0

  // ── 窗口化渲染（虚拟化）：只挂载可视区附近的卡片，避免万级 DOM 卡死 ──
  const VIRTUAL_CHUNK = 300
  const [visibleCount, setVisibleCount] = useState(VIRTUAL_CHUNK)
  const soundsRef = useRef(sounds)
  soundsRef.current = sounds
  // 数据集变化（新搜索/筛选/刷新）时重置窗口并回到顶部
  useEffect(() => {
    setVisibleCount(VIRTUAL_CHUNK)
    containerRef.current?.scrollTo({ top: 0 })
  }, [sounds])
  const visibleSounds = useMemo(
    () => sounds.slice(0, visibleCount),
    [sounds, visibleCount]
  )
  const handleGridScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) {
      setVisibleCount((c) => Math.min(soundsRef.current.length, c + VIRTUAL_CHUNK))
    }
  }, [])

  // 键盘导航所需的实时引用（避免 window 监听器反复重绑）
  const stateRef = useRef({ sounds, selectedId })
  stateRef.current = { sounds, selectedId }
  const playingIdRef = useRef<string | null>(null)
  playingIdRef.current = playingId
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Audio preview logic
  const startPreview = useCallback((sound: SoundData) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    const audio = new Audio(`sv://${sound.id}`)
    audioRef.current = audio
    audio.onended = () => setPlayingId(null)
    audio.onerror = () => { setPlayingId(null); toast.error('无法播放此格式') }
    audio.volume = 0.6
    audio.play().then(() => {
      setPlayingId(sound.id)
      window.api.incrementPlayCount(sound.id).catch(() => {})
    }).catch(() => {})
  }, [])

  const stopPreview = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    setPlayingId(null)
  }, [])

  const handleMouseEnter = useCallback((sound: SoundData, e: React.MouseEvent) => {
    if (isDragging) return
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredId(sound.id)
      setTooltipPos({ x: e.clientX, y: e.clientY })
      startPreview(sound)
    }, 250)
  }, [isDragging, startPreview])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (hoveredId) setTooltipPos({ x: e.clientX, y: e.clientY })
  }, [hoveredId])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null }
    setHoveredId(null)
    setTooltipPos(null)
    stopTimeoutRef.current = setTimeout(() => stopPreview(), 120)
  }, [stopPreview])

  // ---- Rubber band selection ----
  const THRESHOLD = 5 // px minimum drag to start

  const getContainerPos = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const scrollX = containerRef.current?.scrollLeft ?? 0
    const scrollY = containerRef.current?.scrollTop ?? 0
    return { x: e.clientX - rect.left + scrollX, y: e.clientY - rect.top + scrollY }
  }, [])

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start box select on left click in empty area
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const card = target.closest('[data-sound-id]')
    if (card) return // clicked on a card, let card handle it

    const pos = getContainerPos(e)
    setDragStart(pos)
    setDragCurrent(pos)
    setIsDragging(false) // wait for threshold
  }, [getContainerPos])

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart) return
    const pos = getContainerPos(e)
    setDragCurrent(pos)

    const dx = pos.x - dragStart.x
    const dy = pos.y - dragStart.y
    if (Math.abs(dx) > THRESHOLD || Math.abs(dy) > THRESHOLD) {
      setIsDragging(true)
      // clear hover when dragging
      setHoveredId(null)
      setTooltipPos(null)
      stopPreview()
    }
  }, [dragStart, getContainerPos, stopPreview])

  const handleContainerMouseUp = useCallback(() => {
    if (dragStart) {
      if (isDragging) {
        collectSelectedCards()        // box select: replace selection
      } else {
        clearSelection()              // plain click on empty area: clear multi-selection
        selectSound(null)             // also clear single-selection (right panel) so clicking blank deselects all
      }
    }
    setDragStart(null)
    setDragCurrent(null)
    setIsDragging(false)
  }, [isDragging, dragStart, dragCurrent, clearSelection, selectSound])

  const collectSelectedCards = useCallback(() => {
    if (!dragStart || !dragCurrent) return
    const selRect = {
      left: Math.min(dragStart.x, dragCurrent.x),
      top: Math.min(dragStart.y, dragCurrent.y),
      right: Math.max(dragStart.x, dragCurrent.x),
      bottom: Math.max(dragStart.y, dragCurrent.y),
    }

    const cards = containerRef.current?.querySelectorAll('[data-sound-id]')
    if (!cards) return

    const ids: string[] = []
    const containerRect = containerRef.current!.getBoundingClientRect()
    const scrollX = containerRef.current!.scrollLeft
    const scrollY = containerRef.current!.scrollTop

    cards.forEach((el) => {
      const rect = el.getBoundingClientRect()
      const cardRect = {
        left: rect.left - containerRect.left + scrollX,
        top: rect.top - containerRect.top + scrollY,
        right: rect.right - containerRect.left + scrollX,
        bottom: rect.bottom - containerRect.top + scrollY,
      }
      // check intersection > 30%
      const ix = Math.max(selRect.left, cardRect.left)
      const iy = Math.max(selRect.top, cardRect.top)
      const ix2 = Math.min(selRect.right, cardRect.right)
      const iy2 = Math.min(selRect.bottom, cardRect.bottom)
      const iw = Math.max(0, ix2 - ix)
      const ih = Math.max(0, iy2 - iy)
      const intersectArea = iw * ih
      const cardArea = (cardRect.right - cardRect.left) * (cardRect.bottom - cardRect.top)
      // threshold: only pick cards with >20% overlap (for grid this is fine)
      const threshold = cardArea > 0 ? (cardArea * 0.2) : 1
      if (intersectArea > threshold) {
        ids.push(el.getAttribute('data-sound-id')!)
      }
    })

    setSelection(ids)
  }, [dragStart, dragCurrent, setSelection])

  // ---- Card click handler (Ctrl/Shift) ----
  const handleCardClick = useCallback((sound: SoundData, index: number, e: React.MouseEvent) => {
    if (isDragging) return

    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation()
      toggleSoundSelection(sound.id)
      setLastClickedIndex(index)
      return
    }

    if (e.shiftKey) {
      e.stopPropagation()
      if (lastClickedIndex !== null) {
        selectRange(lastClickedIndex, index, sounds.map((s) => s.id))
      } else {
        toggleSoundSelection(sound.id)
      }
      return
    }

    // Normal click: if multi-select mode, toggle; else select single
    if (selectedIds.length > 0) {
      e.stopPropagation()
      toggleSoundSelection(sound.id)
      setLastClickedIndex(index)
    } else {
      onSelect(sound.id)
      setLastClickedIndex(index)
    }
  }, [isDragging, lastClickedIndex, sounds, selectedIds, toggleSoundSelection, selectRange, onSelect])

  // Cleanup
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
      stopPreview()
    }
  }, [stopPreview])

  // ---- Keyboard grid navigation ----
  // 计算当前网格列数：第一行卡片的 offsetTop 相同，数出这一行有几个。
  const getColumns = useCallback((): number => {
    const cards = containerRef.current?.querySelectorAll('[data-sound-id]')
    if (!cards || cards.length === 0) return 1
    const firstTop = cards[0].getBoundingClientRect().top
    let cols = 0
    for (const c of cards) {
      if (Math.abs(c.getBoundingClientRect().top - firstTop) < 1) cols++
      else break
    }
    return Math.max(1, cols)
  }, [])

  // 移动单选焦点（并联动右侧详情面板），必要时滚动到可见区域。
  const focusIndex = useCallback((idx: number) => {
    const list = stateRef.current.sounds
    if (list.length === 0) return
    const clamped = Math.max(0, Math.min(list.length - 1, idx))
    const sound = list[clamped]
    useAppStore.getState().selectSound(sound.id)
    const card = containerRef.current?.querySelectorAll('[data-sound-id]')[clamped] as HTMLElement | undefined
    card?.scrollIntoView({ block: 'nearest' })
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 不拦截输入框 / 可编辑元素内的按键
      const target = e.target as HTMLElement
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      // 网格内的上下文菜单 / 重命名弹窗打开时交给它们处理
      if (contextMenu || renameSound) return
      // 修饰键组合（Ctrl/Alt/Cmd）留给浏览器与 App 级快捷键（如 Ctrl+A）
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const list = stateRef.current.sounds
      if (list.length === 0) return
      const curIdx = list.findIndex((s) => s.id === stateRef.current.selectedId)

      // 字符快速跳转（typeahead）：支持连续输入前缀，800ms 内有效
      if (e.key.length === 1 && e.key !== ' ') {
        e.preventDefault()
        typeaheadRef.current += e.key.toLowerCase()
        if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
        typeaheadTimerRef.current = setTimeout(() => { typeaheadRef.current = '' }, 800)
        const q = typeaheadRef.current
        let found = -1
        // 先从当前项之后环绕查找「文件名以 q 开头」
        for (let i = 1; i <= list.length; i++) {
          const idx = ((curIdx >= 0 ? curIdx : -1) + i) % list.length
          if (list[idx].file_name.toLowerCase().startsWith(q)) { found = idx; break }
        }
        if (found < 0) {
          // 退而求其次：文件名包含 q
          for (let i = 1; i <= list.length; i++) {
            const idx = ((curIdx >= 0 ? curIdx : -1) + i) % list.length
            if (list[idx].file_name.toLowerCase().includes(q)) { found = idx; break }
          }
        }
        if (found >= 0) focusIndex(found)
        return
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault()
          const cols = getColumns()
          let next = curIdx < 0 ? 0 : curIdx
          if (e.key === 'ArrowRight') next = curIdx < 0 ? 0 : curIdx + 1
          else if (e.key === 'ArrowLeft') next = curIdx < 0 ? 0 : curIdx - 1
          else if (e.key === 'ArrowDown') next = curIdx < 0 ? 0 : curIdx + cols
          else if (e.key === 'ArrowUp') next = curIdx < 0 ? 0 : curIdx - cols
          next = Math.max(0, Math.min(list.length - 1, next))
          focusIndex(next)
          break
        }
        case ' ':
        case 'Spacebar': {
          e.preventDefault()
          const idx = curIdx < 0 ? 0 : curIdx
          const sound = list[idx]
          if (!sound) return
          if (playingIdRef.current === sound.id) stopPreview()
          else startPreview(sound)
          break
        }
        case 'Enter': {
          if (curIdx >= 0) {
            e.preventDefault()
            useAppStore.getState().selectSound(list[curIdx].id)
          }
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [contextMenu, renameSound, getColumns, focusIndex, startPreview, stopPreview])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setTagInputVisible(false)
    setCollectionMenuVisible(false)
  }, [])

  // Box-select rect style
  const boxStyle = dragStart && dragCurrent ? (() => {
    const l = Math.min(dragStart.x, dragCurrent.x)
    const t = Math.min(dragStart.y, dragCurrent.y)
    const w = Math.abs(dragCurrent.x - dragStart.x)
    const h = Math.abs(dragCurrent.y - dragStart.y)
    return { left: l, top: t, width: w, height: h, display: 'block' as const }
  })() : { display: 'none' as const }

  const ctx = contextMenu
  const hoveredSound = hoveredId ? sounds.find((s) => s.id === hoveredId) || null : null

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 relative select-none"
      onScroll={handleGridScroll}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={(e) => {
        handleContainerMouseMove(e)
        handleMouseMove(e)
      }}
      onMouseUp={handleContainerMouseUp}
      onClick={closeContextMenu}
    >
      {/* Rubber band selection box */}
      <div
        className="absolute border border-accent-light/70 bg-accent-light/15 rounded pointer-events-none z-40"
        style={boxStyle}
      />

      {viewMode === 'grid' ? (
        <div
          className={gridDensity === 'compact' ? 'grid gap-2' : 'grid gap-3'}
          style={{ gridTemplateColumns: gridDensity === 'compact' ? 'repeat(auto-fill, minmax(150px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))' }}
        >
          {visibleSounds.map((sound, idx) => (
            <SoundCard
              key={sound.id}
              sound={sound}
              index={idx}
              compact={gridDensity === 'compact'}
              isSelected={sound.id === selectedId}
              isHovered={sound.id === hoveredId}
              isPlaying={sound.id === playingId}
              isChecked={selectedIds.includes(sound.id)}
              isMultiSelecting={selectedIds.length > 0}
              onClick={(e) => handleCardClick(sound, idx, e)}
              onCheck={(e) => { e.stopPropagation(); toggleSoundSelection(sound.id); setLastClickedIndex(idx) }}
              onMouseEnter={(e) => handleMouseEnter(sound, e)}
              onMouseLeave={handleMouseLeave}
              onContextMenu={(e) => handleContextMenu(e, sound)}
              onDragFile={() => window.api.startDragFile(sound.file_path)}
            />
          ))}
        </div>
      ) : (
        <div className="border border-surface-border rounded-xl overflow-hidden bg-surface-card/50">
          <div className="grid grid-cols-12 gap-3 px-4 py-2.5 text-xs text-muted border-b border-surface-border bg-surface-card">
            <div className="col-span-5">文件名 / 描述</div>
            <div className="col-span-2">标签</div>
            <div className="col-span-1">格式</div>
            <div className="col-span-1">时长</div>
            <div className="col-span-1">大小</div>
            <div className="col-span-2">操作</div>
          </div>
          {visibleSounds.map((sound, idx) => (
            <SoundListRow
              key={sound.id}
              sound={sound}
              index={idx}
              isSelected={sound.id === selectedId}
              isPlaying={sound.id === playingId}
              isChecked={selectedIds.includes(sound.id)}
              isMultiSelecting={selectedIds.length > 0}
              onClick={(e) => handleCardClick(sound, idx, e)}
              onPlay={() => startPreview(sound)}
              onCheck={(e) => { e.stopPropagation(); toggleSoundSelection(sound.id); setLastClickedIndex(idx) }}
              onContextMenu={(e) => handleContextMenu(e, sound)}
              onDragFile={() => window.api.startDragFile(sound.file_path)}
            />
          ))}
        </div>
      )}

      {sounds.length > visibleCount && (
        <div className="text-center text-xs text-muted py-3 pointer-events-none">
          已显示 {visibleCount} / {sounds.length} · 向下滚动自动加载更多
        </div>
      )}

      {hoveredSound && tooltipPos && !isDragging && (
        <SoundPreviewTooltip sound={hoveredSound} x={tooltipPos.x} y={tooltipPos.y} isPlaying={hoveredSound.id === playingId} />
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          sound={ctx.sound}
          collections={collections}
          tags={tags}
          tagInputVisible={tagInputVisible}
          setTagInputVisible={setTagInputVisible}
          collectionMenuVisible={collectionMenuVisible}
          setCollectionMenuVisible={setCollectionMenuVisible}
          onClose={closeContextMenu}
          refreshSounds={refreshSounds}
          clearSelection={clearSelection}
          setRenameSound={setRenameSound}
        />
      )}

      {renameSound && (
        <RenameModal
          sound={renameSound}
          value={renameValue}
          onChange={setRenameValue}
          onClose={() => setRenameSound(null)}
          onConfirm={async (newName) => {
            const res = await window.api.renameSound(renameSound.id, newName)
            if (res.success) {
              toast.success('重命名成功')
              refreshSounds()
            } else {
              toast.error(res.message || '重命名失败，文件名可能已被占用')
            }
            setRenameSound(null)
          }}
        />
      )}
    </div>
  )

  // ---- Nested functions ----

  function handleContextMenu(e: React.MouseEvent, sound: SoundData) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, sound })
  }
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                            */
/* ------------------------------------------------------------------ */

function SoundPreviewTooltip({ sound, x, y, isPlaying }: { sound: SoundData; x: number; y: number; isPlaying: boolean }): JSX.Element {
  const formatDuration = (ms: number | null): string => {
    if (!ms) return '--:--'
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, '0')}`
  }
  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  const tags = (sound.tags || '').split(',').filter(Boolean).slice(0, 5)
  const info = [
    { label: '时长', value: formatDuration(sound.duration_ms) },
    { label: '大小', value: formatSize(sound.file_size) },
    { label: '采样率', value: sound.sample_rate ? `${sound.sample_rate} Hz` : '-' },
    { label: '声道', value: sound.channels ? `${sound.channels} ch` : '-' },
    { label: '比特率', value: sound.bitrate_kbps ? `${sound.bitrate_kbps} kbps` : '-' },
  ]

  const left = Math.min(x + 16, window.innerWidth - 320)
  const top = Math.min(y + 16, window.innerHeight - 280)

  return (
    <div
      className="fixed z-50 w-72 p-3 rounded-xl border border-surface-border bg-surface-panel shadow-2xl"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${isPlaying ? 'bg-accent' : 'bg-surface-card'}`}>
          {isPlaying ? <Volume2 size={14} className="text-white" /> : <Music size={14} className="text-muted" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-light truncate" title={sound.file_name}>{sound.file_name}</p>
          <p className="text-xs text-muted truncate">{isPlaying ? '正在试听...' : (sound.description || '等待 AI 分析...')}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {info.map((item) => (
          <div key={item.label} className="px-2 py-1.5 rounded-lg bg-surface-card/60 border border-surface-border/50">
            <p className="text-[10px] text-muted uppercase tracking-wider">{item.label}</p>
            <p className="text-xs font-medium text-muted-light">{item.value}</p>
          </div>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-surface-panel text-[10px] text-muted">{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Grid Card                                                          */
/* ------------------------------------------------------------------ */

interface SoundCardProps {
  sound: SoundData
  index: number
  compact?: boolean
  isSelected: boolean
  isHovered: boolean
  isPlaying: boolean
  isChecked: boolean
  isMultiSelecting: boolean
  onClick: (e: React.MouseEvent) => void
  onCheck: (e: React.MouseEvent) => void
  onMouseEnter: (e: React.MouseEvent) => void
  onMouseLeave: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragFile?: () => void
}

function SoundCard({ sound, compact = false, isSelected, isHovered, isPlaying, isChecked, isMultiSelecting, onClick, onCheck, onMouseEnter, onMouseLeave, onContextMenu, onDragFile }: SoundCardProps): JSX.Element {
  const formatDuration = (ms: number | null): string => {
    if (!ms) return '--:--'
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, '0')}`
  }

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  const handleStar = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await window.api.toggleStar(sound.id); useAppStore.getState().refreshSounds() } catch { toast.error('收藏操作未成功，请稍后重试') }
  }, [sound.id])

  return (
    <div
      data-sound-id={sound.id}
      draggable
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; onDragFile?.() }}
      title="拖拽到 After Effects 等应用直接导入"
      className={`relative rounded-xl border cursor-grab active:cursor-grabbing transition-all duration-150 overflow-hidden ${
        isSelected || isChecked
          ? 'border-accent bg-accent/10'
          : isHovered
            ? 'border-surface-border bg-surface-card'
            : 'border-transparent bg-surface-card/50'
      }`}
    >
      {/* Waveform + Play area */}
      <div className={`${compact ? 'h-20' : 'h-24'} bg-surface-card flex items-center justify-center relative`}>
        <div className="w-full h-full px-4 flex items-center justify-center">
          <svg viewBox="0 0 200 48" className="w-full h-10" preserveAspectRatio="none" style={{ opacity: isPlaying ? 0.7 : 0.35 }}>
            <path
              d={`M0,24 ${Array.from({ length: 40 }, (_, i) => {
                const h = Math.sin(i * 0.45) * 9 + Math.sin(i * 1.3) * 5 + Math.sin(i * 0.18) * 3
                return `L${i * 5},${24 + h}`
              }).join(' ')}`}
              fill="none"
              stroke={isPlaying ? '#7C72E6' : '#534AB7'}
              strokeWidth="0.8"
            />
          </svg>
        </div>

        {isPlaying && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-accent/90 flex items-center justify-center">
              <Volume2 size={18} className="text-white" />
            </div>
          </div>
        )}

        {(isMultiSelecting || isChecked) && (
          <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isChecked ? 'bg-accent border-accent' : 'border-muted bg-black/30'
          }`}>
            {isChecked && <Check size={12} className="text-white" />}
          </div>
        )}

        {sound.is_starred && !isMultiSelecting && (
          <button onClick={handleStar} className="absolute top-2 right-2 p-0.5 rounded hover:bg-black/20 transition-colors">
            <Star size={14} className="text-amber-400 fill-amber-400" />
          </button>
        )}

        {sound.ai_analyzed_at && !isMultiSelecting && !sound.is_starred && (
          <div className="absolute top-2 right-2">
            <span className="w-2 h-2 rounded-full bg-green-500 block" title="AI 已分析" />
          </div>
        )}
      </div>

      {/* Card info */}
      <div className={compact ? 'p-2.5' : 'p-3'}>
        <p className="text-sm font-medium text-muted-light truncate mb-1.5" title={sound.file_name}>
          {sound.file_name}
        </p>

        {sound.description ? (
          <p className="text-xs text-muted line-clamp-2 leading-relaxed mb-2">{sound.description}</p>
        ) : (
          <p className="text-xs text-muted/50 mb-2">等待 AI 分析...</p>
        )}

        <div className="flex items-center justify-between text-xs text-muted">
          <div className="flex items-center gap-2">
            <span>{formatDuration(sound.duration_ms)}</span>
            <span className="px-1.5 py-0.5 rounded bg-surface-panel text-xs">{sound.file_ext.toUpperCase()}</span>
          </div>
          <span>{formatSize(sound.file_size)}</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* List Row                                                           */
/* ------------------------------------------------------------------ */

interface SoundListRowProps {
  sound: SoundData
  index: number
  isSelected: boolean
  isPlaying: boolean
  isChecked: boolean
  isMultiSelecting: boolean
  onClick: (e: React.MouseEvent) => void
  onPlay: () => void
  onCheck: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragFile?: () => void
}

function SoundListRow({ sound, isSelected, isPlaying, isChecked, isMultiSelecting, onClick, onPlay, onCheck, onContextMenu, onDragFile }: SoundListRowProps): JSX.Element {
  const formatDuration = (ms: number | null): string => {
    if (!ms) return '--:--'
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, '0')}`
  }

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  const handleStar = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await window.api.toggleStar(sound.id); useAppStore.getState().refreshSounds() } catch { toast.error('收藏操作未成功，请稍后重试') }
  }, [sound.id])

  const tags = (sound.tags || '').split(',').filter(Boolean).slice(0, 3)
  const hasMoreTags = (sound.tags || '').split(',').filter(Boolean).length > 3

  return (
    <div
      data-sound-id={sound.id}
      draggable
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; onDragFile?.() }}
      title="拖拽到 After Effects 等应用直接导入"
      className={`grid grid-cols-12 gap-3 px-4 py-3 items-center border-b border-surface-border/50 cursor-grab active:cursor-grabbing transition-all ${
        isSelected || isChecked
          ? 'bg-accent/10'
          : 'hover:bg-surface-card'
      }`}
    >
      <div className="col-span-5 flex items-center gap-3 min-w-0">
        <div
          onClick={onCheck}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
            isChecked ? 'bg-accent border-accent' : 'border-muted bg-black/30'
          }`}
        >
          {isChecked && <Check size={12} className="text-white" />}
        </div>
        <div className="w-9 h-9 rounded-lg bg-surface-panel flex items-center justify-center shrink-0">
          {isPlaying ? <Volume2 size={16} className="text-accent" /> : <Music size={16} className="text-muted" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-light truncate" title={sound.file_name}>
            {sound.file_name}
          </p>
          <p className="text-xs text-muted truncate">
            {sound.description || '等待 AI 分析...'}
          </p>
        </div>
      </div>

      <div className="col-span-2 flex flex-wrap gap-1 min-w-0">
        {tags.length > 0 ? tags.map((tag, i) => (
          <span key={i} className="px-1.5 py-0.5 rounded bg-surface-panel text-xs text-muted truncate max-w-[80px]">
            {tag}
          </span>
        )) : (
          <span className="text-xs text-muted/50">-</span>
        )}
        {hasMoreTags && <span className="text-xs text-muted/50">+</span>}
      </div>

      <div className="col-span-1">
        <span className="px-1.5 py-0.5 rounded bg-surface-panel text-xs text-muted">{sound.file_ext.toUpperCase()}</span>
      </div>

      <div className="col-span-1 text-xs text-muted">{formatDuration(sound.duration_ms)}</div>
      <div className="col-span-1 text-xs text-muted">{formatSize(sound.file_size)}</div>

      <div className="col-span-2 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onPlay() }}
          className={`p-1.5 rounded-md transition-colors ${
            isPlaying ? 'bg-accent text-white' : 'text-muted hover:bg-surface-hover hover:text-muted-light'
          }`}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          onClick={handleStar}
          className={`p-1.5 rounded-md transition-colors ${
            sound.is_starred ? 'text-amber-400' : 'text-muted hover:bg-surface-hover hover:text-muted-light'
          }`}
        >
          <Star size={14} className={sound.is_starred ? 'fill-amber-400' : ''} />
        </button>
        {sound.ai_analyzed_at && (
          <span className="w-2 h-2 rounded-full bg-green-500 block" title="AI 已分析" />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Context Menu                                                       */
/* ------------------------------------------------------------------ */

interface ContextMenuProps {
  x: number
  y: number
  sound: SoundData
  collections: CollectionData[]
  tags: TagData[]
  tagInputVisible: boolean
  setTagInputVisible: (v: boolean) => void
  collectionMenuVisible: boolean
  setCollectionMenuVisible: (v: boolean) => void
  onClose: () => void
  refreshSounds: () => Promise<void>
  clearSelection: () => void
  setRenameSound: (s: SoundData | null) => void
}

function ContextMenu({ x, y, sound, collections, tags, tagInputVisible, setTagInputVisible, collectionMenuVisible, setCollectionMenuVisible, onClose, refreshSounds, clearSelection, setRenameSound }: ContextMenuProps): JSX.Element {
  const [tagValue, setTagValue] = useState('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const left = Math.min(x, window.innerWidth - 220)
  const top = Math.min(y, window.innerHeight - (menuRef.current?.offsetHeight || 360))
  // 右侧飞出面板位置：紧贴主菜单右边缘
  const flyoutLeft = left + 208 // 主菜单宽 ~208px + 小间距
  const flyoutTop = Math.min(top + 168, window.innerHeight - 280) // 对齐「加入收藏夹」行附近

  const handleShowInFolder = async () => {
    const res = await window.api.showItemInFolder(sound.id)
    if (!res.success) toast.error(res.message || '无法打开文件位置，请确认文件仍然存在')
    onClose()
  }

  const handleCopyTo = async () => {
    const result = await window.api.selectFolder()
    if (!result || result.length === 0) return
    const toastId = toast.loading('正在复制...')
    const res = await window.api.copyFileTo(sound.id, result[0])
    toast.dismiss(toastId)
    if (res.success) toast.success('已复制到目标文件夹')
    else toast.error(res.message || '复制失败，请检查目标文件夹是否可写')
    onClose()
  }

  const handleMoveTo = async () => {
    const result = await window.api.selectFolder()
    if (!result || result.length === 0) return
    const toastId = toast.loading('正在移动...')
    const res = await window.api.moveFileTo(sound.id, result[0])
    toast.dismiss(toastId)
    if (res.success) { toast.success('已移动'); refreshSounds() }
    else toast.error(res.message || '移动失败，请检查目标文件夹是否可写')
    onClose()
  }

  const handleTrash = async () => {
    // If multiple items are selected, batch delete; otherwise delete single
    const selectedIds = useAppStore.getState().selectedSoundIds
    if (selectedIds.length > 1) {
      const res = await window.api.batchDelete(selectedIds)
      if (res.success) { toast.success(`已移到回收站 (${selectedIds.length} 个)`); clearSelection(); refreshSounds() }
      else toast.error(res.message || '批量删除失败，请稍后重试')
    } else {
      const res = await window.api.trashFile(sound.id)
      if (res.success) { toast.success('已移到回收站'); refreshSounds() }
      else toast.error(res.message || '删除失败，文件可能已被占用')
    }
    onClose()
  }

  const handleStar = async () => {
    try { await window.api.toggleStar(sound.id); refreshSounds() } catch { toast.error('操作失败') }
    onClose()
  }

  const handleAnalyze = async () => {
    onClose()
    await useAppStore.getState().analyzeSound(sound.id)
    refreshSounds()
  }

  const handleImportToAE = async () => {
    try {
      onClose()
      const res = await window.api.importToAE(sound.file_path)
      if (res.success) {
        toast.success('已导入到 After Effects 工程')
      } else if (res.code === 'AE_CLOSED') {
        toast('After Effects 未运行，请先打开 AE 后再导出到工程', { icon: '💡', duration: 5000 })
      } else {
        toast.error(res.message || '导入 After Effects 失败，请确认 AE 正在运行')
      }
    } catch {
      toast.error('导入 After Effects 时出错，请稍后重试')
    }
  }

  const handleExportSingle = async () => {
    const result = await window.api.selectFolder()
    if (!result || result.length === 0) return
    onClose()
    const toastId = toast.loading('正在导出…')
    const res = await window.api.copyFileTo(sound.id, result[0])
    toast.dismiss(toastId)
    if (res.success) toast.success('已导出此音效到所选文件夹')
    else toast.error(res.message || '导出失败，请检查目标文件夹是否可写')
  }

  const handleOpenTools = () => {
    useAppStore.getState().selectSound(sound.id)
    useAppStore.getState().setActiveView('tools')
    onClose()
  }

  const handleAddTag = async (tagName: string) => {
    const name = tagName.trim()
    if (!name) return
    const res = await window.api.addTagToSound(sound.id, name, 1)
    if (res.success) { toast.success(`已添加标签: ${name}`); refreshSounds() }
    else toast.error('添加标签失败，请稍后重试')
    setTagValue('')
    setTagInputVisible(false)
    onClose()
  }

  const handleAddToCollection = async (collectionId: string) => {
    const res = await window.api.addToCollection(collectionId, sound.id)
    if (res.success) { toast.success('已加入收藏夹'); await refreshSounds() }
    else toast.error('加入收藏夹失败，请稍后重试')
    setCollectionMenuVisible(false)
    onClose()
  }

  const handleCreateAndAddCollection = async () => {
    const name = newCollectionName.trim()
    if (!name) return
    try {
      const col = await window.api.createCollection(name, '')
      // Immediately add sound to the newly created collection
      await window.api.addToCollection(col.id, sound.id)
      toast.success(`已新建「${name}」并加入`)
      setNewCollectionName('')
      setCollectionMenuVisible(false)
      await refreshSounds()
      onClose()
    } catch {
      toast.error('创建收藏夹失败，请稍后重试')
    }
  }

  const menuItems = [
    { icon: FolderOpen, label: '打开文件位置', action: handleShowInFolder },
    { icon: Copy, label: '复制到...', action: handleCopyTo },
    { icon: FileInput, label: '移动到...', action: handleMoveTo },
    { icon: Pencil, label: '重命名', action: () => { setRenameSound(sound); onClose() } },
    { divider: true },
    { icon: Tag, label: '添加标签', action: () => setTagInputVisible(true), hasSubmenu: true },
    { icon: FolderPlus, label: '加入收藏夹', action: () => setCollectionMenuVisible(true), hasSubmenu: true },
    { icon: Heart, label: sound.is_starred ? '取消收藏' : '收藏', action: handleStar },
    { icon: Sparkles, label: 'AI 分析', action: handleAnalyze },
    { icon: Wrench, label: '工具（裁剪/转换/变速…）', action: handleOpenTools },
    { icon: Download, label: '导出此音效…', action: handleExportSingle },
    { icon: Film, label: '导出到 AE 工程', action: handleImportToAE },
    { divider: true },
    { icon: Trash2, label: '删除', action: handleTrash, danger: true },
  ]

  return (
    <>
    {createPortal(
      <div
        ref={menuRef}
        className="fixed z-[100] w-52 py-1.5 rounded-xl border border-surface-border bg-surface-panel shadow-2xl"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
      {menuItems.map((item, idx) => (
        item.divider ? (
          <div key={idx} className="h-px bg-surface-border/60 my-1.5 mx-2" />
        ) : (
          <button
            key={idx}
            onClick={item.action}
            className={`w-full px-3 py-2 flex items-center gap-2.5 text-sm transition-colors ${
              item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-muted-light hover:bg-surface-card'
            }`}
          >
            <item.icon size={14} className={item.danger ? 'text-red-400' : 'text-muted'} />
            <span className="flex-1 text-left">{item.label}</span>
            {item.hasSubmenu && <MoreHorizontal size={14} className="text-muted" />}
          </button>
        )
      ))}

      {tagInputVisible && (
        <div className="px-3 py-2 border-t border-surface-border/60">
          <input
            autoFocus
            value={tagValue}
            onChange={(e) => setTagValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(tagValue); if (e.key === 'Escape') setTagInputVisible(false) }}
            placeholder="输入标签回车"
            className="w-full px-2 py-1 text-xs rounded bg-surface-card border border-surface-border text-muted-light placeholder:text-muted/50 focus:border-accent outline-none"
          />
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2 max-h-20 overflow-y-auto">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => handleAddTag(tag.name)}
                  className="px-1.5 py-0.5 rounded bg-surface-panel text-[10px] text-muted hover:text-muted-light hover:bg-surface-hover"
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

    </div>,
      document.body
    )}

      {collectionMenuVisible && createPortal(
        <div
          className="fixed z-[101] w-48 rounded-xl border border-surface-border bg-surface-panel shadow-2xl py-2"
          style={{ left: flyoutLeft, top: flyoutTop }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-3 pb-1.5 text-[10px] text-muted/60 uppercase tracking-wider">新建收藏夹</p>
          <div className="flex items-center gap-1.5 px-3 pb-2 mb-1.5 border-b border-surface-border/40">
            <input
              autoFocus
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateAndAddCollection()
                if (e.key === 'Escape') setCollectionMenuVisible(false)
              }}
              placeholder="输入名称…"
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded bg-surface-card border border-surface-border text-muted-light placeholder:text-muted/40 focus:border-accent outline-none"
            />
            <button
              onClick={handleCreateAndAddCollection}
              disabled={!newCollectionName.trim()}
              className="shrink-0 px-2 py-1 rounded bg-accent text-white text-[11px] hover:bg-accent/80 disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <Check size={12} />
            </button>
          </div>

          {collections.length > 0 ? (
            <>
              <p className="px-3 pt-1 pb-1 text-[10px] text-muted/60 uppercase tracking-wider">已有收藏夹</p>
              {collections.map((col) => (
                <button
                  key={col.id}
                  onClick={() => handleAddToCollection(col.id)}
                  className="w-full px-3 py-1.5 text-xs text-muted-light hover:bg-surface-card rounded text-left flex items-center gap-2"
                >
                  <Folder size={12} className="text-muted" />
                  {col.name}
                </button>
              ))}
            </>
          ) : (
            <p className="px-3 py-2 text-xs text-muted/50">暂无收藏夹</p>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Rename Modal                                                       */
/* ------------------------------------------------------------------ */

function RenameModal({ sound, value, onChange, onClose, onConfirm }: {
  sound: SoundData
  value: string
  onChange: (v: string) => void
  onClose: () => void
  onConfirm: (newName: string) => void
}): JSX.Element {
  useEffect(() => {
    const ext = sound.file_ext
    const base = sound.file_name.endsWith(ext) ? sound.file_name.slice(0, -ext.length) : sound.file_name
    onChange(base)
  }, [sound, onChange])

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-80 p-4 rounded-xl border border-surface-border bg-surface-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-medium text-muted-light mb-3">重命名</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(value); if (e.key === 'Escape') onClose() }}
          className="w-full px-3 py-2 text-sm rounded-lg bg-surface-panel border border-surface-border text-muted-light focus:border-accent outline-none mb-4"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-muted hover:text-muted-light">取消</button>
          <button onClick={() => onConfirm(value)} className="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent/90">确定</button>
        </div>
      </div>
    </div>
  )
}
