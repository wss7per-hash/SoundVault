import { useState, useMemo } from 'react'
import { useAppStore } from '../stores/appStore'
import { Trash2, Tags, Wand2, X, Loader2, Check, Plus, Search, Star, Download } from 'lucide-react'
import toast from 'react-hot-toast'

export function FloatingQuickBar(): JSX.Element {
  const selectedIds = useAppStore((s) => s.selectedSoundIds)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const allTags = useAppStore((s) => s.tags) || []
  const batchAnalyzing = useAppStore((s) => s.batchAnalyzing)

  // 标签选择器弹层状态（必须位于 early return 之前，遵守 Hooks 规则）
  const [picker, setPicker] = useState<null | 'add' | 'remove'>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => allTags.filter((t) => t.name.toLowerCase().includes(q)),
    [allTags, q]
  )
  const exactExists = q.length > 0 && allTags.some((t) => t.name.toLowerCase() === q)

  if (selectedIds.length === 0) return <></>

  const openPicker = (mode: 'add' | 'remove') => {
    setPicker(mode)
    setQuery('')
    setPicked(new Set())
  }

  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleBatchDelete = async () => {
    try {
      await window.api.batchDelete(selectedIds)
      toast.success(`已删除 ${selectedIds.length} 个音效`)
      clearSelection()
      await refreshSounds()
    } catch {
      toast.error('批量删除失败，请稍后重试')
    }
  }

  const handleBatchStar = async () => {
    try {
      const res = await window.api.batchStar(selectedIds)
      toast.success(`已收藏 ${res.affected ?? selectedIds.length} 个音效`)
      await refreshSounds()
    } catch {
      toast.error('批量收藏失败，请稍后重试')
    }
  }

  const handleBatchExport = async () => {
    const result = await window.api.selectFolder()
    if (!result || result.length === 0) return
    const toastId = toast.loading('正在导出…')
    const res = await window.api.batchExport(selectedIds, result[0])
    toast.dismiss(toastId)
    if (res.success) {
      const parts = [`已复制 ${res.copied ?? 0} 个`]
      if (res.missing) parts.push(`${res.missing} 个文件缺失`)
      if (res.skipped) parts.push(`${res.skipped} 个失败`)
      toast.success(parts.join('，'))
    } else {
      toast.error(res.message || '导出失败，请检查目标文件夹是否可写')
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

  const confirmTags = async () => {
    const names = [...picked]
    if (!names.length) return
    const action = picker === 'add' ? 'add' : 'remove'
    try {
      const result = await window.api.batchTag(selectedIds, names, action)
      toast.success(
        `${action === 'add' ? '已添加' : '已移除'}标签「${names.join('、')}」，影响 ${result.affected} 条`
      )
      await refreshSounds()
      setPicker(null)
      setPicked(new Set())
      setQuery('')
    } catch {
      toast.error('批量标签操作未成功，请稍后重试')
    }
  }

  const chipBase =
    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors'
  const chipOn = 'bg-accent/25 text-accent-light'
  const chipOff = 'text-muted-light hover:bg-surface-card'

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center">
      {/* 标签选择器弹层（替换原 prompt() 逗号分隔输入） */}
      {picker && (
        <div className="mb-2 w-[320px] max-h-[360px] overflow-hidden bg-surface-panel border border-surface-border rounded-xl shadow-2xl flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-border">
            <Search size={14} className="text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && picked.size > 0) confirmTags() }}
              placeholder={picker === 'add' ? '搜索或新建标签' : '搜索要移除的标签'}
              className="flex-1 bg-transparent outline-none text-xs text-muted-light placeholder:text-muted/60"
            />
            <button
              onClick={() => { setPicker(null); setPicked(new Set()) }}
              className="p-0.5 hover:bg-surface-card rounded text-muted hover:text-muted-light"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {/* 添加模式：无精确匹配时可新建 */}
            {picker === 'add' && q.length > 0 && !exactExists && (
              <button
                onClick={() => toggle(query.trim())}
                className={`${chipBase} ${picked.has(query.trim()) ? chipOn : chipOff} w-full`}
              >
                {picked.has(query.trim()) ? <Check size={13} /> : <Plus size={13} />}
                新建标签「{query.trim()}」
              </button>
            )}

            {filtered.length > 0 ? (
              filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggle(t.name)}
                  className={`${chipBase} ${picked.has(t.name) ? chipOn : chipOff} w-full`}
                >
                  {picked.has(t.name) ? <Check size={13} className="shrink-0" /> : <span className="w-[13px] shrink-0" />}
                  <span className="truncate">{t.name}</span>
                </button>
              ))
            ) : (
              <div className="text-xs text-muted px-2 py-1.5">无匹配标签</div>
            )}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-surface-border">
            <span className="text-[10px] text-muted">已选 {picked.size} 个标签</span>
            <button
              disabled={picked.size === 0}
              onClick={confirmTags}
              className="px-3 py-1 rounded-lg text-xs font-medium text-white bg-accent/80 hover:bg-accent disabled:opacity-40 transition-colors"
            >
              应用到 {selectedIds.length} 个音效
            </button>
          </div>
        </div>
      )}

      {/* 底部快捷操作栏 */}
      <div className="bg-surface-panel border border-surface-border rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-2">
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
          onClick={() => openPicker('add')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-surface-card text-xs text-muted-light hover:text-accent-light transition-colors"
        >
          <Tags size={12} />
          添加标签
        </button>

        <button
          onClick={() => openPicker('remove')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-surface-card text-xs text-muted-light hover:text-red-400 transition-colors"
        >
          <Tags size={12} />
          移除标签
        </button>

        <button
          onClick={handleBatchStar}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-surface-card text-xs text-muted-light hover:text-amber-400 transition-colors"
          title="批量收藏所选音效"
        >
          <Star size={12} />
          收藏
        </button>

        <button
          onClick={handleBatchExport}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-surface-card text-xs text-muted-light hover:text-accent-light transition-colors"
          title="批量导出所选音效到文件夹"
        >
          <Download size={12} />
          导出
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
    </div>
  )
}
