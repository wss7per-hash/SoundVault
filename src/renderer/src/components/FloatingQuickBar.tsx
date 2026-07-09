import { useAppStore } from '../stores/appStore'
import { Trash2, Tags, Wand2, FolderPlus, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

export function FloatingQuickBar(): JSX.Element {
  const selectedIds = useAppStore((s) => s.selectedSoundIds)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const batchAnalyzing = useAppStore((s) => s.batchAnalyzing)

  if (selectedIds.length === 0) return <></>

  const handleBatchDelete = async () => {
    try {
      await window.api.batchDelete(selectedIds)
      toast.success(`已删除 ${selectedIds.length} 个音效`)
      clearSelection()
      await refreshSounds()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleBatchAnalyze = async () => {
    await useAppStore.getState().analyzeBatch(selectedIds)
    clearSelection()
  }

  const handleBatchCancel = async () => {
    const token = useAppStore.getState().batchToken
    if (token) await useAppStore.getState().cancelAnalysis([token])
  }

  const handleBatchTag = async (action: 'add' | 'remove') => {
    const tagNames = prompt(action === 'add' ? '输入要添加的标签（逗号分隔）：' : '输入要移除的标签（逗号分隔）：')
    if (!tagNames?.trim()) return
    try {
      const result = await window.api.batchTag(selectedIds, tagNames.split(',').map((t) => t.trim()), action)
      toast.success(`${action === 'add' ? '已添加' : '已移除'}标签，影响 ${result.affected} 条`)
      await refreshSounds()
    } catch {
      toast.error('操作失败')
    }
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-surface-panel border border-surface-border rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-2 z-40">
      <span className="text-xs text-muted-light mr-1">
        已选 <span className="text-accent-light font-medium">{selectedIds.length}</span> 个
      </span>

      <div className="w-px h-4 bg-surface-border" />

      <button
        onClick={batchAnalyzing ? handleBatchCancel : handleBatchAnalyze}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-surface-card text-xs text-muted-light hover:text-accent-light transition-colors"
      >
        {batchAnalyzing ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            取消
          </>
        ) : (
          <>
            <Wand2 size={12} />
            AI分析
          </>
        )}
      </button>

      <button
        onClick={() => handleBatchTag('add')}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-surface-card text-xs text-muted-light hover:text-accent-light transition-colors"
      >
        <Tags size={12} />
        添加标签
      </button>

      <button
        onClick={() => handleBatchTag('remove')}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-surface-card text-xs text-muted-light hover:text-red-400 transition-colors"
      >
        <Tags size={12} />
        移除标签
      </button>

      <div className="w-px h-4 bg-surface-border" />

      <button
        onClick={handleBatchDelete}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-500/10 text-xs text-red-400 transition-colors"
      >
        <Trash2 size={12} />
        删除
      </button>

      <div className="w-px h-4 bg-surface-border" />

      <button
        onClick={clearSelection}
        className="p-1 hover:bg-surface-card rounded-lg text-muted hover:text-muted-light transition-colors"
        title="取消选择"
      >
        <X size={14} />
      </button>
    </div>
  )
}
