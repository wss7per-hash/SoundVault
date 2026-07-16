import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { X, FolderOpen, Search, Filter, ChevronDown, ChevronRight, AudioWaveform, HardDrive, Sparkles, Monitor, FileText, Download, Music, Film, ArrowLeft, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'
import type { ScanResult, ImportFile } from '../../preload/index.d'

interface ScanDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function ScanDialog({ isOpen, onClose }: ScanDialogProps) {
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const refreshStats = useAppStore((s) => s.refreshStats)

  // Step: 'config' | 'scanning' | 'preview' | 'importing' | 'done'
  const [step, setStep] = useState<'config' | 'scanning' | 'preview' | 'importing' | 'done'>('config')

  // Config state
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [recursive, setRecursive] = useState(true)
  const [skipHidden, setSkipHidden] = useState(true)
  const [includeVideo, setIncludeVideo] = useState(false)
  const [filenameIncludes, setFilenameIncludes] = useState('')
  const [filenameExcludes, setFilenameExcludes] = useState('')
  const [minSizeKB, setMinSizeKB] = useState(0)        // 最小端 0，不漏小文件
  const [maxSizeKB, setMaxSizeKB] = useState(51200)     // 默认最大 50MB
  const [minDurationSec, setMinDurationSec] = useState(0) // 最短 0，不漏短音效
  const [maxDurationSec, setMaxDurationSec] = useState(60) // 默认最长 60s
  const [autoTagFolder, setAutoTagFolder] = useState(true)
  const [autoAnalyze, setAutoAnalyze] = useState(false)

  // Result state
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set())
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [showAdvanced, setShowAdvanced] = useState(false)

  // 扩展名过滤
  const [extFilters, setExtFilters] = useState<Set<string>>(new Set())

  // 预览页客户端二次过滤（0 = 不限制）
  const [filterMinSizeKB, setFilterMinSizeKB] = useState(0)
  const [filterMaxSizeKB, setFilterMaxSizeKB] = useState(0)
  const [filterMinDurSec, setFilterMinDurSec] = useState(0)
  const [filterMaxDurSec, setFilterMaxDurSec] = useState(0)
  const AUDIO_EXTS = [
    { ext: '.wav', label: 'WAV' },
    { ext: '.mp3', label: 'MP3' },
    { ext: '.ogg', label: 'OGG' },
    { ext: '.flac', label: 'FLAC' },
    { ext: '.aac', label: 'AAC' },
    { ext: '.m4a', label: 'M4A' },
    { ext: '.wma', label: 'WMA' },
  ]

  // 常用目录快捷扫描
  const [commonPaths, setCommonPaths] = useState<Record<string, string> | null>(null)
  const [quickScanningDir, setQuickScanningDir] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      window.api.getCommonPaths().then(setCommonPaths).catch(() => {})
    }
  }, [isOpen])

  const handleSelectFolder = async () => {
    const paths = await window.api.selectFolder()
    if (paths.length > 0) {
      setSelectedPaths(paths)
    }
  }

  // 快捷扫描：选中常用目录并自动开始扫描
  const handleQuickScan = useCallback(async (dirKey: string, dirPath: string) => {
    setSelectedPaths([dirPath])
    setQuickScanningDir(dirKey)
    setStep('scanning')

    try {
      const result = await window.api.scanFolder({
        targetPath: dirPath,
        recursive,
        filenameIncludes: filenameIncludes.split(',').map((s) => s.trim()).filter(Boolean),
        filenameExcludes: filenameExcludes.split(',').map((s) => s.trim()).filter(Boolean),
        minSizeKB: minSizeKB || 0,
        maxSizeKB: maxSizeKB || 0,
        minDurationSec: minDurationSec || 0,
        maxDurationSec: maxDurationSec || 0,
        skipHidden,
        includeVideo,
        extFilters: extFilters.size > 0 ? Array.from(extFilters) : undefined,
      })

      setScanResult(result)
      setSelectedFiles(new Set(result.files.map((_, i) => i)))
      setStep('preview')
    } catch (err) {
      toast.error('扫描文件夹时出错，请确认文件夹可访问后重试')
      setStep('config')
    } finally {
      setQuickScanningDir(null)
    }
  }, [recursive, filenameIncludes, filenameExcludes, minSizeKB, maxSizeKB, minDurationSec, maxDurationSec, skipHidden, includeVideo, extFilters])

  const toggleExtFilter = (ext: string) => {
    setExtFilters((prev) => {
      const next = new Set(prev)
      if (next.has(ext)) next.delete(ext)
      else next.add(ext)
      return next
    })
  }

  const handleScan = async () => {
    if (selectedPaths.length === 0) {
      toast.error('请先选择文件夹')
      return
    }

    setStep('scanning')

    try {
      let allResults: ScanResult = {
        total: 0,
        newFiles: 0,
        skipped: 0,
        totalSize: 0,
        byFormat: {},
        files: []
      }

      for (const path of selectedPaths) {
        const result = await window.api.scanFolder({
          targetPath: path,
          recursive,
          filenameIncludes: filenameIncludes.split(',').map((s) => s.trim()).filter(Boolean),
          filenameExcludes: filenameExcludes.split(',').map((s) => s.trim()).filter(Boolean),
          minSizeKB: minSizeKB || 0,
          maxSizeKB: maxSizeKB || 0,
          minDurationSec: minDurationSec || 0,
          maxDurationSec: maxDurationSec || 0,
          skipHidden,
          includeVideo,
          extFilters: extFilters.size > 0 ? Array.from(extFilters) : undefined,
        })

        allResults.total += result.total
        allResults.newFiles += result.newFiles
        allResults.skipped += result.skipped
        allResults.totalSize += result.totalSize
        for (const [fmt, count] of Object.entries(result.byFormat)) {
          allResults.byFormat[fmt] = (allResults.byFormat[fmt] || 0) + count
        }
        allResults.files.push(...result.files)
      }

      setScanResult(allResults)

      // Auto-select all new files
      setSelectedFiles(new Set(allResults.files.map((_, i) => i)))
      setStep('preview')
    } catch (err) {
      toast.error('扫描文件夹时出错，请确认文件夹可访问后重试')
      setStep('config')
    }
  }

  const toggleFile = (index: number) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const selectAll = () => {
    if (!scanResult) return
    setSelectedFiles(new Set(scanResult.files.map((_, i) => i)))
  }

  const deselectAll = () => {
    setSelectedFiles(new Set())
  }

  const handleImport = async () => {
    if (!scanResult) return
    const filesToImport = scanResult.files.filter((_, i) => selectedFiles.has(i))
    if (filesToImport.length === 0) {
      toast.error('请选择要导入的文件')
      return
    }

    setStep('importing')
    setImportProgress({ current: 0, total: filesToImport.length })

    // Import in batches of 50
    const batchSize = 50
    try {
      for (let i = 0; i < filesToImport.length; i += batchSize) {
        const batch = filesToImport.slice(i, i + batchSize)
        await window.api.importSounds(batch)
        setImportProgress({ current: Math.min(i + batchSize, filesToImport.length), total: filesToImport.length })
      }

      await Promise.all([refreshSounds(), refreshStats()])
      setStep('done')
      toast.success(`成功导入 ${filesToImport.length} 个音效文件`)
    } catch (err) {
      toast.error('导入音效时出错，请检查磁盘空间或文件权限后重试')
      setStep('preview')
    }
  }

  const handleClose = () => {
    setStep('config')
    setScanResult(null)
    setSelectedPaths([])
    setSelectedFiles(new Set())
    setExtFilters(new Set())
    setQuickScanningDir(null)
    setFilterMinSizeKB(0)
    setFilterMaxSizeKB(0)
    setFilterMinDurSec(0)
    setFilterMaxDurSec(0)
    onClose()
  }

  const formatSize = (bytes: number): string => {
    if (bytes > 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  const formatDuration = (ms: number | undefined): string => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const m = Math.floor(ms / 60000)
    const s = Math.round((ms % 60000) / 1000)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // 预览页客户端二次过滤
  const filteredFiles = useMemo(() => {
    if (!scanResult) return []
    let files = scanResult.files
    if (filterMinSizeKB > 0 || filterMaxSizeKB > 0 || filterMinDurSec > 0 || filterMaxDurSec > 0) {
      files = files.filter((f) => {
        const sizeKB = f.size / 1024
        if (filterMinSizeKB > 0 && sizeKB < filterMinSizeKB) return false
        if (filterMaxSizeKB > 0 && sizeKB > filterMaxSizeKB) return false
        if (f.durationMs !== undefined) {
          const durSec = f.durationMs / 1000
          if (filterMinDurSec > 0 && durSec < filterMinDurSec) return false
          if (filterMaxDurSec > 0 && durSec > filterMaxDurSec) return false
        }
        return true
      })
    }
    return files
  }, [scanResult, filterMinSizeKB, filterMaxSizeKB, filterMinDurSec, filterMaxDurSec])

  const maxBarWidth = scanResult
    ? Math.max(...Object.values(scanResult.byFormat), 1)
    : 1

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel border border-surface-border rounded-xl w-[680px] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-panel">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-accent-light" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-fg">
                {step === 'config' && '扫描音效文件夹'}
                {step === 'scanning' && '正在扫描...'}
                {step === 'preview' && '扫描结果'}
                {step === 'importing' && '正在导入...'}
                {step === 'done' && '导入完成'}
              </h2>
              <p className="text-xs text-muted">
                {step === 'config' && '选择文件夹，设置过滤条件'}
                {step === 'preview' && `找到 ${scanResult?.newFiles || 0} 个新文件`}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="text-muted-light hover:text-fg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Config */}
          {step === 'config' && (
            <div className="space-y-5">
              {/* Quick scan: common directories */}
              {commonPaths && (
                <div>
                  <label className="block text-xs font-medium text-muted mb-2">快速扫描常用目录</label>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { key: 'desktop', label: '桌面', icon: Monitor, path: commonPaths.desktop },
                      { key: 'documents', label: '文档', icon: FileText, path: commonPaths.documents },
                      { key: 'downloads', label: '下载', icon: Download, path: commonPaths.downloads },
                      { key: 'music', label: '音乐', icon: Music, path: commonPaths.music },
                      { key: 'videos', label: '视频', icon: Film, path: commonPaths.videos },
                    ].map(({ key, label, icon: Icon, path }) => (
                      <button
                        key={key}
                        onClick={() => handleQuickScan(key, path)}
                        disabled={quickScanningDir === key}
                        className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border transition-all text-center ${
                          quickScanningDir === key
                            ? 'border-accent/50 bg-accent/10 text-accent-light'
                            : 'border-surface-border bg-surface-card hover:border-accent/30 hover:bg-accent/5 text-muted-light hover:text-fg'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[10px] leading-tight">{quickScanningDir === key ? '扫描中…' : label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted mt-1.5">点击即可快速扫描该目录下的音频文件</p>
                </div>
              )}

              {/* Folder selection (manual) */}
              <div>
                <label className="block text-xs font-medium text-muted mb-2">目标文件夹</label>
                <div className="space-y-2">
                  {selectedPaths.length > 0 ? (
                    <>
                      {selectedPaths.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 bg-surface-card rounded-lg border border-surface-border group">
                          <FolderOpen className="w-4 h-4 text-accent-light shrink-0" />
                          <span className="text-xs text-fg-muted truncate flex-1">{p}</span>
                          <button
                            onClick={() => setSelectedPaths((prev) => prev.filter((_, idx) => idx !== i))}
                            className="opacity-0 group-hover:opacity-100 text-muted-light hover:text-red-400 transition-all shrink-0"
                            title="移除此文件夹"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleSelectFolder()}
                          className="flex items-center gap-1.5 text-xs text-accent-light hover:text-accent transition-colors"
                        >
                          <FolderOpen size={13} />
                          添加更多文件夹
                        </button>
                        <button
                          onClick={() => { setSelectedPaths([]); setTimeout(() => handleSelectFolder(), 50) }}
                          className="text-xs text-muted hover:text-muted-light transition-colors"
                        >
                          更换所选文件夹
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={handleSelectFolder}
                      className="w-full px-4 py-8 border-2 border-dashed border-surface-border rounded-xl text-center hover:border-accent/40 hover:bg-accent/5 transition-all group"
                    >
                      <FolderOpen className="w-8 h-8 mx-auto mb-2 text-muted-light group-hover:text-accent-light transition-colors" />
                      <p className="text-xs text-muted group-hover:text-muted-light">点击选择文件夹</p>
                    </button>
                  )}
                </div>
              </div>

              {/* Quick options */}
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-surface-border bg-surface-card accent-[#534AB7]" />
                  <span className="text-xs text-muted-light">递归子目录</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={skipHidden} onChange={(e) => setSkipHidden(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-surface-border bg-surface-card accent-[#534AB7]" />
                  <span className="text-xs text-muted-light">跳过隐藏文件</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={includeVideo} onChange={(e) => setIncludeVideo(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-surface-border bg-surface-card accent-[#534AB7]" />
                  <span className="text-xs text-muted-light">包含视频文件</span>
                </label>
              </div>

              {/* Extension filter */}
              <div>
                <label className="block text-xs font-medium text-muted mb-2">文件格式（留空则扫描所有音频）</label>
                <div className="flex flex-wrap gap-2">
                  {AUDIO_EXTS.map(({ ext, label }) => (
                    <button
                      key={ext}
                      onClick={() => toggleExtFilter(ext)}
                      className={`px-2.5 py-1 rounded-md text-[11px] border transition-all ${
                        extFilters.has(ext)
                          ? 'bg-accent/20 border-accent/50 text-accent-light'
                          : 'border-surface-border bg-surface-card text-muted-light hover:border-surface-hover'
                      }`}
                    >
                      {extFilters.has(ext) && <span className="mr-1">✓</span>}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced */}
              <div>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-muted hover:text-muted-light transition-colors"
                >
                  {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  高级过滤
                </button>

                {showAdvanced && (
                  <div className="mt-3 p-4 bg-surface-card rounded-lg border border-surface-border space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">文件名包含</label>
                        <input
                          type="text"
                          value={filenameIncludes}
                          onChange={(e) => setFilenameIncludes(e.target.value)}
                          placeholder="如: sword,impact,explosion"
                          className="w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-xs text-fg-muted placeholder-muted-light focus:outline-none focus:border-accent/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">文件名排除</label>
                        <input
                          type="text"
                          value={filenameExcludes}
                          onChange={(e) => setFilenameExcludes(e.target.value)}
                          placeholder="如: temp,draft,backup"
                          className="w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-xs text-fg-muted placeholder-muted-light focus:outline-none focus:border-accent/50"
                        />
                      </div>
                    </div>

                    {/* Size filter (slider) */}
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-medium text-muted">文件大小</label>
                          <span className="text-[10px] text-muted-light">
                            {minSizeKB > 0 ? `≥ ${minSizeKB >= 1024 ? `${(minSizeKB/1024).toFixed(1)} MB` : `${minSizeKB} KB`}` : '不限'}
                            {' – '}
                            {maxSizeKB > 0 ? `≤ ${maxSizeKB >= 1024 ? `${(maxSizeKB/1024).toFixed(1)} MB` : `${maxSizeKB} KB`}` : '不限'}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <input
                            type="range"
                            min={0}
                            max={102400}
                            step={10}
                            value={minSizeKB}
                            onChange={(e) => setMinSizeKB(Number(e.target.value))}
                            className="flex-1 h-1.5 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                          />
                          <input
                            type="range"
                            min={0}
                            max={102400}
                            step={100}
                            value={maxSizeKB}
                            onChange={(e) => setMaxSizeKB(Number(e.target.value))}
                            className="flex-1 h-1.5 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-muted/50 px-0.5">
                          <span>最小</span>
                          <span>最大 (最大 100 MB)</span>
                        </div>
                      </div>

                      {/* Duration filter (slider) */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-medium text-muted">音频时长</label>
                          <span className="text-[10px] text-muted-light">
                            {minDurationSec > 0 ? `≥ ${minDurationSec < 60 ? `${minDurationSec.toFixed(1)}s` : `${Math.floor(minDurationSec/60)}:${(Math.round(minDurationSec%60)).toString().padStart(2,'0')}`}` : '不限'}
                            {' – '}
                            {maxDurationSec > 0 ? `≤ ${maxDurationSec < 60 ? `${maxDurationSec.toFixed(1)}s` : `${Math.floor(maxDurationSec/60)}:${(Math.round(maxDurationSec%60)).toString().padStart(2,'0')}`}` : '不限'}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <input
                            type="range"
                            min={0}
                            max={600}
                            step={0.5}
                            value={minDurationSec}
                            onChange={(e) => setMinDurationSec(Number(e.target.value))}
                            className="flex-1 h-1.5 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                          />
                          <input
                            type="range"
                            min={0}
                            max={3600}
                            step={1}
                            value={maxDurationSec}
                            onChange={(e) => setMaxDurationSec(Number(e.target.value))}
                            className="flex-1 h-1.5 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-muted/50 px-0.5">
                          <span>最短</span>
                          <span>最长 (最大 60 分钟)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Import options */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={autoTagFolder} onChange={(e) => setAutoTagFolder(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-surface-border bg-surface-card accent-[#534AB7]" />
                  <span className="text-xs text-muted-light">按文件夹结构自动标记标签</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Scanning */}
          {step === 'scanning' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 mb-4 relative">
                <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#534AB7] animate-spin" />
                <Search className="w-6 h-6 absolute inset-0 m-auto text-accent-light" />
              </div>
              <p className="text-sm text-muted-light">正在扫描文件夹...</p>
              <p className="text-xs text-muted-light mt-1">这可能需要几秒到几分钟</p>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && scanResult && (
            <div className="space-y-4">
              {/* Stats cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-surface-card rounded-lg border border-surface-border p-3 text-center">
                  <p className="text-lg font-semibold text-fg">{scanResult.total}</p>
                  <p className="text-xs text-muted">总计</p>
                </div>
                <div className="bg-[#1a3a1a] rounded-lg border border-[#2a5a2a] p-3 text-center">
                  <p className="text-lg font-semibold text-[#4ADE80]">{scanResult.newFiles}</p>
                  <p className="text-xs text-[#6a9a6a]">新文件</p>
                </div>
                <div className="bg-surface-card rounded-lg border border-surface-border p-3 text-center">
                  <p className="text-lg font-semibold text-fg">{scanResult.skipped}</p>
                  <p className="text-xs text-muted">已导入</p>
                </div>
                <div className="bg-surface-card rounded-lg border border-surface-border p-3 text-center">
                  <p className="text-lg font-semibold text-fg">{formatSize(scanResult.totalSize)}</p>
                  <p className="text-xs text-muted">总大小</p>
                </div>
              </div>

              {/* Format distribution */}
              {Object.keys(scanResult.byFormat).length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted mb-2">格式分布</h3>
                  <div className="space-y-1.5">
                    {Object.entries(scanResult.byFormat)
                      .sort(([, a], [, b]) => b - a)
                      .map(([fmt, count]) => (
                        <div key={fmt} className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-right text-muted">{fmt}</span>
                          <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent rounded-full transition-all"
                              style={{ width: `${(count / maxBarWidth) * 100}%` }}
                            />
                          </div>
                          <span className="w-6 text-muted-light">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Client-side post-scan filter bar */}
              <div className="bg-surface-card rounded-lg border border-surface-border p-3 space-y-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Filter size={12} className="text-accent-light" />
                  <span className="text-[11px] font-medium text-muted">结果过滤</span>
                  {filteredFiles.length !== scanResult.files.length && (
                    <span className="text-[10px] text-accent-light ml-auto">
                      显示 {filteredFiles.length} / {scanResult.files.length}
                    </span>
                  )}
                </div>

                {/* Size sliders */}
                <div>
                  <div className="flex justify-between text-[9px] text-muted mb-0.5">
                    <span>大小: {filterMinSizeKB > 0 ? `${filterMinSizeKB >= 1024 ? `${(filterMinSizeKB/1024).toFixed(1)}MB` : `${filterMinSizeKB}KB`}+` : '不限'} — {filterMaxSizeKB > 0 ? `${filterMaxSizeKB >= 1024 ? `${(filterMaxSizeKB/1024).toFixed(1)}MB` : `${filterMaxSizeKB}KB`}-` : '不限'}</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="range"
                      min={0}
                      max={102400}
                      step={10}
                      value={filterMinSizeKB}
                      onChange={(e) => setFilterMinSizeKB(Number(e.target.value))}
                      className="flex-1 h-1 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                    />
                    <input
                      type="range"
                      min={0}
                      max={102400}
                      step={100}
                      value={filterMaxSizeKB}
                      onChange={(e) => setFilterMaxSizeKB(Number(e.target.value))}
                      className="flex-1 h-1 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                    />
                  </div>
                </div>

                {/* Duration sliders */}
                <div>
                  <div className="flex justify-between text-[9px] text-muted mb-0.5">
                    <span>时长: {filterMinDurSec > 0 ? `${filterMinDurSec.toFixed(1)}s+` : '不限'} — {filterMaxDurSec > 0 ? (filterMaxDurSec < 60 ? `${filterMaxDurSec.toFixed(1)}s-` : `${Math.floor(filterMaxDurSec/60)}:${Math.round(filterMaxDurSec%60).toString().padStart(2,'0')}-`) : '不限'}</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="range"
                      min={0}
                      max={600}
                      step={0.5}
                      value={filterMinDurSec}
                      onChange={(e) => setFilterMinDurSec(Number(e.target.value))}
                      className="flex-1 h-1 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                    />
                    <input
                      type="range"
                      min={0}
                      max={3600}
                      step={1}
                      value={filterMaxDurSec}
                      onChange={(e) => setFilterMaxDurSec(Number(e.target.value))}
                      className="flex-1 h-1 bg-surface rounded-full appearance-none cursor-pointer accent-[#534AB7]"
                    />
                  </div>
                </div>
              </div>

              {/* File list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-muted">
                    文件列表 ({filteredFiles.length}{filteredFiles.length !== scanResult.files.length ? ` / ${scanResult.files.length}` : ''})
                  </h3>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      // 只选中当前过滤后的文件（用原始索引）
                      const originalIndices = filteredFiles.map(f => scanResult.files.indexOf(f))
                      setSelectedFiles(new Set(originalIndices))
                    }} className="text-xs text-accent-light hover:text-accent-light">全选</button>
                    <button onClick={deselectAll} className="text-xs text-muted hover:text-muted-light">取消</button>
                  </div>
                </div>
                <div className="max-h-[240px] overflow-y-auto border border-surface-border rounded-lg">
                  {filteredFiles.map((file) => {
                    const origIdx = scanResult!.files.indexOf(file)
                    return (
                      <div
                        key={origIdx}
                        onClick={() => toggleFile(origIdx)}
                        className={`flex items-center gap-3 px-3 py-2 border-b border-surface-panel last:border-b-0 cursor-pointer transition-colors ${
                          selectedFiles.has(origIdx) ? 'bg-accent/10' : 'hover:bg-surface-card'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(origIdx)}
                          onChange={() => toggleFile(origIdx)}
                          className="w-3.5 h-3.5 rounded border-surface-border bg-surface-card accent-[#534AB7]"
                        />
                        <AudioWaveform className="w-4 h-4 text-muted-light shrink-0" />
                        <span className="flex-1 text-xs text-fg-muted truncate">{file.name}</span>
                        <span className="text-xs text-muted-light uppercase shrink-0">{file.ext.replace('.', '')}</span>
                        <span className="text-xs text-muted-light w-16 text-right shrink-0">{formatSize(file.size)}</span>
                        <span className="text-xs text-muted w-14 text-right shrink-0 flex items-center justify-end gap-0.5">
                          <Clock size={10} />
                          {formatDuration(file.durationMs)}
                        </span>
                      </div>
                    )
                  })}
                  {filteredFiles.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted">没有符合当前过滤条件的文件</div>
                  )}
                </div>
              </div>

              {/* AI option */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-surface-border bg-surface-card accent-[#534AB7]" />
                <Sparkles className="w-3.5 h-3.5 text-accent-light" />
                <span className="text-xs text-muted-light">导入后自动 AI 分析</span>
              </label>
            </div>
          )}

          {/* Step 4: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-16 h-16 relative">
                <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#534AB7] animate-spin" />
                <HardDrive className="w-6 h-6 absolute inset-0 m-auto text-accent-light" />
              </div>
              <p className="text-sm text-muted-light">正在导入音效文件...</p>
              <div className="w-64 h-2 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-light">{importProgress.current} / {importProgress.total}</p>
            </div>
          )}

          {/* Step 5: Done */}
          {step === 'done' && scanResult && (
            <div className="flex flex-col items-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#1a3a1a] flex items-center justify-center">
                <svg className="w-6 h-6 text-[#4ADE80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-fg">
                  成功导入 {scanResult.newFiles} 个文件
                </p>
                <p className="text-xs text-muted">
                  总大小 {formatSize(scanResult.totalSize)}
                  {autoAnalyze && ' · 将自动进行 AI 分析'}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setStep('config'); setScanResult(null); setSelectedFiles(new Set()) }}
                  className="px-4 py-2 text-xs text-muted hover:text-fg border border-surface-border rounded-lg transition-colors"
                >
                  继续导入
                </button>
                <button
                  onClick={handleClose}
                  className="px-6 py-2 bg-accent text-white text-xs rounded-lg hover:bg-accent transition-colors"
                >
                  完成
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'config' && (
          <div className="px-6 py-4 border-t border-surface-panel flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-xs text-muted hover:text-fg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleScan}
              disabled={selectedPaths.length === 0}
              className="px-6 py-2 bg-accent text-white text-xs rounded-lg hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              开始扫描
            </button>
          </div>
        )}

        {step === 'preview' && (
          <div className="px-6 py-4 border-t border-surface-panel flex justify-between gap-3">
            <button
              onClick={() => setStep('config')}
              className="flex items-center gap-1.5 px-4 py-2 text-xs text-muted hover:text-fg transition-colors"
            >
              <ArrowLeft size={13} />
              返回修改
            </button>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-xs text-muted hover:text-fg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={selectedFiles.size === 0}
                className="px-6 py-2 bg-accent text-white text-xs rounded-lg hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                导入选中 ({selectedFiles.size})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
