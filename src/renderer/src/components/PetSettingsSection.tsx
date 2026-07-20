// 宠物（声波小精灵）设置区 · 启用开关 / 外观 / 规则启停 / Petpack 导入导出
// 复用 SettingsPanel 的通用 UI 片段；配置以「精简结构」存于 settings 表，
// 渲染端用 DEFAULT_PET_CONFIG 补全完整规则集。
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { RotateCcw, Download, Upload } from 'lucide-react'
import { Section, Row, Toggle } from './SettingsPanel'
import { DEFAULT_RULE_TEMPLATES } from '../pet/engine/defaults'
import type { PetConfigStored } from '../../../shared/pet-types'

// A3 换肤：一键预设皮肤（不同色相），点击直接应用
const SKIN_PRESETS: { name: string; hue: number }[] = [
  { name: '经典紫', hue: 265 },
  { name: '薄荷绿', hue: 150 },
  { name: '天空蓝', hue: 205 },
  { name: '蜜桃粉', hue: 330 },
  { name: '暖阳橙', hue: 25 },
  { name: '葡萄紫', hue: 285 }
]

export function PetSettingsSection(): JSX.Element {
  const [cfg, setCfg] = useState<PetConfigStored | null>(null)

  useEffect(() => {
    window.api?.pet
      ?.getConfig?.()
      .then((c: PetConfigStored | null) => setCfg(c))
      .catch(() => setCfg(null))
  }, [])

  if (!cfg) {
    return (
      <Section title="宠物（声波小精灵）" desc="音频联动的桌面小精灵，默认常驻、可开关">
        <Row label="状态">
          <span className="text-xs text-muted">加载中…</span>
        </Row>
      </Section>
    )
  }

  const sprite = cfg.sprite ?? { hue: 265, name: '声波小精灵' }
  const display = cfg.display ?? {}
  const ruleEnabled = cfg.ruleEnabled ?? {}

  const update = async (patch: Partial<PetConfigStored>) => {
    const next: PetConfigStored = { ...cfg, ...patch }
    setCfg(next)
    await window.api?.pet?.saveConfig(next)
  }
  const setSprite = (patch: Partial<typeof sprite>) => update({ sprite: { ...sprite, ...patch } })
  const setDisplay = (patch: Partial<typeof display>) => update({ display: { ...display, ...patch } })
  const setRule = (id: string, v: boolean) => update({ ruleEnabled: { ...ruleEnabled, [id]: v } })

  const onToggleEnabled = async (v: boolean) => {
    setCfg({ ...cfg, enabled: v })
    await window.api?.pet?.setEnabled(v)
  }

  const onResetDefaults = async () => {
    try {
      // 持久化仅 enabled 的最小覆盖 → 渲染端 merge 默认规则集即等于「出厂默认」
      await window.api?.pet?.saveConfig({ enabled: cfg.enabled ?? true } as PetConfigStored)
      const fresh = await window.api?.pet?.getConfig()
      setCfg(fresh ?? cfg)
      toast.success('已恢复声波小精灵默认配置')
    } catch {
      toast.error('恢复默认失败')
    }
  }

  const onExport = async () => {
    const r = await window.api?.pet?.exportPetpack()
    if (r?.success) toast.success('已导出 Petpack')
    else toast.error(r?.message || '导出失败')
  }
  const onImport = async () => {
    const r = await window.api?.pet?.importPetpack()
    if (r?.success) {
      const fresh = await window.api?.pet?.getConfig()
      setCfg(fresh ?? cfg)
      toast.success('已导入 Petpack')
    } else toast.error(r?.message || '导入失败')
  }

  return (
    <Section title="宠物（声波小精灵）" desc="音频联动的桌面小精灵，默认常驻、可开关">
      <Row label="启用声波小精灵">
        <Toggle checked={cfg.enabled !== false} onChange={onToggleEnabled} />
      </Row>

      <Row label="名称">
        <input
          value={sprite.name}
          onChange={(e) => setSprite({ name: e.target.value })}
          className="bg-surface-card border border-surface-border text-sm text-fg rounded-lg px-3 py-1.5 outline-none focus:border-accent/50 w-44"
        />
      </Row>

      <Row label="主色相">
        <div className="flex items-center gap-3">
          <span
            className="w-6 h-6 rounded-md border border-surface-border shrink-0"
            style={{ background: `hsl(${sprite.hue}, 70%, 60%)` }}
          />
          <input
            type="range"
            min={0}
            max={360}
            value={sprite.hue}
            onChange={(e) => setSprite({ hue: parseInt(e.target.value, 10) })}
            className="w-40"
          />
          <span className="text-xs text-muted-light tabular-nums w-10">{sprite.hue}°</span>
        </div>
      </Row>

      <Row label="预设皮肤">
        <div className="flex flex-wrap gap-2">
          {SKIN_PRESETS.map((sk) => (
            <button
              key={sk.hue}
              title={sk.name}
              onClick={() => setSprite({ hue: sk.hue })}
              className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${sprite.hue === sk.hue ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-panel' : ''}`}
              style={{ background: `hsl(${sk.hue}, 70%, 60%)` }}
            />
          ))}
        </div>
      </Row>

      <Row label="缩放">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.3}
            max={2}
            step={0.1}
            value={display.scale ?? 1}
            onChange={(e) => setDisplay({ scale: parseFloat(e.target.value) })}
            className="w-40"
          />
          <span className="text-xs text-muted-light tabular-nums w-10">{((display.scale ?? 1)).toFixed(1)}x</span>
        </div>
      </Row>

      <Row label="透明度">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={display.opacity ?? 1}
            onChange={(e) => setDisplay({ opacity: parseFloat(e.target.value) })}
            className="w-40"
          />
          <span className="text-xs text-muted-light tabular-nums w-10">{Math.round((display.opacity ?? 1) * 100)}%</span>
        </div>
      </Row>

      <Row label="窗口置顶">
        <Toggle checked={display.alwaysOnTop !== false} onChange={(v) => setDisplay({ alwaysOnTop: v })} />
      </Row>

      <Row label="鼠标穿透（不挡操作）">
        <Toggle checked={!!display.clickThrough} onChange={(v) => setDisplay({ clickThrough: v })} />
      </Row>

      <div className="pt-2">
        <div className="text-xs text-muted mb-2">互动规则（默认方案，可单独启停）</div>
        <div className="space-y-2">
          {DEFAULT_RULE_TEMPLATES.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-4 bg-surface-card/50 rounded-lg px-3 py-2"
            >
              <span className="text-sm text-muted-light">{r.name}</span>
              <Toggle checked={ruleEnabled[r.id] !== false} onChange={(v) => setRule(r.id, v)} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          onClick={onResetDefaults}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-light bg-surface-card border border-surface-border hover:bg-surface-hover transition-colors"
        >
          <RotateCcw size={13} /> 恢复默认
        </button>
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-light bg-surface-card border border-surface-border hover:bg-surface-hover transition-colors"
        >
          <Download size={13} /> 导出 Petpack
        </button>
        <button
          onClick={onImport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-light bg-surface-card border border-surface-border hover:bg-surface-hover transition-colors"
        >
          <Upload size={13} /> 导入 Petpack
        </button>
      </div>
    </Section>
  )
}
