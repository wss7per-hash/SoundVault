import type { SoundData } from '../../preload/index.d'

// 把 onomatopoeia（DB 里是 JSON 字符串，渲染端也可能是已解析数组）拼成可检索文本
function onomatopoeiaText(ono: SoundData['onomatopoeia']): string {
  if (!ono) return ''
  let arr: Array<{ zh?: string; ja?: string; en?: string; pinyin?: string }> = []
  if (typeof ono === 'string') {
    try {
      arr = JSON.parse(ono)
    } catch {
      return ono
    }
  } else if (Array.isArray(ono)) {
    arr = ono as Array<{ zh?: string; ja?: string; en?: string; pinyin?: string }>
  }
  return arr.map((o) => [o.zh, o.ja, o.en, o.pinyin].filter(Boolean).join(' ')).join(' ')
}

// 把查询拆成词（英文按空格，中文整段作为一词，靠子串匹配）
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

interface Field {
  text: string | null
  weight: number
}

/**
 * 轻量本地语义评分：利用已分析的 AI 文本字段（描述/场景/拟声词/标签/情绪/文件名），
 * 对查询词做加权命中累加，并按命中字段权重排序。无需外部 API、无 Key 也能用。
 * 返回 0 表示完全不相关。
 */
export function semanticScore(sound: SoundData, query: string): number {
  const q = (query || '').trim().toLowerCase()
  if (!q) return 0
  const terms = tokenizeQuery(q)
  if (terms.length === 0) return 0

  const fields: Field[] = [
    { text: sound.file_name, weight: 1.0 }, // 文件名命中权重最高
    { text: sound.description, weight: 1.0 },
    { text: sound.best_for, weight: 0.9 },
    { text: onomatopoeiaText(sound.onomatopoeia), weight: 0.85 },
    { text: sound.tags, weight: 0.7 },
    { text: sound.emotion, weight: 0.6 },
    { text: sound.notes, weight: 0.4 }
  ]

  let total = 0
  for (const term of terms) {
    let termHit = false
    for (const f of fields) {
      const t = (f.text || '').toLowerCase()
      if (t && t.includes(term)) {
        total += f.weight
        termHit = true
      }
    }
    if (!termHit) {
      // 某个词完全没命中，轻微惩罚，避免无关结果靠前
      total -= 0.15
    }
  }

  // 整句作为短语命中某字段 → 额外加分（强信号）
  for (const f of fields) {
    const t = (f.text || '').toLowerCase()
    if (t && t.includes(q)) {
      total += f.weight * 0.5
    }
  }

  return Math.max(0, Math.round(total * 100) / 100)
}

/** 按语义相关度对音效排序，仅返回相关度 > 0 的结果。 */
export function rankSoundsBySemantic(sounds: SoundData[], query: string): SoundData[] {
  const q = (query || '').trim()
  if (!q) return sounds
  return sounds
    .map((s) => ({ s, score: semanticScore(s, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s)
}
