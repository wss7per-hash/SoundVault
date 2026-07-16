import { useState, useEffect } from 'react'
import { X, FileDown, Loader2, Check, FolderOpen, Film, Clapperboard, Table, Layers } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'

type NLEFormat = 'premiere' | 'fcpx' | 'resolve' | 'csv'

const FORMATS: { id: NLEFormat; name: string; note: string; icon: typeof Film }[] = [
  { id: 'premiere', name: 'Premiere Pro', note: 'FCP7 兼容 XML，导入即可拖入时间线', icon: Film },
  { id: 'fcpx', name: 'Final Cut Pro X', note: 'FCPXML 工程', icon: Clapperboard },
  { id: 'resolve', name: 'DaVinci Resolve', note: 'FCPXML 工程（Resolve 可导入）', icon: Layers },
  { id: 'csv', name: '通用 CSV 清单', note: '文件路径 / 时长 / 规格，任意软件可用', icon: Table },
]

interface ExportNLEModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function ExportNLEModal({ isOpen, onClose }: ExportNLEModalProps): JSX.Element | null {
  const selectedIds = useAppStore((s) => s.selectedSoundIds)
  const allSounds = useAppStore((s) => s.sounds)

  const [format, setFormat] = useState<NLEFormat>('premiere')
  const [targetDir, setTargetDir] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<{ path: string; count: number } | null>(null)

  const ids = selectedIds.length > 0 ? selectedIds : allSounds.map((s) => s.id)
  const scopeLabel = selectedIds.length > 0
    ? `当前选中 ${selectedIds.length} 个音效`
    : `当前库全部 ${allSounds.length} 个音效（当前视图）`

  useEffect(() => {
    if (isOpen) {
      setResult(null)
      setExporting(false)
      // 记忆上次导出目录
      window.api.getSetting('export:nleDir').then((d) => { if (d) setTargetDir(d) }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  if (!isOpen) return null

  const chooseDir = async () => {
    const res = await window.api.selectFolder()
    if (res && res.length > 0) {
      setTargetDir(res[0])
      window.api.setSetting('export:nleDir', res[0]).catch(() => {})
    }
  }

  const doExport = async () => {
    if (ids.length === 0) { toast.error('没有可导出的音效'); return }
    if (!targetDir) { toast.error('请先选择导出目录'); return }
    setExporting(true)
    setResult(null)
    try {
      const res = await window.api.exportNLE(ids, format, targetDir)
      if (res.success && res.path) {
        setResult({ path: res.path, count: res.count ?? ids.length })
        toast.success(`已导出 ${res.count ?? ids.length} 个音效的工程文件`)
      } else {
        toast.error(res.message || '导出失败，请检查目标目录是否可写')
      }
    } catch (err) {
      toast.error('导出时出现异常，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  const openDir = async () => {
    if (targetDir) await window.api.openPath(targetDir)
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel border border-surface-border rounded-2xl w-[520px] max-h-[88vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
              <FileDown className="w-4 h-4 text-accent-light" />
            </div>
            <div>
              <div className="text-sm font-semibold text-muted-light">导出剪辑工程</div>
              <div className="text-xs text-muted mt-0.5">把所选音效导出为剪辑软件可识别的工程文件</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:bg-surface-hover hover:text-muted-light transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* 范围 */}
          <div className="text-xs text-muted">
            导出范围：<span className="text-accent-light font-medium">{scopeLabel}</span>
          </div>

          {/* 格式选择 */}
          <div>
            <div className="text-xs text-muted mb-2">目标格式</div>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    format === f.id
                      ? 'border-accent bg-accent/15'
                      : 'border-surface-border hover:border-muted'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium text-muted-light">
                    <f.icon size={14} className="text-accent-light" />
                    {f.name}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5 leading-tight">{f.note}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 目标目录 */}
          <div>
            <div className="text-xs text-muted mb-2">导出目录</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface border border-surface-border text-xs text-muted-light truncate">
                {targetDir || '未选择'}
              </div>
              <button
                onClick={chooseDir}
                className="px-3 py-2 rounded-lg border border-surface-border text-xs text-muted hover:text-muted-light hover:border-muted transition-colors shrink-0"
              >
                选择目录
              </button>
            </div>
          </div>

          {/* 结果 */}
          {result && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs mb-1">
                <Check size={14} /> 导出完成
              </div>
              <div className="text-xs text-muted-light break-all mb-2">{result.path}</div>
              <button
                onClick={openDir}
                className="flex items-center gap-1.5 text-xs text-accent-light hover:underline"
              >
                <FolderOpen size={13} /> 打开所在文件夹
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-surface-border px-6 py-4 flex items-center gap-3">
          {exporting ? (
            <>
              <button
                disabled
                className="flex-1 px-4 py-2.5 rounded-lg bg-accent/60 text-white text-sm font-medium flex items-center justify-center gap-2 cursor-wait"
              >
                <Loader2 size={15} className="animate-spin" /> 导出中…
              </button>
            </>
          ) : (
            <button
              onClick={doExport}
              disabled={ids.length === 0 || !targetDir}
              className="flex-1 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <FileDown size={15} /> 导出工程（{ids.length} 个）
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-surface-border text-sm text-muted hover:text-muted-light hover:border-muted transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
