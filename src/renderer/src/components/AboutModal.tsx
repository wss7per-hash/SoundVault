import { useState, useEffect } from 'react'
import { X, AudioLines } from 'lucide-react'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps): JSX.Element | null {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    if (!isOpen) return
    window.api
      ?.getVersion()
      .then((v) => setVersion(v || ''))
      .catch(() => setVersion(''))
  }, [isOpen])

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[400px] max-w-[90vw] rounded-xl bg-surface border border-surface-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="relative px-6 pt-7 pb-5 flex flex-col items-center text-center border-b border-surface-border">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 p-1.5 rounded-md text-muted hover:bg-surface-hover hover:text-muted-light transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
          <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center mb-3">
            <AudioLines size={28} className="text-accent-light" />
          </div>
          <h2 className="text-xl font-semibold text-muted-light tracking-tight">SoundVault</h2>
          <p className="text-xs text-muted mt-1">让音效管理更高效</p>
        </div>

        {/* 详情 */}
        <div className="px-6 py-5 space-y-3">
          <Row label="版本" value={version ? `v${version}` : '—'} />
          <Row label="作者" value="VV" />
          <p className="text-xs leading-relaxed text-muted pt-1">
            本地音效库管理工具 —— AI 语义分析、智能检索、DSP 工具与批量编辑，
            让音效素材的整理、标注与复用变得简单。
          </p>
        </div>

        {/* 底部 */}
        <div className="px-6 py-3 border-t border-surface-border text-center">
          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-md bg-accent/20 text-accent-light text-sm font-medium hover:bg-accent/30 transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-muted-light font-medium">{value}</span>
    </div>
  )
}
