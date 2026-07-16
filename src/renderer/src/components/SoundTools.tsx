import { useCallback, useState, useRef, useEffect } from 'react'
import type { SoundData } from '../../preload/index.d'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Scissors,
  FileAudio,
  Gauge,
  Import
} from 'lucide-react'
import toast from 'react-hot-toast'

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
function formatDuration(ms: number | undefined): string {
  if (!ms) return '--'
  const sec = ms / 1000
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface SoundToolsProps {
  sound: SoundData
  onUpdate: () => void
}

/**
 * 独立的「工具」面板：对单个音频做本地 DSP 处理。
 * 自带 audio 播放器（用于裁剪试听），不依赖详情面板，可被 ToolsPanel 与 DetailPanel 复用。
 */
export function SoundTools({ sound, onUpdate }: SoundToolsProps): JSX.Element {
  // ===== Audio player (self-contained, used for crop preview) =====
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState(false)
  const [peaks, setPeaks] = useState<number[]>([])
  const [peaksLoading, setPeaksLoading] = useState(false)

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

  useEffect(() => {
    let cancelled = false
    setPeaks([])
    setPeaksLoading(true)
    window.api
      .getWaveform(sound.id)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.peaks && res.peaks.length) setPeaks(res.peaks)
        setPeaksLoading(false)
      })
      .catch(() => {
        if (!cancelled) setPeaksLoading(false)
      })
    return () => {
      cancelled = true
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

  // ===== 首尾无缝循环 =====
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
            <button onClick={() => window.api.openPath(res.outPath!)} style={{ marginLeft: 8, textDecoration: 'underline' }}>
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

  // ===== 导入 AE =====
  const [importing, setImporting] = useState(false)
  const handleImportToAE = useCallback(async () => {
    if (importing) return
    setImporting(true)
    try {
      const res = await window.api.importToAE(sound.file_path)
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
      if (cropPreviewRef.current && audio.currentTime >= audio.duration) {
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
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])
  const onCropWaveMove = useCallback(
    (e: React.PointerEvent) => {
      if (!cropDrag.current || !cropWaveRef.current || !duration) return
      const rect = cropWaveRef.current.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const sec = ratio * duration
      if (cropDrag.current === 'start') {
        setCropStart(Math.min(sec, cropEnd - 0.02))
      } else {
        setCropEnd(Math.max(sec, cropStart + 0.02))
      }
    },
    [duration, cropEnd, cropStart]
  )
  const onCropWaveUp = useCallback(() => {
    cropDrag.current = null
  }, [])
  const handleCropPreview = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audioError || !duration) return
    if (cropPreview) {
      audio.pause()
      setIsPlaying(false)
      setCropPreview(false)
      return
    }
    if (cropEnd - cropStart < 0.05) {
      toast.error('选区太短，至少需要 0.05 秒')
      return
    }
    audio.currentTime = Math.max(0, Math.min(cropStart, duration))
    audio.play().then(() => {
      setIsPlaying(true)
      setCropPreview(true)
    }).catch(() => setAudioError(true))
  }, [cropPreview, cropStart, cropEnd, duration, audioError])
  const handleCrop = useCallback(async () => {
    if (cropping) return
    if (cropEnd - cropStart < 0.05) {
      toast.error('选区太短，至少需要 0.05 秒')
      return
    }
    if (cropPreview) {
      audioRef.current?.pause()
      setCropPreview(false)
    }
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
  useEffect(() => {
    setSpeed(1.5)
  }, [sound.id])
  const handleStretch = useCallback(async () => {
    if (stretching) return
    if (Math.abs(speed - 1) < 0.001) {
      toast.error('请选择不等于 1x 的速度')
      return
    }
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

  return (
    <div className="flex flex-col gap-4">
      {/* Player (for crop preview) */}
      <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-muted truncate flex-1" title={sound.file_name}>
            {sound.file_name}
          </span>
          <span className="text-xs text-muted-light font-mono tabular-nums shrink-0">
            {formatDuration(sound.duration_ms)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={skipBack}
            className="p-1 hover:text-muted-light text-muted-light transition-colors"
            title="后退5秒"
          >
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
          <span className="text-xs text-muted font-mono tabular-nums ml-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
        <audio ref={audioRef} src={`sv://${sound.id}`} preload="metadata" />
      </div>

      {/* 首尾无缝循环 */}
      <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
            <Repeat size={13} className="text-accent" /> 首尾无缝循环
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-[10px] text-muted-light">
              交叉
              <input
                type="number"
                min={10}
                max={500}
                value={loopMs}
                onChange={(e) => setLoopMs(Math.max(10, Math.min(500, Number(e.target.value) || 30)))}
                className="w-12 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-[10px] text-muted-light text-center"
              />
              ms
            </label>
            <label className="flex items-center gap-1 text-[10px] text-muted-light">
              循环
              <input
                type="number"
                min={1}
                max={50}
                value={loopCount}
                onChange={(e) => setLoopCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="w-10 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-[10px] text-muted-light text-center"
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
        <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">
          用 ffmpeg 将尾音交叉淡入开头，生成 <code className="text-muted">原名_loop次数.wav</code>（不覆盖原文件）。
        </p>
      </div>

      {/* 裁剪截取片段 */}
      <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
            <Scissors size={13} className="text-accent" /> 裁剪截取片段
          </span>
          <button
            onClick={handleCropPreview}
            disabled={!duration}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-muted-light bg-surface-card hover:bg-surface-hover border border-surface-panel transition-colors disabled:opacity-40"
          >
            {cropPreview ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
            {cropPreview ? '停止试听' : '试听选区'}
          </button>
        </div>

        <div
          ref={cropWaveRef}
          className="relative h-14 bg-surface rounded-lg overflow-hidden mb-2 select-none touch-none"
          onPointerMove={onCropWaveMove}
          onPointerUp={onCropWaveUp}
          onPointerLeave={onCropWaveUp}
        >
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 56" preserveAspectRatio="none">
            {peaks.length > 0 ? (
              peaks.map((p, i) => {
                const h = Math.max(2, p * 50)
                const barTime = ((i + 0.5) / peaks.length) * (duration || 1)
                const inSel = barTime >= cropStart && barTime <= cropEnd
                const x = (i * 300) / peaks.length
                const w = Math.max(0.8, 300 / peaks.length - 1)
                return <rect key={i} x={x} y={28 - h / 2} width={w} height={h} rx={0.5} fill={inSel ? '#534AB7' : '#2c2c2a'} />
              })
            ) : (
              <line x1="0" y1="28" x2="300" y2="28" stroke="#2c2c2a" strokeWidth="1" />
            )}
          </svg>
          {duration > 0 && (
            <div
              className="absolute top-0 bottom-0 bg-accent/15 border-x border-accent/50 pointer-events-none"
              style={{ left: `${(cropStart / duration) * 100}%`, width: `${((cropEnd - cropStart) / duration) * 100}%` }}
            />
          )}
          {duration > 0 && (
            <>
              <div
                className="absolute top-0 bottom-0 w-1.5 -ml-0.5 bg-accent cursor-ew-resize z-10"
                style={{ left: `${(cropStart / duration) * 100}%` }}
                onPointerDown={onCropHandleDown('start')}
              />
              <div
                className="absolute top-0 bottom-0 w-1.5 -ml-0.5 bg-accent cursor-ew-resize z-10"
                style={{ left: `${(cropEnd / duration) * 100}%` }}
                onPointerDown={onCropHandleDown('end')}
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-light mb-2">
          <label className="flex items-center gap-1">
            起点
            <input
              type="number"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Number(cropStart.toFixed(2))}
              onChange={(e) => setCropStart(Math.max(0, Math.min(Number(e.target.value) || 0, cropEnd - 0.02)))}
              className="w-14 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-muted-light text-center"
            />
            s
          </label>
          <label className="flex items-center gap-1">
            终点
            <input
              type="number"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Number(cropEnd.toFixed(2))}
              onChange={(e) => setCropEnd(Math.max(Number(e.target.value) || 0, cropStart + 0.02))}
              className="w-14 bg-surface-card border border-surface-panel rounded px-1 py-0.5 text-muted-light text-center"
            />
            s
          </label>
          <span className="ml-auto font-mono tabular-nums text-muted">{(cropEnd - cropStart).toFixed(2)}s</span>
        </div>

        <button
          onClick={handleCrop}
          disabled={cropping || !duration}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50"
        >
          <Scissors size={13} />
          {cropping ? '截取中…' : '生成片段'}
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
          <button
            onClick={() => setConvFmt('wav')}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${
              convFmt === 'wav' ? 'bg-accent text-white border-accent/60' : 'bg-surface-card text-muted-light border-surface-panel hover:bg-surface-hover'
            }`}
          >
            WAV
          </button>
          <button
            onClick={() => setConvFmt('mp3')}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${
              convFmt === 'mp3' ? 'bg-accent text-white border-accent/60' : 'bg-surface-card text-muted-light border-surface-panel hover:bg-surface-hover'
            }`}
          >
            MP3
          </button>
        </div>
        {convFmt === 'mp3' && (
          <div className="flex items-center gap-2 text-[10px] text-muted-light mb-2">
            <span>码率</span>
            {[128, 192, 256, 320].map((b) => (
              <button
                key={b}
                onClick={() => setConvBitrate(b)}
                className={`px-1.5 py-0.5 rounded border transition-colors ${
                  convBitrate === b ? 'bg-accent/20 text-accent-light border-accent/40' : 'bg-surface-card text-muted border-surface-panel hover:bg-surface-hover'
                }`}
              >
                {b}
              </button>
            ))}
            <span>kbps</span>
          </div>
        )}
        <button
          onClick={handleConvert}
          disabled={converting}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50"
        >
          <FileAudio size={13} />
          {converting ? '转换中…' : `转换为 ${convFmt.toUpperCase()}`}
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
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                speed === s ? 'bg-accent text-white border-accent/60' : 'bg-surface-card text-muted-light border-surface-panel hover:bg-surface-hover'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        <button
          onClick={handleStretch}
          disabled={stretching}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50"
        >
          <Gauge size={13} />
          {stretching ? '变速中…' : `变速为 ${speed}x（不变调）`}
        </button>
        <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">
          生成 <code className="text-muted">原名_{speed}x.{sound.file_ext?.replace(/^\./, '') || 'wav'}</code> 自动入库。
        </p>
      </div>

      {/* After Effects */}
      <div className="rounded-md border border-surface-panel bg-surface px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted flex items-center gap-1.5 font-medium">
            <Import size={13} className="text-accent" /> 导入到 After Effects
          </span>
        </div>
        <button
          onClick={handleImportToAE}
          disabled={importing}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 transition-colors disabled:opacity-50"
        >
          <Import size={13} />
          {importing ? '导入中…' : '导入到正在运行的 AE 工程'}
        </button>
        <p className="text-[10px] text-muted-light mt-1.5 leading-relaxed">需先在 AE 中开启「允许脚本写入文件和访问网络」。</p>
      </div>
    </div>
  )
}

export default SoundTools
