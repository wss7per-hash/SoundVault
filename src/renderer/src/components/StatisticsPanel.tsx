import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { Database, Clock, HardDrive, Sparkles, Tags, ArrowLeft, Layers, Volume2, Copy, Trash2 } from 'lucide-react'
import type { TagStatData, DuplicateGroup, DuplicateItem } from '../../preload/index.d'

const formatDuration = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`
  return `0:${String(s).padStart(2, '0')}`
}

const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function StatisticsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const stats = useAppStore((s) => s.stats)
  const tagStats = useAppStore((s) => s.tagStats)
  const onoStats = useAppStore((s) => s.onoStats)
  const refreshStats = useAppStore((s) => s.refreshStats)
  const refreshTagStats = useAppStore((s) => s.refreshTagStats)
  const refreshOnoStats = useAppStore((s) => s.refreshOnoStats)
  const duplicates = useAppStore((s) => s.duplicates)
  const refreshDuplicates = useAppStore((s) => s.refreshDuplicates)
  const [keepMap, setKeepMap] = useState<Record<string, string>>({})
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    refreshStats()
    refreshTagStats()
    refreshOnoStats()
  }, [refreshStats, refreshTagStats, refreshOnoStats])

  const total = stats.total || 0
  const analyzedPct = total > 0 ? Math.round((stats.analyzed / total) * 100) : 0
  const taggedPct = total > 0 ? Math.round((stats.taggedSounds / total) * 100) : 0
  const maxCount = tagStats.reduce((m, t) => Math.max(m, t.count), 1)
  const maxOno = onoStats.reduce((m, t) => Math.max(m, t.count), 1)

  const sizeFor = (c: number): number => 13 + Math.round((c / maxCount) * 21) // 13~34px
  const opacityFor = (c: number): number => 0.5 + (c / maxCount) * 0.5 // 0.5~1
  const sizeForOno = (c: number): number => 13 + Math.round((c / maxOno) * 21)
  const opacityForOno = (c: number): number => 0.5 + (c / maxOno) * 0.5

  const handleTagClick = (tag: TagStatData): void => {
    const store = useAppStore.getState()
    store.setSelectedTag(tag.id)
    store.setSidebarTab('tags')
    store.setActiveView('library')
  }

  const handleOnoClick = (t: TagStatData): void => {
    const store = useAppStore.getState()
    store.setSearchQuery(t.name)
    store.setActiveView('library')
  }

  const handleScan = async (): Promise<void> => {
    setScanning(true)
    try {
      await refreshDuplicates()
    } finally {
      setScanning(false)
    }
  }

  const removeItems = async (items: DuplicateItem[]): Promise<void> => {
    for (const item of items) {
      await window.api.trashFile(item.id)
    }
    await refreshDuplicates()
    const store = useAppStore.getState()
    store.refreshStats()
    store.refreshSounds()
  }

  const handleRemoveGroup = async (group: DuplicateGroup): Promise<void> => {
    const keepId = keepMap[group.hash] || group.items[0]?.id
    const toRemove = group.items.filter((i) => i.id !== keepId)
    if (toRemove.length === 0) return
    await removeItems(toRemove)
  }

  const handleRemoveAll = async (): Promise<void> => {
    for (const group of duplicates) {
      const keepId = keepMap[group.hash] || group.items[0]?.id
      const toRemove = group.items.filter((i) => i.id !== keepId)
      await removeItems(toRemove)
    }
  }

  const onoPct = total > 0 ? Math.round((stats.withOnomatopoeia / total) * 100) : 0

  const extRows = [
    { key: 'wav', label: 'WAV', value: stats.byExt.wav },
    { key: 'mp3', label: 'MP3', value: stats.byExt.mp3 },
    { key: 'flac', label: 'FLAC', value: stats.byExt.flac },
    { key: 'other', label: '其他', value: stats.byExt.other }
  ].filter((r) => r.value > 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#131311]">
      {/* Header */}
      <div className="h-11 border-b border-surface-border flex items-center gap-3 px-4 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted hover:bg-surface-hover hover:text-muted-light transition-colors"
        >
          <ArrowLeft size={15} />
          返回库
        </button>
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-accent-light" />
          <h2 className="text-sm font-semibold text-[#e8e8e4]">库洞察 · Insights</h2>
        </div>
        <span className="ml-auto text-xs text-muted">
          共 {total} 个音效 · {tagStats.length} 个标签
        </span>
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard icon={<Database size={18} className="text-accent-light" />} label="音效总数" value={String(total)} sub={`${stats.starred} 个收藏 · ${stats.missing} 个缺失`} />
          <KpiCard icon={<Clock size={18} className="text-accent-light" />} label="总时长" value={formatDuration(stats.totalDurationMs)} sub={`平均 ${total > 0 ? formatDuration(stats.totalDurationMs / total) : '—'}`} />
          <KpiCard icon={<HardDrive size={18} className="text-accent-light" />} label="总大小" value={formatSize(stats.totalSize)} sub={`${formatSize(total > 0 ? stats.totalSize / total : 0)} / 个`} />
          <KpiCard icon={<Sparkles size={18} className="text-accent-light" />} label="AI 分析覆盖" value={`${analyzedPct}%`} sub={`${stats.analyzed} / ${total} 已分析`} accent={analyzedPct < 100} />
        </div>

        {/* File type distribution */}
        <Section title="文件格式分布" icon={<HardDrive size={14} className="text-muted" />}>
          <div className="space-y-2.5">
            {extRows.length > 0 ? (
              extRows.map((r) => {
                const pct = total > 0 ? (r.value / total) * 100 : 0
                return (
                  <div key={r.key} className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-xs text-muted-light tabular-nums">{r.label}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-[#232321] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">{r.value}</span>
                    <span className="w-12 shrink-0 text-right text-xs text-muted/60 tabular-nums">{pct.toFixed(0)}%</span>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-muted">暂无数据</p>
            )}
          </div>
        </Section>

        {/* Tag cloud */}
        <Section title="标签云" icon={<Tags size={14} className="text-muted" />} hint="字号越大代表使用越多 · 点击可跳转筛选">
          {tagStats.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2.5 pt-1">
              {tagStats.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTagClick(t)}
                  className="leading-none hover:underline underline-offset-4 transition-all"
                  style={{
                    fontSize: `${sizeFor(t.count)}px`,
                    color: t.color || '#C4B5FD',
                    opacity: opacityFor(t.count)
                  }}
                  title={`${t.name} · ${t.count} 个音效`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">还没有标签。先对音效做 AI 分析，即可自动生成标签。</p>
          )}
        </Section>

        {/* Onomatopoeia cloud */}
        <Section title="拟声词云" icon={<Volume2 size={14} className="text-muted" />} hint="点击按拟声词搜索 · 字号越大代表库中越多">
          {onoStats.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2.5 pt-1">
              {onoStats.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleOnoClick(t)}
                  className="leading-none hover:underline underline-offset-4 transition-all"
                  style={{
                    fontSize: `${sizeForOno(t.count)}px`,
                    color: t.color || '#FBBF24',
                    opacity: opacityForOno(t.count)
                  }}
                  title={`${t.name} · ${t.count} 个音效`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">还没有拟声词。先对音效做 AI 分析，即可自动生成多语种拟声词。</p>
          )}
        </Section>

        {/* Duplicates */}
        <Section title="重复文件" icon={<Copy size={14} className="text-muted" />} hint="按文件内容(hash)查重 · 清除时移入回收站">
          <div className="pt-1">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-3 py-1.5 rounded-md text-xs bg-[#2a2a26] hover:bg-[#34342f] border border-surface-border disabled:opacity-50"
            >
              {scanning ? '扫描中…' : '查找重复文件'}
            </button>
            {duplicates.length === 0 ? (
              <p className="text-xs text-muted mt-2">未发现重复文件。点击上方按钮可扫描整个音效库（按文件内容精确比对）。</p>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-[#5a5a54]">
                  发现 {duplicates.length} 组重复 · 共 {duplicates.reduce((s, g) => s + g.count, 0)} 个文件 · 可清理 {duplicates.reduce((s, g) => s + g.count - 1, 0)} 个。
                  每组默认保留最早导入的，可点选其他项保留。
                </p>
                {duplicates.map((g) => {
                  const keepId = keepMap[g.hash] || g.items[0]?.id
                  const toRemove = g.items.filter((i) => i.id !== keepId)
                  return (
                    <div key={g.hash} className="rounded-lg border border-surface-border p-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-mono text-muted truncate">#{g.hash.slice(0, 10)}… · {g.count} 个相同</span>
                        <button
                          onClick={() => handleRemoveGroup(g)}
                          disabled={toRemove.length === 0}
                          className="px-2 py-1 rounded text-[11px] bg-[#3a2a2a] hover:bg-[#4a3333] border border-[#5a3a3a] text-red-200 disabled:opacity-40"
                        >
                          删除其余 {toRemove.length} 个
                        </button>
                      </div>
                      <div className="space-y-1">
                        {g.items.map((item) => {
                          const isKeep = item.id === keepId
                          return (
                            <label
                              key={item.id}
                              className={`flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer ${isKeep ? 'bg-[#1d2a1d] text-green-300' : 'hover:bg-surface-2'}`}
                            >
                              <input
                                type="radio"
                                name={`keep-${g.hash}`}
                                checked={isKeep}
                                onChange={() => setKeepMap((m) => ({ ...m, [g.hash]: item.id }))}
                              />
                              <span className="flex-1 truncate">{item.file_name}</span>
                              <span className="text-muted">{formatSize(item.file_size)}</span>
                              {isKeep && <span className="text-[10px] text-green-400">保留</span>}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                <button
                  onClick={handleRemoveAll}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#3a2a2a] hover:bg-[#4a3333] border border-[#5a3a3a] text-red-200"
                >
                  <Trash2 size={13} /> 一键清理全部重复
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* Extra insights */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mt-8">
          <MiniStat label="平均质量分" value={stats.avgQuality !== null ? `${stats.avgQuality} / 100` : '—'} />
          <MiniStat label="已打标签" value={`${taggedPct}%`} sub={`${stats.taggedSounds} 个音效`} />
          <MiniStat label="标签总数" value={String(stats.tagCount)} />
          <MiniStat label="含拟声词" value={String(stats.withOnomatopoeia)} sub={`占 ${onoPct}%`} />
          <MiniStat
            label="待分析"
            value={String(stats.unanalyzed)}
            warn={stats.unanalyzed > 0}
            sub={stats.unanalyzed > 0 ? '建议批量 AI 分析' : '已全部分析'}
          />
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, sub, accent }: {
  icon: JSX.Element
  label: string
  value: string
  sub?: string
  accent?: boolean
}): JSX.Element {
  return (
    <div className="bg-[#1f1f1d] border border-surface-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">{icon}</div>
      <div className={`text-2xl font-semibold tabular-nums ${accent ? 'text-amber-400' : 'text-muted-light'}`}>
        {value}
      </div>
      <div className="text-xs text-muted">{label}</div>
      {sub && <div className="text-[10px] text-muted/60">{sub}</div>}
    </div>
  )
}

function MiniStat({ label, value, sub, warn }: {
  label: string
  value: string
  sub?: string
  warn?: boolean
}): JSX.Element {
  return (
    <div className="bg-[#1a1a18] border border-surface-border rounded-lg px-3.5 py-3">
      <div className={`text-lg font-semibold tabular-nums ${warn ? 'text-amber-400' : 'text-muted-light'}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-muted/60 mt-0.5">{sub}</div>}
    </div>
  )
}

function Section({ title, icon, hint, children }: {
  title: string
  icon: JSX.Element
  hint?: string
  children: JSX.Element
}): JSX.Element {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-medium text-muted-light">{title}</h3>
        {hint && <span className="text-[10px] text-muted/60 ml-1">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
