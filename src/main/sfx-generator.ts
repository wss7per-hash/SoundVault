// 云端「文本 → 音效」生成（Fal.ai Stable Audio 2.5 + ElevenLabs SFX V2）
// 完全独立于 AI 语义分析（ai-analyzer.ts），生成用的 Key 由渲染层经 settings 表
// 持久化传入，不污染 ModelConfig。本文件只负责「调服务商 API → 拿到音频二进制」，
// 落盘与入库由 ipc-handlers.ts 的 ai:generateSFX 处理。

export type GenProvider = 'fal' | 'elevenlabs'

export interface GenOptions {
  provider: GenProvider
  apiKey: string
  prompt: string
  durationSeconds?: number // fal: 1-190；elevenlabs: 1-20
  guidanceScale?: number // fal 专用：扩散引导系数，越高越贴近 prompt
  seed?: number // -1 = 随机
}

export interface GenResult {
  buffer: Buffer
  contentType: string
  fileName: string
}

// 单次生成估算花费（USD）。仅用于界面提示与本地累计，以服务商实际扣费为准。
export const GEN_COST_USD: Record<GenProvider, number> = {
  fal: 0.2,
  elevenlabs: 0.1
}

const FAL_ENDPOINT = 'https://fal.run/stabilityai/stable-audio-2.5'
const ELEVEN_ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation'

const MAX_GEN_MS = 120000

// ── 生成取消令牌（与主进程 AbortController 绑定）──
const activeGens = new Map<string, AbortController>()
export function registerGeneration(token: string, c: AbortController): void {
  activeGens.set(token, c)
}
export function unregisterGeneration(token: string): void {
  activeGens.delete(token)
}
export function cancelGeneration(token: string): boolean {
  const c = activeGens.get(token)
  if (c) {
    c.abort()
    activeGens.delete(token)
    return true
  }
  return false
}

export async function generateSFX(opts: GenOptions, signal?: AbortSignal): Promise<GenResult> {
  if (!opts.apiKey) throw new Error('未配置 API Key，请在生成面板中填写')
  if (!opts.prompt || !opts.prompt.trim()) throw new Error('请填写音效描述')

  if (opts.provider === 'fal') return generateFal(opts, signal)
  return generateEleven(opts, signal)
}

// ── Fal.ai（Stable Audio 2.5，队列模式：提交 → 轮询状态 → 取结果）──
async function generateFal(opts: GenOptions, signal?: AbortSignal): Promise<GenResult> {
  const controller = new AbortController()
  let safety: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  safety = setTimeout(() => controller.abort(), MAX_GEN_MS)

  try {
    const secondsTotal = Math.max(1, Math.min(190, Math.round(opts.durationSeconds || 6)))
    const body: Record<string, unknown> = {
      prompt: opts.prompt.trim(),
      seconds_total: secondsTotal,
      num_inference_steps: 30,
      guidance_scale: opts.guidanceScale ?? 1
    }
    if (opts.seed != null && opts.seed >= 0) body.seed = opts.seed

    const submitRes = await fetch(FAL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${opts.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!submitRes.ok) {
      const t = await submitRes.text()
      throw new Error(`Fal.ai 提交失败 ${submitRes.status}: ${t.slice(0, 200)}`)
    }
    const submit = (await submitRes.json()) as {
      request_id?: string
      audio?: { url?: string; content_type?: string; file_name?: string }
    }
    // 兼容个别情况下直接同步返回结果（无需轮询）
    if (submit.audio?.url) {
      const audioRes = await fetch(submit.audio.url, { signal: controller.signal })
      if (!audioRes.ok) throw new Error(`下载生成音频失败 ${audioRes.status}`)
      const buf = Buffer.from(await audioRes.arrayBuffer())
      const isWav = (submit.audio?.content_type || '').includes('wav') || submit.audio.url.endsWith('.wav')
      return {
        buffer: buf,
        contentType: submit.audio?.content_type || (isWav ? 'audio/wav' : 'audio/mpeg'),
        fileName: submit.audio?.file_name || `sfx_${Date.now()}.${isWav ? 'wav' : 'mp3'}`
      }
    }
    const requestId = submit.request_id
    if (!requestId) throw new Error('Fal.ai 未返回 request_id')

    const statusUrl = `${FAL_ENDPOINT}/requests/${requestId}/status`
    const contentUrl = `${FAL_ENDPOINT}/requests/${requestId}/content`
    const deadline = Date.now() + MAX_GEN_MS
    let status = ''
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      if (controller.signal.aborted) throw new Error('已取消')
      const stRes = await fetch(statusUrl, {
        headers: { Authorization: `Key ${opts.apiKey}` },
        signal: controller.signal
      })
      if (stRes.ok) {
        const st = (await stRes.json()) as { status?: string }
        status = st.status || ''
        if (status === 'COMPLETED') break
        if (status === 'FAILED') throw new Error('Fal.ai 生成失败')
      }
    }
    if (status !== 'COMPLETED') throw new Error('Fal.ai 生成超时，请重试')

    const contentRes = await fetch(contentUrl, {
      headers: { Authorization: `Key ${opts.apiKey}` },
      signal: controller.signal
    })
    if (!contentRes.ok) throw new Error(`Fal.ai 获取结果失败 ${contentRes.status}`)
    const content = (await contentRes.json()) as {
      audio?: { url?: string; content_type?: string; file_name?: string }
    }
    const audioUrl = content.audio?.url
    if (!audioUrl) throw new Error('Fal.ai 返回结果缺少音频地址')

    const audioRes = await fetch(audioUrl, { signal: controller.signal })
    if (!audioRes.ok) throw new Error(`下载生成音频失败 ${audioRes.status}`)
    const buf = Buffer.from(await audioRes.arrayBuffer())
    const isWav = (content.audio?.content_type || '').includes('wav') || audioUrl.endsWith('.wav')
    return {
      buffer: buf,
      contentType: content.audio?.content_type || (isWav ? 'audio/wav' : 'audio/mpeg'),
      fileName: content.audio?.file_name || `sfx_${Date.now()}.${isWav ? 'wav' : 'mp3'}`
    }
  } finally {
    if (safety) clearTimeout(safety)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

// ── ElevenLabs SFX V2（同步返回音频二进制）──
async function generateEleven(opts: GenOptions, signal?: AbortSignal): Promise<GenResult> {
  const controller = new AbortController()
  let safety: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  safety = setTimeout(() => controller.abort(), MAX_GEN_MS)

  try {
    const duration = Math.max(1, Math.min(20, Math.round(opts.durationSeconds || 6)))
    const body: Record<string, unknown> = {
      text: opts.prompt.trim(),
      duration_seconds: duration,
      prompt_influence: 0.7,
      output_format: 'mp3_44100_128'
    }
    const res = await fetch(ELEVEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': opts.apiKey },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`ElevenLabs 生成失败 ${res.status}: ${t.slice(0, 200)}`)
    }
    const contentType = res.headers.get('content-type') || 'audio/mpeg'
    const buf = Buffer.from(await res.arrayBuffer())
    const isWav = contentType.includes('wav')
    return {
      buffer: buf,
      contentType,
      fileName: `sfx_${Date.now()}.${isWav ? 'wav' : 'mp3'}`
    }
  } finally {
    if (safety) clearTimeout(safety)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

// 查询账户/试用额度。仅 Fal 可可靠读取余额；ElevenLabs 额度结构复杂，引导官网查看。
export async function checkBalance(
  provider: GenProvider,
  apiKey: string
): Promise<{ balance: number | null; message: string }> {
  if (!apiKey) return { balance: null, message: '请先填写 API Key' }
  try {
    if (provider === 'fal') {
      const res = await fetch('https://fal.run/api/user/balance', {
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(10000)
      })
      if (!res.ok) return { balance: null, message: `查询失败 ${res.status}` }
      const data = (await res.json()) as { balance?: number }
      return {
        balance: typeof data.balance === 'number' ? data.balance : null,
        message: '已读取 Fal.ai 账户余额（含免费试用金）'
      }
    }
    return { balance: null, message: 'ElevenLabs 额度请在官网查看；本地按 ~$0.10/次估算' }
  } catch (err) {
    return { balance: null, message: `查询额度失败：${(err as Error).message}` }
  }
}
