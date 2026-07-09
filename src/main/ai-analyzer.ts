import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import { join } from 'path'

const execFileAsync = promisify(execFile)

// ---- Types ----

export interface AudioMetadata {
  duration: number       // seconds
  sampleRate: number
  channels: number
  bitrate: number        // kbps
  codec: string
  fileSize: number       // bytes
  format: string
  peakDB: number
  rmsDB: number
  loudnessIntegratedLUFS: number
  loudnessRangeLU: number
  truePeakDB: number
}

export interface AIAnalysisResult {
  description: string           // 一句话特征描述
  detailedDescription: string   // 详细描述
  scenario: string              // 使用场景建议
  tags: Array<{
    name: string
    category: string            // 人声/动物/环境氛围/动作音效/UI转场/乐器音乐/机械科技
    confidence: number          // 0-1
  }>
  emotion: string               // 情绪标签
  qualityScore: number          // 1-5 音质评分
  moodEnergy: number            // 1-10 能量等级
  isLoopable: boolean           // 是否可循环
  variantOf: string | null      // 变体提示
}

export interface ModelConfig {
  provider: 'openai' | 'deepseek' | 'qwen' | 'anthropic' | 'gemini' | 'kimi' | 'doubao' | 'siliconflow' | 'azure' | 'ollama' | 'tokendance' | 'custom'
  apiKey: string
  endpoint: string
  model: string
  maxTokens: number
  temperature: number
}

// ---- Cancellation infrastructure ----
// Each in-flight analysis (single or batch) registers an AbortController
// keyed by a token (sound id for single, a generated token for batch).
// This lets the UI interrupt a stuck analysis and keeps analyses independent
// so a slow/hung one never blocks analysing other sounds.

const activeAnalyses = new Map<string, AbortController>()

export function cancelAnalysis(token: string): boolean {
  const controller = activeAnalyses.get(token)
  if (controller) {
    controller.abort()
    activeAnalyses.delete(token)
    return true
  }
  return false
}

export function registerAnalysis(token: string, controller: AbortController): void {
  activeAnalyses.set(token, controller)
}

export function unregisterAnalysis(token: string): void {
  activeAnalyses.delete(token)
}

// Hard ceiling so a request can never hang the UI forever even if the
// network neither responds nor errors.
const MAX_ANALYSIS_MS = 45000

// ---- FFprobe metadata extraction ----

/**
 * Resolve ffprobe path with fallback chain:
 * 1. Bundled path (packaged app)
 * 2. System PATH lookup
 */
function resolveFfprobePath(): string {
  // Try bundled first
  const bundled = join(app.getAppPath(), '..', 'ffmpeg', 'ffprobe.exe')

  // On Windows, also check common install locations
  const candidates = [
    bundled,
    // System PATH - will be resolved by execFile
    'ffprobe',
    // Common Windows installs
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
    join(process.env['PROGRAMFILES'] || '', 'ffmpeg', 'bin', 'ffprobe.exe'),
    join(process.env['PROGRAMFILES(X86)'] || '', 'ffmpeg', 'bin', 'ffprobe.exe'),
  ]

  return candidates[0] // Return first candidate; execFile will search PATH if just 'ffprobe'
}

let cachedFfprobePath: string | null = null

async function findWorkingFfprobe(): Promise<string> {
  if (cachedFfprobePath) return cachedFfprobePath

  const candidates = [
    join(app.getAppPath(), '..', 'ffmpeg', 'ffprobe.exe'),
    'ffprobe',  // Will use system PATH
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
  ]

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['-version'], { timeout: 5000 })
      cachedFfprobePath = candidate
      console.log(`[AI Analyzer] Found ffprobe at: ${candidate}`)
      return candidate
    } catch {
      continue
    }
  }

  console.warn('[AI Analyzer] No working ffprobe found! Audio metadata will be estimated from file extension.')
  return ''
}

export async function extractAudioMetadata(filePath: string): Promise<AudioMetadata> {
  const ffprobePath = await findWorkingFfprobe()
  let metadata: Partial<AudioMetadata> = {}

  if (ffprobePath) {
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ], { timeout: 10000 })

      const info = JSON.parse(stdout)
      const audioStream = info.streams?.find((s: any) => s.codec_type === 'audio')
      const fmt = info.format || {}

      metadata = {
        duration: parseFloat(audioStream?.duration || fmt.duration || '0'),
        sampleRate: parseInt(audioStream?.sample_rate || '0'),
        channels: parseInt(audioStream?.channels || '0'),
        bitrate: Math.round(parseInt(audioStream?.bit_rate || fmt.bit_rate || '0') / 1000),
        codec: audioStream?.codec_name || 'unknown',
        fileSize: parseInt(fmt.size || '0'),
        format: fmt.format_name || audioStream?.codec_name || 'unknown'
      }
      console.log(`[AI Analyzer] Metadata extracted: dur=${metadata.duration}s sr=${metadata.sampleRate}Hz ch=${metadata.channels} br=${metadata.bitrate}kbps codec=${metadata.codec}`)
    } catch (err) {
      console.warn('[AI Analyzer] ffprobe failed:', (err as Error).message)
    }

    // Try loudness analysis if basic extraction succeeded
    if (metadata.duration && metadata.duration > 0) {
      try {
        const { stdout } = await execFileAsync(ffprobePath, [
          '-v', 'quiet',
          '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
          '-f', 'null',
          '-',
        ].concat(['-i', filePath]), { timeout: 15000 })

        const jsonMatch = stdout.match(/\{[^{]*"input_i"[^}]*\}/)
        if (jsonMatch) {
          const loudness = JSON.parse(jsonMatch[0])
          metadata.loudnessIntegratedLUFS = parseFloat(loudness.input_i || '0')
          metadata.loudnessRangeLU = parseFloat(loudness.input_lra || '0')
          metadata.truePeakDB = parseFloat(loudness.input_tp || '0')
        }
      } catch {
        // Loudness is optional
      }
    }
  }

  // Fill defaults for anything missing
  metadata.peakDB = metadata.truePeakDB || (metadata.bitrate && metadata.bitrate > 200 ? -3 : -6)
  metadata.rmsDB = metadata.loudnessIntegratedLUFS || (metadata.bitrate && metadata.bitrate > 128 ? -18 : -23)
  metadata.loudnessIntegratedLUFS = metadata.loudnessIntegratedLUFS || -20
  metadata.loudnessRangeLU = metadata.loudnessRangeLU || 8
  metadata.duration = metadata.duration || 0
  metadata.sampleRate = metadata.sampleRate || 44100
  metadata.channels = metadata.channels || (metadata.codec === 'mp3' ? 2 : 1)
  metadata.bitrate = metadata.bitrate || (metadata.codec === 'mp3' ? 192 : metadata.codec === 'flac' ? 900 : 320)
  metadata.fileSize = metadata.fileSize || 0
  metadata.format = metadata.format || 'unknown'
  metadata.codec = metadata.codec || 'unknown'

  return metadata as AudioMetadata
}

// ---- AI Analysis ----

function buildAnalyzePrompt(metadata: AudioMetadata, fileName: string): string {
  // Build a lightweight audio profile — only duration matters for context
  const dur = metadata.duration.toFixed(1)
  const durHint = metadata.duration < 0.5 ? '极短促（<0.5s），适合单次事件触发'
    : metadata.duration < 2 ? '短音效（<2s），适合动作反馈'
    : metadata.duration < 10 ? '中等长度，适合强调或过渡'
    : '长音频，适合环境铺底或循环'

  return `你是一位专业音效库的标注员。你的任务是帮用户快速理解这个声音是"什么"、用在"哪里"、听起来像"什么"。想象你在给一个游戏开发者或视频剪辑师推荐这个音效——他们不关心波形参数，只想知道"这个声音像什么？我什么时候用？"

## 音频文件
文件名: "${fileName}"
时长: ${dur}秒（${durHint}）

## 输出要求（最重要）

### 你必须关注的四个维度：
1. **形象描述**：用日常语言描述这个声音听起来像什么。比如"清脆的金属叮当声""连绵不断的流水声""密集的哒哒哒枪声"
2. **使用场景**：具体在什么情况下会用这个声音。比如"玩家射击时""下雨天背景""UI按钮按下反馈""角色跳跃落地"
3. **关联关键词**：搜索时可能用到的词，包括同义词、近义词、相关词
4. **拟声词**：这个声音的文字化模拟（如 哗啦啦、叮当、轰隆、嗖、咔嚓）

### 绝对禁止：
- ❌ 不要分析"音色质感""动态范围""频率响应""压缩感""空间宽度"等音频工程术语
- ❌ 不要出现"编码质量较低""建议替换为无损版本""采样率""比特率""声道""LUFS"等技术参数
- ❌ 不要说"短音效""音频文件""MP3格式"等无意义的废话
- ❌ 不要输出任何关于编码/格式的评价

## 返回 JSON（只返回JSON，不要其他文字）：

{
  "description": "一句话说明这是什么声音、听起来像什么。例如：'连续快速的机枪扫射声，哒哒哒的密集弹道音'",
  "detailedDescription": "2-3句话的形象化描述：①这个声音听起来是什么样子的（用比喻和感官语言）；②适合配合什么画面或情境；③和其他类似声音有什么不同。",
  "scenario": "4-6个具体使用场景，用逗号分隔。必须非常具体：'FPS游戏射击音效、战斗场景火力压制、机关枪开火反馈、动作片枪战配乐、游戏武器音效'",
  "tags": [
    {"name": "标签名", "category": "类别", "confidence": 0.95}
  ],
  "emotion": "情绪感受（如：紧张/欢快/悬疑/震撼/平静/激昂/恐怖/温暖/中性）",
  "qualityScore": 5,
  "moodEnergy": 7,
  "isLoopable": false,
  "variantOf": null
}

## 标签规则
- category 只能是以下之一：动作音效 / 环境氛围 / UI转场 / 乐器音乐 / 人声 / 机械科技 / 自然音效 / 拟声词
- 必须提供 4-7 个标签
- 至少覆盖 2 个不同 category
- **标签必须有实际意义**，要包含：①内容词（如 金币/水流/枪声/脚步）②用法词（如 获得物品/背景音/UI反馈）③拟声/形容词（如 叮当/哗啦啦/清脆/密集）
- 好标签示例（流水音效）：["水流","河流","自然音效","水花","哗啦啦","环境氛围"]
- 坏标签示例：["短音效","音频","低码率","音效","MP3","未分类"]

## 拟声词示例参考
- 金属碰撞：叮当、铛铛、哐当、锵
- 水流：哗啦啦、潺潺、滴答、咕噜
- 爆炸：轰隆、砰、嘭、轰
- 枪械/射击：哒哒哒、砰、噼里啪啦、突突
- 风：呼呼、嗖、呜呜
- 脚步：哒哒、咚咚、沙沙
- 开关/机械：咔哒、咔嚓、吱嘎
- 火：噼啪、呼呼
- 动物：汪汪、喵喵、嘶吼、嗡嗡

## 文件名理解指南
文件名通常直接说明了内容。"扫射1"= 扫射/机枪射击，"金币"= 金币获得音效，"脚步声_草地"= 草地上的脚步声。以文件名为第一判断依据。

再次强调：只输出一个 JSON 对象，不要 \`\`\`json 标记，不要解释文字。`
}

/**
 * Build a human-readable audio fingerprint from technical metadata.
 * This gives the LLM rich context even without actual audio playback.
 */
function buildAudioFingerprint(m: AudioMetadata, fileName: string): string {
  const lines: string[] = []

  lines.push(`- 时长: ${m.duration.toFixed(2)} 秒 (${m.duration < 0.5 ? '极短瞬态/冲击型' : m.duration < 2 ? '短音效' : m.duration < 10 ? '中等长度' : '长音效/环境音'})`)
  lines.push(`- 采样率: ${m.sampleRate} Hz (${m.sampleRate >= 48000 ? '高保真' : m.sampleRate >= 44100 ? 'CD品质' : '低采样率'})`)
  lines.push(`- 声道: ${m.channels} (${m.channels === 1 ? '单声道' : m.channels === 2 ? '立体声' : '多声道'})`)
  lines.push(`- 比特率: ${m.bitrate} kbps (${m.bitrate > 320 ? '无损/高品质' : m.bitrate > 192 ? '高品质' : m.bitrate > 128 ? '标准' : '低码率'})`)
  lines.push(`- 编解码: ${m.codec.toUpperCase()} (${getCodecCharacteristics(m.codec)})`)
  lines.push(`- 文件大小: ${(m.fileSize / 1024).toFixed(1)} KB`)
  lines.push(`- 综合响度: ${m.loudnessIntegratedLUFS.toFixed(1)} LUFS (${interpretLoudness(m.loudnessIntegratedLUFS)})`)
  lines.push(`- 动态范围: ${m.loudnessRangeLU.toFixed(1)} LU (${m.loudnessRangeLU > 14 ? '很大动态/对比强烈' : m.loudnessRangeLU > 8 ? '中等动态' : '压缩/平稳'})`)

  // Infer likely sound type from filename as a hint (but tell AI to verify with parameters)
  const nameHints = inferFromFileName(fileName)
  if (nameHints.length > 0) {
    lines.push('')
    lines.push(`### 文件名线索（仅供参考，以技术参数为准）`)
    lines.push(...nameHints.map(h => `- ${h}`))
  }

  return lines.join('\n')
}

function getCodecCharacteristics(codec: string): string {
  const map: Record<string, string> = {
    mp3: '有损压缩，高频可能有预回声伪影',
    flac: '无损压缩，完整保留原始波形',
    wav: '未压缩 PCM，最高保真',
    aac: '高效有损，低码率表现好',
    ogg: '开源有损，Vorbis 编码',
    m4a: 'AAC 封装，通常质量不错',
    aiff: 'Mac 原生无损格式',
    pcm: '原始脉冲编码，无压缩',
  }
  return map[codec.toLowerCase()] || '未知编码特性'
}

function interpretLoudness(lufs: number): string {
  if (lufs > -8) return '非常大声/接近满电平'
  if (lufs > -14) return '大声/正常音效水平'
  if (lufs > -20) return '中等响度'
  if (lufs > -28) return '较安静'
  return '非常安静/背景音级别'
}

function inferFromFileName(name: string): string[] {
  const hints: string[] = []
  const lower = name.toLowerCase()

  // === 获得/奖励类（最高优先级）===
  if (/金币|coin|gold|银币|silver/.test(lower)) hints.push('文件名含"金币/硬币" → 这是拾取/获得类奖励音效')
  if (/拾取|collect|pickup|收集|获得|获取|reward|掉落|drop|loot/.test(lower)) hints.push('文件名含"拾取/收集/获得/掉落" → 物品获取或掉落反馈音')
  if (/升级|level.?up|upgrade|解锁|unlock|成就|achievement/.test(lower)) hints.push('文件名含"升级/解锁/成就" → 角色成长或目标达成提示音')

  // === 战斗动作类 ===
  if (/金属|铁|钢|铜.*击|撞|敲|打|hit.*metal|clash|cling/.test(lower) && !/金币|coin/.test(lower))
    hints.push('文件名含"金属/击/撞" → 可能是金属类撞击或碰撞音效')
  if (/攻击|attack|strike|砍|劈|slash|stab|射击|shoot/.test(lower)) hints.push('文件名含"攻击/砍/射击" → 战斗动作音效')
  if (/受击|hurt|受伤|damage|pain/.test(lower)) hints.push('文件名含"受击/受伤" → 角色受伤害反馈')
  if (/爆炸|explosion|boom|blast/.test(lower)) hints.push('文件名含"爆炸" → 强瞬态冲击音效')

  // === 移动交互类 ===
  if (/木|门|地板|脚步|wood|foot|step|door/.test(lower)) hints.push('文件名含木质/门/脚 → 可能是环境交互音效')
  if (/跳跃|jump|hop|leap/.test(lower)) hints.push('文件名含"跳跃" → 角色移动动作音效')

  // === UI界面类 ===
  if (/ui|界面|通知|提醒|notify|alert|click|pop|按钮|确认|错误/.test(lower)) hints.push('文件名含UI/点击/通知 → 界面交互音效')

  // === 环境氛围类 ===
  if (/水|雨|海|波浪|流|滴|splash|water|rain|ocean/.test(lower)) hints.push('文件名含水相关 → 液体质感环境音')
  if (/火|爆炸|boom|explosion|blast/.test(lower) && !/explosi/.test(lower)) hints.push('文件名含火 → 火焰燃烧环境音')
  if (/风|空气|呼啸|wind|air|whoosh/.test(lower)) hints.push('文件名含风/空气 → 气流/环境噪声类')
  if (/玻璃|破碎|glass|break|shatter/.test(lower)) hints.push('文件名含玻璃/破碎 → 高频脆裂音效')
  if (/城市|city|街道|森林|forest|洞穴|cave/.test(lower)) hints.push('文件名含地点词 → 特定场景环境音')

  // === 生物声音类 ===
  if (/人声|说话|喊叫|voice|speak|shout|vocals/.test(lower)) hints.push('文件名含人声 → 需注意语言内容')
  if (/动物|狗|猫|鸟|monster|beast/.test(lower)) hints.push('文件名含动物/怪物 → 生物发声')
  if (/人群|crowd|嘈杂/.test(lower)) hints.push('文件名含人群 → 群体环境噪音')

  // === 音乐乐器类 ===
  if (/音乐|music|bgm|melody|piano|guitar|drum/.test(lower)) hints.push('文件名含音乐相关 → 乐器/乐句片段')

  // Duration-based hint only when no filename keywords matched
  if (hints.length === 0) {
    hints.push(`文件名"${name}"无明确类别关键词，需结合技术参数判断用途`)
  }

  return hints.slice(0, 5)
}

async function callAIAPI(config: ModelConfig, prompt: string, isAnalysis: boolean = false, externalSignal?: AbortSignal): Promise<string> {
  const systemPrompt = '你是一个专业的音频分析和音效设计助手。始终返回严格的 JSON，不包含任何额外解释或 markdown 标记。如果用户要求 JSON 输出，你必须且只能输出一个 JSON 对象。'
  const userMessage = { role: 'user' as const, content: prompt }
  const systemMessage = { role: 'system' as const, content: systemPrompt }

  // Combine the caller's cancel signal with a hard safety timeout so the
  // request can never hang the UI forever.
  const controller = new AbortController()
  let safetyTimer: ReturnType<typeof setTimeout> | undefined
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  safetyTimer = setTimeout(() => controller.abort(), MAX_ANALYSIS_MS)

  // Use larger token limit for analysis (rich output), smaller for simple calls
  const effectiveMaxTokens = isAnalysis ? Math.max(config.maxTokens || 2000, 2000) : (config.maxTokens || 1000)

  console.log(`[AI Analyzer] Calling ${config.provider}: ${config.endpoint} with model ${config.model}, maxTokens=${effectiveMaxTokens}`)

  // Anthropic Claude
  try {
  if (config.provider === 'anthropic') {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: effectiveMaxTokens,
        temperature: config.temperature || 0.3,
        messages: [userMessage],
        system: systemPrompt
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`AI API error ${response.status}: ${text.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text
    if (!content) {
      throw new Error(`AI API returned empty content: ${JSON.stringify(data).slice(0, 200)}`)
    }
    return extractJSON(content)
  }

  // Google Gemini
  if (config.provider === 'gemini') {
    const endpoint = config.endpoint.endsWith(':generateContent') ? config.endpoint : `${config.endpoint}:generateContent`
    const response = await fetch(`${endpoint}?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
        generationConfig: {
          maxOutputTokens: effectiveMaxTokens,
          temperature: config.temperature || 0.3
        }
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`AI API error ${response.status}: ${text.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      throw new Error(`AI API returned empty content: ${JSON.stringify(data).slice(0, 200)}`)
    }
    return extractJSON(content)
  }

  // Ollama local
  if (config.provider === 'ollama') {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [systemMessage, userMessage],
        stream: false,
        options: {
          temperature: config.temperature || 0.3,
          num_predict: effectiveMaxTokens
        }
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`AI API error ${response.status}: ${text.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.message?.content
    if (!content) {
      throw new Error(`AI API returned empty content: ${JSON.stringify(data).slice(0, 200)}`)
    }
    return extractJSON(content)
  }

  // OpenAI-compatible (openai, deepseek, qwen, kimi, doubao, siliconflow, azure, tokendance, custom)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (config.provider === 'azure') {
    headers['api-key'] = config.apiKey
  } else if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const body: Record<string, any> = {
    model: config.model,
    messages: [systemMessage, userMessage],
    max_tokens: effectiveMaxTokens,
    temperature: config.temperature || 0.3,
  }

  // Only add response_format for providers that reliably support it
  const reliableJsonProviders = ['openai', 'deepseek']
  if (reliableJsonProviders.includes(config.provider)) {
    body.response_format = { type: 'json_object' }
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI API error ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = await response.json()
  const rawContent = data.choices?.[0]?.message?.content

  if (!rawContent) {
    throw new Error(`AI API returned empty content: ${JSON.stringify(data).slice(0, 200)}`)
  }

  return extractJSON(rawContent)
  } finally {
    if (safetyTimer) clearTimeout(safetyTimer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Robust JSON extraction from LLM output.
 * Handles: plain JSON, markdown code blocks, JSON wrapped in text, trailing commas.
 */
function extractJSON(raw: string): string {
  let cleaned = raw.trim()

  // Remove markdown code blocks
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '')

  // Try direct parse first
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {}

  // Try to find JSON object in the text
  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      JSON.parse(objectMatch[0])
      return objectMatch[0]
    } catch {}
  }

  // Fix common issues and retry
  let fixed = cleaned
  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, '$1')
  // Remove single-line comments
  fixed = fixed.replace(/\/\/.*$/gm, '')
  // Remove BOM or weird characters
  fixed = fixed.replace(/^\uFEFF/, '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '')

  try {
    JSON.parse(fixed)
    return fixed
  } catch {}

  // Last resort: try extracting from object match after fixing
  const fixedObjectMatch = fixed.match(/\{[\s\S]*\}/)
  if (fixedObjectMatch) {
    return fixedObjectMatch[0]
  }

  // Give up - return original
  console.warn('[AI Analyzer] Could not extract valid JSON from response. Raw (first 300 chars):', cleaned.slice(0, 300))
  return cleaned
}

function getDefaultConfig(): ModelConfig {
  return {
    provider: 'deepseek',
    apiKey: '',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    maxTokens: 2000,
    temperature: 0.3
  }
}

// ---- Config management ----

let cachedConfig: ModelConfig | null = null

export function setModelConfig(config: ModelConfig): void {
  cachedConfig = config
}

export function getModelConfig(): ModelConfig {
  return cachedConfig || getDefaultConfig()
}

// ---- Main analyze function ----

export async function analyzeAudio(
  filePath: string,
  fileName: string,
  metadata: AudioMetadata,
  configOverride?: Partial<ModelConfig>,
  options?: { signal?: AbortSignal }
): Promise<AIAnalysisResult> {
  const config = { ...getModelConfig(), ...configOverride }

  if (!config.apiKey) {
    throw new Error('AI_API_KEY_NOT_SET')
  }

  const prompt = buildAnalyzePrompt(metadata, fileName)

  try {
    const rawJson = await callAIAPI(config, prompt, true, options?.signal)
    const result = JSON.parse(rawJson) as AIAnalysisResult

    // Validate required fields
    if (!result.description) {
      throw new Error('AI returned no description field')
    }

    // Validate and fix tags
    if (!result.tags || !Array.isArray(result.tags)) {
      console.warn('[AI Analyzer] No tags in result, generating from description')
      result.tags = generateTagsFromDescription(result.description, fileName)
    }

    // Ensure all tags have required fields
    result.tags = result.tags.map(t => ({
      name: t.name || '',
      category: t.category || '其他',
      confidence: typeof t.confidence === 'number' ? t.confidence : 0.8
    })).filter(t => t.name)

    // Ensure minimum tags
    if (result.tags.length < 3) {
      const extraTags = generateTagsFromDescription(result.description, fileName)
      const existingNames = new Set(result.tags.map(t => t.name))
      for (const tag of extraTags) {
        if (!existingNames.has(tag.name) && result.tags.length < 6) {
          result.tags.push(tag)
          existingNames.add(tag.name)
        }
      }
    }

    // Fill defaults for optional fields
    result.emotion = result.emotion || inferEmotion(metadata, result.description)
    result.qualityScore = result.qualityScore || inferQuality(metadata)
    result.moodEnergy = result.moodEnergy || inferEnergy(metadata)
    result.isLoopable = result.isLoopable || false
    result.detailedDescription = result.detailedDescription || expandDescription(result.description, metadata, fileName)
    result.scenario = result.scenario || inferScenario(metadata, result.description, fileName)
    result.variantOf = result.variantOf || null

    // Strip any encoding-quality reminders the model may have added
    // (e.g. "编码质量较低，建议替换为无损版本"). These are not
    // useful and were previously appearing on many sounds.
    result.description = sanitizeText(result.description)
    result.detailedDescription = sanitizeText(result.detailedDescription)
    result.scenario = sanitizeText(result.scenario)
    result.emotion = sanitizeText(result.emotion)
    result.tags = (result.tags || [])
      .map(t => ({ ...t, name: sanitizeText(t.name) }))
      .filter(t => t.name)

    return result
  } catch (err) {
    if ((err as Error).message === 'AI_API_KEY_NOT_SET') {
      throw err
    }
    // Aborted (user cancel or safety timeout) -> propagate so the caller can
    // mark this analysis as cancelled instead of writing a bogus fallback.
    const e = err as Error
    if (e.name === 'AbortError' || /the operation was aborted/i.test(e.message) || /aborted/i.test(e.message)) {
      throw err
    }

    console.warn(`[AI Analyzer] Full analysis failed: ${(err as Error).message}. Using smart fallback.`)

    // Smart fallback: use filename + metadata to generate useful results
    return generateSmartFallback(metadata, fileName)
  }
}

/**
 * Generate useful tags from description when AI didn't provide enough.
 */
function generateTagsFromDescription(description: string, fileName: string): Array<{ name: string; category: string; confidence: number }> {
  const tags: Array<{ name: string; category: string; confidence: number }> = []
  const lowerDesc = description.toLowerCase() + ' ' + fileName.toLowerCase()

  // Category mapping with keywords
  const categoryKeywords: Array<{ category: string; keywords: string[] }> = [
    { category: '动作音效', keywords: ['撞击', '击打', '碰撞', '冲击', '碎', '破', '爆', 'hit', 'impact', 'crash', 'bang', 'smash', 'strike'] },
    { category: '机械科技', keywords: ['金属', '机器', '电子', '电机', '引擎', 'metal', 'machine', 'engine', 'tech', 'robot', '机械', '科技'] },
    { category: '环境氛围', keywords: ['风', '雨', '水', '火', '环境', '气氛', 'ambience', 'atmosphere', 'weather', 'nature'] },
    { category: 'UI转场', keywords: ['点击', '弹出', '过渡', '通知', 'ui', 'click', 'pop', 'transition', 'notify', 'alert', ' swoosh'] },
    { category: '人声', keywords: ['人', '喊', '叫', '笑', '哭', 'voice', 'human', 'vocal', 'speak', 'shout'] },
    { category: '动物', keywords: ['动物', '狗', '猫', '鸟', 'animal', 'dog', 'cat', 'bird'] },
    { category: '乐器音乐', keywords: ['钢琴', '吉他', '鼓', '弦', '管', 'piano', 'guitar', 'drum', 'music', 'instrument'] },
  ]

  for (const { category, keywords } of categoryKeywords) {
    for (const kw of keywords) {
      if (lowerDesc.includes(kw)) {
        const tagName = keywords.find(k => lowerDesc.includes(k)) || kw
        if (!tags.some(t => t.name === tagName)) {
          tags.push({ name: tagName, category, confidence: 0.85 })
        }
        break
      }
    }
  }

  return tags.slice(0, 5)
}

/**
 * Smart fallback that generates meaningful analysis from filename + metadata
 * even when the AI call completely fails.
 */
function generateSmartFallback(metadata: AudioMetadata, fileName: string): AIAnalysisResult {
  const desc = inferDescriptionFromFile(metadata, fileName)
  const tags = generateSmartTags(metadata, fileName)
  const scenario = inferScenario(metadata, desc, fileName)

  return {
    description: desc,
    detailedDescription: expandDescription(desc, metadata, name),
    scenario,
    tags,
    emotion: inferEmotion(metadata, desc),
    qualityScore: inferQuality(metadata),
    moodEnergy: inferEnergy(metadata),
    isLoopable: metadata.duration > 3 && metadata.duration < 30,
    variantOf: null
  }
}

function inferDescriptionFromFile(m: AudioMetadata, name: string): string {
  const lower = name.replace(/\.[^.]+$/, '').toLowerCase()

  // === 获得奖励类 ===
  if (/金币|银币|硬币|coin|gold|money|拾取|收集|collect|pickup|获得|获取|reward/.test(lower))
    return `${m.duration < 0.5 ? '清脆短促' : '明亮悦耳'}的${/金币|coin|gold/.test(lower) ? '金币' : /银币|silver/.test(lower) ? '银币' : '物品'}获得音效，带有上升感的金属叮当声`
  if (/升级|level.?up|upgrade|解锁|unlock|成就|achievement/.test(lower))
    return '角色升级或达成成就时的激励反馈音效'
  if (/掉落|drop|loot|战利品/.test(lower))
    return '物品掉落或拾取时的收获提示音'

  // === 战斗动作类 ===
  if (/击中金属|金属.*击|hit.*metal|clash|clang/.test(lower))
    return '金属撞击音效，武器命中护甲或金属物体的清脆碰撞声'
  if (/攻击|attack|strike|砍|劈|slash|stab/.test(lower))
    return '近战攻击命中音效'
  if (/受击|受伤|hurt|damage|hit|pain/.test(lower))
    return '角色受到伤害时的受击反馈音效'
  if (/爆炸|explosion|boom|blast|bang/.test(lower))
    return '爆炸冲击音效'
  if (/射击|shoot|fire|gun|bullet/.test(lower))
    return /扫射|sweep|machine|机枪|mg/.test(lower) ? '连续快速的机枪扫射声，密集的哒哒哒弹道音效' : '枪械射击或投射物发射音效'
  if (/枪|gun|rifle|pistol|ak|m4/.test(lower))
    return /扫射|sweep|machine|机枪|mg/.test(lower) ? '连续快速的机枪扫射声，密集的哒哒哒弹道音效' : '枪械射击音效'

  // === 移动交互类 ===
  if (/脚步|footstep|foot|step|walk|run/.test(lower))
    return `${/草地|grass|野外/.test(lower) ? '户外' : /室内|indoor|stone|石头/.test(lower) ? '石地' : ''}脚步声`
  if (/跳跃|jump|hop|leap/.test(lower))
    return '角色跳跃起落音效'
  if (/开门|关门|door|open|close/.test(lower))
    return '开关门交互音效'

  // === UI界面类 ===
  if (/ui|click|pop|notify|button|按钮|点击/.test(lower))
    return 'UI 界面操作反馈音效'
  if (/确认|confirm|ok|success|正确/.test(lower))
    return '操作成功或确认提示音效'
  if (/错误|error|fail|cancel|取消|警告|warn/.test(lower))
    return '操作失败或警告提示音效'

  // === 环境氛围类 ===
  if (/风|wind|whoosh|气流/.test(lower))
    return '风声或气流环境音效'
  if (/雨|rain|水|water|splash|波浪|wave/.test(lower))
    return /rain|雨/.test(lower) ? '下雨环境音效' : '水/液体环境音效'
  if (/火|fire|flame|燃烧|burning/.test(lower))
    return '火焰燃烧环境音效'
  if (/城市|city|街道|street|traffic/.test(lower))
    return '城市环境背景音效'
  if (/森林|forest|鸟|bird|自然|nature/.test(lower))
    return '自然环境氛围音效'

  // === 生物声音类 ===
  if (/怪物|monster|beast|野兽|咆哮|roar/.test(lower))
    return '怪物或猛兽叫声'
  if (/动物|animal|dog|cat|bird/.test(lower))
    return '动物叫声'
  if (/人群|crowd|嘈杂|ambient/.test(lower))
    return '人群环境噪音'

  // === 音乐乐器类 ===
  if (/音乐|music|bgm|旋律|melody/.test(lower))
    return '音乐片段或旋律音效'
  if (/piano|钢琴|guitar|吉他|drum|鼓|violin|弦乐/.test(lower))
    return '乐器演奏音效'

  // === 最后兜底：基于文件名关键词智能推断 ===
  const nameOnly = lower.replace(/[\d_\-.\s()（）【】\[\]]+/g, '')
  if (nameOnly.length > 0) {
    return `${nameOnly}相关音效`
  }

  return '未分类音频文件'
}

function generateSmartTags(m: AudioMetadata, name: string): Array<{ name: string; category: string; confidence: number }> {
  const tags: Array<{ name: string; category: string; confidence: number }> = []
  const lower = name.toLowerCase()
  const added = new Set<string>()

  const addTag = (name: string, category: string, conf: number) => {
    if (!added.has(name)) {
      tags.push({ name, category, confidence: conf })
      added.add(name)
    }
  }

  // === 获得奖励类 ===
  if (/金币|coin|gold|硬币/.test(lower)) { addTag('金币', 'UI转场', 0.95); addTag('获得物品', '动作音效', 0.90); addTag('奖励音效', 'UI转场', 0.88); }
  if (/银币|silver/.test(lower)) addTag('银币', 'UI转场', 0.95)
  if (/拾取|collect|pickup|收集|获得|获取/.test(lower)) { addTag('拾取', '动作音效', 0.92); addTag('获得物品', 'UI转场', 0.88); }
  if (/升级|level.?up|upgrade/.test(lower)) { addTag('升级', 'UI转场', 0.95); addTag('提示音效', 'UI转场', 0.85); }
  if (/解锁|unlock|成就|achievement/.test(lower)) addTag('解锁', 'UI转场', 0.92)
  if (/掉落|drop|loot/.test(lower)) addTag('掉落', '动作音效', 0.90)
  if (/奖励|reward|bonus/.test(lower)) addTag('奖励', 'UI转场', 0.93)

  // === 战斗动作类 ===
  if (/击中|hit|impact|命中/.test(lower)) addTag('击中', '动作音效', 0.94)
  if (/金属|metal|铁|钢|铜/.test(lower)) addTag('金属', '机械科技', 0.88)
  if (/攻击|attack|strike|砍|劈/.test(lower)) addTag('攻击', '动作音效', 0.92)
  if (/受击|hurt|受伤|damage/.test(lower)) addTag('受击', '动作音效', 0.93)
  if (/爆炸|explosion|boom/.test(lower)) addTag('爆炸', '动作音效', 0.94)
  if (/射击|shoot|gun|fire/.test(lower)) addTag('射击', '动作音效', 0.91)
  if (/武器|weapon|剑|刀|枪/.test(lower)) addTag('战斗', '动作音效', 0.87)

  // === 移动交互类 ===
  if (/脚步|foot|step|walk|run/.test(lower)) addTag('脚步声', '环境氛围', 0.93)
  if (/跳跃|jump|hop/.test(lower)) addTag('跳跃', '动作音效', 0.91)
  if (/开门|关门|door/.test(lower)) addTag('开关门', '环境氛围', 0.89)

  // === UI界面类 ===
  if (/ui|click|pop|notify|按钮|点击|确认|cancel|error/.test(lower)) addTag('UI反馈', 'UI转场', 0.89)
  if (/确认|success|ok|正确/.test(lower)) addTag('确认音效', 'UI转场', 0.90)
  if (/错误|error|fail|警告|warn/.test(lower)) addTag('警告音效', 'UI转场', 0.88)

  // === 环境氛围类 ===
  if (/风|wind|whoosh/.test(lower)) addTag('风声', '环境氛围', 0.90)
  if (/雨|rain|水|water/.test(lower)) addTag(/rain/.test(lower) ? '雨声' : '水声', '自然音效', 0.89)
  if (/火|fire|燃烧/.test(lower)) addTag('火焰', '环境氛围', 0.88)
  if (/城市|city|街道/.test(lower)) addTag('城市', '环境氛围', 0.86)
  if (/森林|forest|自然|nature/.test(lower)) addTag('自然环境', '自然音效', 0.87)

  // === 生物声音类 ===
  if (/怪物|monster|beast|咆哮|roar/.test(lower)) addTag('怪物叫声', '人声', 0.90)
  if (/动物|animal|dog|cat|bird/.test(lower)) addTag('动物', '自然音效', 0.88)
  if (/人群|crowd/.test(lower)) addTag('人群', '环境氛围', 0.85)

  // === 音乐乐器类 ===
  if (/音乐|music|bgm|旋律/.test(lower)) addTag('音乐', '乐器音乐', 0.88)
  if (/piano|钢琴/.test(lower)) addTag('钢琴', '乐器音乐', 0.92)
  if (/guitar|吉他/.test(lower)) addTag('吉他', '乐器音乐', 0.92)
  if (/drum|鼓/.test(lower)) addTag('鼓点', '乐器音乐', 0.90)

  // === 拟声词标签（根据文件名匹配自动补充） ===
  const onoMap: Record<RegExp, string> = [
    [/金币|coin|拾取|获得/, '叮当'],
    [/金属|击中|clash|cling/, '铛'],
    [/扫射|机枪|machine|sweep/, '哒哒哒'],
    [/射击|枪|gun|shoot/, '砰'],
    [/爆炸|boom|blast|bang/, '轰隆'],
    [/水|水流|water|rain|雨/, '哗啦啦'],
    [/风|wind|whoosh/, '呼呼'],
    [/脚步|foot|step/, '哒哒'],
    [/跳跃|jump|hop/, '咚'],
    [/开关门|door/, '咔嚓'],
    [/火|fire|燃烧/, '噼啪'],
    [/玻璃|glass|break/, '咔啦'],
  ]
  for (const [re, ono] of onoMap) {
    if (re.test(lower)) { addTag(ono, '拟声词', 0.80); break }
  }

  // === 如果文件名匹配太少，从名字本身提取关键词作为标签 ===
  if (tags.length < 3) {
    const keywords = lower.replace(/\.[^.]+$/, '').replace(/[\d_\-.\s()（）【】\[\]]+/g, '').split('')
    // Try to extract Chinese words or English tokens from filename
    const cnMatch = lower.match(/[\u4e00-\u9fff]{2,}/g)
    if (cnMatch) {
      for (const word of cnMatch) {
        if (!added.has(word) && word.length >= 2 && !/音效|音频|文件|sound|audio/.test(word)) {
          addTag(word, '其他', 0.75)
        }
      }
    }

    // Extract English meaningful tokens
    const enMatch = lower.match(/[a-z_]{3,}/g)
    if (enMatch) {
      for (const token of enMatch) {
        if (!added.has(token)) {
          addTag(token, '其他', 0.70)
        }
      }
    }
  }

  // Ensure minimum tags
  if (tags.length < 2) {
    if (m.duration < 2 && m.duration > 0) addTag(m.duration < 0.5 ? '瞬态音效' : '短音效', '动作音效', 0.60)
    else if (m.duration >= 2) addTag('环境音效', '环境氛围', 0.60)
  }

  return tags.slice(0, 7)
}

function expandDescription(desc: string, m: AudioMetadata, fileName: string): string {
  // Add usage-focused context — what kind of sound this is, when to use it.
  // Deliberately avoids ALL technical audio terms (timbre/dynamics/LUFS/channels).
  const usage: string[] = []

  // Duration → usage hint
  if (m.duration < 0.5) usage.push('极短促的瞬间音效，适合单次事件触发（如击中、点击、拾取）')
  else if (m.duration < 2) usage.push('短音效，适合动作反馈和UI交互提示')
  else if (m.duration < 10) usage.push('中等长度，可用于强调性事件或场景过渡')
  else usage.push('较长的声音，可直接用于环境背景铺底或循环播放')

  return `${desc}。${usage.join('，')}。`
}

/**
 * Strip any AI-originated encoding-quality reminders (e.g. "编码质量较低" /
 * "建议替换为无损版本") from analysis text. These are not useful to the user
 * and were previously showing up on many sounds.
 */
function sanitizeText(input: string): string {
  if (!input) return input
  return input
    // 编码质量类
    .replace(/（?注意[：:].*?无损版本.*?）?/g, '')
    .replace(/编码质量较低[^。，,；;]*?/g, '')
    .replace(/建议替换(为|成)?(更)?高质量(版本|源)?[^。，,；;]*?/g, '')
    .replace(/[^。，,；;]*?无损版本[^。，,；;]*?/g, '')
    // 音色质感 / 音频工程术语（用户明确不要这些）
    .replace(/音色质感[：:][^。，,；;]*？/g, '')
    .replace(/动态(范围|压缩)[^。，,；;]*？/g, '')
    .replace(/(立体声|单声道|多声道)[^。，,；;]*？/g, '')
    .replace(/响度[^。，,；;]{0,15}？/g, '')
    .replace(/空间(感|宽度)[^。，,；;]*？/g, '')
    .replace(/起音|attack|衰减|频率响应|高频细节|低频[^。，,；;]{0,10}？/g, '')
    .replace(/采样率\d*Hz[^。，,；;]*？/g, '')
    .replace(/比特率\d*kbps[^。，,；;]*？/g, '')
    .replace(/LUFS[^。，,；;]*？/g, '')
    .replace(/PCM[^。，,；;]*？/g, '')
    .replace(/(边界清晰|层次丰富|听感平稳|冲击感强|克制内敛)[^。，,；;]*？/g, '')
    .replace(/(有损|无损)(压缩|格式|PCM)[^。，,；;]*？/g, '')
    // 清理残留标点
    .replace(/，{2,}/g, '，')
    .replace(/。{2,}/g, '。')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function inferEmotion(m: AudioMetadata, desc: string): string {
  const lower = desc.toLowerCase()

  if (/恐怖|惊悚|黑暗|horror|scary|creep/.test(lower)) return '恐怖'
  if (/欢乐|欢快|愉快|happy|joy|cheerful/.test(lower)) return '欢乐'
  if (/悲伤|忧伤|sad|sorrow|melanchol/.test(lower)) return '悲伤'
  if (/紧张|intense|urgent|danger|激昂|epic/.test(lower)) return '紧张'
  if (/温馨|温暖|warm|cozy|gentle/.test(lower)) return '温馨'
  if (/悬疑|mystery|suspen/.test(lower)) return '悬疑'
  if (/震撼|powerful|impact|explosi/.test(lower)) return '震撼'
  if (m.loudnessIntegratedLUFS > -10 && m.duration < 1) return '激昂'
  if (m.loudnessIntegratedLUFS < -25 || m.duration > 10) return '平静'

  return '中性'
}

function inferQuality(m: AudioMetadata): number {
  let score = 3 // baseline

  if (m.codec === 'flac' || m.codec === 'wav' || m.codec === 'aiff') score += 1
  else if (m.codec === 'aac' || m.codec === 'ogg') score += 0
  else if (m.codec === 'mp3' && m.bitrate >= 256) score += 0.5
  else if (m.codec === 'mp3' && m.bitrate < 128) score -= 1

  if (m.sampleRate >= 48000) score += 0.5
  else if (m.sampleRate < 22050) score -= 1

  if (m.bitrate > 320) score += 0.5
  else if (m.bitrate < 96) score -= 0.5

  return Math.max(1, Math.min(5, Math.round(score)))
}

function inferEnergy(m: AudioMetadata): number {
  let energy = 5 // baseline

  // Short loud sounds are high energy
  if (m.duration < 0.3 && m.loudnessIntegratedLUFS > -10) energy = 9
  else if (m.duration < 1 && m.loudnessIntegratedLUFS > -14) energy = 7
  else if (m.duration < 0.5) energy = 6
  else if (m.duration > 10) energy = 3
  else if (m.loudnessIntegratedLUFS < -25) energy = 2

  // High bitrate often means more dynamic content
  if (m.bitrate > 300) energy = Math.min(10, energy + 1)

  return Math.max(1, Math.min(10, energy))
}

function inferScenario(m: AudioMetadata, desc: string, name: string): string {
  const scenarios: string[] = []
  const lower = (desc + ' ' + name).toLowerCase()

  // === 获得奖励类 ===
  if (/金币|coin|银币|拾取|收集|collect|pickup|获得|获取/.test(lower)) {
    scenarios.push('角色拾取金币或物品')
    scenarios.push('获得道具奖励')
    scenarios.push('商城购买确认')
    scenarios.push('任务完成提示')
  }
  if (/升级|level.?up|upgrade|解锁|unlock|成就/.test(lower)) {
    scenarios.push('角色升级提示音')
    scenarios.push('成就解锁通知')
    scenarios.push('技能习得反馈')
  }

  // === 战斗动作类 ===
  if (/击中|hit|impact|命中|金属.*击/.test(lower)) scenarios.push('武器命中护甲或金属物体')
  if (/攻击|attack|strike|砍|劈|射击/.test(lower)) scenarios.push('战斗攻击动作')
  if (/受击|hurt|受伤|damage/.test(lower)) scenarios.push('角色受到伤害反馈')
  if (/爆炸|explosion|boom/.test(lower)) scenarios.push('爆破/冲击场景')
  if (/金属|metal|铁|钢/.test(lower) && !/拾取|获得/.test(lower)) scenarios.push('金属碰撞交互')

  // === 移动交互类 ===
  if (/脚步|footstep|foot|step|walk|run/.test(lower)) scenarios.push('角色移动脚步声')
  if (/跳跃|jump|hop/.test(lower)) scenarios.push('角色跳跃起落')
  if (/门|door|open|close/.test(lower)) scenarios.push('开关门交互')

  // === UI界面类 ===
  if (/ui|click|pop|notify|按钮|点击|确认/.test(lower)) scenarios.push('UI 界面操作反馈')
  if (/错误|error|fail|取消|警告/.test(lower)) scenarios.push('操作失败警告')

  // === 环境氛围类 ===
  if (/风|wind|whoosh|气流/.test(lower)) scenarios.push('户外风声环境')
  if (/雨|rain/.test(lower)) scenarios.push('下雨场景氛围')
  if (/水|water|splash/.test(lower) && !/rain/.test(lower)) scenarios.push('水/液体环境')
  if (/火|fire|燃烧/.test(lower)) scenarios.push('火焰燃烧环境')
  if (/城市|city|街道/.test(lower)) scenarios.push('城市街景背景')
  if (/森林|forest|自然|nature|鸟/.test(lower)) scenarios.push('自然环境氛围')

  // === 生物声音类 ===
  if (/怪物|monster|beast|咆哮|roar/.test(lower)) scenarios.push('Boss战/怪物出现')
  if (/动物|animal/.test(lower)) scenarios.push('自然界生物环境')

  // === 音乐乐器类 ===
  if (/音乐|music|bgm|旋律|piano|guitar|drum/.test(lower)) scenarios.push('背景音乐/配乐片段')

  // === Generic fallback based on duration ===
  if (scenarios.length === 0) {
    if (m.duration < 1) {
      scenarios.push('游戏/UI 事件反馈音效')
    } else if (m.duration < 5) {
      scenarios.push('游戏/影视事件音效')
    } else {
      scenarios.push('背景环境音效铺底')
    }
  }

  return [...new Set(scenarios)].slice(0, 5).join('、')
}

// ---- Batch analyze ----

export async function batchAnalyze(
  files: Array<{ id: string; file_path?: string; filePath?: string; file_name?: string; fileName?: string }>,
  onProgress?: (current: number, total: number, id: string) => void,
  options?: { signal?: AbortSignal }
): Promise<Array<{ id: string; result: AIAnalysisResult }>> {
  const results: Array<{ id: string; result: AIAnalysisResult }> = []
  const total = files.length

  for (let i = 0; i < files.length; i++) {
    // Honor cancellation between items.
    if (options?.signal?.aborted) break
    const file = files[i]
    // Support both snake_case (from DB query) and camelCase
    const filePath = file.filePath || file.file_path || ''
    const fileName = file.fileName || file.file_name || 'unknown'
    try {
      const metadata = await extractAudioMetadata(filePath)
      const result = await analyzeAudio(filePath, fileName, metadata, undefined, { signal: options?.signal })
      results.push({ id: file.id, result })
      onProgress?.(i + 1, total, file.id)
    } catch (err) {
      // Cancellation -> stop the whole batch rather than writing fallbacks.
      const e = err as Error
      if (e.name === 'AbortError' || /aborted/i.test(e.message)) {
        onProgress?.(i + 1, total, file.id)
        break
      }
      console.error(`[AI Analyzer] Batch error for ${fileName}:`, e.message)
      // Still produce a fallback result so UI isn't broken
      try {
        const meta = await extractAudioMetadata(filePath)
        results.push({ id: file.id, result: generateSmartFallback(meta, fileName) })
      } catch {
        results.push({
          id: file.id,
          result: {
            description: `音频文件: ${fileName}`,
            detailedDescription: `${fileName}`,
            scenario: '',
            tags: [],
            emotion: '中性',
            qualityScore: 3,
            moodEnergy: 5,
            isLoopable: false,
            variantOf: null
          }
        })
      }
      onProgress?.(i + 1, total, file.id)
    }
  }

  return results
}

// ---- Test connection ----

export async function testConnection(config: ModelConfig): Promise<{ success: boolean; message: string }> {
  try {
    if (config.provider === 'anthropic') {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 5,
          temperature: 0,
          messages: [{ role: 'user', content: '回复 OK' }],
          system: '请只回复 OK'
        }),
        signal: AbortSignal.timeout(10000)
      })
      return response.ok
        ? { success: true, message: '连接成功' }
        : { success: false, message: `API 返回错误 ${response.status}: ${(await response.text()).slice(0, 100)}` }
    }

    if (config.provider === 'gemini') {
      const endpoint = config.endpoint.endsWith(':generateContent') ? config.endpoint : `${config.endpoint}:generateContent`
      const response = await fetch(`${endpoint}?key=${config.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '回复 OK' }] }] }),
        signal: AbortSignal.timeout(10000)
      })
      return response.ok
        ? { success: true, message: '连接成功' }
        : { success: false, message: `API 返回错误 ${response.status}: ${(await response.text()).slice(0, 100)}` }
    }

    if (config.provider === 'ollama') {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: '回复 OK' }],
          stream: false
        }),
        signal: AbortSignal.timeout(10000)
      })
      return response.ok
        ? { success: true, message: '连接成功' }
        : { success: false, message: `API 返回错误 ${response.status}: ${(await response.text()).slice(0, 100)}` }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.provider === 'azure') {
      headers['api-key'] = config.apiKey
    } else if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: '回复 OK' }],
        max_tokens: 5,
        temperature: 0
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (response.ok) {
      return { success: true, message: '连接成功' }
    } else {
      const text = await response.text()
      return { success: false, message: `API 返回错误 ${response.status}: ${text.slice(0, 100)}` }
    }
  } catch (err) {
    return { success: false, message: `连接失败: ${(err as Error).message}` }
  }
}
