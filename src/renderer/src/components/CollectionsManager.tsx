import { useState, useCallback } from 'react'
import type { CollectionData } from '../../preload/index.d'
import { Folder, Plus, Trash2, Edit3, Check, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import toast from 'react-hot-toast'

const COLLECTION_COLORS = ['#534AB7', '#E85D75', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899']

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
      toast.success(`已创建合集: ${newName}`)
    } catch {
      toast.error('创建失败')
    }
  }, [newName, refreshCollections])

  const handleDelete = useCallback(async (col: CollectionData) => {
    try {
      await window.api.deleteCollection(col.id)
      toast.success(`已删除: ${col.name}`)
      await refreshCollections()
    } catch {
      toast.error('删除失败')
    }
  }, [refreshCollections])

  const handleRename = useCallback(async (id: string) => {
    if (!editName.trim()) return
    try {
      await window.api.updateCollection(id, { name: editName.trim() })
      setEditId(null)
      await refreshCollections()
    } catch {
      toast.error('重命名失败')
    }
  }, [editName, refreshCollections])

  const handleSelect = useCallback(async (col: CollectionData) => {
    if (activeCollectionId === col.id) {
      setActiveCollection(null)
      await refreshSounds()
      return
    }
    setActiveCollection(col.id)
    try {
      const sounds = await window.api.getCollectionSounds(col.id)
      useAppStore.getState().setSounds(sounds)
    } catch {
      // fallback
    }
  }, [activeCollectionId, setActiveCollection, refreshSounds])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a28]">
        <div className="flex items-center gap-1.5">
          <Folder size={14} className="text-muted" />
          <span className="text-xs font-medium text-muted-light">合集</span>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="p-1 hover:bg-surface-card rounded text-muted hover:text-accent-light transition-colors"
          title="新建合集"
        >
          <Plus size={14} />
        </button>
      </div>

      {showAdd && (
        <div className="px-3 py-2 border-b border-[#2a2a28] space-y-1.5">
          <input
            className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs outline-none focus:border-accent"
            placeholder="合集名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCreate}
              className="px-2 py-0.5 bg-accent text-white text-2xs rounded hover:bg-[#6B5ED4]"
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

      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {collections.length === 0 ? (
          <p className="text-2xs text-muted text-center py-4">暂无合集</p>
        ) : (
          collections.map((col) => (
            <div
              key={col.id}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
                activeCollectionId === col.id
                  ? 'bg-accent/20 text-accent-light'
                  : 'text-muted-light hover:bg-surface-card'
              }`}
              onClick={() => handleSelect(col)}
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
    </div>
  )
}
