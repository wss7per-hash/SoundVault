import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { TagData, TagStatData } from '../../preload/index.d'
import {
  Plus, Trash2, Edit3, ChevronRight, ChevronDown, Tags, Hash, Search,
  Eye, ArrowRightLeft, Eraser, X, Check, RefreshCw
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import toast from 'react-hot-toast'
import { PopupMenu, useContextMenu, type MenuItem } from './PopupMenu'

const TAG_COLORS = ['#534AB7', '#E85D75', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4']

interface TagTreeNode extends TagData {
  children: TagTreeNode[]
  count?: number
}

/** 右键菜单目标 */
interface TagContextMenuTarget {
  x: number
  y: number
  tag: TagTreeNode
}

export function TagTree(): JSX.Element {
  const tags = useAppStore((s) => s.tags)
  const tagStats = useAppStore((s) => s.tagStats)
  const selectedTagId = useAppStore((s) => s.selectedTagId)
  const setSelectedTag = useAppStore((s) => s.setSelectedTag)
  const refreshTags = useAppStore((s) => s.refreshTags)
  const refreshTagStats = useAppStore((s) => s.refreshTagStats)
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const setActiveView = useAppStore((s) => s.setActiveView)

  // ---- 搜索 / 新建 / 编辑（原有）----
  const [searchTag, setSearchTag] = useState('')
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // ---- 右键菜单 ----
  const [contextMenu, setContextMenu] = useState<TagContextMenuTarget | null>(null)
  const [mergeMode, setMergeMode] = useState<string | null>(null) // 正在合并的源 tag id

  // ── 标签栏空白处右键菜单 ──
  const tagsMenu = useContextMenu()
  const tagsMenuItems: MenuItem[] = [
    { type: 'item', label: '新建标签', icon: <Plus size={14} />, onClick: () => setShowAddForm(true) },
    { type: 'item', label: '刷新标签', icon: <RefreshCw size={14} />, onClick: () => { void refreshTags(); void refreshTagStats() } }
  ]
  const menuRef = useRef<HTMLDivElement>(null)

  // ---- 多选批量操作 ----
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // ---- 统计空标签数量 ----
  const emptyTagCount = useMemo(
    () => tags.filter((t) => !tagStats.find((s) => s.id === t.id)?.count).length,
    [tags, tagStats]
  )

  // 点击外部关闭右键菜单 & 合并模式
  useEffect(() => {
    if (!contextMenu && !mergeMode) return
    const handler = () => { setContextMenu(null); setMergeMode(null) }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu, mergeMode])

  // ESC 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [contextMenu])

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

  /** 所有标签节点扁平列表（用于 Shift 范围选择） */
  const flatNodes = useMemo(() => {
    const arr: TagTreeNode[] = []
    const walk = (nodes: TagTreeNode[]) => { for (const n of nodes) { arr.push(n); walk(n.children) } }
    walk(tree)
    return arr
  }, [tree])

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

  // ---- 多选逻辑 ----
  const handleTagClick = useCallback((node: TagTreeNode, e: React.MouseEvent) => {
    // 有多选时，点击行为改为多选；无多选时保持原筛选行为
    if (selectedTagIds.size > 0 || e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + 点击：切换单个
      setSelectedTagIds((prev) => {
        const next = new Set(prev)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
      setLastClickedId(node.id)
      return
    }
    if (e.shiftKey && lastClickedId) {
      // Shift + 点击：范围选择
      const startIdx = flatNodes.findIndex((n) => n.id === lastClickedId)
      const endIdx = flatNodes.findIndex((n) => n.id === node.id)
      if (startIdx >= 0 && endIdx >= 0) {
        const range = startIdx <= endIdx ? flatNodes.slice(startIdx, endIdx + 1) : flatNodes.slice(endIdx, startIdx + 1)
        setSelectedTagIds(new Set(range.map((n) => n.id)))
      }
      return
    }
    // 普通点击：筛选
    setSelectedTagIds(new Set())
    setSelectedTag(selectedTagId === node.id ? null : node.id)
    if (node.children.length > 0) toggleExpand(node.id)
  }, [selectedTagId, selectedTagIds, lastClickedId, flatNodes, setSelectedTag, toggleExpand])

  const clearSelection = useCallback(() => setSelectedTagIds(new Set()), [])

  // ---- 删除（单个/批量）----
  const handleDelete = useCallback(async (tag: TagTreeNode) => {
    try {
      await window.api.deleteTag(tag.id)
      toast.success(`已删除标签: ${tag.name}`)
      setSelectedTagIds((prev) => { const n = new Set(prev); n.delete(tag.id); return n })
      await Promise.all([refreshTags(), refreshTagStats(), refreshSounds()])
    } catch {
      toast.error('删除标签失败，请稍后重试')
    }
  }, [refreshTags, refreshTagStats, refreshSounds])

  const handleBatchDelete = useCallback(async () => {
    if (selectedTagIds.size === 0) return
    const names: string[] = []
    for (const id of selectedTagIds) {
      const t = tags.find((t) => t.id === id)
      if (t) names.push(t.name)
    }
    const confirmed = window.confirm(`确定删除选中的 ${selectedTagIds.size} 个标签吗？\n${names.slice(0, 5).join(', ')}${names.length > 5 ? ` 等 ${names.length} 个` : ''}`)
    if (!confirmed) return
    let ok = 0
    for (const id of selectedTagIds) {
      try { await window.api.deleteTag(id); ok++ } catch { /* skip */ }
    }
    toast.success(`已删除 ${ok}/${selectedTagIds.size} 个标签`)
    clearSelection()
    await Promise.all([refreshTags(), refreshTagStats(), refreshSounds()])
  }, [selectedTagIds, tags, clearSelection, refreshTags, refreshTagStats, refreshSounds])

  // ---- 清空所有空标签 ----
  const handleDeleteEmptyTags = useCallback(async () => {
    const emptyIds = tags.filter((t) => !statMap.get(t.id)).map((t) => t.id)
    if (emptyIds.length === 0) { toast.info('没有空标签'); return }
    const confirmed = window.confirm(`确定删除全部 ${emptyIds.length} 个空标签吗？`)
    if (!confirmed) return
    let ok = 0
    for (const id of emptyIds) {
      try { await window.api.deleteTag(id); ok++ } catch { /* skip */ }
    }
    toast.success(`已清理 ${ok} 个空标签`)
    await Promise.all([refreshTags(), refreshTagStats()])
  }, [tags, statMap, refreshTags, refreshTagStats])

  // ---- 重命名 ----
  const handleRename = useCallback(
    async (tagId: string, name: string) => {
      if (!name.trim()) return
      try {
        await window.api.updateTag(tagId, { name: name.trim() })
        setEditingTag(null)
        await refreshTags()
        toast.success('标签已重命名')
      } catch {
        toast.error('重命名失败，该名称可能已被使用')
      }
    },
    [refreshTags]
  )

  // ---- 新建 ----
  const handleAdd = useCallback(async () => {
    if (!newTagName.trim()) return
    try {
      await window.api.addTag(newTagName.trim(), null, newTagColor)
      setNewTagName('')
      setShowAddForm(false)
      await Promise.all([refreshTags(), refreshTagStats()])
      toast.success(`已创建标签: ${newTagName}`)
    } catch {
      toast.error('创建标签失败，请稍后重试')
    }
  }, [newTagName, newTagColor, refreshTags, refreshTagStats])

  // ---- 右键菜单 handlers ----
  const handleContextMenu = useCallback((e: React.MouseEvent, tag: TagTreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, tag })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleCtxViewSounds = useCallback((tag: TagTreeNode) => {
    setSelectedTag(tag.id)
    setActiveView('library')
    closeContextMenu()
  }, [setSelectedTag, setActiveView, closeContextMenu])

  const handleCtxRename = useCallback((tag: TagTreeNode) => {
    setEditingTag(tag.id)
    setEditValue(tag.name)
    closeContextMenu()
  }, [closeContextMenu])

  const handleCtxMerge = useCallback((tag: TagTreeNode) => {
    setMergeMode(tag.id)
    closeContextMenu()
  }, [closeContextMenu])

  const confirmMerge = useCallback(async (targetId: string) => {
    if (!mergeMode || mergeMode === targetId) { setMergeMode(null); return }
    const srcTag = tags.find((t) => t.id === mergeMode)
    const dstTag = tags.find((t) => t.id === targetId)
    if (!srcTag || !dstTag) return

    // 合并前查询真实影响数（后端精确计数，而非前端粗略字符串匹配）
    let affected = 0
    try {
      affected = await window.api.getTagSoundCount(srcTag.id)
    } catch { /* 计数失败时退回 0，仍允许合并 */ }

    const confirmed = window.confirm(
      `将标签「${srcTag.name}」合并到「${dstTag.name}」并删除「${srcTag.name}」？\n\n` +
      `将迁移 ${affected} 个音效到「${dstTag.name}」。\n` +
      `此操作可通过 Ctrl+Z 撤销。`
    )
    if (!confirmed) { setMergeMode(null); return }

    const toastId = toast.loading('正在合并标签...')
    try {
      // 后端单条 SQL 事务完成迁移+删除，返回真实迁移数，并接入撤销栈
      const res = await window.api.mergeTags(srcTag.id, dstTag.id)
      toast.dismiss(toastId)
      if (!res.success) {
        toast.error(res.error || '合并标签失败')
        setMergeMode(null)
        return
      }
      toast.success(`合并完成：${res.migrated} 个音效从「${srcTag.name}」迁移到「${dstTag.name}」（Ctrl+Z 可撤销）`)
      setMergeMode(null)
      await Promise.all([refreshTags(), refreshTagStats(), refreshSounds()])
    } catch {
      toast.dismiss(toastId)
      toast.error('合并标签时出错，请稍后重试')
      setMergeMode(null)
    }
  }, [mergeMode, tags, refreshTags, refreshTagStats, refreshSounds])

  // ---- 渲染 ----
  const renderNode = useCallback(
    (node: TagTreeNode, depth: number) => {
      const hasChildren = node.children.length > 0
      const isExpanded = expandedIds.has(node.id)
      const isEditing = editingTag === node.id
      const isSelected = selectedTagId === node.id
      const isChecked = selectedTagIds.has(node.id)

      return (
        <div key={node.id}>
          <div
            className={`group flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-xs transition-colors ${
              isChecked ? 'bg-accent/30 text-accent-light ring-1 ring-accent/40' :
              isSelected ? 'bg-accent/20 text-accent-light' :
              'text-muted-light hover:bg-surface-card'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={(e) => handleTagClick(node, e)}
            onContextMenu={(e) => handleContextMenu(e, node)}
          >
            {/* 多选勾选框 */}
            {(selectedTagIds.size > 0 || false) && (
              <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${
                isChecked ? 'bg-accent border-accent' : 'border-muted hover:border-muted-light'
              }`}>
                {isChecked && <Check size={8} className="text-white" />}
              </div>
            )}

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
                onChange={(e) => setEditValue(e.value)}
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
    [expandedIds, editingTag, selectedTagId, selectedTagIds, editValue, handleTagClick, handleRename, handleDelete, toggleExpand]
  )

  // ---- 右键菜单位置修正（防溢出） ----
  const ctxLeft = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 200) : 0
  const ctxTop = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 220) : 0

  return (
    <div className="flex flex-col h-full relative select-none" onContextMenu={tagsMenu.open}>
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-panel">
        <div className="flex items-center gap-1.5">
          <Tags size={14} className="text-muted" />
          <span className="text-xs font-medium text-muted-light">标签</span>
          {emptyTagCount > 0 && (
            <button
              onClick={handleDeleteEmptyTags}
              className="ml-auto mr-1 px-1.5 py-0.5 text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              title={`清理 ${emptyTagCount} 个空标签`}
            >
              <Eraser size={10} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="p-1 hover:bg-surface-card rounded text-muted hover:text-accent-light transition-colors"
          title="新建标签"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 新建表单 */}
      {showAddForm && (
        <div className="px-3 py-2 border-b border-surface-panel space-y-2">
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
              className="px-2 py-0.5 bg-accent text-white text-2xs rounded hover:bg-accent-light"
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

      {/* 搜索栏 */}
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 bg-surface-card border border-surface-border rounded px-2 py-1">
          <Search size={12} className="text-muted shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted"
            placeholder="搜索标签..."
            value={searchTag}
            onChange={(e) => setSearchTag(e.value)}
          />
        </div>
      </div>

      {/* 标签列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-1 py-1">
        {filteredTree.length === 0 ? (
          <p className="text-2xs text-muted text-center py-4">
            {tags.length === 0 ? '还没有标签\n导入音效并运行 AI 分析' : '无匹配标签'}
          </p>
        ) : (
          filteredTree.map((node) => renderNode(node, 0))
        )}
      </div>

      {/* ====== 批量操作浮动栏 ====== */}
      {selectedTagIds.size > 0 && (
        <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-panel border border-surface-border shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <span className="text-xs text-muted-light font-medium whitespace-nowrap">
            已选 {selectedTagIds.size} 个标签
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
            title="删除所选标签"
          >
            <Trash2 size={13} />
            删除所选
          </button>
        </div>
      )}

      {/* ====== 右键菜单 ====== */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] w-48 py-1.5 rounded-xl border border-surface-border bg-surface-panel shadow-2xl"
          style={{ left: ctxLeft, top: ctxTop }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleCtxViewSounds(contextMenu.tag)}
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-muted-light hover:bg-surface-card transition-colors"
          >
            <Eye size={14} className="text-muted" />
            <span className="flex-1 text-left">查看关联音效</span>
            <span className="text-[10px] text-muted">{contextMenu.tag.count ?? 0}</span>
          </button>
          <button
            onClick={() => handleCtxRename(contextMenu.tag)}
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-muted-light hover:bg-surface-card transition-colors"
          >
            <Edit3 size={14} className="text-muted" />
            <span className="flex-1 text-left">重命名</span>
          </button>
          <button
            onClick={() => handleCtxMerge(contextMenu.tag)}
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-muted-light hover:bg-surface-card transition-colors"
          >
            <ArrowRightLeft size={14} className="text-muted" />
            <span className="flex-1 text-left">合并到其他标签</span>
          </button>
          <div className="h-px bg-surface-border/60 my-1.5 mx-2" />
          <button
            onClick={() => { handleDelete(contextMenu.tag); closeContextMenu() }}
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} className="text-red-400" />
            <span className="flex-1 text-left">删除</span>
          </button>
        </div>
      )}

      {/* ====== 合并选择器（内联浮层）===== */}
      {mergeMode && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-72 max-h-80 rounded-xl border border-surface-border bg-surface-panel shadow-2xl p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-light">合并到…</span>
              <button
                onClick={() => setMergeMode(null)}
                className="p-0.5 text-muted hover:text-muted-light rounded"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-[11px] text-muted mb-2 leading-relaxed">
              将「<b>{tags.find((t) => t.id === mergeMode)?.name}</b>」的音效转移到目标标签后删除它：
            </p>

            <div className="flex-1 overflow-y-auto space-y-0.5 mb-3">
              {tags
                .filter((t) => t.id !== mergeMode)
                .map((t) => {
                  const cnt = statMap.get(t.id) || 0
                  return (
                    <button
                      key={t.id}
                      onClick={() => confirmMerge(t.id)}
                      className="w-full px-2.5 py-1.5 rounded text-left text-xs text-muted-light hover:bg-surface-card flex items-center gap-2 transition-colors"
                    >
                      <Hash size={10} className="shrink-0 text-muted" />
                      <span className="flex-1 truncate">{t.name}</span>
                      {cnt > 0 && <span className="text-[10px] text-muted">{cnt}</span>}
                    </button>
                  )
                })}
            </div>

            <p className="text-[10px] text-muted/60 text-center pb-1">点击目标标签完成合并</p>
          </div>
        </div>
      )}

      {/* 标签栏空白处右键菜单 */}
      {tagsMenu.pos && (
        <PopupMenu x={tagsMenu.pos.x} y={tagsMenu.pos.y} items={tagsMenuItems} onClose={tagsMenu.close} />
      )}
    </div>
  )
}
