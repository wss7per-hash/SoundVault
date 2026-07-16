import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, Play, Pause, CornerDownLeft, Pencil, GripHorizontal } from 'lucide-react'
import type { SoundData } from '../../../preload/index.d'

/**
 * 全局快捷搜索 overlay。运行在独立的无边框置顶窗口里（#spotlight hash），
 * 由主进程全局快捷键 Ctrl/Cmd+Shift+Space 呼出。
 * - 自动聚焦输入，防抖搜索（复用 sound:search，已覆盖 名称/描述/情绪/备注/标签）
 * - ↑/↓ 选择，Enter 在主窗口中定位选中，Esc 关闭
 * - 每行可内联试听（sv:// 协议）
 */
export function Spotlight(): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SoundData[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // 当前呼出快捷键（从 settings 读取）+ 录制态
  const [shortcutAcc, setShortcutAcc] = useState<string>('CommandOrControl+Shift+Space')
  const [recording, setRecording] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)

  // 呼出时聚焦 + 清空，像系统 Spotlight
  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    focus()
    const unsub = window.api.onSpotlightOpened(() => {
      setQuery('')
      setResults([])
      setActiveIdx(0)
      setRecording(false)
      setRecError(null)
      stopPreview()
      window.api.getSetting('spotlight.shortcut').then((v) => {
        if (v) setShortcutAcc(v)
      }).catch(() => {})
      setTimeout(focus, 30)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 防抖搜索
  useEffect(() => {
    const q = query.trim()
    const t = setTimeout(async () => {
      if (!q) {
        setResults([])
        setActiveIdx(0)
        return
      }
      try {
        const res = await window.api.searchSounds(q)
        setResults(res.slice(0, 50))
        setActiveIdx(0)
      } catch {
        setResults([])
      }
    }, 140)
    return () => clearTimeout(t)
  }, [query])

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlayingId(null)
  }, [])

  const togglePreview = useCallback(
    (sound: SoundData) => {
      if (playingId === sound.id) {
        stopPreview()
        return
      }
      stopPreview()
      const audio = new Audio(`sv://${sound.id}`)
      audio.onended = () => setPlayingId(null)
      audio.onerror = () => setPlayingId(null)
      audioRef.current = audio
      audio.play().then(() => setPlayingId(sound.id)).catch(() => setPlayingId(null))
    },
    [playingId, stopPreview]
  )

  const reveal = useCallback((sound: SoundData) => {
    stopPreview()
    window.api.revealSound(sound.id)
  }, [stopPreview])

  const close = useCallback(() => {
    stopPreview()
    window.api.hideSpotlight()
  }, [stopPreview])

  // 拖动浮层：用屏幕坐标增量上报主进程（透明窗口下 -webkit-app-region 不可靠）
  const onDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (recording) return
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return
      e.preventDefault()
      let prevX = e.screenX
      let prevY = e.screenY
      const move = (ev: MouseEvent): void => {
        const dx = ev.screenX - prevX
        const dy = ev.screenY - prevY
        prevX = ev.screenX
        prevY = ev.screenY
        if (dx !== 0 || dy !== 0) window.api.moveSpotlight(dx, dy)
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [recording]
  )

  // 进入录制态：等待用户按下一次组合键
  const startRec = useCallback(() => {
    setRecError(null)
    setRecording(true)
  }, [])

  // 快捷键展示格式化（CommandOrControl → 平台对应标签）
  const fmtShortcut = (acc: string): string => {
    const isMac = /mac/i.test(navigator.platform)
    return acc.split('+').map((p) => {
      if (p === 'CommandOrControl') return isMac ? 'Cmd' : 'Ctrl'
      if (p === 'Command') return 'Cmd'
      if (p === 'Control') return 'Ctrl'
      if (p === 'Shift') return 'Shift'
      if (p === 'Alt') return 'Alt'
      if (p === 'Space') return 'Space'
      return p
    }).join('+')
  }

  // 录制新快捷键：捕获一次组合键并提交到主进程
  useEffect(() => {
    if (!recording) return
    const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta']
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        setRecError(null)
        return
      }
      if (MODIFIER_KEYS.includes(e.key)) return // 等待非修饰键
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Control')
      if (e.metaKey) parts.push('Command')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      let key = e.key
      if (key === ' ') key = 'Space'
      else if (key === 'ArrowUp') key = 'Up'
      else if (key === 'ArrowDown') key = 'Down'
      else if (key === 'ArrowLeft') key = 'Left'
      else if (key === 'ArrowRight') key = 'Right'
      else if (key === 'Escape') key = 'Esc'
      else if (key.length === 1) key = key.toUpperCase()
      if (parts.length === 0) {
        setRecError('请同时按住 Ctrl / Alt / Shift 等修饰键')
        return
      }
      parts.push(key)
      const acc = parts.join('+')
      window.api
        .setSpotlightShortcut(acc)
        .then((res: { success: boolean; error?: string }) => {
          if (res.success) {
            setShortcutAcc(acc)
            setRecording(false)
            setRecError(null)
          } else {
            setRecError(res.error || '该快捷键无法使用')
          }
        })
        .catch(() => setRecError('保存快捷键失败，请稍后重试'))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  // 键盘导航
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (recording) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const s = results[activeIdx]
        if (s) reveal(s)
      } else if (e.key === ' ' && e.ctrlKey) {
        // Ctrl+Space 试听当前项
        e.preventDefault()
        const s = results[activeIdx]
        if (s) togglePreview(s)
      }
    },
    [results, activeIdx, reveal, togglePreview, close]
  )

  // 选中项滚动进视野
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const formatDuration = (ms: number | null): string => {
    if (!ms || ms <= 0) return ''
    const s = Math.round(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  return (
    <div
      className="w-screen h-screen flex items-start justify-center pt-2 select-none"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="w-full max-w-[620px] mx-3 rounded-xl overflow-hidden bg-[#1c1c1a]/98 border border-[#333330] shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={onDragMouseDown}
      >
        {/* 搜索框（抓住这一条可拖动窗口；输入框除外） */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2a28] cursor-move" onMouseDown={onDragMouseDown}>
          <GripHorizontal size={14} className="text-[#4a4a46] shrink-0" />
          <Search size={18} className="text-[#6a6a64] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索音效（名称 / 描述 / 情绪 / 备注 / 标签）..."
            className="flex-1 bg-transparent text-[15px] text-[#e8e8e4] placeholder:text-[#5a5a54] outline-none"
            data-no-drag
          />
          <kbd className="text-[10px] text-[#6a6a64] border border-[#3a3a38] rounded px-1.5 py-0.5 shrink-0">Esc</kbd>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="max-h-[340px] overflow-y-auto">
          {query.trim() && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[#5a5a54]">未找到匹配的音效</div>
          )}
          {!query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-[#5a5a54]">
              输入关键词，跨 名称 / 描述 / 情绪 / 备注 / 标签 搜索
            </div>
          )}
          {results.map((s, i) => (
            <div
              key={s.id}
              data-idx={i}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => reveal(s)}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                i === activeIdx ? 'bg-[#534AB7]/20' : 'hover:bg-[#252524]'
              }`}
            >
              <button
                onClick={(e) => { e.stopPropagation(); togglePreview(s) }}
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-[#2a2a28] text-[#b8b8b4] hover:text-white hover:bg-[#534AB7]/40 transition-colors"
                title="试听"
                data-no-drag
              >
                {playingId === s.id ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#e8e8e4] truncate">{s.file_name}</p>
                {(s.description || s.tags) && (
                  <p className="text-xs text-[#7a7a74] truncate">
                    {s.description || (s.tags ? s.tags.split(',').slice(0, 4).join(' · ') : '')}
                  </p>
                )}
              </div>
              <span className="text-[11px] text-[#6a6a64] shrink-0">{s.file_ext?.replace('.', '').toUpperCase()}</span>
              {formatDuration(s.duration_ms) && (
                <span className="text-[11px] text-[#6a6a64] shrink-0 w-9 text-right">{formatDuration(s.duration_ms)}</span>
              )}
              {i === activeIdx && (
                <CornerDownLeft size={13} className="text-[#9C92F6] shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* 常驻使用提示 + 自定义呼出快捷键（抓住这一行也可拖动窗口） */}
        <div className="px-4 py-2.5 border-t border-[#2a2a28] bg-[#161614]/70 cursor-move" onMouseDown={onDragMouseDown}>
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-[#7a7a74]">
            <span className="flex items-center gap-1"><kbd className="text-[10px] border border-[#3a3a38] rounded px-1 py-0.5">↑↓</kbd>选择</span>
            <span className="flex items-center gap-1"><kbd className="text-[10px] border border-[#3a3a38] rounded px-1 py-0.5">Enter</kbd>定位到主窗口</span>
            <span className="flex items-center gap-1"><kbd className="text-[10px] border border-[#3a3a38] rounded px-1 py-0.5">Ctrl+Space</kbd>试听</span>
            <span className="flex items-center gap-1"><kbd className="text-[10px] border border-[#3a3a38] rounded px-1 py-0.5">Esc</kbd>/点击空白处 关闭</span>
            {results.length > 0 && (
              <span className="ml-auto text-[11px] text-[#6a6a64]">
                {results.length} 个结果{results.length >= 50 ? '（仅前 50）' : ''}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-[#6a6a64]">呼出快捷键</span>
            {recording ? (
              <span className="text-[11px] text-[#9C92F6] animate-pulse">请按下新的快捷键组合…（Esc 取消）</span>
            ) : (
              <button
                onClick={startRec}
                className="flex items-center gap-1 text-[11px] text-[#b8b8b4] border border-[#3a3a38] rounded px-2 py-0.5 hover:bg-[#252524] hover:text-white transition-colors"
                title="点击后按下新的快捷键组合"
                data-no-drag
              >
                <Pencil size={11} />
                {fmtShortcut(shortcutAcc)}
              </button>
            )}
            {recError && <span className="text-[11px] text-red-400">{recError}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
