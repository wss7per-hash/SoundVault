import { useState, useEffect } from 'react'
import { X, Check, AlertCircle, Loader2, Zap, Eye, EyeOff, ExternalLink, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'
import type { AIConfig } from '../../preload/index.d'

// ── AI 服务商预设（与后端兼容） ──
const PROVIDERS = [
  { id: 'deepseek' as const, name: 'DeepSeek', desc: '高性价比，中文理解优秀', defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions', defaultModel: 'deepseek-chat', color: '#4ADE80' },
  { id: 'openai' as const, name: 'OpenAI', desc: 'GPT-4o，综合分析能力强', defaultEndpoint: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o', color: '#10A37F' },
  { id: 'qwen' as const, name: '通义千问', desc: '阿里云，中文场景深度优化', defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', defaultModel: 'qwen-plus', color: '#615CED' },
  { id: 'kimi' as const, name: 'Kimi', desc: 'Moonshot，长上下文、中文强', defaultEndpoint: 'https://api.moonshot.cn/v1/chat/completions', defaultModel: 'moonshot-v1-8k', color: '#8B5CF6' },
  { id: 'doubao' as const, name: '豆包', desc: '字节火山引擎，国内速度快', defaultEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', defaultModel: 'doubao-pro-32k', color: '#3B82F6' },
  { id: 'siliconflow' as const, name: '硅基流动', desc: '聚合国内开源模型平台', defaultEndpoint: 'https://api.siliconflow.cn/v1/chat/completions', defaultModel: 'Qwen/Qwen2.5-72B-Instruct', color: '#06B6D4' },
  { id: 'anthropic' as const, name: 'Claude', desc: 'Anthropic，代码与推理强', defaultEndpoint: 'https://api.anthropic.com/v1/messages', defaultModel: 'claude-3-5-sonnet-20241022', color: '#D97706' },
  { id: 'gemini' as const, name: 'Gemini', desc: 'Google，多模态理解', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro', defaultModel: 'gemini-1.5-pro', color: '#0EA5E9' },
  { id: 'azure' as const, name: 'Azure OpenAI', desc: '微软企业级 OpenAI 服务', defaultEndpoint: 'https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2024-02-15-preview', defaultModel: 'gpt-4o', color: '#2563EB' },
  { id: 'ollama' as const, name: 'Ollama', desc: '本地私有化模型，无需联网', defaultEndpoint: 'http://localhost:11434/api/chat', defaultModel: 'llama3.1', color: '#84CC16' },
  { id: 'tokendance' as const, name: 'TokenDance', desc: 'OpenAI 兼容聚合网关，多模型路由', defaultEndpoint: 'https://tokendance.space/gateway/v1/chat/completions', defaultModel: 'deepseek-v3.2', color: '#22D3EE' },
  { id: 'custom' as const, name: '自定义', desc: '兼容 OpenAI 接口的任意服务', defaultEndpoint: '', defaultModel: '', color: '#F59E0B' }
]

// ── 通用 UI 片段 ──
function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-border bg-surface-panel p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="text-xs text-muted mt-0.5">{desc}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-light shrink-0">{label}</span>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-lg border border-surface-border overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-4 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value ? 'bg-accent text-white' : 'text-muted hover:bg-surface-hover hover:text-muted-light'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-border'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : ''}`} />
    </button>
  )
}

// ── AI 模型配置区（从 ModelConfig 迁入，重写用语义类） ──
function AIConfigSection() {
  const [config, setConfig] = useState<AIConfig>({
    provider: 'deepseek', apiKey: '', endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat', maxTokens: 1000, temperature: 0.3
  })
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadConfig() }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const saved = await window.api.getAIConfig()
      if (saved) { setConfig(saved); setShowKey(false); setTestResult(null) }
    } catch (err) { console.error('Load config error:', err) }
    finally { setLoading(false) }
  }

  const selectProvider = (provider: AIConfig['provider']) => {
    const preset = PROVIDERS.find((p) => p.id === provider)
    setConfig((prev) => ({ ...prev, provider, endpoint: preset?.defaultEndpoint || '', model: preset?.defaultModel || '' }))
    setTestResult(null)
  }

  const handleSave = async () => {
    try { await window.api.saveAIConfig(config); toast.success('配置已保存') }
    catch { toast.error('保存失败') }
  }

  const handleTest = async () => {
    if (!config.apiKey) { toast.error('请先填写 API Key'); return }
    setTesting(true); setTestResult(null)
    try {
      const result = await window.api.testAIConnection(config)
      setTestResult(result)
      result.success ? toast.success('连接成功') : toast.error(result.message)
    } catch (err) { setTestResult({ success: false, message: (err as Error).message }) }
    finally { setTesting(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-accent-light animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Provider selection */}
      <div>
        <label className="block text-xs font-medium text-muted mb-3">选择模型服务商</label>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() => selectProvider(provider.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                config.provider === provider.id ? 'border-accent/60 bg-accent/10' : 'border-surface-border bg-surface-card hover:border-accent/40'
              }`}
            >
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: provider.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-fg">{provider.name}</p>
                <p className="text-xs text-muted truncate">{provider.desc}</p>
              </div>
              {config.provider === provider.id && <Check className="w-3.5 h-3.5 text-accent-light shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs font-medium text-muted mb-1.5">API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder={config.provider === 'custom' ? '输入自定义 API Key' : `输入 ${PROVIDERS.find((p) => p.id === config.provider)?.name} API Key`}
            className="w-full px-3 py-2 pr-20 bg-surface-card border border-surface-border rounded-lg text-xs text-fg placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-muted-light transition-colors"
          >
            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-xs text-muted mt-1">Key 仅存储在本地，不会上传到任何服务器</p>
      </div>

      {/* Endpoint & Model */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted mb-1.5">API Endpoint</label>
          <input
            type="text"
            value={config.endpoint}
            onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
            placeholder="https://api.openai.com/v1/chat/completions"
            className="w-full px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-xs text-fg placeholder:text-muted focus:outline-none focus:border-accent/50 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1.5">模型名称</label>
          <input
            type="text"
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            placeholder="gpt-4o / deepseek-chat"
            className="w-full px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-xs text-fg placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* Advanced params */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted mb-1.5">Max Tokens</label>
          <input
            type="number" value={config.maxTokens} min={100} max={4000}
            onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) || 1000 })}
            className="w-full px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-xs text-fg focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1.5">Temperature</label>
          <input
            type="number" value={config.temperature} min={0} max={2} step={0.1}
            onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) || 0.3 })}
            className="w-full px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-xs text-fg focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
          testResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {testResult.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span className="text-xs">{testResult.message}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleTest} disabled={testing || !config.apiKey}
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted hover:text-muted-light disabled:opacity-40 transition-colors"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
          测试连接
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2 bg-accent text-white text-xs rounded-lg hover:bg-accent-light transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />保存配置
        </button>
      </div>
    </div>
  )
}

// ── 设置面板主组件 ──
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const fontSize = useAppStore((s) => s.fontSize)
  const setFontSize = useAppStore((s) => s.setFontSize)
  const defaultExportFormat = useAppStore((s) => s.defaultExportFormat)
  const setDefaultExportFormat = useAppStore((s) => s.setDefaultExportFormat)
  const autoAnalyze = useAppStore((s) => s.autoAnalyzeOnImport)
  const setAutoAnalyze = useAppStore((s) => s.setAutoAnalyzeOnImport)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface">
      {/* Header */}
      <div className="h-12 shrink-0 flex items-center gap-3 px-5 border-b border-surface-border">
        <h2 className="text-sm font-semibold text-fg">设置</h2>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted hover:bg-surface-hover hover:text-muted-light transition-colors"
          title="关闭设置"
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full space-y-6">
        <Section title="外观" desc="界面主题与文字大小">
          <Row label="主题">
            <Segmented
              value={theme}
              onChange={setTheme}
              options={[{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }]}
            />
          </Row>
          <Row label="界面字号">
            <div className="flex items-center gap-3">
              <input
                type="range" min={12} max={20} value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                className="w-40"
              />
              <span className="text-xs text-muted-light tabular-nums w-10">{fontSize}px</span>
            </div>
          </Row>
        </Section>

        <Section title="AI 模型" desc="用于智能标注的 AI 服务商与密钥">
          <AIConfigSection />
        </Section>

        <Section title="导入与导出" desc="默认格式与自动化">
          <Row label="默认导出 / 转换格式">
            <select
              value={defaultExportFormat}
              onChange={(e) => setDefaultExportFormat(e.target.value)}
              className="bg-surface-card border border-surface-border text-sm text-fg rounded-lg px-3 py-2 outline-none focus:border-accent/50"
            >
              {['wav', 'mp3', 'flac', 'ogg', 'm4a'].map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </Row>
          <Row label="导入后自动 AI 标注">
            <Toggle checked={autoAnalyze} onChange={setAutoAnalyze} />
            <span className="text-xs text-muted">开启后，每次导入音效会自动进行语义分析</span>
          </Row>
        </Section>

        <div className="flex items-center gap-2 text-xs text-muted pt-2 pb-4">
          <Sparkles size={13} className="text-accent-light" />
          <span>SoundVault · 让音效管理更高效</span>
        </div>
      </div>
    </div>
  )
}
