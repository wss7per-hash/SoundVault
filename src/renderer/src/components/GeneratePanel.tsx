import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  Wand2,
  X,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
  Coins,
  Sparkles,
  RefreshCw,
  Check,
  ExternalLink
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import type { GenProvider, GenResult, GenStats } from '../../preload/index.d'

interface GeneratePanelProps {
  isOpen: boolean
  onClose: () => void
}

// 单次生成估算花费（USD），与 sfx-generator.ts 中的 GEN_COST_USD 保持一致
const GEN_COST: Record<GenProvider, number> = { fal: 0.2, elevenlabs: 0.1 }
const PROVIDER_META: Record<GenProvider, { name: string; note: string; maxDur: number }> = {
  fal: { name: 'Fal.ai', note: 'Stable Audio 2.5 · 最长 190s · 国内通常可直连', maxDur: 190 },
  elevenlabs: { name: 'ElevenLabs', note: 'SFX V2 · 音效质量最佳 · 需海外卡+代理', maxDur: 20 }
}

interface GenConfig {
  provider: GenProvider
  falKey: string
  elevenKey: string
}

const DEFAULT_CONFIG: GenConfig = { provider: 'fal', falKey: '', elevenKey: '' }

export default function GeneratePanel({ isOpen, onClose }: GeneratePanelProps): JSX.Element | null {
  const [config, setConfig] = useState<GenConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(6)
  const [guidance, setGuidance] = useState(3)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [balance, setBalance] = useState<{ balance: number | null; message: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<GenResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<GenStats | null>(null)
  const tokenRef = useRef<string | null>(null)

  const currentKey = config.provider === 'fal' ? config.falKey : config.elevenKey
  const cost = GEN_COST[config.provider]

  useEffect(() => {
    if (isOpen) {
      loadAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const loadAll = async () => {
    try {
      setLoading(true)
      setResult(null)
      setError(null)
      setBalance(null)
      const [cfgRaw, statsRaw] = await Promise.all([
        window.api.getSetting('gen:config'),
        window.api.getSetting('gen:stats')
      ])
      if (cfgRaw) {
        try {
          setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(cfgRaw) })
        } catch {
          /* 忽略损坏配置 */
        }
      }
      if (statsRaw) {
        try {
          setStats(JSON.parse(statsRaw))
        } catch {
          /* 忽略 */
        }
      }
    } catch (err) {
      console.error('Load gen config error:', err)
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async () => {
    try {
      await window.api.setSetting('gen:config', JSON.stringify(config))
      toast.success('生成配置已保存（Key 仅存本地 AppData，不会上传至云端）')
    } catch {
      toast.error('保存配置失败，请稍后重试')
    }
  }

  const checkBalance = async () => {
    if (!currentKey) {
      toast.error('请先填写当前服务商的 API Key')
      return
    }
    setChecking(true)
    setBalance(null)
    try {
      const res = await window.api.getGenBalance(config.provider, currentKey)
      setBalance(res)
      if (res.balance != null) {
        // 同步把免费/账户余额记到统计里，供花费预估使用
        const next: GenStats = stats || { count: 0, estCostUSD: 0, freeRemainingUSD: null }
        next.freeRemainingUSD = res.balance
        setStats({ ...next })
        await window.api.setSetting('gen:stats', JSON.stringify(next))
      }
    } catch (err) {
      setBalance({ balance: null, message: (err as Error).message })
    } finally {
      setChecking(false)
    }
  }

  const openConfirm = () => {
    if (!currentKey) {
      toast.error('请先填写 API Key（可在面板内保存配置）')
      return
    }
    if (!prompt.trim()) {
      toast.error('请填写音效描述')
      return
    }
    setConfirmOpen(true)
  }

  const doGenerate = async () => {
    setConfirmOpen(false)
    setGenerating(true)
    setError(null)
    const token = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`
    tokenRef.current = token
    try {
      const res = (await window.api.generateSFX({
        token,
        provider: config.provider,
        apiKey: currentKey,
        prompt: prompt.trim(),
        durationSeconds: duration,
        guidanceScale: config.provider === 'fal' ? guidance : undefined,
        seed: -1
      })) as GenResult
      if (res.cancelled) {
        toast('已取消生成')
        return
      }
      if (res.success) {
        toast.success('音效已生成并入库')
        await useAppStore.getState().refreshSounds()
        setStats(res.stats || null)
        setResult(res)
      } else {
        const errMsg = res.error || '音效生成未成功，请检查描述或稍后重试'
        setError(errMsg)
        toast.error(errMsg)
      }
    } catch (err) {
      const msg = '音效生成时出现异常，请检查网络连接或 API 配置后重试'
      setError(msg)
      toast.error(msg)
    } finally {
      setGenerating(false)
      tokenRef.current = null
    }
  }

  const cancel = async () => {
    if (tokenRef.current) {
      try {
        await window.api.cancelGeneration(tokenRef.current)
      } catch {
        /* ignore */
      }
    }
  }

  const viewInLibrary = () => {
    if (result?.soundId) {
      useAppStore.getState().selectSound(result.soundId)
      useAppStore.getState().refreshSounds()
    }
    onClose()
  }

  if (!isOpen) return null

  const meta = PROVIDER_META[config.provider]
  const durMax = meta.maxDur // 放开时长上限：Fal.ai 支持到 190s，ElevenLabs 20s

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel border border-surface-border rounded-xl w-[560px] max-h-[88vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-panel">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-accent-light" />
            </div>
            <div>
              <div className="text-sm font-semibold text-muted-light flex items-center gap-1.5">
                AI 生成音效 <Sparkles className="w-3.5 h-3.5 text-accent-light" />
              </div>
              <div className="text-xs text-muted mt-0.5">用文字描述，云端生成音效并自动入库</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:bg-surface-hover hover:text-muted-light transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16 text-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {/* 服务商切换 */}
            <div>
              <div className="text-xs text-muted mb-2">服务商</div>
              <div className="grid grid-cols-2 gap-2">
                {(['fal', 'elevenlabs'] as GenProvider[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setConfig((c) => ({ ...c, provider: p }))
                      setBalance(null)
                    }}
                    className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      config.provider === p
                        ? 'border-accent bg-accent/15 text-muted-light'
                        : 'border-surface-border text-muted hover:border-muted hover:text-muted-light'
                    }`}
                  >
                    <div className="text-sm font-medium">{PROVIDER_META[p].name}</div>
                    <div className="text-[11px] text-muted mt-0.5 leading-tight">
                      {PROVIDER_META[p].note}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* API Key */}
            <div>
              <div className="text-xs text-muted mb-2">
                {meta.name} API Key
                <span className="text-muted/70">（仅存本地，不联网上传）</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={config.provider === 'fal' ? config.falKey : config.elevenKey}
                    onChange={(e) =>
                      setConfig((c) =>
                        config.provider === 'fal'
                          ? { ...c, falKey: e.target.value }
                          : { ...c, elevenKey: e.target.value }
                      )
                    }
                    placeholder={config.provider === 'fal' ? 'fal-xxxxxxxxxxxx' : 'xi-xxxxxxxxxxxx'}
                    className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-muted-light placeholder:text-muted/50 focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-muted-light"
                    title={showKey ? '隐藏' : '显示'}
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <button
                  onClick={checkBalance}
                  disabled={checking}
                  className="px-3 py-2 rounded-lg border border-surface-border text-xs text-muted hover:text-muted-light hover:border-muted transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  title="查询账户/免费额度"
                >
                  {checking ? <Loader2 size={13} className="animate-spin" /> : <Coins size={13} />}
                  额度
                </button>
                <button
                  onClick={saveConfig}
                  className="px-3 py-2 rounded-lg bg-accent hover:bg-accent text-white text-xs transition-colors"
                >
                  保存
                </button>
              </div>
              {balance && (
                <div
                  className={`mt-2 text-xs flex items-center gap-1.5 ${
                    balance.balance != null ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {balance.balance != null ? (
                    <>
                      <Coins size={13} /> 账户余额 ${balance.balance.toFixed(2)}（含免费试用金，用完即转付费）
                    </>
                  ) : (
                    <>
                      <AlertCircle size={13} /> {balance.message}
                    </>
                  )}
                </div>
              )}
              {config.provider === 'elevenlabs' && (
                <div className="mt-2 text-[11px] text-muted/70 flex items-center gap-1">
                  <ExternalLink size={11} /> 申请 Key：api.elevenlabs.io → Profile → API Key（需海外支付方式）
                </div>
              )}
              {config.provider === 'fal' && (
                <div className="mt-2 text-[11px] text-muted/70 flex items-center gap-1">
                  <ExternalLink size={11} /> 申请 Key：fal.ai/dashboard（新用户送 ~$1-5 试用金）
                </div>
              )}
            </div>

            {/* 描述 */}
            <div>
              <div className="text-xs text-muted mb-2">音效描述</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="例如：打铁敲击声，金属质感，短促有力，带轻微回响"
                className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-muted-light placeholder:text-muted/50 focus:outline-none focus:border-accent resize-none"
              />
            </div>

            {/* 时长 */}
            <div>
              <div className="flex items-center justify-between text-xs text-muted mb-2">
                <span>时长</span>
                <span className="text-muted-light font-medium">{duration}s</span>
              </div>
              <input
                type="range"
                min={1}
                max={durMax}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full accent-[#534AB7]"
              />
              <div className="text-[11px] text-muted/60 mt-1">
                {config.provider === 'fal'
                  ? 'Fal.ai 最长支持 190s'
                  : 'ElevenLabs 单次最长 20s'}
              </div>
            </div>

            {/* 高级（Fal 引导系数） */}
            {config.provider === 'fal' && (
              <div>
                <button
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="text-xs text-muted hover:text-muted-light flex items-center gap-1"
                >
                  <RefreshCw size={12} className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  高级参数
                </button>
                {showAdvanced && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-muted mb-2">
                      <span>引导系数（guidance，越高越贴近描述）</span>
                      <span className="text-muted-light font-medium">{guidance.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={0.5}
                      value={guidance}
                      onChange={(e) => setGuidance(Number(e.target.value))}
                      className="w-full accent-[#534AB7]"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 花费 / 统计 */}
            <div className="rounded-lg bg-surface border border-surface-panel px-3 py-2.5 text-xs text-muted space-y-1">
              <div className="flex items-center justify-between">
                <span>本次预计消耗</span>
                <span className="text-muted-light font-medium">${cost.toFixed(2)}（{meta.name}）</span>
              </div>
              <div className="flex items-center justify-between">
                <span>累计生成</span>
                <span className="text-muted-light">
                  {stats?.count ?? 0} 次 · 估算 ${((stats?.estCostUSD ?? 0)).toFixed(2)}
                </span>
              </div>
              {stats?.freeRemainingUSD != null && (
                <div className="flex items-center justify-between">
                  <span>免费/账户余额</span>
                  <span className="text-emerald-400">${stats.freeRemainingUSD.toFixed(2)}（本地估算）</span>
                </div>
              )}
            </div>

            {error && (
              <div className="text-xs text-red-400 flex items-start gap-1.5">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 生成结果 */}
            {result?.success && result.soundId && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs mb-2">
                  <Check size={14} /> 已生成并入库
                </div>
                <div className="text-xs text-muted-light mb-1">
                  {result.fileName} · {((result.durationMs ?? 0) / 1000).toFixed(1)}s
                </div>
                <audio controls src={`sv://${result.soundId}`} className="w-full h-9" />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={viewInLibrary}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent text-white text-xs transition-colors"
                  >
                    在库中查看
                  </button>
                  <button
                    onClick={() => {
                      setResult(null)
                      setError(null)
                    }}
                    className="px-3 py-1.5 rounded-lg border border-surface-border text-xs text-muted hover:text-muted-light hover:border-muted transition-colors"
                  >
                    再生成一个
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div className="border-t border-surface-panel px-6 py-4 flex items-center gap-3">
            {generating ? (
              <>
                <button
                  onClick={cancel}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm font-medium transition-colors"
                >
                  取消生成
                </button>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={16} className="animate-spin text-accent-light" />
                  生成中…（最长约 2 分钟）
                </div>
              </>
            ) : (
              <button
                onClick={openConfirm}
                disabled={!prompt.trim() || !currentKey}
                className="flex-1 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Wand2 size={15} /> 生成音效（约 ${cost.toFixed(2)}）
              </button>
            )}
          </div>
        )}
      </div>

      {/* 花费确认弹窗 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-[380px] bg-surface-panel border border-surface-border rounded-2xl shadow-2xl p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                <Coins className="w-4 h-4 text-accent-light" />
              </div>
              <div className="text-sm font-medium text-muted-light">确认生成</div>
            </div>
            <p className="text-sm text-muted leading-relaxed mb-1">
              将消耗约 <span className="text-muted-light font-medium">${cost.toFixed(2)}</span>（{meta.name}），生成后自动入库。
            </p>
            {stats?.freeRemainingUSD != null && (
              <p className="text-xs text-muted/80 mb-3">
                当前余额 ${stats.freeRemainingUSD.toFixed(2)} → 生成后约 $
                {Math.max(0, stats.freeRemainingUSD - cost).toFixed(2)}
              </p>
            )}
            {stats?.freeRemainingUSD == null && <div className="mb-3" />}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-sm text-muted hover:text-muted-light hover:border-muted transition-colors"
              >
                再想想
              </button>
              <button
                onClick={doGenerate}
                className="flex-1 px-4 py-2 rounded-lg bg-accent hover:bg-accent text-white text-sm font-medium transition-colors"
              >
                确认生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
