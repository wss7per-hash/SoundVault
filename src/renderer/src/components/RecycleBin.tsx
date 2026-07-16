import { useState, useEffect, useCallback, useMemo } from 'react'
import type { SoundData } from '../../preload/index.d'
import { Trash2, RotateCcw, AlertTriangle, HardDrive } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'
import { PopupMenu, useContextMenu, type MenuItem } from './PopupMenu'

interface ConfirmState {
  open: boolean
  count: number
}

export function RecycleBin(): JSX.Element {
  const [trashSounds, setTrashSounds] = useState<SoundData[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false, count: 0 })
  const [deleteLocalFile, setDeleteLocalFile] = useState(false)

  // 跨组件回收站同步：Sidebar 的「清空/恢复全部」会 bump trashVersion，此处订阅后自动刷新
  const trashVersion = useAppStore((s) => s.trashVersion)
  const bumpTrashVersion = useAppStore((s) => s.bumpTrashVersion)
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const refreshStats = useAppStore((s) => s.refreshStats)

  // ── 空白处右键菜单 ──
  const rbMenu = useContextMenu()

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

  const handleRestoreAllInBin = useCallback(async () => {
    if (trashSounds.length === 0) return
    setLoading(true)
    try {
      await window.api.restoreSounds(trashSounds.map((s) => s.id))
      toast.success(`已恢复 ${trashSounds.length} 个音效`)
      await loadTrash()
      bumpTrashVersion()
      await Promise.all([refreshSounds(), refreshStats()])
    } catch {
      toast.error('恢复失败，文件可能已被永久删除')
    } finally {
      setLoading(false)
    }
  }, [trashSounds, loadTrash, bumpTrashVersion, refreshSounds, refreshStats])

  useEffect(() => {
    loadTrash()
  }, [loadTrash, trashVersion])

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
      // 通知 Sidebar 回收站计数刷新，并把恢复的音效同步回主库
      bumpTrashVersion()
      await Promise.all([refreshSounds(), refreshStats()])
    } catch {
      toast.error('恢复失败，文件可能已被永久删除')
    } finally {
      setLoading(false)
    }
  }

  const handlePermanentDelete = async () => {
    if (selected.size === 0) return
    // 先弹出确认对话框，不直接执行
    setConfirm({ open: true, count: selected.size })
  }

  const confirmPermanentDelete = async () => {
    setConfirm({ open: false, count: 0 })
    setLoading(true)
    try {
      await window.api.permanentDelete(Array.from(selected), deleteLocalFile)
      toast.success(
        `已从库中移除 ${selected.size} 个音效` +
        (deleteLocalFile ? '（本地文件也已删除）' : '（本地文件未受影响）')
      )
      setSelected(new Set())
      await loadTrash()
      // 通知 Sidebar 回收站计数刷新
      bumpTrashVersion()
    } catch {
      toast.error('永久删除失败，文件可能被占用，请关闭占用后重试')
    } finally {
      setLoading(false)
    }
  }

  const cancelConfirm = () => {
    setConfirm({ open: false, count: 0 })
    setDeleteLocalFile(false)
  }

  const formatSize = (bytes: number | null | undefined): string => {
    if (!bytes || bytes < 0) return '0 KB'
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  // 右键菜单项定义（放在所有 handler 之后，确保引用安全）
  const rbMenuItems: MenuItem[] = useMemo(() => [
    { type: 'item', label: '恢复选中', icon: <RotateCcw size={14} />, disabled: selected.size === 0, onClick: handleRestore },
    { type: 'item', label: '恢复全部', icon: <RotateCcw size={14} />, disabled: trashSounds.length === 0, onClick: () => void handleRestoreAllInBin() },
    { type: 'separator' },
    { type: 'item', label: '永久删除选中', icon: <Trash2 size={14} />, danger: true, disabled: selected.size === 0, onClick: handlePermanentDelete }
  ], [selected.size, trashSounds.length, handleRestore, handleRestoreAllInBin, handlePermanentDelete])

  if (trashSounds.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center relative" onContextMenu={rbMenu.open}>
        {/* 确认弹窗（空状态时也需渲染，以防状态残留） */}
        {confirm.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={cancelConfirm}>
            <div
              className="bg-surface-panel border border-surface-border rounded-xl shadow-2xl w-[380px] p-5 mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle size={18} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-fg mb-1">确认永久删除</h3>
                  <p className="text-xs text-muted leading-relaxed">
                    将从 SoundVault 库中<strong className="text-fg">永久移除</strong> {confirm.count} 个音效记录。
                    <br />此操作<span className="font-medium text-fg">不可撤销</span>。
                  </p>

                  <label className="flex items-start gap-2 mt-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={deleteLocalFile}
                      onChange={(e) => setDeleteLocalFile(e.target.checked)}
                      className="mt-0.5 accent-red-500"
                    />
                    <span className="text-xs text-muted group-hover:text-fg transition-colors leading-relaxed">
                      <HardDrive size={11} className="inline mr-1 -mt-0.5" />
                      同时删除本地音频文件（不可恢复）
                    </span>
                  </label>

                  {deleteLocalFile && (
                    <p className="text-[10px] text-red-400/80 mt-1.5 ml-5 leading-relaxed">
                      ⚠ 勾选后，原始音频文件将从磁盘彻底删除，无法通过系统回收站恢复！
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-surface-panel">
                <button
                  onClick={cancelConfirm}
                  className="px-3 py-1.5 text-xs text-muted-light bg-surface-card hover:bg-surface-border border border-surface-border rounded-md transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmPermanentDelete}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {loading ? '删除中…' : '确认永久删除'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="text-center">
          <Trash2 size={32} className="text-muted mx-auto mb-3 opacity-30" />
          <p className="text-sm text-muted">回收站是空的</p>
          <p className="text-2xs text-muted/60 mt-1">删除的音效会保留在此处，可随时恢复或永久移除</p>
        </div>

        {rbMenu.pos && (
          <PopupMenu x={rbMenu.pos.x} y={rbMenu.pos.y} items={rbMenuItems} onClose={rbMenu.close} />
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" onContextMenu={rbMenu.open}>
      {/* 永久删除确认弹窗 */}
      {confirm.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={cancelConfirm}>
          <div
            className="bg-surface-panel border border-surface-border rounded-xl shadow-2xl w-[380px] p-5 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-fg mb-1">确认永久删除</h3>
                <p className="text-xs text-muted leading-relaxed">
                  将从 SoundVault 库中<strong className="text-fg">永久移除</strong> {confirm.count} 个音效记录。
                  <br />此操作<span className="font-medium text-fg">不可撤销</span>。
                </p>

                <label className="flex items-start gap-2 mt-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={deleteLocalFile}
                    onChange={(e) => setDeleteLocalFile(e.target.checked)}
                    className="mt-0.5 accent-red-500"
                  />
                  <span className="text-xs text-muted group-hover:text-fg transition-colors leading-relaxed">
                    <HardDrive size={11} className="inline mr-1 -mt-0.5" />
                    同时删除本地音频文件（不可恢复）
                  </span>
                </label>

                {deleteLocalFile && (
                  <p className="text-[10px] text-red-400/80 mt-1.5 ml-5 leading-relaxed">
                    ⚠ 勾选后，原始音频文件将从磁盘彻底删除，无法通过系统回收站恢复！
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-surface-panel">
              <button
                onClick={cancelConfirm}
                className="px-3 py-1.5 text-xs text-muted-light bg-surface-card hover:bg-surface-border border border-surface-border rounded-md transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmPermanentDelete}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {loading ? '删除中…' : '确认永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-panel">
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
            <tr className="text-muted text-left border-b border-surface-panel">
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
                className={`border-b border-surface-panel hover:bg-surface-card cursor-pointer ${
                  selected.has(s.id) ? 'bg-accent/10' : ''
                }`}
                onClick={() => toggleSelect(s.id)}
              >
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => {}} className="accent-accent" />
                </td>
                <td className="py-1.5 text-muted-light truncate max-w-[300px]">{s.file_name ?? '未命名'}</td>
                <td className="py-1.5 text-muted">{(s.file_ext ?? '').toUpperCase()}</td>
                <td className="py-1.5 text-muted">{formatSize(s.file_size)}</td>
                <td className="py-1.5 text-muted">
                  {s.updated_at ? new Date(s.updated_at).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rbMenu.pos && (
        <PopupMenu x={rbMenu.pos.x} y={rbMenu.pos.y} items={rbMenuItems} onClose={rbMenu.close} />
      )}
    </div>
  )
}
