import { useState, useCallback, useRef } from 'react'
import { X, FolderOpen, Search, Filter, ChevronDown, ChevronRight, AudioWaveform, HardDrive, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'
import type { ScanResult, ImportFile } from '../../preload/index.d'

interface ScanDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function ScanDialog({ isOpen, onClose }: ScanDialogProps) {
  const refreshSounds = useAppStore((s) => s.refreshSounds)

  // Step: 'config' | 'scanning' | 'preview' | 'importing' | 'done'
  const [step, setStep] = useState<'config' | 'scanning' | 'preview' | 'importing' | 'done'>('config')

  // Config state
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [recursive, setRecursive] = useState(true)
  const [skipHidden, setSkipHidden] = useState(true)
  const [includeVideo, setIncludeVideo] = useState(false)
  const [filenameIncludes, setFilenameIncludes] = useState('')
  const [filenameExcludes, setFilenameExcludes] = useState('')
  const [minSizeKB, setMinSizeKB] = useState('')
  const [maxSizeKB, setMaxSizeKB] = useState('')
  const [autoTagFolder, setAutoTagFolder] = useState(true)
  const [autoAnalyze, setAutoAnalyze] = useState(false)

  // Result state
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set())
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleSelectFolder = async () => {
    const paths = await window.api.selectFolder()
    if (paths.length > 0) {
      setSelectedPaths(paths)
    }
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
          minSizeKB: minSizeKB ? parseFloat(minSizeKB) : 0,
          maxSizeKB: maxSizeKB ? parseFloat(maxSizeKB) : 0,
          skipHidden,
          includeVideo
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
      toast.error(`扫描失败: ${(err as Error).message}`)
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

      refreshSounds()
      setStep('done')
      toast.success(`成功导入 ${filesToImport.length} 个音效文件`)
    } catch (err) {
      toast.error(`导入失败: ${(err as Error).message}`)
      setStep('preview')
    }
  }

  const handleClose = () => {
    setStep('config')
    setScanResult(null)
    setSelectedPaths([])
    setSelectedFiles(new Set())
    onClose()
  }

  const formatSize = (bytes: number): string => {
    if (bytes > 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  const maxBarWidth = scanResult
    ? Math.max(...Object.values(scanResult.byFormat), 1)
    : 1

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1f1f1d] border border-[#3a3a38] rounded-xl w-[680px] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#534AB7]/20 flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-[#7C72E6]" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#e8e8e4]">
                {step === 'config' && '扫描音效文件夹'}
                {step === 'scanning' && '正在扫描...'}
                {step === 'preview' && '扫描结果'}
                {step === 'importing' && '正在导入...'}
                {step === 'done' && '导入完成'}
              </h2>
              <p className="text-xs text-[#8a8a82]">
                {step === 'config' && '选择文件夹，设置过滤条件'}
                {step === 'preview' && `找到 ${scanResult?.newFiles || 0} 个新文件`}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="text-[#6a6a64] hover:text-[#e8e8e4] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Config */}
          {step === 'config' && (
            <div className="space-y-5">
              {/* Folder selection */}
              <div>
                <label className="block text-xs font-medium text-[#9a9a92] mb-2">目标文件夹</label>
                <div className="space-y-2">
                  {selectedPaths.length > 0 ? (
                    selectedPaths.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#252524] rounded-lg border border-[#333]">
                        <FolderOpen className="w-4 h-4 text-[#7C72E6] shrink-0" />
                        <span className="text-xs text-[#c8c8c4] truncate flex-1">{p}</span>
                      </div>
                    ))
                  ) : (
                    <button
                      onClick={handleSelectFolder}
                      className="w-full px-4 py-8 border-2 border-dashed border-[#3a3a38] rounded-xl text-center hover:border-[#534AB7]/40 hover:bg-[#534AB7]/5 transition-all group"
                    >
                      <FolderOpen className="w-8 h-8 mx-auto mb-2 text-[#5a5a54] group-hover:text-[#7C72E6] transition-colors" />
                      <p className="text-xs text-[#8a8a82] group-hover:text-[#b8b8b4]">点击选择文件夹</p>
                    </button>
                  )}
                  {selectedPaths.length > 0 && (
                    <button
                      onClick={handleSelectFolder}
                      className="text-xs text-[#7C72E6] hover:text-[#9C92F6] transition-colors"
                    >
                      + 添加更多文件夹
                    </button>
                  )}
                </div>
              </div>

              {/* Quick options */}
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#4a4a48] bg-[#252524] accent-[#534AB7]" />
                  <span className="text-xs text-[#b8b8b4]">递归子目录</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={skipHidden} onChange={(e) => setSkipHidden(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#4a4a48] bg-[#252524] accent-[#534AB7]" />
                  <span className="text-xs text-[#b8b8b4]">跳过隐藏文件</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={includeVideo} onChange={(e) => setIncludeVideo(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#4a4a48] bg-[#252524] accent-[#534AB7]" />
                  <span className="text-xs text-[#b8b8b4]">包含视频文件</span>
                </label>
              </div>

              {/* Advanced */}
              <div>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-[#8a8a82] hover:text-[#b8b8b4] transition-colors"
                >
                  {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  高级过滤
                </button>

                {showAdvanced && (
                  <div className="mt-3 p-4 bg-[#252524] rounded-lg border border-[#333] space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">文件名包含</label>
                        <input
                          type="text"
                          value={filenameIncludes}
                          onChange={(e) => setFilenameIncludes(e.target.value)}
                          placeholder="如: sword,impact,explosion"
                          className="w-full px-3 py-1.5 bg-[#1a1a18] border border-[#333] rounded-lg text-xs text-[#c8c8c4] placeholder-[#5a5a54] focus:outline-none focus:border-[#534AB7]/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">文件名排除</label>
                        <input
                          type="text"
                          value={filenameExcludes}
                          onChange={(e) => setFilenameExcludes(e.target.value)}
                          placeholder="如: temp,draft,backup"
                          className="w-full px-3 py-1.5 bg-[#1a1a18] border border-[#333] rounded-lg text-xs text-[#c8c8c4] placeholder-[#5a5a54] focus:outline-none focus:border-[#534AB7]/50"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">最小大小 (KB)</label>
                        <input
                          type="number"
                          value={minSizeKB}
                          onChange={(e) => setMinSizeKB(e.target.value)}
                          placeholder="不限"
                          min="0"
                          className="w-full px-3 py-1.5 bg-[#1a1a18] border border-[#333] rounded-lg text-xs text-[#c8c8c4] placeholder-[#5a5a54] focus:outline-none focus:border-[#534AB7]/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">最大大小 (KB)</label>
                        <input
                          type="number"
                          value={maxSizeKB}
                          onChange={(e) => setMaxSizeKB(e.target.value)}
                          placeholder="不限"
                          min="0"
                          className="w-full px-3 py-1.5 bg-[#1a1a18] border border-[#333] rounded-lg text-xs text-[#c8c8c4] placeholder-[#5a5a54] focus:outline-none focus:border-[#534AB7]/50"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Import options */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={autoTagFolder} onChange={(e) => setAutoTagFolder(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#4a4a48] bg-[#252524] accent-[#534AB7]" />
                  <span className="text-xs text-[#b8b8b4]">按文件夹结构自动标记标签</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Scanning */}
          {step === 'scanning' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 mb-4 relative">
                <div className="absolute inset-0 rounded-full border-2 border-[#534AB7]/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#534AB7] animate-spin" />
                <Search className="w-6 h-6 absolute inset-0 m-auto text-[#7C72E6]" />
              </div>
              <p className="text-sm text-[#b8b8b4]">正在扫描文件夹...</p>
              <p className="text-xs text-[#6a6a64] mt-1">这可能需要几秒到几分钟</p>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && scanResult && (
            <div className="space-y-4">
              {/* Stats cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-[#252524] rounded-lg border border-[#333] p-3 text-center">
                  <p className="text-lg font-semibold text-[#e8e8e4]">{scanResult.total}</p>
                  <p className="text-xs text-[#8a8a82]">总计</p>
                </div>
                <div className="bg-[#1a3a1a] rounded-lg border border-[#2a5a2a] p-3 text-center">
                  <p className="text-lg font-semibold text-[#4ADE80]">{scanResult.newFiles}</p>
                  <p className="text-xs text-[#6a9a6a]">新文件</p>
                </div>
                <div className="bg-[#252524] rounded-lg border border-[#333] p-3 text-center">
                  <p className="text-lg font-semibold text-[#e8e8e4]">{scanResult.skipped}</p>
                  <p className="text-xs text-[#8a8a82]">已导入</p>
                </div>
                <div className="bg-[#252524] rounded-lg border border-[#333] p-3 text-center">
                  <p className="text-lg font-semibold text-[#e8e8e4]">{formatSize(scanResult.totalSize)}</p>
                  <p className="text-xs text-[#8a8a82]">总大小</p>
                </div>
              </div>

              {/* Format distribution */}
              {Object.keys(scanResult.byFormat).length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-[#9a9a92] mb-2">格式分布</h3>
                  <div className="space-y-1.5">
                    {Object.entries(scanResult.byFormat)
                      .sort(([, a], [, b]) => b - a)
                      .map(([fmt, count]) => (
                        <div key={fmt} className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-right text-[#8a8a82]">{fmt}</span>
                          <div className="flex-1 h-2 bg-[#1a1a18] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#534AB7] rounded-full transition-all"
                              style={{ width: `${(count / maxBarWidth) * 100}%` }}
                            />
                          </div>
                          <span className="w-6 text-[#6a6a64]">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* File list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-[#9a9a92]">
                    文件列表 ({scanResult.files.length})
                  </h3>
                  <div className="flex gap-2">
                    <button onClick={selectAll} className="text-xs text-[#7C72E6] hover:text-[#9C92F6]">全选</button>
                    <button onClick={deselectAll} className="text-xs text-[#8a8a82] hover:text-[#b8b8b4]">取消</button>
                  </div>
                </div>
                <div className="max-h-[240px] overflow-y-auto border border-[#333] rounded-lg">
                  {scanResult.files.map((file, i) => (
                    <div
                      key={i}
                      onClick={() => toggleFile(i)}
                      className={`flex items-center gap-3 px-3 py-2 border-b border-[#2a2a28] last:border-b-0 cursor-pointer transition-colors ${
                        selectedFiles.has(i) ? 'bg-[#534AB7]/10' : 'hover:bg-[#252524]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(i)}
                        onChange={() => toggleFile(i)}
                        className="w-3.5 h-3.5 rounded border-[#4a4a48] bg-[#252524] accent-[#534AB7]"
                      />
                      <AudioWaveform className="w-4 h-4 text-[#6a6a64] shrink-0" />
                      <span className="flex-1 text-xs text-[#c8c8c4] truncate">{file.name}</span>
                      <span className="text-xs text-[#5a5a54] uppercase">{file.ext.replace('.', '')}</span>
                      <span className="text-xs text-[#5a5a54]">{formatSize(file.size)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI option */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[#4a4a48] bg-[#252524] accent-[#534AB7]" />
                <Sparkles className="w-3.5 h-3.5 text-[#7C72E6]" />
                <span className="text-xs text-[#b8b8b4]">导入后自动 AI 分析</span>
              </label>
            </div>
          )}

          {/* Step 4: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-16 h-16 relative">
                <div className="absolute inset-0 rounded-full border-2 border-[#534AB7]/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#534AB7] animate-spin" />
                <HardDrive className="w-6 h-6 absolute inset-0 m-auto text-[#7C72E6]" />
              </div>
              <p className="text-sm text-[#b8b8b4]">正在导入音效文件...</p>
              <div className="w-64 h-2 bg-[#1a1a18] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#534AB7] rounded-full transition-all duration-300"
                  style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-[#6a6a64]">{importProgress.current} / {importProgress.total}</p>
            </div>
          )}

          {/* Step 5: Done */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="w-16 h-16 rounded-full bg-[#1a3a1a] flex items-center justify-center">
                <svg className="w-8 h-8 text-[#4ADE80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-[#e8e8e4]">
                成功导入 {scanResult?.newFiles || 0} 个文件
              </p>
              <button
                onClick={handleClose}
                className="px-6 py-2 bg-[#534AB7] text-white text-xs rounded-lg hover:bg-[#6358D0] transition-colors"
              >
                完成
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'config' && (
          <div className="px-6 py-4 border-t border-[#2a2a28] flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-xs text-[#8a8a82] hover:text-[#e8e8e4] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleScan}
              disabled={selectedPaths.length === 0}
              className="px-6 py-2 bg-[#534AB7] text-white text-xs rounded-lg hover:bg-[#6358D0] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              开始扫描
            </button>
          </div>
        )}

        {step === 'preview' && (
          <div className="px-6 py-4 border-t border-[#2a2a28] flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-xs text-[#8a8a82] hover:text-[#e8e8e4] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={selectedFiles.size === 0}
              className="px-6 py-2 bg-[#534AB7] text-white text-xs rounded-lg hover:bg-[#6358D0] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              导入选中 ({selectedFiles.size})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
