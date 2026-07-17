import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import type { SoundData, TagWithMeta, TagData, OnomatopoeiaItem } from '../../preload/index.d'
import {
  X,
  Play,
  Pause,
  Copy,
  FolderOpen,
  Import,
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
  Repeat,
  Scissors,
  FileAudio,
  Gauge
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'

interface DetailPanelProps {
  sound: SoundData
  onClose: () => void
  onUpdate: () => void
}

type DetailTab = 'info' | 'tools'

export function DetailPanel({ sound, onClose, onUpdate }: DetailPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<DetailTab>('info')
  const [tags, setTags] = useState<TagWithMeta[]>([])
  const [tagsLoaded, setTagsLoaded] = useState(false)
  const [allTags, setAllTags] = useState<TagData[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)

  const onoList: OnomatopoeiaItem[] = useMemo(() => {
    if (!sound.onomatopoeia) return []
    try { return JSON.parse(sound.onomatopoeia) as OnomatopoeiaItem[] } catch { return [] }
  }, [sound.onomatopoeia])
  const [descEditing, setDescEditing] = useState(false)
  const [descValue, setDescValue] = useState(sound.description || '')
  const [bestForEditing, setBestForEditing] = useState(false)
  const [bestForValue, setBestForValue] = useState(sound.best_for || '')
  const [notesValue, setNotesValue] = useState(sound.notes || '')
  const [notesEditing, setNotesEditing] = useState(false)

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState(false)
  const [peaks, setPeaks] = useState<number[]>([])
  const [peaksLoading, setPeaksLoading] = useState(false)

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
      setNotesValue(sound.notes || '')
      // 切换音效时退出编辑状态，防止新音效自动进入编辑模式
      setDescEditing(false)
      setBestForEditing(false)
      setNotesEditing(false)
      setTagsLoaded(true)
    }
  }, [sound.id, sound.description, sound.best_for, sound.notes])

  // Audio element setup — reset + rewire on sound switch
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

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

  // 加载波形峰值
  useEffect(() => {
    let cancelled = false
    setPeaks([])
    setPeaksLoading(true)
    window.api.getWaveform(sound.id)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.peaks && res.peaks.length) setPeaks(res.peaks)
        setPeaksLoading(false)
      })
      .catch(() => { if (cancelled) return; else setPeaksLoading(false) })
    return () => { cancelled = true }
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
      toast.error('复制路径失败，请稍后重试')
    }
  }, [sound.file_path])

  const handleOpenFolder = useCallback(async () => {
    try {
      const res = await window.api.showItemInFolder(sound.id)
      if (!res.success) toast.error(res.message || '打开失败')
    } catch {
      toast.error('操作未成功，请稍后重试')
    }
  }, [sound.id])

  // 首尾无缝循环
  const [loopMs, setLoopMs] = useState(30)
  const [loopCount, setLoopCount] = useState(1)
  const [looping, setLooping] = useState(false)
  const handleSeamlessLoop = useCallback(async () => {
    if (looping) return
    setLooping(true)
    try {
      const res = await window.api.seamlessLoop(sound.id, loopMs, loopCount)
      if (res.success && res.outPath) {
        onUpdate()
        toast.success(
          <span>
            已生成无缝循环文件（{res.loopCount}×循环，交叉 {res.crossfadeMs}ms）并自动导入音效库
            <button
              onClick={() => window.api.openPath(res.outPath!)}
              style={{ marginLeft: 8, textDecoration: 'underline' }}
            >
              打开位置
            </button>
          </span>,
          { duration: 5000 }
        )
      } else {
        toast.error(res.message || '生成无缝循环失败，请检查音频时长是否足够')
      }
    } catch {
      toast.error('生成无缝循环时出错，请稍后重试')
    } finally {
      setLooping(false)
    }
  }, [sound.id, loopMs, loopCount, looping, onUpdate])

  // 导入 AE
  const [importing, setImporting] = useState(false)
  const handleImportToAE = useCallback(async () => {
    if (importing) return
    setImporting(true)
    try {
      const res = await window.api.importToAE([sound.file_path])
      if (res.success) {
        toast.success(`已导入 After Effects${res.name ? '：' + res.name : ''}`)
      } else if (res.code === 'AE_CLOSED') {
        toast('After Effects 未运行，请先打开 AE 后再导出到工程', { icon: '💡', duration: 5000 })
      } else {
        toast.error(res.message || '导入 After Effects 失败，请确认 AE 正在运行')
      }
    } catch {
      toast.error('导入 After Effects 时出错，请稍后重试')
    } finally {
      setImporting(false)
    }
  }, [sound.file_path, importing])

  // ===== 裁剪截取片段 =====
  const [cropStart, setCropStart] = useState(0)
  const [cropEnd, setCropEnd] = useState(0)
  const [cropping, setCropping] = useState(false)
  const [cropPreview, setCropPreview] = useState(false)
  const cropWaveRef = useRef<HTMLDivElement | null>(null)
  const cropDrag = useRef<'start' | 'end' | null>(null)
  const cropInitialized = useRef<string>('')

  const cropEndRef = useRef(0)
  const cropPreviewRef = useRef(false)
  cropEndRef.current = cropEnd
  cropPreviewRef.current = cropPreview

  useEffect(() => {
    setCropPreview(false)
    setCropStart(0)
    setCropEnd(0)
    cropInitialized.current = ''
  }, [sound.id])

  useEffect(() => {
    if (sound.id !== cropInitialized.current && duration > 0) {
      cropInitialized.current = sound.id
      setCropStart(0)
      setCropEnd(duration)
    }
  }, [sound.id, duration])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTu = () => {
      if (cropPreviewRef.current && audio.currentTime >= cropEndRef.current) {
        audio.pause()
        setIsPlaying(false)
        setCropPreview(false)
      }
    }
    audio.addEventListener('timeupdate', onTu)
    return () => audio.removeEventListener('timeupdate', onTu)
  }, [sound.id])

  const onCropHandleDown = useCallback((which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    cropDrag.current = which
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }, [])

  const onCropWaveMove = useCallback((e: React.PointerEvent) => {
    if (!cropDrag.current || !cropWaveRef.current || !duration) return
    const rect = cropWaveRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const sec = ratio * duration
    if (cropDrag.current === 'start') {
      setCropStart(Math.min(sec, cropEnd - 0.02))
    } else {
      setCropEnd(Math.max(sec, cropStart + 0.02))
    }
  }, [duration, cropEnd, cropStart])

  const onCropWaveUp = useCallback(() => { cropDrag.current = null }, [])

  const handleCropPreview = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audioError || !duration) return
    if (cropPreview) {
      audio.pause()
      setIsPlaying(false)
      setCropPreview(false)
      return
    }
    if (cropEnd - cropStart < 0.05) { toast.error('选区太短，至少需要 0.05 秒'); return }
    audio.currentTime = Math.max(0, Math.min(cropStart, duration))
    audio.play().then(() => {
      setIsPlaying(true)
      setCropPreview(true)
    }).catch(() => setAudioError(true))
  }, [cropPreview, cropStart, cropEnd, duration, audioError])

  const handleCrop = useCallback(async () => {
    if (cropping) return
    if (cropEnd - cropStart < 0.05) { toast.error('选区太短，至少需要 0.05 秒'); return }
    if (cropPreview) { audioRef.current?.pause(); setCropPreview(false) }
    setCropping(true)
    try {
      const res = await window.api.trimSound(sound.id, cropStart, cropEnd)
      if (res.success && res.outPath) {
        onUpdate()
        toast.success(
          <span>
            已截取片段（{res.startSec?.toFixed(2)}–{res.endSec?.toFixed(2)}s）并自动导入音效库
            <button onClick={() => window.api.openPath(res.outPath!)} style={{ marginLeft: 8, textDecoration: 'underline' }}>
              打开位置
            </button>
          </span>,
          { duration: 5000 }
        )
      } else {
        toast.error(res.message || '截取失败，请确认选区有效且文件未被占用')
      }
    } catch {
      toast.error('截取操作出错，请稍后重试')
    } finally {
      setCropping(false)
    }
  }, [sound.id, cropStart, cropEnd, cropping, cropPreview, onUpdate])

  // ===== 格式转换 =====
  const [convFmt, setConvFmt] = useState<'wav' | 'mp3'>('mp3')
  const [convBitrate, setConvBitrate] = useState(192)
  const [converting, setConverting] = useState(false)
  useEffect(() => {
    const cur = (sound.file_ext || '').replace(/^\./, '').toLowerCase()
    setConvFmt(cur === 'wav' ? 'mp3' : 'wav')
  }, [sound.id, sound.file_ext])

  const handleConvert = useCallback(async () => {
    if (converting) return
    setConverting(true)
    try {
      const res = await window.api.convertSound(sound.id, convFmt, convBitrate)
      if (res.success && res.outPath) {
        onUpdate()
        toast.success(
          <span>
            已转换为 {convFmt.toUpperCase()} 并自动导入音效库
            <button onClick={() => window.api.openPath(res.outPath!)} style={{ marginLeft: 8, textDecoration: 'underline' }}>
              打开位置
            </button>
          </span>,
          { duration: 5000 }
        )
      } else {
        toast.error(res.message || '格式转换失败，请检查磁盘空间')
      }
    } catch {
      toast.error('格式转换时出错，请稍后重试')
    } finally {
      setConverting(false)
    }
  }, [sound.id, convFmt, convBitrate, converting, onUpdate])

  // ===== 变速不变调 =====
  const SPEED_PRESETS = [0.5, 0.75, 1.25, 1.5, 2] as const
  const [speed, setSpeed] = useState<number>(1.5)
  const [stretching, setStretching] = useState(false)
  useEffect(() => { setSpeed(1.5) }, [sound.id])

  const handleStretch = useCallback(async () => {
    if (stretching) return
    if (Math.abs(speed - 1) < 0.001) { toast.error('请选择不等于 1x 的速度'); return }
    setStretching(true)
    try {
      const res = await window.api.stretchSound(sound.id, speed)
      if (res.success && res.outPath) {
        onUpdate()
        toast.success(
          <span>
            已变速为 {res.speed}x（不变调）并自动导入音效库
            <button onClick={() => window.api.openPath(res.outPath!)} style={{ marginLeft: 8, textDecoration: 'underline' }}>
              打开位置
            </button>
          </span>,
          { duration: 5000 }
        )
      } else {
        toast.error(res.message || '变速处理失败，请确认速度值在 0.25x–4x 之间')
      }
    } catch {
      toast.error('变速处理时出错，请稍后重试')
    } finally {
      setStretching(false)
    }
  }, [sound.id, speed, stretching, onUpdate])

  const handleStar = useCallback(async () => {
    try {
      await window.api.toggleStar(sound.id)
      onUpdate()
    } catch {
      toast.error('操作未成功，请稍后重试')
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
      toast.error('移除标签失败，请稍后重试')
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
      toast.error('添加标签失败，请稍后重试')
    }
  }, [sound.id])

  const handleSaveDescription = useCallback(async () => {
    try {
      await window.api.setDescription(sound.id, descValue)
      toast.success('描述已保存')
      setDescEditing(false)
      onUpdate()
    } catch {
      toast.error('保存失败，请检查磁盘空间或文件权限')
    }
  }, [descValue, sound.id, onUpdate])

  const handleSaveBestFor = useCallback(async () => {
    try {
      await window.api.setBestFor(sound.id, bestForValue)
      toast.success('详细分析已保存')
      setBestForEditing(false)
      onUpdate()
    } catch {
      toast.error('保存失败，请检查磁盘空间或文件权限')
    }
  }, [bestForValue, sound.id, onUpdate])

  const handleSaveNotes = useCallback(async () => {
    try {
      await window.api.setNotes(sound.id, notesValue)
      toast.success('备注已保存')
      setNotesEditing(false)
      onUpdate()
    } catch {
      toast.error('保存失败，请检查磁盘空间或文件权限')
    }
  }, [notesValue, sound.id, onUpdate])

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

  const filteredSuggestions = allTags
    .filter((t) => {
      if (!newTagInput.trim()) return false
      const already = tags.some((et) => et.id === t.id)
      return !already && t.name.toLowerCase().includes(newTagInput.toLowerCase())
    })
    .slice(0, 6)

  const progressRatio = duration > 0 ? currentTime / duration : 0

  // ===== Tab 配置 =====
  const tabs: { key: DetailTab; label: string; icon: JSX.Element }[] = [
    { key: 'info', label: '信息', icon: <Edit3 size={13} /> },
    { key: 'tools', label: '工具', icon: <Gauge size={13} /> },
  ]

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <div className="w-80 h-full border-l border-surface-border flex flex-col shrink-0 bg-surface">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={`sv://${sound.id}`} preload="auto" />

      {/* ════════════════ FIXED TOP AREA (never scrolls) ════════════════ */}
      <div className="shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-panel">
          <span className="text-sm font-medium text-muted-light">音效详情</span>
          <button onClick={onClose} className="p-1 rounded-md text-muted-light hover:bg-surface-card hover:text-muted-light transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 flex flex-col gap-3">
          {/* File name + star row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-medium text-fg-muted truncate" title={sound.file_name}>
                {sound.file_name}
              </p>
              <p className="text-xs text-muted-light truncate mt-0.5" title={sound.file_path}>
                {sound.file_path}
              </p>
            </div>
            <button
              onClick={handleStar}
              className={`p-1.5 rounded-md shrink-0 transition-colors ${
                sound.is_starred
                  ? 'text-amber-400 hover:bg-amber-400/10'
                  : 'text-muted-light hover:bg-surface-card hover:text-amber-400'
              }`}
              title={sound.is_starred ? '取消收藏' : '收藏'}
            >
              <Star size={15} className={sound.is_starred ? 'fill-amber-400' : ''} />
            </button>
          </div>

          {/* AI Analyze button */}
          <button
            onClick={isCurrentAnalyzing ? handleCancelAnalyze : handleAnalyze}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isCurrentAnalyzing
                ? 'bg-accent/20 text-accent-light border border-accent/30'
                : sound.ai_analyzed_at
                  ? 'bg-surface text-muted-light hover:bg-surface-card border border-surface-panel'
                  : 'bg-accent text-white hover:bg-accent/80 border border-transparent'
            }`}
          >
            {isCurrentAnalyzing ? (
              <><Loader2 size={15} className="animate-spin" /> 分析中…（点击取消）</>
            ) : (
              <><Sparkles size={15} /> {sound.ai_analyzed_at ? '重新 AI 分析' : 'AI 分析'}</>
            )}
          </button>

          {/* Waveform Player — always visible */}
          <div className="bg-surface rounded-lg border border-surface-panel p-3">
            {audioError ? (
              <div className="flex flex-col items-center gap-2 py-3">
                <Volume2 size={20} className="text-muted-light" />
                <span className="text-xs text-muted-light">无法播放此格式</span>
              </div>
            ) : (
              <>
                <div
                  className="h-14 bg-surface rounded-lg cursor-pointer relative overflow-hidden mb-2.5"
                  onClick={handleSeek}
                >
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 56" preserveAspectRatio="none">
                    {peaks.length > 0 ? (
                      peaks.map((p, i) => {
                        const h = Math.max(2, p * 50)
                        const barRatio = (i + 0.5) / peaks.length
                        const alreadyPlayed = barRatio <= progressRatio
                        const x = (i * 300) / peaks.length
                        const w = Math.max(0.8, 300 / peaks.length - 1)
                        return (
                          <rect key={i} x={x} y={28 - h / 2} width={w} height={h} rx={0.5}
                            fill={alreadyPlayed ? '#534AB7' : '#3a3a38'} />
                        )
                      })
                    ) : (
                      <line x1="0" y1="28" x2="300" y2="28" stroke="#3a3a38" strokeWidth="1" />
                    )}
                  </svg>
                  <div
                    className="absolute bottom-0 left-0 h-0.5 bg-accent rounded transition-all duration-100"
                    style={{ width: `${progressRatio * 100}%` }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button onClick={skipBack} className="p-1 hover:text-muted-light text-muted-light transition-colors" title="后退5秒">
                      <SkipBack size={14} />
                    </button>
                    <button
                      onClick={togglePlay}
                      className="w-8 h-8 rounded-full bg-accent hover:bg-accent/80 flex items-center justify-center text-white transition-colors"
                    >
                      {isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" className="ml-0.5" />}
                    </button>
                    <button onClick={skipForward} className="p-1 hover:text-muted-light text-muted-light transition-colors" title="前进5秒">
                      <SkipForward size={14} />
                    </button>
                  </div>
                  <span className="text-xs text-muted font-mono tabular-nums">
                    {formatTime(currentTime)} / {formatDuration(sound.duration_ms)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ===== Tab Bar ===== */}
        <div className="flex border-b border-surface-panel px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-accent text-fg-muted'
                  : 'border-transparent text-muted-light hover:text-muted hover:border-surface-border'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════ SCROLLABLE TAB CONTENT ════════════════ */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* ──── INFO TAB ──── */}
        {activeTab === 'info' && (
          <>
            {/* AI Description */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-muted-light uppercase tracking-wider">AI 描述</p>
                <button
                  onClick={() => { if (!descEditing) { setDescValue(sound.description || ''); setDescEditing(true) } else { setDescEditing(false) } }}
                  className="p-0.5 hover:bg-surface-card rounded text-muted-light hover:text-muted-light transition-colors"
                >
                  {descEditing ? <X size={14} /> : <Edit3 size={13} />}
                </button>
              </div>
              {descEditing ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    value={descValue}
                    onChange={(e) => setDescValue(e.target.value)}
                    className="w-full bg-surface border border-surface-panel rounded-md p-2 text-sm text-fg-muted placeholder:text-muted-light resize-none focus:outline-none focus:border-accent/50 min-h-[56px] leading-relaxed"
                    placeholder="输入音效描述..." rows={3}
                  />
                  <button onClick={handleSaveDescription} className="self-end flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-accent text-white hover:bg-accent/80 transition-colors">
                    <Check size={13} /> 保存
                  </button>
                </div>
              ) : sound.description ? (
                <div>
                  <p className="text-sm text-fg-muted leading-relaxed">{sound.description}</p>
                  {sound.ai_model && <p className="text-xs text-muted-light mt-1">分析模型: {sound.ai_model}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-light italic">尚未分析，点击上方 AI 分析按钮</p>
              )}
            </div>

            {/* Best For */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-muted-light uppercase tracking-wider">详细分析</p>
                <button
                  onClick={() => { if (!bestForEditing) { setBestForValue(sound.best_for || ''); setBestForEditing(true) } else { setBestForEditing(false) } }}
                  className="p-0.5 hover:bg-surface-card rounded text-muted-light hover:text-muted-light transition-colors"
                >
                  {bestForEditing ? <X size={14} /> : <Edit3 size={13} />}
                </button>
              </div>
              {bestForEditing && (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    value={bestForValue}
                    onChange={(e) => setBestForValue(e.target.value)}
                    className="w-full bg-surface border border-surface-panel rounded-md p-2 text-sm text-fg-muted placeholder:text-muted-light resize-none focus:outline-none focus:border-accent/50 min-h-[56px] leading-relaxed"
                    placeholder="输入详细分析..." rows={3}
                  />
                  <button onClick={handleSaveBestFor} className="self-end flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-accent text-white hover:bg-accent/80 transition-colors">
                    <Check size={13} /> 保存
                  </button>
                </div>
              )}
              {!bestForEditing && sound.best_for && (
                <p className="text-sm text-muted leading-relaxed">{sound.best_for}</p>
              )}
            </div>

            {/* Use Cases */}
            {sound.use_cases && (
              <div>
                <p className="text-xs text-muted-light uppercase tracking-wider mb-1.5">适用场景</p>
                <div className="flex flex-wrap gap-1.5">
                  {sound.use_cases.split(/[,;，；]/).filter(Boolean).map((uc, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent-light border border-accent/20">
                      {uc.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Emotion */}
            {sound.emotion && (
              <div>
                <p className="text-xs text-muted-light uppercase tracking-wider mb-1">情绪</p>
                <p className="text-sm text-fg-muted">{sound.emotion}</p>
              </div>
            )}

            {/* Notes */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-muted-light uppercase tracking-wider">备注 / 笔记</p>
                <button
                  onClick={() => { if (!notesEditing) { setNotesValue(sound.notes || ''); setNotesEditing(true) } else { setNotesEditing(false) } }}
                  className="p-0.5 hover:bg-surface-card rounded text-muted-light hover:text-muted-light transition-colors"
                >
                  {notesEditing ? <X size={14} /> : <Edit3 size={13} />}
                </button>
              </div>
              {notesEditing ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    className="w-full bg-surface border border-surface-panel rounded-md p-2 text-sm text-fg-muted placeholder:text-muted-light resize-none focus:outline-none focus:border-accent/50 min-h-[56px] leading-relaxed"
                    placeholder="记录使用心得、来源、版权信息..." rows={3}
                  />
                  <button onClick={handleSaveNotes} className="self-end flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-accent text-white hover:bg-accent/80 transition-colors">
                    <Check size={13} /> 保存
                  </button>
                </div>
              ) : sound.notes ? (
                <p className="text-sm text-fg-muted leading-relaxed whitespace-pre-wrap">{sound.notes}</p>
              ) : (
                <p className="text-sm text-muted-light italic">暂无备注，点击编辑</p>
              )}
            </div>

            {/* Onomatopoeia (多语种 + 拼音) */}
            <div>
              <p className="text-xs text-muted-light uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Volume2 size={13} className="text-accent-light" /> 拟声词
              </p>
              {onoList.length === 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-light italic">暂无拟声词</span>
                  <button
                    onClick={() => analyzeSound(sound.id)}
                    className="text-xs text-accent-light hover:text-white transition-colors underline underline-offset-2"
                  >AI 分析生成</button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {onoList.map((o, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg bg-surface-panel border border-surface-panel flex flex-col gap-0.5 min-w-[120px]">
                      <div className="text-base text-fg font-medium leading-none">{o.zh}</div>
                      {o.pinyin && <div className="text-xs text-muted">{o.pinyin}</div>}
                      <div className="flex gap-3 text-xs text-muted-light mt-0.5">
                        {o.ja && <span>日 {o.ja}</span>}
                        {o.en && <span>英 {o.en}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tags */}
            <div>
              <p className="text-xs text-muted-light uppercase tracking-wider mb-1.5">标签</p>
              <div className="relative mb-2">
                <div className="flex items-center gap-1 bg-surface border border-surface-panel rounded-md focus-within:border-accent/50 transition-colors">
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
                    className="flex-1 bg-transparent text-sm text-fg-muted placeholder:text-muted-light outline-none px-2.5 py-1.5 min-w-0"
                  />
                  <button
                    onClick={() => handleAddTag(newTagInput)}
                    disabled={!newTagInput.trim()}
                    className="px-2 py-1 mr-1 text-accent-light hover:text-white disabled:text-muted-light disabled:cursor-default transition-colors"
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {showTagSuggestions && filteredSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surface-panel border border-surface-panel rounded-md shadow-lg z-10 max-h-36 overflow-y-auto">
                    {filteredSuggestions.map((t) => (
                      <button
                        key={t.id}
                        onMouseDown={() => handleAddTag(t.name)}
                        className="w-full text-left px-3 py-2 text-sm text-muted-light hover:bg-surface-card transition-colors first:rounded-t-md last:rounded-b-md"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                {tags.length === 0 ? (
                  <span className="text-xs text-muted-light italic">暂无标签</span>
                ) : (
                  tags.map((tag) => (
                    <span key={tag.id} className="text-xs pl-2.5 pr-1 py-1 rounded-full bg-surface-card text-muted border border-surface-border flex items-center gap-1 group">
                      {tag.is_manual ? '✎ ' : ''}{tag.name}
                      <button onClick={() => handleRemoveTag(tag.id)} className="p-0.5 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-colors" title="移除标签">
                        <X size={10} />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Quality Score */}
            {sound.quality_score !== null && sound.quality_score !== undefined && (
              <div>
                <p className="text-xs text-muted-light uppercase tracking-wider mb-1.5">质量评分</p>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} size={14} className={i < sound.quality_score! ? 'text-amber-400 fill-amber-400' : 'text-muted/30'} />
                  ))}
                </div>
              </div>
            )}

            {/* Technical Info */}
            <div>
              <p className="text-xs text-muted-light uppercase tracking-wider mb-1.5">技术信息</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
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

            {/* Stats */}
            <div>
              <p className="text-xs text-muted-light uppercase tracking-wider mb-1.5">使用统计</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <InfoRow label="播放" value={`${sound.play_count} 次`} />
                <InfoRow label="导出" value={`${sound.export_count} 次`} />
                <InfoRow label="导入时间" value={sound.imported_at ? new Date(sound.imported_at).toLocaleDateString('zh-CN') : '--'} />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-1.5 pb-1">
              <button onClick={handleCopyPath} className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm bg-surface text-muted hover:bg-surface-card hover:text-muted-light border border-surface-panel transition-colors">
                <Copy size={15} /> 复制路径
              </button>
              <button onClick={handleOpenFolder} className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm bg-surface text-muted hover:bg-surface-card hover:text-muted-light border border-surface-panel transition-colors">
                <FolderOpen size={15} /> 打开文件位置
              </button>
            </div>
          </>
        )}

        {/* ──── TOOLS TAB ──── */}
        {activeTab === 'tools' && (
          <>
            {/* 首尾无缝循环 */}
            <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
                  <Repeat size={13} className="text-accent" /> 首尾无缝循环
                </span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-[10px] text-muted-light">
                    交叉<input type="number" min={10} max={500} value={loopMs} onChange={(e) => setLoopMs(Math.max(10, Math.min(500, Number(e.target.value) || 30)))} className="w-12 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-[10px] text-muted-light text-center" />ms
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-muted-light">
                    循环<input type="number" min={1} max={50} value={loopCount} onChange={(e) => setLoopCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="w-10 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-[10px] text-muted-light text-center" />次
                  </label>
                </div>
              </div>
              <button onClick={handleSeamlessLoop} disabled={looping} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50">
                <Repeat size={13} />{looping ? '生成中…' : '生成无缝循环文件'}
              </button>
              <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">用 ffmpeg 将尾音交叉淡入开头，生成 <code className="text-muted">原名_loop次数.wav</code>（不覆盖原文件）。</p>
            </div>

            {/* 裁剪截取片段 */}
            <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
                  <Scissors size={13} className="text-accent" /> 裁剪截取片段
                </span>
                <button onClick={handleCropPreview} disabled={!duration} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-muted-light bg-surface-card hover:bg-surface-hover border border-surface-panel transition-colors disabled:opacity-40">
                  {cropPreview ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}{cropPreview ? '停止试听' : '试听选区'}
                </button>
              </div>

              <div ref={cropWaveRef} className="relative h-14 bg-surface rounded-lg overflow-hidden mb-2 select-none touch-none" onPointerMove={onCropWaveMove} onPointerUp={onCropWaveUp} onPointerLeave={onCropWaveUp}>
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 56" preserveAspectRatio="none">
                  {peaks.length > 0 ? peaks.map((p, i) => {
                    const h = Math.max(2, p * 50)
                    const barTime = ((i + 0.5) / peaks.length) * (duration || 1)
                    const inSel = barTime >= cropStart && barTime <= cropEnd
                    const x = (i * 300) / peaks.length
                    const w = Math.max(0.8, 300 / peaks.length - 1)
                    return <rect key={i} x={x} y={28 - h / 2} width={w} height={h} rx={0.5} fill={inSel ? '#534AB7' : '#2c2c2a'} />
                  }) : <line x1="0" y1="28" x2="300" y2="28" stroke="#2c2c2a" strokeWidth="1" />}
                </svg>
                {duration > 0 && (
                  <div className="absolute top-0 bottom-0 bg-accent/15 border-x border-accent/50 pointer-events-none" style={{ left: `${(cropStart / duration) * 100}%`, width: `${((cropEnd - cropStart) / duration) * 100}%` }} />
                )}
                {duration > 0 && (
                  <>
                    <div className="absolute top-0 bottom-0 w-1.5 -ml-0.5 bg-accent cursor-ew-resize z-10" style={{ left: `${(cropStart / duration) * 100}%` }} onPointerDown={onCropHandleDown('start')} />
                    <div className="absolute top-0 bottom-0 w-1.5 -ml-0.5 bg-accent cursor-ew-resize z-10" style={{ left: `${(cropEnd / duration) * 100}%` }} onPointerDown={onCropHandleDown('end')} />
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10px] text-muted-light mb-2">
                <label className="flex items-center gap-1">起点<input type="number" min={0} max={duration || 0} step={0.1} value={Number(cropStart.toFixed(2))} onChange={(e) => setCropStart(Math.max(0, Math.min(Number(e.target.value) || 0, cropEnd - 0.02)))} className="w-14 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-muted-light text-center" />s</label>
                <label className="flex items-center gap-1">终点<input type="number" min={0} max={duration || 0} step={0.1} value={Number(cropEnd.toFixed(2))} onChange={(e) => setCropEnd(Math.max(Number(e.target.value) || 0, cropStart + 0.02))} className="w-14 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-muted-light text-center" />s</label>
                <span className="ml-auto font-mono tabular-nums text-muted">{(cropEnd - cropStart).toFixed(2)}s</span>
              </div>

              <button onClick={handleCrop} disabled={cropping || !duration} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50">
                <Scissors size={13} />{cropping ? '截取中…' : '生成片段'}
              </button>
              <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">拖动把手选取区间；生成 <code className="text-muted">原名_clip_起-止.wav</code> 自动入库。</p>
            </div>

            {/* 格式转换 WAV↔MP3 */}
            <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
                  <FileAudio size={13} className="text-accent" /> 格式转换 WAV↔MP3
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setConvFmt('wav')} className={`flex-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${convFmt === 'wav' ? 'bg-accent text-white border-accent/60' : 'bg-surface-card text-muted-light border-surface-panel hover:bg-surface-hover'}`}>WAV</button>
                <button onClick={() => setConvFmt('mp3')} className={`flex-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${convFmt === 'mp3' ? 'bg-accent text-white border-accent/60' : 'bg-surface-card text-muted-light border-surface-panel hover:bg-surface-hover'}`}>MP3</button>
              </div>
              {convFmt === 'mp3' && (
                <div className="flex items-center gap-2 text-[10px] text-muted-light mb-2">
                  <span>码率</span>
                  {[128, 192, 256, 320].map((b) => (
                    <button key={b} onClick={() => setConvBitrate(b)} className={`px-1.5 py-0.5 rounded border transition-colors ${convBitrate === b ? 'bg-accent/20 text-accent-light border-accent/40' : 'bg-surface-card text-muted border-surface-panel hover:bg-surface-hover'}`}>{b}</button>
                  ))}<span>kbps</span>
                </div>
              )}
              <button onClick={handleConvert} disabled={converting} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50">
                <FileAudio size={13} />{converting ? '转换中…' : `转换为 ${convFmt.toUpperCase()}`}
              </button>
              <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">生成 <code className="text-muted">原名_conv.{convFmt}</code> 自动入库。</p>
            </div>

            {/* 变速不变调 */}
            <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
                  <Gauge size={13} className="text-accent" /> 变速不变调
                </span>
                <span className="text-[10px] text-muted-light">改变速度 · 保持音高</span>
              </div>
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                {SPEED_PRESETS.map((s) => (
                  <button key={s} onClick={() => setSpeed(s)} className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${speed === s ? 'bg-accent text-white border-accent/60' : 'bg-surface-card text-muted-light border-surface-panel hover:bg-surface-hover'}`}>{s}x</button>
                ))}
              </div>
              <button onClick={handleStretch} disabled={stretching} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50">
                <Gauge size={13} />{stretching ? '变速中…' : `变速为 ${speed}x（不变调）`}
              </button>
              <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">生成 <code className="text-muted">原名_{speed}x.{sound.file_ext?.replace(/^\./, '') || 'wav'}</code> 自动入库。</p>
            </div>

            {/* After Effects */}
            <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
                  <Import size={13} className="text-accent" /> 导入到 After Effects
                </span>
              </div>
              <button onClick={handleImportToAE} disabled={importing} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50">
                <Import size={13} />{importing ? '导入中…' : '导入到正在运行的 AE 工程'}
              </button>
              <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">需先在 AE 中开启「允许脚本写入文件和访问网络」。</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-muted-light shrink-0">{label}</span>
      <span className="text-xs text-muted truncate">{value}</span>
    </div>
  )
}
