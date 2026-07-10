import { useCallback, useState, useRef, useEffect } from 'react'
import type { SoundData, TagWithMeta, TagData } from '../../preload/index.d'
import {
  X,
  Play,
  Pause,
  Copy,
  FolderOpen,
  Star,
  RefreshCw,
  Loader2,
  Sparkles,
  Volume2,
  Plus,
  SkipBack,
  SkipForward,
  Edit3,
  Check,
  Repeat
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'

interface DetailPanelProps {
  sound: SoundData
  onClose: () => void
  onUpdate: () => void
}

export function DetailPanel({ sound, onClose, onUpdate }: DetailPanelProps): JSX.Element {
  const [tags, setTags] = useState<TagWithMeta[]>([])
  const [tagsLoaded, setTagsLoaded] = useState(false)
  const [allTags, setAllTags] = useState<TagData[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [descEditing, setDescEditing] = useState(false)
  const [descValue, setDescValue] = useState(sound.description || '')
  const [bestForEditing, setBestForEditing] = useState(false)
  const [bestForValue, setBestForValue] = useState(sound.best_for || '')

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState(false)

  const analyzingIds = useAppStore((s) => s.analyzingIds)
  const analyzeSound = useAppStore((s) => s.analyzeSound)
  const cancelAnalysis = useAppStore((s) => s.cancelAnalysis)

  // Load tags for this sound
  useEffect(() => {
    if (sound.id) {
      setTagsLoaded(false)
      window.api.getTagsForSound(sound.id).then(setTags).catch(() => {})
      window.api.getTags().then(setAllTags).catch(() => {})
      setDescValue(sound.description || '')
      setBestForValue(sound.best_for || '')
      setTagsLoaded(true)
    }
  }, [sound.id, sound.description, sound.best_for])

  // Audio element setup — reset + rewire on sound switch
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // Reset playback state when switching to a different sound, otherwise a
    // previous file's error/playing state leaks into the new one and makes
    // it look like this file "can't be played" too.
    setAudioError(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    try {
      audio.load()
    } catch {
      /* ignore */
    }

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onDurationChange = () => setDuration(audio.duration || 0)
    const onEnded = () => setIsPlaying(false)
    const onError = () => setAudioError(true)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [sound.id])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audioError) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => setAudioError(true))
    }
  }, [isPlaying, audioError])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || audioError || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    audio.currentTime = Math.max(0, Math.min(duration, ratio * duration))
  }, [duration, audioError])

  const skipBack = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, audio.currentTime - 5)
  }, [])

  const skipForward = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = Math.min(duration, audio.currentTime + 5)
  }, [duration])

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sound.file_path)
      toast.success('路径已复制')
    } catch {
      toast.error('复制失败')
    }
  }, [sound.file_path])

  const handleOpenFolder = useCallback(async () => {
    try {
      const dir = sound.file_path.substring(0, sound.file_path.lastIndexOf('\\'))
      await navigator.clipboard.writeText(dir)
      toast.success('文件夹路径已复制到剪贴板')
    } catch {
      toast.error('操作失败')
    }
  }, [sound.file_path])

  // 首尾无缝循环：调用后端 ffmpeg 交叉淡变，生成 *_loopN.wav
  const [loopMs, setLoopMs] = useState(30)
  const [loopCount, setLoopCount] = useState(1)
  const [looping, setLooping] = useState(false)
  const handleSeamlessLoop = useCallback(async () => {
    if (looping) return
    setLooping(true)
    try {
      const res = await window.api.seamlessLoop(sound.id, loopMs, loopCount)
      if (res.success && res.outPath) {
        toast.success(
          <span>
            已生成无缝循环文件（{res.loopCount}×循环，交叉 {res.crossfadeMs}ms）
            <button
              onClick={() => window.api.openPath(res.outPath!)}
              style={{ marginLeft: 8, textDecoration: 'underline' }}
            >
              打开位置
            </button>
          </span>
        )
      } else {
        toast.error(res.message || '生成失败')
      }
    } catch {
      toast.error('生成失败')
    } finally {
      setLooping(false)
    }
  }, [sound.id, loopMs, loopCount, looping])

  const handleStar = useCallback(async () => {
    try {
      await window.api.toggleStar(sound.id)
      onUpdate()
    } catch {
      toast.error('操作失败')
    }
  }, [sound.id, onUpdate])

  const handleAnalyze = useCallback(async () => {
    const ok = await analyzeSound(sound.id)
    if (ok) {
      setTagsLoaded(false)
      setDescEditing(false)
      setBestForEditing(false)
    }
  }, [sound.id, analyzeSound])

  const handleCancelAnalyze = useCallback(async () => {
    await cancelAnalysis([sound.id])
  }, [sound.id, cancelAnalysis])

  // Tag management
  const handleRemoveTag = useCallback(async (tagId: string) => {
    try {
      await window.api.removeTagFromSound(sound.id, tagId)
      setTags((prev) => prev.filter((t) => t.id !== tagId))
    } catch {
      toast.error('移除标签失败')
    }
  }, [sound.id])

  const handleAddTag = useCallback(async (tagName: string) => {
    if (!tagName.trim()) return
    try {
      await window.api.addTagToSound(sound.id, tagName.trim(), 1)
      const updated = await window.api.getTagsForSound(sound.id)
      setTags(updated)
      setNewTagInput('')
      setShowTagSuggestions(false)
    } catch {
      toast.error('添加标签失败')
    }
  }, [sound.id])

  // Save description
  const handleSaveDescription = useCallback(async () => {
    try {
      await window.api.setSetting(`desc:${sound.id}`, descValue)
      toast.success('描述已保存')
      setDescEditing(false)
      onUpdate()
    } catch {
      toast.error('保存失败')
    }
  }, [descValue, sound.id, onUpdate])

  const handleSaveBestFor = useCallback(async () => {
    try {
      await window.api.setSetting(`best_for:${sound.id}`, bestForValue)
      toast.success('详细分析已保存')
      setBestForEditing(false)
      onUpdate()
    } catch {
      toast.error('保存失败')
    }
  }, [bestForValue, sound.id, onUpdate])

  const formatTime = (sec: number): string => {
    if (!isFinite(sec) || sec <= 0) return '0:00'
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const formatDuration = (ms: number | null): string => {
    if (!ms) return '--:--'
    return formatTime(ms / 1000)
  }

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  const isCurrentAnalyzing = analyzingIds.includes(sound.id)

  // Tag suggestions filtered
  const filteredSuggestions = allTags
    .filter((t) => {
      if (!newTagInput.trim()) return false
      const already = tags.some((et) => et.id === t.id)
      return !already && t.name.toLowerCase().includes(newTagInput.toLowerCase())
    })
    .slice(0, 6)

  const progressRatio = duration > 0 ? currentTime / duration : 0

  return (
    <div className="w-80 h-full border-l border-[#2a2a28] flex flex-col shrink-0 bg-[#1e1e1c] overflow-y-auto">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={`sv://${sound.id}`}
        preload="auto"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a28]">
        <span className="text-sm font-medium text-[#b8b8b4]">音效详情</span>
        <button onClick={onClose} className="p-1 rounded-md text-[#6a6a64] hover:bg-[#252524] hover:text-[#b8b8b4] transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-5">
        {/* File name */}
        <div>
          <p className="text-base font-medium text-[#c8c8c4] truncate" title={sound.file_name}>
            {sound.file_name}
          </p>
          <p className="text-xs text-[#6a6a64] truncate mt-1" title={sound.file_path}>
            {sound.file_path}
          </p>
        </div>

        {/* ===== AI ANALYZE (prominent, top) ===== */}
        <button
          onClick={isCurrentAnalyzing ? handleCancelAnalyze : handleAnalyze}
          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            isCurrentAnalyzing
              ? 'bg-[#534AB7]/20 text-[#9C92F6] border border-[#534AB7]/30'
              : sound.ai_analyzed_at
                ? 'bg-[#1a1a18] text-[#b8b8b4] hover:bg-[#252524] border border-[#2a2a28]'
                : 'bg-accent text-white hover:bg-accent/80 border border-transparent'
          }`}
        >
          {isCurrentAnalyzing ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              分析中…（点击取消）
            </>
          ) : (
            <>
              <Sparkles size={15} />
              {sound.ai_analyzed_at ? '重新 AI 分析' : 'AI 分析'}
            </>
          )}
        </button>

        {/* ===== REAL AUDIO PLAYER ===== */}
        <div className="bg-[#1a1a18] rounded-lg border border-[#2a2a28] p-3">
          {audioError ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <Volume2 size={20} className="text-[#5a5a54]" />
              <span className="text-xs text-[#6a6a64]">无法播放此格式</span>
            </div>
          ) : (
            <>
              {/* Progress bar / waveform area */}
              <div
                className="h-16 bg-[#141412] rounded-lg cursor-pointer relative overflow-hidden mb-3"
                onClick={handleSeek}
              >
                {/* Waveform bars */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 64" preserveAspectRatio="none">
                  {Array.from({ length: 60 }, (_, i) => {
                    const h = 8 + Math.abs(Math.sin(i * 0.25) * 18) + Math.abs(Math.sin(i * 1.5) * 6) + Math.abs(Math.cos(i * 0.7) * 4)
                    const barRatio = i / 60
                    const alreadyPlayed = barRatio <= progressRatio
                    return (
                      <rect
                        key={i}
                        x={i * 5}
                        y={32 - h / 2}
                        width={3}
                        height={h}
                        rx={1.5}
                        fill={alreadyPlayed ? '#534AB7' : '#3a3a38'}
                      />
                    )
                  })}
                </svg>
                {/* Progress overlay */}
                <div
                  className="absolute bottom-0 left-0 h-0.5 bg-accent rounded transition-all duration-100"
                  style={{ width: `${progressRatio * 100}%` }}
                />
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button onClick={skipBack} className="p-1 hover:text-[#b8b8b4] text-[#6a6a64] transition-colors" title="后退5秒">
                    <SkipBack size={14} />
                  </button>
                  <button
                    onClick={togglePlay}
                    className="w-9 h-9 rounded-full bg-accent hover:bg-accent/80 flex items-center justify-center text-white transition-colors"
                  >
                    {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" className="ml-0.5" />}
                  </button>
                  <button onClick={skipForward} className="p-1 hover:text-[#b8b8b4] text-[#6a6a64] transition-colors" title="前进5秒">
                    <SkipForward size={14} />
                  </button>
                </div>
                <span className="text-xs text-[#8a8a82] font-mono tabular-nums">
                  {formatTime(currentTime)} / {formatDuration(sound.duration_ms)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ===== 首尾无缝循环（紧邻播放器） ===== */}
        <div className="rounded-md border border-[#2a2a28] bg-[#1a1a18] px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#8a8a82] flex items-center gap-1.5 font-medium">
              <Repeat size={13} className="text-accent" />
              首尾无缝循环
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[10px] text-[#6a6a64]">
                交叉
                <input
                  type="number" min={10} max={500} value={loopMs}
                  onChange={(e) => setLoopMs(Math.max(10, Math.min(500, Number(e.target.value) || 30)))}
                  className="w-12 bg-[#252524] border border-[#2a2a28] rounded px-1 py-0.5 text-[10px] text-[#b8b8b4] text-center"
                />
                ms
              </label>
              <label className="flex items-center gap-1 text-[10px] text-[#6a6a64]">
                循环
                <input
                  type="number" min={1} max={50} value={loopCount}
                  onChange={(e) => setLoopCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="w-10 bg-[#252524] border border-[#2a2a28] rounded px-1 py-0.5 text-[10px] text-[#b8b8b4] text-center"
                />
                次
              </label>
            </div>
          </div>
          <button
            onClick={handleSeamlessLoop}
            disabled={looping}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50"
          >
            <Repeat size={13} />
            {looping ? '生成中…' : '生成无缝循环文件'}
          </button>
          <p className="text-[10px] text-[#6a6a64] mt-1.5 leading-relaxed">
            用 ffmpeg 将尾音交叉淡入开头，在原文件同目录生成 <code className="text-[#8a8a82]">原名_loop次数.wav</code>（不覆盖原文件）。
          </p>
        </div>

        {/* ===== AI DESCRIPTION (editable) ===== */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-[#6a6a64] uppercase tracking-wider">AI 描述</p>
            <button
              onClick={() => { if (!descEditing) { setDescValue(sound.description || ''); setDescEditing(true) } else { setDescEditing(false) } }}
              className="p-0.5 hover:bg-[#252524] rounded text-[#6a6a64] hover:text-[#b8b8b4] transition-colors"
            >
              {descEditing ? <X size={14} /> : <Edit3 size={13} />}
            </button>
          </div>
          {descEditing ? (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={descValue}
                onChange={(e) => setDescValue(e.target.value)}
                className="w-full bg-[#141412] border border-[#2a2a28] rounded-md p-2.5 text-sm text-[#c8c8c4] placeholder:text-[#5a5a54] resize-none focus:outline-none focus:border-accent/50 min-h-[60px] leading-relaxed"
                placeholder="输入音效描述..."
                rows={3}
              />
              <button
                onClick={handleSaveDescription}
                className="self-end flex items-center gap-1 px-3 py-1.5 rounded-md text-xs bg-accent text-white hover:bg-accent/80 transition-colors"
              >
                <Check size={13} /> 保存
              </button>
            </div>
          ) : sound.description ? (
            <div>
              <p className="text-sm text-[#c8c8c4] leading-relaxed">{sound.description}</p>
              {sound.ai_model && (
                <p className="text-xs text-[#5a5a54] mt-1">分析模型: {sound.ai_model}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#5a5a54] italic">尚未分析，点击下方 AI 分析按钮</p>
          )}
        </div>

        {/* ===== BEST FOR (editable) ===== */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-[#6a6a64] uppercase tracking-wider">详细分析</p>
            <button
              onClick={() => { if (!bestForEditing) { setBestForValue(sound.best_for || ''); setBestForEditing(true) } else { setBestForEditing(false) } }}
              className="p-0.5 hover:bg-[#252524] rounded text-[#6a6a64] hover:text-[#b8b8b4] transition-colors"
            >
              {bestForEditing ? <X size={14} /> : <Edit3 size={13} />}
            </button>
          </div>
          {bestForEditing ? (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={bestForValue}
                onChange={(e) => setBestForValue(e.target.value)}
                className="w-full bg-[#141412] border border-[#2a2a28] rounded-md p-2.5 text-sm text-[#c8c8c4] placeholder:text-[#5a5a54] resize-none focus:outline-none focus:border-accent/50 min-h-[60px] leading-relaxed"
                placeholder="输入详细分析..."
                rows={3}
              />
              <button
                onClick={handleSaveBestFor}
                className="self-end flex items-center gap-1 px-3 py-1.5 rounded-md text-xs bg-accent text-white hover:bg-accent/80 transition-colors"
              >
                <Check size={13} /> 保存
              </button>
            </div>
          ) : sound.best_for ? (
            <p className="text-sm text-[#8a8a82] leading-relaxed">{sound.best_for}</p>
          ) : null}
        </div>

        {/* ===== USE CASES ===== */}
        {sound.use_cases && (
          <div>
            <p className="text-xs text-[#6a6a64] uppercase tracking-wider mb-2">适用场景</p>
            <div className="flex flex-wrap gap-1.5">
              {sound.use_cases.split(/[,;，；]/).filter(Boolean).map((uc, i) => (
                <span
                  key={i}
                  className="text-xs px-2.5 py-1 rounded-full bg-[#534AB7]/10 text-[#9C92F6] border border-[#534AB7]/20"
                >
                  {uc.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ===== EMOTION ===== */}
        {sound.emotion && (
          <div>
            <p className="text-xs text-[#6a6a64] uppercase tracking-wider mb-1.5">情绪</p>
            <p className="text-sm text-[#c8c8c4]">{sound.emotion}</p>
          </div>
        )}

        {/* ===== TAGS (EDITABLE) ===== */}
        <div>
          <p className="text-xs text-[#6a6a64] uppercase tracking-wider mb-2">标签</p>

          {/* Tag input */}
          <div className="relative mb-2">
            <div className="flex items-center gap-1 bg-[#141412] border border-[#2a2a28] rounded-md focus-within:border-accent/50 transition-colors">
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => { setNewTagInput(e.target.value); setShowTagSuggestions(true) }}
                onFocus={() => setShowTagSuggestions(true)}
                onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { handleAddTag(newTagInput) }
                  if (e.key === 'Escape') { setNewTagInput(''); setShowTagSuggestions(false) }
                }}
                placeholder="添加标签..."
                className="flex-1 bg-transparent text-sm text-[#c8c8c4] placeholder:text-[#5a5a54] outline-none px-2.5 py-1.5 min-w-0"
              />
              <button
                onClick={() => handleAddTag(newTagInput)}
                disabled={!newTagInput.trim()}
                className="px-2 py-1 mr-1 text-accent-light hover:text-white disabled:text-[#5a5a54] disabled:cursor-default transition-colors"
              >
                <Plus size={15} />
              </button>
            </div>

            {/* Autocomplete suggestions */}
            {showTagSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e1e1c] border border-[#2a2a28] rounded-md shadow-lg z-10 max-h-36 overflow-y-auto">
                {filteredSuggestions.map((t) => (
                  <button
                    key={t.id}
                    onMouseDown={() => handleAddTag(t.name)}
                    className="w-full text-left px-3 py-2 text-sm text-[#b8b8b4] hover:bg-[#252524] transition-colors first:rounded-t-md last:rounded-b-md"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tag list */}
          <div className="flex flex-wrap gap-1.5 min-h-[28px]">
            {tags.length === 0 ? (
              <span className="text-xs text-[#5a5a54] italic">暂无标签</span>
            ) : (
              tags.map((tag) => (
                <span
                  key={tag.id}
                  className="text-xs pl-2.5 pr-1 py-1 rounded-full bg-[#252524] text-[#8a8a82] border border-[#333] flex items-center gap-1 group"
                >
                  {tag.is_manual ? '✎ ' : ''}{tag.name}
                  <button
                    onClick={() => handleRemoveTag(tag.id)}
                    className="p-0.5 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    title="移除标签"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        {/* ===== QUALITY SCORE ===== */}
        {sound.quality_score !== null && sound.quality_score !== undefined && (
          <div>
            <p className="text-xs text-[#6a6a64] uppercase tracking-wider mb-1.5">质量评分</p>
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-sm ${
                    i < sound.quality_score! ? 'bg-[#534AB7]' : 'bg-[#2a2a28]'
                  }`}
                />
              ))}
              <span className="text-xs text-[#6a6a64] ml-1.5">{sound.quality_score}/5</span>
            </div>
          </div>
        )}

        {/* ===== TECHNICAL INFO ===== */}
        <div>
          <p className="text-xs text-[#6a6a64] uppercase tracking-wider mb-2">技术信息</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <InfoRow label="时长" value={formatDuration(sound.duration_ms)} />
            <InfoRow label="格式" value={sound.file_ext.toUpperCase().replace('.', '')} />
            <InfoRow label="采样率" value={sound.sample_rate ? `${sound.sample_rate / 1000}kHz` : '--'} />
            <InfoRow label="位深" value={sound.bit_depth ? `${sound.bit_depth}bit` : '--'} />
            <InfoRow label="声道" value={sound.channels ? (sound.channels === 2 ? '立体声' : sound.channels === 1 ? '单声道' : `${sound.channels}ch`) : '--'} />
            <InfoRow label="大小" value={formatSize(sound.file_size)} />
            {sound.loudness_lufs && <InfoRow label="响度" value={`${sound.loudness_lufs} LUFS`} />}
            <InfoRow label="比特率" value={sound.bitrate_kbps ? `${sound.bitrate_kbps}kbps` : '--'} />
          </div>
        </div>

        {/* ===== STATS ===== */}
        <div>
          <p className="text-xs text-[#6a6a64] uppercase tracking-wider mb-2">使用统计</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <InfoRow label="播放" value={`${sound.play_count} 次`} />
            <InfoRow label="导出" value={`${sound.export_count} 次`} />
            <InfoRow
              label="导入时间"
              value={sound.imported_at ? new Date(sound.imported_at).toLocaleDateString('zh-CN') : '--'}
            />
          </div>
        </div>

        {/* ===== ACTION BUTTONS ===== */}
        <div className="flex flex-col gap-2 pb-2">
          <button
            onClick={handleStar}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              sound.is_starred
                ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
                : 'bg-[#1a1a18] text-[#8a8a82] hover:bg-[#252524] hover:text-[#b8b8b4] border border-[#2a2a28]'
            }`}
          >
            <Star size={15} className={sound.is_starred ? 'fill-amber-400' : ''} />
            {sound.is_starred ? '已收藏' : '收藏'}
          </button>

          <button
            onClick={handleCopyPath}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm bg-[#1a1a18] text-[#8a8a82] hover:bg-[#252524] hover:text-[#b8b8b4] border border-[#2a2a28] transition-colors"
          >
            <Copy size={15} />
            复制路径
          </button>

          <button
            onClick={handleOpenFolder}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm bg-[#1a1a18] text-[#8a8a82] hover:bg-[#252524] hover:text-[#b8b8b4] border border-[#2a2a28] transition-colors"
          >
            <FolderOpen size={15} />
            打开文件位置
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-[#5a5a54] shrink-0">{label}</span>
      <span className="text-xs text-[#8a8a82] truncate">{value}</span>
    </div>
  )
}
