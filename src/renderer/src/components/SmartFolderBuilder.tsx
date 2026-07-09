import { useState, useEffect, useCallback } from 'react'
import type { SmartFolderData, SoundData } from '../../preload/index.d'
import { FolderCog, Plus, Trash2, Save, Play, Search, X, GripVertical } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import toast from 'react-hot-toast'

type ConditionField = 'file_name' | 'description' | 'emotion' | 'use_cases' | 'file_ext' | 'duration_ms'
type ConditionOp = 'contains' | 'not_contains' | 'equals' | 'starts_with' | 'gt' | 'lt' | 'is'

interface Condition {
  id: string
  field: ConditionField
  op: ConditionOp
  value: string
}

interface ConditionGroup {
  id: string
  logic: 'AND' | 'OR'
  conditions: Condition[]
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9)
}

const FIELD_OPTIONS: { value: ConditionField; label: string }[] = [
  { value: 'file_name', label: '文件名' },
  { value: 'description', label: 'AI描述' },
  { value: 'emotion', label: '情绪' },
  { value: 'use_cases', label: '适用场景' },
  { value: 'file_ext', label: '文件格式' },
  { value: 'duration_ms', label: '时长(ms)' }
]

const OP_OPTIONS: { value: ConditionOp; label: string; needsValue: boolean }[] = [
  { value: 'contains', label: '包含', needsValue: true },
  { value: 'not_contains', label: '不含', needsValue: true },
  { value: 'equals', label: '等于', needsValue: true },
  { value: 'starts_with', label: '开头是', needsValue: true },
  { value: 'gt', label: '大于', needsValue: true },
  { value: 'lt', label: '小于', needsValue: true },
  { value: 'is', label: '是', needsValue: false }
]

export function SmartFolderList(): JSX.Element {
  const smartFolders = useAppStore((s) => s.smartFolders)
  const setActiveSmartFolder = useAppStore((s) => s.setActiveSmartFolder)
  const activeSmartFolderId = useAppStore((s) => s.activeSmartFolderId)
  const refreshSmartFolders = useAppStore((s) => s.refreshSmartFolders)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editFolder, setEditFolder] = useState<SmartFolderData | null>(null)

  const handleDelete = useCallback(async (id: string, name: string) => {
    try {
      await window.api.deleteSmartFolder(id)
      toast.success(`已删除: ${name}`)
      await refreshSmartFolders()
    } catch {
      toast.error('删除失败')
    }
  }, [refreshSmartFolders])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a28]">
        <div className="flex items-center gap-1.5">
          <FolderCog size={14} className="text-muted" />
          <span className="text-xs font-medium text-muted-light">智能文件夹</span>
        </div>
        <button
          onClick={() => {
            setEditFolder(null)
            setShowBuilder(true)
          }}
          className="p-1 hover:bg-surface-card rounded text-muted hover:text-accent-light transition-colors"
          title="新建智能文件夹"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {smartFolders.length === 0 ? (
          <p className="text-2xs text-muted text-center py-4">暂无智能文件夹</p>
        ) : (
          smartFolders.map((sf) => (
            <div
              key={sf.id}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
                activeSmartFolderId === sf.id ? 'bg-accent/20 text-accent-light' : 'text-muted-light hover:bg-surface-card'
              }`}
              onClick={() => setActiveSmartFolder(activeSmartFolderId === sf.id ? null : sf.id)}
            >
              <span className="flex-1 truncate">{sf.name}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                  className="p-0.5 hover:text-accent-light rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditFolder(sf)
                    setShowBuilder(true)
                  }}
                  title="编辑"
                >
                  <Play size={10} />
                </button>
                <button
                  className="p-0.5 hover:text-red-400 rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(sf.id, sf.name)
                  }}
                  title="删除"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showBuilder && (
        <SmartFolderBuilderDialog
          folder={editFolder}
          onClose={() => {
            setShowBuilder(false)
            setEditFolder(null)
          }}
        />
      )}
    </div>
  )
}

interface SmartFolderBuilderDialogProps {
  folder: SmartFolderData | null
  onClose: () => void
}

function SmartFolderBuilderDialog({ folder, onClose }: SmartFolderBuilderDialogProps): JSX.Element {
  const refreshSmartFolders = useAppStore((s) => s.refreshSmartFolders)

  const [name, setName] = useState(folder?.name || '')
  const [groups, setGroups] = useState<ConditionGroup[]>(() => {
    if (folder?.conditions) {
      try {
        return JSON.parse(folder.conditions)
      } catch {
        return [{ id: generateId(), logic: 'AND', conditions: [createEmptyCondition()] }]
      }
    }
    return [{ id: generateId(), logic: 'AND', conditions: [createEmptyCondition()] }]
  })

  function createEmptyCondition(): Condition {
    return { id: generateId(), field: 'file_name', op: 'contains', value: '' }
  }

  const addCondition = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, conditions: [...g.conditions, createEmptyCondition()] } : g))
    )
  }

  const removeCondition = (groupId: string, conditionId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, conditions: g.conditions.filter((c) => c.id !== conditionId) }
          : g
      ).filter((g) => g.conditions.length > 0)
    )
  }

  const updateCondition = (groupId: string, conditionId: string, updates: Partial<Condition>) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              conditions: g.conditions.map((c) =>
                c.id === conditionId ? { ...c, ...updates } : c
              )
            }
          : g
      )
    )
  }

  const toggleGroupLogic = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, logic: g.logic === 'AND' ? 'OR' : 'AND' } : g
      )
    )
  }

  const addGroup = () => {
    setGroups((prev) => [...prev, { id: generateId(), logic: 'AND', conditions: [createEmptyCondition()] }])
  }

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error('请输入文件夹名称')
      return
    }
    try {
      const conditions = JSON.stringify(groups)
      await window.api.saveSmartFolder({
        id: folder?.id,
        name: name.trim(),
        conditions
      })
      toast.success(folder ? '已更新' : '已创建')
      await refreshSmartFolders()
      onClose()
    } catch {
      toast.error('保存失败')
    }
  }, [name, groups, folder, refreshSmartFolders, onClose])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-panel border border-surface-border rounded-xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2a28]">
          <FolderCog size={16} className="text-accent" />
          <input
            className="flex-1 bg-transparent text-sm font-medium text-muted-light outline-none placeholder:text-muted"
            placeholder="智能文件夹名称..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button onClick={handleSave} className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-[#6B5ED4] flex items-center gap-1">
            <Save size={12} />保存
          </button>
          <button onClick={onClose} className="p-1 hover:text-accent-light rounded text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {groups.map((group, gi) => (
            <div key={group.id} className="bg-surface-card rounded-lg border border-surface-border p-3">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => toggleGroupLogic(group.id)}
                  className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${
                    group.logic === 'AND'
                      ? 'bg-accent/20 text-accent-light'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {group.logic === 'AND' ? 'AND · 全部满足' : 'OR · 任一满足'}
                </button>
                {groups.length > 1 && (
                  <button
                    onClick={() => setGroups((prev) => prev.filter((g) => g.id !== group.id))}
                    className="text-muted hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {group.conditions.map((cond) => {
                  const fieldOpt = FIELD_OPTIONS.find((f) => f.value === cond.field)!
                  const opOpt = OP_OPTIONS.find((o) => o.value === cond.op)!
                  return (
                    <div key={cond.id} className="flex items-center gap-1.5">
                      <GripVertical size={10} className="text-muted shrink-0" />
                      <select
                        className="bg-surface-panel border border-surface-border rounded px-1.5 py-1 text-2xs text-muted-light outline-none"
                        value={cond.field}
                        onChange={(e) => updateCondition(group.id, cond.id, { field: e.target.value as ConditionField })}
                      >
                        {FIELD_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>

                      <select
                        className="bg-surface-panel border border-surface-border rounded px-1.5 py-1 text-2xs text-muted-light outline-none"
                        value={cond.op}
                        onChange={(e) => updateCondition(group.id, cond.id, { op: e.target.value as ConditionOp })}
                      >
                        {OP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>

                      <input
                        className="flex-1 min-w-0 bg-surface-panel border border-surface-border rounded px-2 py-1 text-2xs text-muted-light outline-none focus:border-accent"
                        placeholder={opOpt.needsValue ? '输入值...' : '无需输入'}
                        value={cond.value}
                        onChange={(e) => updateCondition(group.id, cond.id, { value: e.target.value })}
                        disabled={!opOpt.needsValue}
                      />

                      <button
                        onClick={() => removeCondition(group.id, cond.id)}
                        className="p-0.5 text-muted hover:text-red-400 shrink-0"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )
                })}

                <button
                  onClick={() => addCondition(group.id)}
                  className="flex items-center gap-1 text-2xs text-muted hover:text-accent-light transition-colors px-1.5"
                >
                  <Plus size={10} />添加条件
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={addGroup}
            className="w-full py-2 border border-dashed border-surface-border rounded-lg text-2xs text-muted hover:text-accent-light hover:border-accent/30 transition-colors flex items-center justify-center gap-1"
          >
            <Plus size={12} />添加条件组（上一组 AND 新一组）
          </button>
        </div>

        <div className="px-4 py-2 border-t border-[#2a2a28] flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 py-1.5 bg-accent text-white text-xs rounded hover:bg-[#6B5ED4]"
          >
            保存并应用
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-muted hover:text-muted-light rounded"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
