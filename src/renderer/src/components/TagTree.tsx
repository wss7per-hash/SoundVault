import { useState, useCallback, useMemo } from 'react'
import type { TagData, TagStatData } from '../../preload/index.d'
import { Plus, Trash2, Edit3, ChevronRight, ChevronDown, Tags, Hash, Search } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import toast from 'react-hot-toast'

const TAG_COLORS = ['#534AB7', '#E85D75', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4']

interface TagTreeNode extends TagData {
  children: TagTreeNode[]
  count?: number
}

export function TagTree(): JSX.Element {
  const tags = useAppStore((s) => s.tags)
  const tagStats = useAppStore((s) => s.tagStats)
  const selectedTagId = useAppStore((s) => s.selectedTagId)
  const setSelectedTag = useAppStore((s) => s.setSelectedTag)
  const refreshTags = useAppStore((s) => s.refreshTags)
  const refreshTagStats = useAppStore((s) => s.refreshTagStats)
  const refreshSounds = useAppStore((s) => s.refreshSounds)

  const [searchTag, setSearchTag] = useState('')
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const statMap = useMemo(() => {
    const m = new Map<string, number>()
    tagStats.forEach((s) => m.set(s.id, s.count))
    return m
  }, [tagStats])

  const tree = useMemo(() => {
    const map = new Map<string, TagTreeNode>()
    const roots: TagTreeNode[] = []

    for (const t of tags) {
      map.set(t.id, { ...t, children: [], count: statMap.get(t.id) || 0 })
    }

    for (const t of tags) {
      const node = map.get(t.id)!
      if (t.parent_id && map.has(t.parent_id)) {
        map.get(t.parent_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return roots
  }, [tags, statMap])

  const filteredTree = useMemo(() => {
    if (!searchTag.trim()) return tree
    const q = searchTag.toLowerCase()
    const filter = (nodes: TagTreeNode[]): TagTreeNode[] =>
      nodes
        .filter((n) => n.name.toLowerCase().includes(q) || n.children.some((c) => c.name.toLowerCase().includes(q)))
        .map((n) => ({ ...n, children: filter(n.children) }))
    return filter(tree)
  }, [tree, searchTag])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleDelete = useCallback(async (tag: TagTreeNode) => {
    try {
      await window.api.deleteTag(tag.id)
      toast.success(`已删除标签: ${tag.name}`)
      await Promise.all([refreshTags(), refreshTagStats(), refreshSounds()])
    } catch {
      toast.error('删除失败')
    }
  }, [refreshTags, refreshTagStats, refreshSounds])

  const handleRename = useCallback(
    async (tagId: string, name: string) => {
      if (!name.trim()) return
      try {
        await window.api.updateTag(tagId, { name: name.trim() })
        setEditingTag(null)
        await refreshTags()
        toast.success('标签已重命名')
      } catch {
        toast.error('重命名失败')
      }
    },
    [refreshTags]
  )

  const handleAdd = useCallback(async () => {
    if (!newTagName.trim()) return
    try {
      await window.api.addTag(newTagName.trim(), null, newTagColor)
      setNewTagName('')
      setShowAddForm(false)
      await Promise.all([refreshTags(), refreshTagStats()])
      toast.success(`已创建标签: ${newTagName}`)
    } catch {
      toast.error('创建失败')
    }
  }, [newTagName, newTagColor, refreshTags, refreshTagStats])

  const renderNode = useCallback(
    (node: TagTreeNode, depth: number) => {
      const hasChildren = node.children.length > 0
      const isExpanded = expandedIds.has(node.id)
      const isEditing = editingTag === node.id
      const isSelected = selectedTagId === node.id

      return (
        <div key={node.id}>
          <div
            className={`group flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-xs transition-colors ${
              isSelected ? 'bg-accent/20 text-accent-light' : 'text-muted-light hover:bg-surface-card'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => {
              setSelectedTag(isSelected ? null : node.id)
              if (hasChildren) toggleExpand(node.id)
            }}
          >
            {hasChildren ? (
              <button
                className="w-4 h-4 flex items-center justify-center shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpand(node.id)
                }}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : (
              <Hash size={10} className="shrink-0 ml-0.5 text-muted" />
            )}

            {isEditing ? (
              <input
                className="flex-1 bg-surface-card border border-accent rounded px-1 py-0 text-xs outline-none min-w-0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => handleRename(node.id, editValue)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(node.id, editValue)
                  if (e.key === 'Escape') setEditingTag(null)
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 truncate select-none">{node.name}</span>
            )}

            {typeof node.count === 'number' && node.count > 0 && (
              <span className="text-2xs text-muted shrink-0">{node.count}</span>
            )}

            {!isEditing && (
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                  className="p-0.5 hover:text-accent-light rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingTag(node.id)
                    setEditValue(node.name)
                  }}
                  title="重命名"
                >
                  <Edit3 size={10} />
                </button>
                <button
                  className="p-0.5 hover:text-red-400 rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(node)
                  }}
                  title="删除"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            )}
          </div>

          {hasChildren && isExpanded && (
            <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      )
    },
    [expandedIds, editingTag, selectedTagId, editValue, setSelectedTag, handleRename, handleDelete, toggleExpand]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a28]">
        <div className="flex items-center gap-1.5">
          <Tags size={14} className="text-muted" />
          <span className="text-xs font-medium text-muted-light">标签</span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="p-1 hover:bg-surface-card rounded text-muted hover:text-accent-light transition-colors"
          title="新建标签"
        >
          <Plus size={14} />
        </button>
      </div>

      {showAddForm && (
        <div className="px-3 py-2 border-b border-[#2a2a28] space-y-2">
          <input
            className="w-full bg-surface-card border border-surface-border rounded px-2 py-1 text-xs outline-none focus:border-accent"
            placeholder="标签名"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            autoFocus
          />
          <div className="flex items-center gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  newTagColor === c ? 'border-white scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
                onClick={() => setNewTagColor(c)}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleAdd}
              className="px-2 py-0.5 bg-accent text-white text-2xs rounded hover:bg-[#6B5ED4]"
            >
              创建
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-2 py-0.5 text-2xs text-muted hover:text-muted-light rounded"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 bg-surface-card border border-surface-border rounded px-2 py-1">
          <Search size={12} className="text-muted shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted"
            placeholder="搜索标签..."
            value={searchTag}
            onChange={(e) => setSearchTag(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1">
        {filteredTree.length === 0 ? (
          <p className="text-2xs text-muted text-center py-4">
            {tags.length === 0 ? '还没有标签\n导入音效并运行 AI 分析' : '无匹配标签'}
          </p>
        ) : (
          filteredTree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  )
}
