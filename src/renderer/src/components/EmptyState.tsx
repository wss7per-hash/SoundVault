import { useState, useCallback } from 'react'
import { FolderOpen, FolderSearch, ArrowDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'
import emptyStateImg from '../assets/images/empty-state.png'

interface EmptyStateProps {
  onImport: () => void
}

export function EmptyState({ onImport }: EmptyStateProps): JSX.Element {
  const [isImporting, setIsImporting] = useState(false)
  const { refreshSounds, refreshStats, toggleScanDialog } = useAppStore()

  const handleBrowseFolder = useCallback(async () => {
    setIsImporting(true)
    try {
      const folders = await window.api.selectFolder()
      if (folders.length === 0) return

      for (const folder of folders) {
        const result = await window.api.scanFolder({
          targetPath: folder,
          recursive: true,
          filenameIncludes: [],
          filenameExcludes: [],
          minSizeKB: 0,
          maxSizeKB: 0,
          skipHidden: true,
          includeVideo: false
        })

        if (result.newFiles > 0) {
          const { imported } = await window.api.importSounds(result.files)
          toast.success(`导入了 ${imported} 个音效`)
        } else {
          toast('未发现新音频文件')
        }
      }

      await Promise.all([refreshSounds(), refreshStats()])
    } catch (err) {
      toast.error('导入失败')
    } finally {
      setIsImporting(false)
    }
  }, [refreshSounds, refreshStats])

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-xs">
        <img
          src={emptyStateImg}
          alt="空状态"
          className="w-36 h-36 mx-auto mb-4 rounded-2xl object-cover opacity-90"
        />

        <h2 className="text-xl font-medium text-muted-light mb-2">欢迎使用 SoundVault</h2>
        <p className="text-sm text-accent-light leading-relaxed mb-1.5 font-medium">AI 自动标注 + 语义搜索，告别手动整理音效</p>
        <p className="text-sm text-muted leading-relaxed mb-6">
          导入音效文件夹，AI 会帮你自动识别、描述、打标签。
        </p>

        <div className="flex flex-col gap-2.5 mb-5">
          <button
            onClick={handleBrowseFolder}
            disabled={isImporting}
            className="flex items-center justify-center gap-2 bg-accent hover:bg-accent-light text-white rounded-lg py-2.5 px-5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <FolderOpen size={16} />
            {isImporting ? '正在扫描...' : '选择音效文件夹'}
          </button>

          <button
            onClick={() => toggleScanDialog()}
            disabled={isImporting}
            className="flex items-center justify-center gap-2 bg-surface-card hover:bg-surface-hover text-muted-light border border-surface-border rounded-lg py-2 px-5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <FolderSearch size={14} />
            高级扫描导入（可按格式过滤）
          </button>

          <p className="text-xs text-muted">
            或直接将文件夹拖入窗口
          </p>
        </div>

        <div className="flex items-center justify-center gap-1 text-xs text-muted">
          <ArrowDown size={10} className="animate-bounce" />
          <span>拖入文件夹即可开始</span>
          <ArrowDown size={10} className="animate-bounce" />
        </div>
      </div>
    </div>
  )
}
