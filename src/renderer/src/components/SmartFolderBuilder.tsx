import { useState, useEffect, useCallback } from 'react'
import type { SmartFolderData, SoundData } from '../../preload/index.d'
import { FolderCog, Plus, Trash2, Save, Play, Search, X, GripVertical, Wand2 } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import toast from 'react-hot-toast'

type ConditionField = 'file_name' | 'description' | 'emotion' | 'use_cases' | 'file_ext' | 'duration_ms' | 'quality_score' | 'is_starred' | 'is_missing' | 'ai_analyzed_at' | 'imported_at' | 'tags'
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
  { value: 'tags', label: '标签/分类' },
  { value: 'file_ext', label: '文件格式' },
  { value: 'duration_ms', label: '时长(ms)' },
  { value: 'quality_score', label: '质量评分' },
  { value: 'is_starred', label: '已收藏' },
  { value: 'is_missing', label: '文件缺失' },
  { value: 'ai_analyzed_at', label: '分析状态' },
  { value: 'imported_at', label: '导入时间(天)' }
]

// 这些字段用专用控件（是/否、已分析/未分析），op 固定为 is
const BOOLEAN_FIELDS = new Set<ConditionField>(['is_starred', 'is_missing'])
const STATUS_FIELDS = new Set<ConditionField>(['ai_analyzed_at'])
const NUMERIC_FIELDS = new Set<ConditionField>(['duration_ms', 'quality_score', 'imported_at'])

function valuePlaceholder(field: ConditionField): string {
  if (field === 'imported_at') return '填天数，如 7'
  if (field === 'duration_ms') return '毫秒，如 1000'
  if (field === 'quality_score') return '1-5，如 7'
  if (field === 'tags') return '标签或分类名，如 环境氛围'
  return '输入值...'
}

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
      toast.error('删除智能文件夹失败，请稍后重试')
    }
  }, [refreshSmartFolders])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-panel">
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
              onClick={() => {
                const next = activeSmartFolderId === sf.id ? null : sf.id
                setActiveSmartFolder(next)
                if (next) useAppStore.getState().refreshSounds()
              }}
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

// 一键智能分类面板：按不同维度自动生成智能文件夹
const CLASSIFY_DIMS = [
  { dim: 'scenario', label: '按适用场景' },
  { dim: 'emotion', label: '按情绪' },
  { dim: 'ai_tags', label: '按AI标签' },
  { dim: 'filename', label: '按文件名' },
  { dim: 'file_ext', label: '按格式' },
  { dim: 'imported', label: '按导入时间' },
  { dim: 'duration', label: '按时长' },
  { dim: 'quality', label: '按质量' }
]

export function SmartClassifyPanel(): JSX.Element {
  const refreshSmartFolders = useAppStore((s) => s.refreshSmartFolders)
  const [busy, setBusy] = useState<string | null>(null)
  // 聚类参数：控制生成的文件夹数量与噪声阈值
  const [maxGroups, setMaxGroups] = useState(8)
  const [minPerGroup, setMinPerGroup] = useState(2)

  const runOne = async (dim: string, label: string): Promise<number> => {
    const res = await window.api.autoClassify(dim, { maxGroups, minPerGroup })
    if (res.created > 0) {
      toast.success(`「${label}」已生成 ${res.created} 个智能文件夹` +
        (res.skipped > 0 ? `（${res.skipped} 个已存在）` : ''))
    } else if (res.skipped > 0) {
      toast(`「${label}」分类已存在，未重复创建`)
    } else {
      toast(`没有可用于「${label}」的音效`)
    }
    return res.created
  }

  const onClassify = async (dim: string, label: string) => {
    if (busy) return
    setBusy(dim)
    try {
      await runOne(dim, label)
      await refreshSmartFolders()
    } catch {
      toast.error('智能分类失败，请检查规则或稍后重试')
    } finally {
      setBusy(null)
    }
  }

  const onClassifyAll = async () => {
    if (busy) return
    setBusy('__all__')
    try {
      let total = 0
      for (const d of CLASSIFY_DIMS) total += await runOne(d.dim, d.label)
      await refreshSmartFolders()
      toast.success(`智能整理完成，共生成 ${total} 个智能文件夹`)
    } catch {
      toast.error('智能分类失败，请检查规则或稍后重试')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="px-2 py-2 border-b border-surface-panel">
      <div className="flex items-center gap-1.5 mb-2">
        <Wand2 size={13} className="text-accent" />
        <span className="text-2xs font-medium text-muted-light">一键智能分类</span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {CLASSIFY_DIMS.map((d) => (
          <button
            key={d.dim}
            disabled={busy !== null}
            onClick={() => onClassify(d.dim, d.label)}
            title={`按「${d.label}」自动生成智能文件夹`}
            className="text-2xs text-muted-light bg-surface-card hover:bg-accent/20 hover:text-accent-light border border-surface-border rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed truncate"
          >
            {busy === d.dim ? '生成中…' : d.label}
          </button>
        ))}
      </div>

      <button
        disabled={busy !== null}
        onClick={onClassifyAll}
        className="mt-1.5 w-full text-2xs font-medium text-white bg-accent/80 hover:bg-accent border border-accent/60 rounded-md px-2 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy === '__all__' ? '整理中…' : '⚡ 一键整理全部维度'}
      </button>

      <div className="flex items-center gap-2 mt-2">
        <label className="flex items-center gap-1 text-[10px] text-muted">
          上限
          <input
            type="number" min={2} max={20} value={maxGroups}
            onChange={(e) => setMaxGroups(Math.max(2, Math.min(20, Number(e.target.value) || 8)))}
            className="w-11 bg-surface-input border border-surface-border rounded px-1 py-0.5 text-[10px] text-muted-light text-center"
          />
          个
        </label>
        <label className="flex items-center gap-1 text-[10px] text-muted">
          忽略&lt;
          <input
            type="number" min={1} max={20} value={minPerGroup}
            onChange={(e) => setMinPerGroup(Math.max(1, Math.min(20, Number(e.target.value) || 2)))}
            className="w-11 bg-surface-input border border-surface-border rounded px-1 py-0.5 text-[10px] text-muted-light text-center"
          />
          个素材
        </label>
      </div>

      <p className="text-[10px] text-muted mt-2 leading-relaxed">
        开放维度（场景/情绪/标签）会先按<strong className="text-muted-light">主题词典</strong>归并成少量「主题文件夹」，
        不再一个值一个夹；固定维度（格式/时间/时长/质量）直接分组。可调整上限与噪声阈值。
      </p>
    </div>
  )
}

interface SmartFolderBuilderDialogProps {
  folder: SmartFolderData | null
  onClose: () => void
}

function SmartFolderBuilderDialog({ folder, onClose }: SmartFolderBuilderDialogProps): JSX.Element {
  const refreshSmartFolders = useAppStore((s) => s.refreshSmartFolders)
  const [previewCount, setPreviewCount] = useState<number | null>(null)

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

  // 实时预览：根据当前规则计算匹配数量（必须在 groups useState 之后）
  useEffect(() => {
    let cancelled = false
    window.api.previewSmartFolder(JSON.stringify(groups))
      .then((rows) => { if (!cancelled) setPreviewCount(Array.isArray(rows) ? rows.length : 0) })
      .catch(() => { if (!cancelled) setPreviewCount(0) })
    return () => { cancelled = true }
  }, [groups])

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
      toast.error('保存失败，请稍后重试')
    }
  }, [name, groups, folder, refreshSmartFolders, onClose])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-panel border border-surface-border rounded-xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-panel">
          <FolderCog size={16} className="text-accent" />
          <input
            className="flex-1 bg-transparent text-sm font-medium text-muted-light outline-none placeholder:text-muted"
            placeholder="智能文件夹名称..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button onClick={handleSave} className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-accent-light flex items-center gap-1">
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
                  const fieldOpt = FIELD_OPTIONS.find((f) => f.value === cond.field) ?? FIELD_OPTIONS[0]
                  const opOpt = OP_OPTIONS.find((o) => o.value === cond.op) ?? OP_OPTIONS[0]
                  return (
                    <div key={cond.id} className="flex items-center gap-1.5">
                      <GripVertical size={10} className="text-muted shrink-0" />
                      <select
                        className="bg-surface-panel border border-surface-border rounded px-1.5 py-1 text-2xs text-muted-light outline-none"
                        value={cond.field}
                        onChange={(e) => {
                          const f = e.target.value as ConditionField
                          const extra = (BOOLEAN_FIELDS.has(f) || STATUS_FIELDS.has(f)) ? { op: 'is' as ConditionOp } : {}
                          updateCondition(group.id, cond.id, { field: f, ...extra })
                        }}
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

                      {BOOLEAN_FIELDS.has(cond.field) || STATUS_FIELDS.has(cond.field) ? (
                        <select
                          className="flex-1 min-w-0 bg-surface-panel border border-surface-border rounded px-2 py-1 text-2xs text-muted-light outline-none focus:border-accent"
                          value={cond.value || (STATUS_FIELDS.has(cond.field) ? 'analyzed' : 'true')}
                          onChange={(e) => updateCondition(group.id, cond.id, { value: e.target.value })}
                        >
                          {STATUS_FIELDS.has(cond.field) ? (
                            <>
                              <option value="analyzed">已分析</option>
                              <option value="unanalyzed">未分析</option>
                            </>
                          ) : (
                            <>
                              <option value="true">是</option>
                              <option value="false">否</option>
                            </>
                          )}
                        </select>
                      ) : (
                        <input
                          className="flex-1 min-w-0 bg-surface-panel border border-surface-border rounded px-2 py-1 text-2xs text-muted-light outline-none focus:border-accent"
                          placeholder={valuePlaceholder(cond.field)}
                          value={cond.value}
                          onChange={(e) => updateCondition(group.id, cond.id, { value: e.target.value })}
                        />
                      )}

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

        <div className="px-4 py-2 border-t border-surface-panel flex items-center gap-3">
          <span className="text-2xs text-muted shrink-0">
            {previewCount === null ? '匹配计算中…' : `当前匹配 ${previewCount} 个音效`}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleSave}
            className="flex-1 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-light"
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
