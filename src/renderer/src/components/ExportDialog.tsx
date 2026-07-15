import { useEffect, useMemo, useState } from 'react'
import { Download, ListChecks, Search, Check, X, ArrowLeft, FolderSync, Tag, Star, Layers } from 'lucide-react'
import type { SoundData, TagData, CollectionData, SmartFolderData } from '../../preload/index.d'

interface ExportDialogProps {
  sounds: SoundData[]
  tags: TagData[]
  collections: CollectionData[]
  smartFolders: SmartFolderData[]
  onClose: () => void
  /** ids = null → 全部导出；ids = string[] → 仅导出这些 */
  onExport: (ids: string[] | null) => void
}

type CustomTab = 'manual' | 'smartfolder' | 'tag' | 'collection'

function splitTags(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map((t) => t.trim()).filter(Boolean)
}

export function ExportDialog({ sounds, tags, collections, smartFolders, onClose, onExport }: ExportDialogProps): JSX.Element {
  const [mode, setMode] = useState<'choice' | 'custom'>('choice')
  const [tab, setTab] = useState<CustomTab>('manual')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  // 收藏夹 → 音效 id 列表（懒加载）
  const [collectionSounds, setCollectionSounds] = useState<Record<string, string[]>>({})
  const [collectionLoading, setCollectionLoading] = useState(false)

  // 智能文件夹 → 音效 id 列表（懒加载）
  const [sfSounds, setSfSounds] = useState<Record<string, string[]>>({})
  const [sfLoading, setSfLoading] = useState(false)

  // 标签分组（按音效自带的 tags 字段）
  const tagGroups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const s of sounds) {
      for (const t of splitTags(s.tags)) {
        if (!map.has(t)) map.set(t, [])
        map.get(t)!.push(s.id)
      }
    }
    const colorOf = new Map(tags.map((t) => [t.name, t.color]))
    return Array.from(map.entries())
      .map(([name, ids]) => ({ name, ids, color: colorOf.get(name) || null }))
      .sort((a, b) => b.ids.length - a.ids.length)
  }, [sounds, tags])

  // 进入收藏夹 tab 时拉取
  useEffect(() => {
    if (mode !== 'custom' || tab !== 'collection') return
    let cancelled = false
    setCollectionLoading(true)
    ;(async () => {
      const next: Record<string, string[]> = {}
      for (const col of collections) {
        try {
          const list = await window.api.getCollectionSounds(col.id)
          if (!cancelled) next[col.id] = list.map((s) => s.id)
        } catch {
          if (!cancelled) next[col.id] = []
        }
      }
      if (!cancelled) {
        setCollectionSounds(next)
        setCollectionLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [mode, tab, collections])

  // 进入智能文件夹 tab 时拉取
  useEffect(() => {
    if (mode !== 'custom' || tab !== 'smartfolder') return
    let cancelled = false
    setSfLoading(true)
    ;(async () => {
      const next: Record<string, string[]> = {}
      for (const sf of smartFolders) {
        try {
          const list = await window.api.getSmartFolderSounds(sf.id)
          if (!cancelled) next[sf.id] = list.map((s) => s.id)
        } catch {
          if (!cancelled) next[sf.id] = []
        }
      }
      if (!cancelled) {
        setSfSounds(next)
        setSfLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [mode, tab, smartFolders])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sounds
    return sounds.filter((s) => (s.file_name || '').toLowerCase().includes(q))
  }, [sounds, search])

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (ids: string[]) => {
    setChecked((prev) => {
      const next = new Set(prev)
      const allOn = ids.every((id) => next.has(id))
      if (allOn) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  const toggleAll = () => {
    setChecked((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((s) => s.id))
    )
  }

  const startExport = (ids: string[] | null) => {
    onExport(ids)
    onClose()
  }

  const TABS: Array<{ key: CustomTab; label: string; icon: typeof Folder }> = [
    { key: 'manual', label: '手动', icon: Layers },
    { key: 'smartfolder', label: '智能文件夹', icon: FolderSync },
    { key: 'tag', label: '标签', icon: Tag },
    { key: 'collection', label: '收藏夹', icon: Star },
  ]

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-[460px] max-h-[84vh] bg-surface-panel border border-surface-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-border/60 shrink-0">
          {mode === 'custom' ? (
            <button
              onClick={() => setMode('choice')}
              className="text-muted hover:text-muted-light transition-colors"
              title="返回"
            >
              <ArrowLeft size={16} />
            </button>
          ) : (
            <Download size={18} className="text-accent-light shrink-0" />
          )}
          <h3 className="text-sm font-semibold text-fg flex-1">
            {mode === 'custom' ? '自定义导出' : '导出音效库'}
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-muted-light transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {mode === 'choice' ? (
          <div className="p-4 flex flex-col gap-3">
            <p className="text-xs text-muted mb-1">选择要导出的范围：</p>
            <button
              onClick={() => startExport(null)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border transition-colors text-left"
            >
              <Download size={18} className="text-accent-light shrink-0" />
              <div className="flex-1">
                <div className="text-sm text-fg font-medium">全部导出</div>
                <div className="text-[11px] text-muted mt-0.5">
                  导出整个资源库（{sounds.length} 个音效）
                </div>
              </div>
            </button>
            <button
              onClick={() => setMode('custom')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border transition-colors text-left"
            >
              <ListChecks size={18} className="text-accent-light shrink-0" />
              <div className="flex-1">
                <div className="text-sm text-fg font-medium">自定义导出</div>
                <div className="text-[11px] text-muted mt-0.5">按智能文件夹 / 标签 / 收藏夹筛选或手动勾选</div>
              </div>
            </button>
          </div>
        ) : (
          <div className="flex flex-col min-h-0 flex-1">
            {/* Tabs */}
            <div className="flex items-center gap-1 px-3 pt-2 border-b border-surface-border/40 shrink-0">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-lg border-b-2 transition-colors ${
                    tab === t.key
                      ? 'border-accent text-accent-light'
                      : 'border-transparent text-muted hover:text-muted-light'
                  }`}
                >
                  <t.icon size={13} />
                  {t.label}
                </button>
              ))}
            </div>

            {/* 手动：搜索 + 列表 */}
            {tab === 'manual' && (
              <>
                <div className="px-4 pt-3 pb-2 shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-card border border-surface-border">
                    <Search size={14} className="text-muted shrink-0" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="搜索音效文件名…"
                      className="flex-1 bg-transparent text-sm text-muted-light placeholder:text-muted outline-none min-w-0"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between px-5 py-2 border-b border-surface-border/40 shrink-0">
                  <button
                    onClick={toggleAll}
                    className="flex items-center gap-2 text-xs text-muted-light hover:text-fg transition-colors"
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked.size ? 'bg-accent border-accent' : 'border-surface-border'}`}>
                      {checked.size ? <Check size={12} className="text-white" /> : null}
                    </span>
                    全选（当前 {filtered.length}）
                  </button>
                  <span className="text-[11px] text-muted">已选 {checked.size} 个</span>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0 max-h-[40vh]">
                  {filtered.length === 0 ? (
                    <div className="text-center text-xs text-muted py-8">没有匹配的音效</div>
                  ) : (
                    filtered.map((s) => {
                      const isOn = checked.has(s.id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => toggle(s.id)}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-hover transition-colors text-left"
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isOn ? 'bg-accent border-accent' : 'border-surface-border'}`}>
                            {isOn ? <Check size={12} className="text-white" /> : null}
                          </span>
                          <span className="flex-1 text-xs text-muted-light truncate" title={s.file_name}>
                            {s.file_name}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </>
            )}

            {/* 智能文件夹 / 标签 / 收藏夹：分组快速选择 */}
            {tab !== 'manual' && (
              <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0 max-h-[44vh]">
                {tab === 'smartfolder' &&
                  (sfLoading ? (
                    <div className="text-center text-xs text-muted py-8">加载智能文件夹…</div>
                  ) : smartFolders.length === 0 ? (
                    <div className="text-center text-xs text-muted py-8">还没有智能文件夹</div>
                  ) : (
                    smartFolders.map((sf) => {
                      const ids = sfSounds[sf.id] || []
                      const allOn = ids.length > 0 && ids.every((id) => checked.has(id))
                      const someOn = ids.some((id) => checked.has(id))
                      return (
                        <button
                          key={sf.id}
                          onClick={() => toggleGroup(ids)}
                          className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-hover transition-colors text-left mb-0.5 ${someOn ? 'bg-accent/10' : ''}`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${allOn ? 'bg-accent border-accent' : someOn ? 'bg-accent/40 border-accent' : 'border-surface-border'}`}>
                            {allOn ? <Check size={12} className="text-white" /> : null}
                          </span>
                          <FolderSync size={14} className="text-accent-light shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs text-muted-light truncate">{sf.name}</span>
                          </span>
                          <span className="text-[11px] text-muted shrink-0">{ids.length}</span>
                        </button>
                      )
                    })
                  ))}

                {tab === 'tag' &&
                  tagGroups.map((g) => {
                    const allOn = g.ids.every((id) => checked.has(id))
                    const someOn = g.ids.some((id) => checked.has(id))
                    return (
                      <button
                        key={g.name}
                        onClick={() => toggleGroup(g.ids)}
                        className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-hover transition-colors text-left mb-0.5 ${someOn ? 'bg-accent/10' : ''}`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${allOn ? 'bg-accent border-accent' : someOn ? 'bg-accent/40 border-accent' : 'border-surface-border'}`}>
                          {allOn ? <Check size={12} className="text-white" /> : null}
                        </span>
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.color || '#534AB7' }} />
                        <span className="flex-1 text-xs text-muted-light truncate">{g.name}</span>
                        <span className="text-[11px] text-muted shrink-0">{g.ids.length}</span>
                      </button>
                    )
                  })}

                {tab === 'collection' &&
                  (collectionLoading ? (
                    <div className="text-center text-xs text-muted py-8">加载收藏夹…</div>
                  ) : collections.length === 0 ? (
                    <div className="text-center text-xs text-muted py-8">还没有收藏夹</div>
                  ) : (
                    collections.map((col) => {
                      const ids = collectionSounds[col.id] || []
                      const allOn = ids.length > 0 && ids.every((id) => checked.has(id))
                      const someOn = ids.some((id) => checked.has(id))
                      return (
                        <button
                          key={col.id}
                          onClick={() => toggleGroup(ids)}
                          className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-hover transition-colors text-left mb-0.5 ${someOn ? 'bg-accent/10' : ''}`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${allOn ? 'bg-accent border-accent' : someOn ? 'bg-accent/40 border-accent' : 'border-surface-border'}`}>
                            {allOn ? <Check size={12} className="text-white" /> : null}
                          </span>
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: col.color || '#534AB7' }} />
                          <span className="flex-1 text-xs text-muted-light truncate">{col.name}</span>
                          <span className="text-[11px] text-muted shrink-0">{ids.length}</span>
                        </button>
                      )
                    })
                  ))}
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-3 border-t border-surface-border/60 flex items-center justify-between gap-2 shrink-0">
              <span className="text-[11px] text-muted">已选 {checked.size} 个</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMode('choice')}
                  className="px-3 py-1.5 rounded-lg text-xs text-muted-light hover:bg-surface-hover transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => startExport([...checked])}
                  disabled={checked.size === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-default"
                >
                  <Download size={13} />
                  导出选中 {checked.size} 个
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
