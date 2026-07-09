import { useState, useEffect } from 'react'
import { X, Check, AlertCircle, Loader2, Zap, Eye, EyeOff, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AIConfig } from '../../preload/index.d'

interface ModelConfigProps {
  isOpen: boolean
  onClose: () => void
}

const PROVIDERS = [
  {
    id: 'deepseek' as const,
    name: 'DeepSeek',
    desc: '高性价比，中文理解优秀',
    defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    color: '#4ADE80'
  },
  {
    id: 'openai' as const,
    name: 'OpenAI',
    desc: 'GPT-4o，综合分析能力强',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    color: '#10A37F'
  },
  {
    id: 'qwen' as const,
    name: '通义千问',
    desc: '阿里云，中文场景深度优化',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    color: '#615CED'
  },
  {
    id: 'kimi' as const,
    name: 'Kimi',
    desc: 'Moonshot，长上下文、中文强',
    defaultEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    color: '#8B5CF6'
  },
  {
    id: 'doubao' as const,
    name: '豆包',
    desc: '字节火山引擎，国内速度快',
    defaultEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'doubao-pro-32k',
    color: '#3B82F6'
  },
  {
    id: 'siliconflow' as const,
    name: '硅基流动',
    desc: '聚合国内开源模型平台',
    defaultEndpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    color: '#06B6D4'
  },
  {
    id: 'anthropic' as const,
    name: 'Claude',
    desc: 'Anthropic，代码与推理强',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-sonnet-20241022',
    color: '#D97706'
  },
  {
    id: 'gemini' as const,
    name: 'Gemini',
    desc: 'Google，多模态理解',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro',
    defaultModel: 'gemini-1.5-pro',
    color: '#0EA5E9'
  },
  {
    id: 'azure' as const,
    name: 'Azure OpenAI',
    desc: '微软企业级 OpenAI 服务',
    defaultEndpoint: 'https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2024-02-15-preview',
    defaultModel: 'gpt-4o',
    color: '#2563EB'
  },
  {
    id: 'ollama' as const,
    name: 'Ollama',
    desc: '本地私有化模型，无需联网',
    defaultEndpoint: 'http://localhost:11434/api/chat',
    defaultModel: 'llama3.1',
    color: '#84CC16'
  },
  {
    id: 'tokendance' as const,
    name: 'TokenDance',
    desc: 'OpenAI 兼容聚合网关，多模型路由',
    defaultEndpoint: 'https://tokendance.space/gateway/v1/chat/completions',
    defaultModel: 'deepseek-v3.2',
    color: '#22D3EE'
  },
  {
    id: 'custom' as const,
    name: '自定义',
    desc: '兼容 OpenAI 接口的任意服务',
    defaultEndpoint: '',
    defaultModel: '',
    color: '#F59E0B'
  }
]

export default function ModelConfig({ isOpen, onClose }: ModelConfigProps) {
  const [config, setConfig] = useState<AIConfig>({
    provider: 'deepseek',
    apiKey: '',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    maxTokens: 1000,
    temperature: 0.3
  })
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isOpen) {
      loadConfig()
    }
  }, [isOpen])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const saved = await window.api.getAIConfig()
      if (saved) {
        setConfig(saved)
        setShowKey(false)
        setTestResult(null)
      }
    } catch (err) {
      console.error('Load config error:', err)
    } finally {
      setLoading(false)
    }
  }

  const selectProvider = (provider: AIConfig['provider']) => {
    const preset = PROVIDERS.find((p) => p.id === provider)
    setConfig((prev) => ({
      ...prev,
      provider,
      endpoint: preset?.defaultEndpoint || '',
      model: preset?.defaultModel || ''
    }))
    setTestResult(null)
  }

  const handleSave = async () => {
    try {
      await window.api.saveAIConfig(config)
      toast.success('配置已保存')
      onClose()
    } catch (err) {
      toast.error('保存失败')
    }
  }

  const handleTest = async () => {
    if (!config.apiKey) {
      toast.error('请先填写 API Key')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.testAIConnection(config)
      setTestResult(result)
      if (result.success) {
        toast.success('连接成功')
      } else {
        toast.error(result.message)
      }
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1f1f1d] border border-[#3a3a38] rounded-xl w-[580px] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#534AB7]/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-[#7C72E6]" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#e8e8e4]">AI 模型配置</h2>
              <p className="text-xs text-[#8a8a82]">选择用于音频分析的 AI 模型</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6a6a64] hover:text-[#e8e8e4] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-[#7C72E6] animate-spin" />
            </div>
          ) : (
            <>
              {/* Provider selection */}
              <div>
                <label className="block text-xs font-medium text-[#9a9a92] mb-3">选择模型服务商</label>
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDERS.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => selectProvider(provider.id)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                        config.provider === provider.id
                          ? 'border-[#534AB7]/60 bg-[#534AB7]/10'
                          : 'border-[#333] bg-[#252524] hover:border-[#3a3a38]'
                      }`}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: provider.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#c8c8c4]">{provider.name}</p>
                        <p className="text-xs text-[#6a6a64] truncate">{provider.desc}</p>
                      </div>
                      {config.provider === provider.id && (
                        <Check className="w-3.5 h-3.5 text-[#7C72E6] shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">API Key</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={config.apiKey}
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                    placeholder={config.provider === 'custom' ? '输入自定义 API Key' : `输入 ${PROVIDERS.find((p) => p.id === config.provider)?.name} API Key`}
                    className="w-full px-3 py-2 pr-20 bg-[#252524] border border-[#333] rounded-lg text-xs text-[#c8c8c4] placeholder-[#5a5a54] focus:outline-none focus:border-[#534AB7]/50"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6a6a64] hover:text-[#b8b8b4] transition-colors"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-[#6a6a64] mt-1">Key 仅存储在本地，不会上传到任何服务器</p>
              </div>

              {/* Endpoint & Model */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">API Endpoint</label>
                  <input
                    type="text"
                    value={config.endpoint}
                    onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
                    placeholder="https://api.openai.com/v1/chat/completions"
                    className="w-full px-3 py-2 bg-[#252524] border border-[#333] rounded-lg text-xs text-[#c8c8c4] placeholder-[#5a5a54] focus:outline-none focus:border-[#534AB7]/50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">模型名称</label>
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    placeholder="gpt-4o / deepseek-chat"
                    className="w-full px-3 py-2 bg-[#252524] border border-[#333] rounded-lg text-xs text-[#c8c8c4] placeholder-[#5a5a54] focus:outline-none focus:border-[#534AB7]/50"
                  />
                </div>
              </div>

              {/* Advanced params */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">Max Tokens</label>
                  <input
                    type="number"
                    value={config.maxTokens}
                    onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) || 1000 })}
                    min={100}
                    max={4000}
                    className="w-full px-3 py-2 bg-[#252524] border border-[#333] rounded-lg text-xs text-[#c8c8c4] focus:outline-none focus:border-[#534AB7]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9a92] mb-1.5">Temperature</label>
                  <input
                    type="number"
                    value={config.temperature}
                    onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) || 0.3 })}
                    min={0}
                    max={2}
                    step={0.1}
                    className="w-full px-3 py-2 bg-[#252524] border border-[#333] rounded-lg text-xs text-[#c8c8c4] focus:outline-none focus:border-[#534AB7]/50"
                  />
                </div>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                  testResult.success
                    ? 'bg-[#1a2a1a] border-[#2a5a2a] text-[#4ADE80]'
                    : 'bg-[#2a1a1a] border-[#5a2a2a] text-[#F87171]'
                }`}>
                  {testResult.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span className="text-xs">{testResult.message}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2a2a28] flex items-center justify-between">
          <button
            onClick={handleTest}
            disabled={testing || !config.apiKey}
            className="flex items-center gap-2 px-3 py-2 text-xs text-[#8a8a82] hover:text-[#e8e8e4] disabled:opacity-40 transition-colors"
          >
            {testing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ExternalLink className="w-3.5 h-3.5" />
            )}
            测试连接
          </button>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs text-[#8a8a82] hover:text-[#e8e8e4] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-[#534AB7] text-white text-xs rounded-lg hover:bg-[#6358D0] transition-colors"
            >
              保存配置
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
