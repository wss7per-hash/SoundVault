import { useState, useEffect, useCallback } from 'react'
import type { SimilarSound } from '../../preload/index.d'
import { ChevronUp, ChevronDown, Search, Loader2 } from 'lucide-react'

interface SimilarSoundsBarProps {
  soundId: string | null
}

export function SimilarSoundsBar({ soundId }: SimilarSoundsBarProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(true)
  const [similar, setSimilar] = useState<SimilarSound[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!soundId) {
      setSimilar([])
      return
    }
    let cancelled = false
    setLoading(true)
    setSimilar([])
    window.api.getSimilarSounds(soundId)
      .then((res) => {
        if (!cancelled) {
          setSimilar(res || [])
          setLoading(false)
          // Auto-expand if there are results
          if (res && res.length > 0) setExpanded(true)
        }
      })
      .catch(() => {
        if (!cancelled) { setSimilar([]); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [soundId])

  // No sound selected → hide entirely
  if (!soundId) return null

  // No results and not loading → show minimal collapsed bar or nothing
  if (!loading && similar.length === 0 && !expanded) return null

  const hasContent = similar.length > 0

  return (
    <div className={`border-t border-[#2a2a28] bg-[#1a1a18] transition-all duration-200 ${
      expanded ? 'max-h-48' : 'max-h-9'
    } overflow-hidden flex flex-col shrink-0`}>
      {/* Header bar — always visible when sound is selected */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-4 h-9 hover:bg-[#222220] transition-colors shrink-0 w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Search size={13} className="text-accent" />
          <span className="text-xs font-medium text-[#8a8a82]">相似音效</span>
          {!expanded && hasContent && (
            <span className="text-[10px] text-[#6a6a64] tabular-nums">{similar.length} 条匹配</span>
          )}
          {loading && <Loader2 size={12} className="animate-spin text-[#6a6a64]" />}
        </div>
        {hasContent && (
          expanded ? <ChevronDown size={14} className="text-[#6a6a64]" /> : <ChevronUp size={14} className="text-[#6a6a64]" />
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-2.5 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-[#5a5a54] italic py-2">计算相似度中…</p>
          ) : !hasContent ? (
            <p className="text-xs text-[#5a5a54] italic py-2">暂无相似音效（先 AI 分析同库音效，更易匹配）</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {similar.map((s) => (
                <button
                  key={s.id}
                  onClick={() => window.api.revealSound(s.id)}
                  className="flex-shrink-0 min-w-[160px] max-w-[240px] text-left rounded-md border border-[#2a2a28] bg-[#252524] hover:bg-[#2f2f2c] hover:border-accent/40 px-3 py-2 transition-colors group"
                  title={`点击跳转到「${s.file_name}」`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm text-[#c8c8c4] truncate group-hover:text-white">{s.file_name}</span>
                    <span className="text-[10px] font-mono tabular-nums text-accent shrink-0 font-medium">
                      {Math.round(s.score * 100)}%
                    </span>
                  </div>
                  {s.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {s.reasons.slice(0, 3).map((r, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#534AB7]/10 text-[#9C92F6] border border-[#534AB7]/20 leading-none">
                          {r}
                        </span>
                      ))}
                      {s.reasons.length > 3 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#2a2a28] text-[#6a6a64] leading-none">
                          +{s.reasons.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
