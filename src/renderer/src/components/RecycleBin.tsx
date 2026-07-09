import { useState, useEffect, useCallback } from 'react'
import type { SoundData } from '../../preload/index.d'
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

export function RecycleBin(): JSX.Element {
  const [trashSounds, setTrashSounds] = useState<SoundData[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const loadTrash = useCallback(async () => {
    try {
      const sounds = await window.api.getTrash()
      setTrashSounds(sounds)
      setSelected(new Set())
    } catch {
      // recycle bin may not be initialized yet
      setTrashSounds([])
    }
  }, [])

  useEffect(() => {
    loadTrash()
  }, [loadTrash])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === trashSounds.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(trashSounds.map((s) => s.id)))
    }
  }

  const handleRestore = async () => {
    if (selected.size === 0) return
    setLoading(true)
    try {
      await window.api.restoreSounds(Array.from(selected))
      toast.success(`已恢复 ${selected.size} 个音效`)
      await loadTrash()
    } catch {
      toast.error('恢复失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePermanentDelete = async () => {
    if (selected.size === 0) return
    setLoading(true)
    try {
      await window.api.permanentDelete(Array.from(selected))
      toast.success(`已永久删除 ${selected.size} 个音效`)
      await loadTrash()
    } catch {
      toast.error('删除失败')
    } finally {
      setLoading(false)
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  if (trashSounds.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Trash2 size={32} className="text-muted mx-auto mb-3 opacity-30" />
          <p className="text-sm text-muted">回收站是空的</p>
          <p className="text-2xs text-muted/60 mt-1">删除的音效会在回收站保留 30 天</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2a2a28]">
        <div className="flex items-center gap-1.5 text-xs text-muted-light">
          <Trash2 size={14} className="text-red-400" />
          <span>回收站</span>
          <span className="text-muted">({trashSounds.length})</span>
        </div>

        <div className="flex-1" />

        {selected.size > 0 && (
          <>
            <button
              onClick={handleRestore}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1 bg-accent/20 text-accent-light text-xs rounded hover:bg-accent/30 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={12} />恢复 ({selected.size})
            </button>
            <button
              onClick={handlePermanentDelete}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1 bg-red-500/10 text-red-400 text-xs rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <AlertTriangle size={12} />永久删除 ({selected.size})
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-panel">
            <tr className="text-muted text-left border-b border-[#2a2a28]">
              <th className="w-8 px-3 py-1.5">
                <input type="checkbox" checked={selected.size === trashSounds.length && trashSounds.length > 0} onChange={selectAll} className="accent-accent" />
              </th>
              <th className="py-1.5 font-normal">文件名</th>
              <th className="py-1.5 font-normal">格式</th>
              <th className="py-1.5 font-normal">大小</th>
              <th className="py-1.5 font-normal">删除时间</th>
            </tr>
          </thead>
          <tbody>
            {trashSounds.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-[#1d1d1b] hover:bg-surface-card cursor-pointer ${
                  selected.has(s.id) ? 'bg-accent/10' : ''
                }`}
                onClick={() => toggleSelect(s.id)}
              >
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => {}} className="accent-accent" />
                </td>
                <td className="py-1.5 text-muted-light truncate max-w-[300px]">{s.file_name}</td>
                <td className="py-1.5 text-muted">{s.file_ext.toUpperCase()}</td>
                <td className="py-1.5 text-muted">{formatSize(s.file_size)}</td>
                <td className="py-1.5 text-muted">
                  {new Date(s.updated_at).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
