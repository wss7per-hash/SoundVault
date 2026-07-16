import { useState, useCallback, useMemo } from 'react'
import type { CollectionData } from '../../preload/index.d'
import { Folder, Plus, Trash2, Edit3, Check, X, Star, RefreshCw } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import toast from 'react-hot-toast'
import { PopupMenu, useContextMenu, type MenuItem } from './PopupMenu'
import { useListSelection } from '../hooks/useListSelection'

const COLLECTION_COLORS = ['#534AB7', '#E85D75', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899']

// 虚拟「收藏」项的哨兵 id：它不属于任何真实收藏夹，
// 点击后从 collections 视图里列出所有已星标（is_starred=1）的音效。
const STARRED_ID = '__starred__'

export function CollectionsManager(): JSX.Element {
  const collections = useAppStore((s) => s.collections)
  const activeCollectionId = useAppStore((s) => s.activeCollectionId)
  const setActiveCollection = useAppStore((s) => s.setActiveCollection)
  const refreshCollections = useAppStore((s) => s.refreshCollections)
  const refreshSounds = useAppStore((s) => s.refreshSounds)

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    try {
      await window.api.createCollection(newName.trim(), '')
      setNewName('')
      setShowAdd(false)
      await refreshCollections()
      toast.success(`已创建收藏夹: ${newName}`)
    } catch {
      toast.error('创建收藏夹失败，请稍后重试')
    }
  }, [newName, refreshCollections])

  const handleDelete = useCallback(async (col: CollectionData) => {
    try {
      await window.api.deleteCollection(col.id)
      toast.success(`已删除: ${col.name}`)
      await refreshCollections()
    } catch {
      toast.error('删除收藏夹失败，请稍后重试')
    }
  }, [refreshCollections])

  const handleRename = useCallback(async (id: string) => {
    if (!editName.trim()) return
    try {
      await window.api.updateCollection(id, { name: editName.trim() })
      setEditId(null)
      await refreshCollections()
    } catch {
      toast.error('重命名失败，该名称可能已被使用')
    }
  }, [editName, refreshCollections])

  const handleSelect = useCallback(async (col: CollectionData) => {
    const next = activeCollectionId === col.id ? null : col.id
    setActiveCollection(next)
    // 确保切到收藏夹标签，否则 refreshSounds 会走错分支
    useAppStore.getState().setSidebarTab('collections')
    await refreshSounds()
  }, [activeCollectionId, setActiveCollection, refreshSounds])

  // 虚拟「收藏」项：列出所有已星标音效，但不属于任何真实收藏夹
  const handleSelectStarred = useCallback(async () => {
    const next = activeCollectionId === STARRED_ID ? null : STARRED_ID
    setActiveCollection(next)
    useAppStore.getState().setSidebarTab('collections')
    await refreshSounds()
  }, [activeCollectionId, setActiveCollection, refreshSounds])

  // ── 多选 + 连选（拖拽框选等价）──
  const orderedColIds = useMemo(
    () => [STARRED_ID, ...collections.map((c) => c.id)],
    [collections]
  )
  const { selectedIds: selectedColIds, setSelectedIds, onRowMouseDown, onRowMouseEnter, onRowClick, clear: clearSelection } =
    useListSelection(orderedColIds)

  const handleBatchDelete = useCallback(async () => {
    const realIds = [...selectedColIds].filter((id) => id !== STARRED_ID)
    if (realIds.length === 0) return
    const names: string[] = []
    for (const id of realIds) {
      const c = collections.find((c) => c.id === id)
      if (c) names.push(c.name)
    }
    const confirmed = window.confirm(
      `确定删除选中的 ${realIds.length} 个收藏夹吗？\n${names.slice(0, 5).join(', ')}${names.length > 5 ? ` 等 ${names.length} 个` : ''}`
    )
    if (!confirmed) return
    let ok = 0
    for (const id of realIds) {
      try {
        await window.api.deleteCollection(id)
        ok++
      } catch {
        /* skip */
      }
    }
    toast.success(`已删除 ${ok}/${realIds.length} 个收藏夹`)
    clearSelection()
    await refreshCollections()
  }, [selectedColIds, collections, clearSelection, refreshCollections])

  // ── 收藏夹空白处右键菜单 ──
  const collMenu = useContextMenu()
  const collMenuItems: MenuItem[] = [
    { type: 'item', label: '新建收藏夹', icon: <Plus size={14} />, onClick: () => setShowAdd(true) },
    { type: 'item', label: '刷新收藏夹', icon: <RefreshCw size={14} />, onClick: () => void refreshCollections() }
  ]

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-panel">
        <div className="flex items-center gap-1.5">
          <Folder size={14} className="text-muted" />
          <span className="text-xs font-medium text-muted-light">收藏夹</span>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="p-1 hover:bg-surface-card rounded text-muted hover:text-accent-light transition-colors"
          title="新建收藏夹"
        >
          <Plus size={14} />
        </button>
      </div>

      {showAdd && (
        <div className="px-3 py-2 border-b border-surface-panel space-y-1.5">
          <input
            className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs outline-none focus:border-accent"
            placeholder="收藏夹名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCreate}
              className="px-2 py-0.5 bg-accent text-white text-2xs rounded hover:bg-accent-light"
            >
              创建
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-2 py-0.5 text-2xs text-muted hover:text-muted-light rounded"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-1.5 select-none" onContextMenu={collMenu.open}>
        {/* 虚拟「收藏」项：所有已星标音效，不归属于任何收藏夹 */}
        <div
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
            activeCollectionId === STARRED_ID
              ? 'bg-accent/20 text-accent-light'
              : 'text-amber-400/90 hover:bg-surface-card'
          } ${selectedColIds.has(STARRED_ID) ? 'ring-1 ring-accent/40' : ''}`}
          onMouseDown={(e) => onRowMouseDown(STARRED_ID, e)}
          onMouseEnter={() => onRowMouseEnter(STARRED_ID)}
          onClick={(e) => onRowClick(STARRED_ID, e, handleSelectStarred)}
        >
          {selectedColIds.size > 0 && (
            <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${
              selectedColIds.has(STARRED_ID) ? 'bg-accent border-accent' : 'border-muted hover:border-muted-light'
            }`}>
              {selectedColIds.has(STARRED_ID) && <Check size={8} className="text-white" />}
            </div>
          )}
          <Star size={14} className={activeCollectionId === STARRED_ID ? 'fill-amber-400' : ''} />
          <span className="flex-1 truncate">收藏</span>
        </div>

        {collections.length > 0 && <div className="h-px bg-surface-panel my-1.5" />}

        {collections.length === 0 ? (
          <p className="text-2xs text-muted text-center py-4">暂无收藏夹</p>
        ) : (
          collections.map((col) => (
            <div
              key={col.id}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
                activeCollectionId === col.id
                  ? 'bg-accent/20 text-accent-light'
                  : 'text-muted-light hover:bg-surface-card'
              } ${selectedColIds.has(col.id) ? 'ring-1 ring-accent/40' : ''}`}
              onMouseDown={(e) => { if (editId === col.id) return; onRowMouseDown(col.id, e) }}
              onMouseEnter={() => { if (editId === col.id) return; onRowMouseEnter(col.id) }}
              onClick={(e) => { if (editId === col.id) return; onRowClick(col.id, e, () => handleSelect(col)) }}
            >
              {editId === col.id ? (
                <>
                  <input
                    className="flex-1 bg-surface-card border border-accent rounded px-1 py-0 text-xs outline-none min-w-0"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(col.id)
                      if (e.key === 'Escape') setEditId(null)
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button onClick={(e) => { e.stopPropagation(); handleRename(col.id) }}><Check size={10} /></button>
                  <button onClick={(e) => { e.stopPropagation(); setEditId(null) }}><X size={10} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate">{col.name}</span>
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      className="p-0.5 hover:text-accent-light rounded"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditId(col.id)
                        setEditName(col.name)
                      }}
                      title="重命名"
                    >
                      <Edit3 size={10} />
                    </button>
                    <button
                      className="p-0.5 hover:text-red-400 rounded"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(col)
                      }}
                      title="删除"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* ====== 批量操作浮动栏 ====== */}
      {selectedColIds.size > 0 && (
        <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-panel border border-surface-border shadow-xl">
          <span className="text-xs text-muted-light font-medium whitespace-nowrap">
            已选 {selectedColIds.size} 个收藏夹
          </span>
          <div className="flex-1" />
          <button
            onClick={clearSelection}
            className="p-1 text-muted hover:text-muted-light hover:bg-surface-hover rounded transition-colors"
            title="取消选择"
          >
            <X size={14} />
          </button>
          <button
            onClick={handleBatchDelete}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors"
            title="删除所选收藏夹"
          >
            <Trash2 size={13} />
            删除所选
          </button>
        </div>
      )}

      {collMenu.pos && (
        <PopupMenu x={collMenu.pos.x} y={collMenu.pos.y} items={collMenuItems} onClose={collMenu.close} />
      )}
    </div>
  )
}
