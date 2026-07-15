import { useState, useCallback } from 'react'
import { Upload, Sparkles, Wrench, X, ArrowRight, ArrowLeft, Keyboard } from 'lucide-react'

interface Step {
  icon: JSX.Element
  title: string
  desc: string
}

const STEPS: Step[] = [
  {
    icon: <Upload size={22} className="text-accent-light" />,
    title: '导入你的音效',
    desc: '点击工具栏的「导入」按钮，或直接把音频文件拖进窗口，即可加入本地音效库。支持 WAV / MP3 / FLAC / OGG 等常见格式，文件始终留在你本机。'
  },
  {
    icon: <Sparkles size={22} className="text-accent-light" />,
    title: '一键 AI 智能标注',
    desc: '选中任意音效后点「AI 分析」，自动生成形象描述、使用场景、语义标签与拟声词。也可以在「设置」里开启「导入后自动标注」，让新音效入库即分析。'
  },
  {
    icon: <Wrench size={22} className="text-accent-light" />,
    title: '处理与整理',
    desc: '右键任意音效可裁剪、转换格式、变速不变调、加入收藏夹或打标签；顶部可搜索、切换网格/列表与密度。键盘方向键也能快速浏览，空格试听当前音效。'
  }
]

export function OnboardingTour(): JSX.Element | null {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sv-onboarded') === '1'
    } catch {
      return false
    }
  })
  const [step, setStep] = useState(0)

  const finish = useCallback(() => {
    try { localStorage.setItem('sv-onboarded', '1') } catch { /* ignore */ }
    setDismissed(true)
  }, [])

  if (dismissed) return null

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="relative w-[420px] max-w-full bg-surface-panel border border-surface-border rounded-2xl shadow-2xl p-6">
        {/* 关闭 / 跳过 */}
        <button
          onClick={finish}
          className="absolute top-3 right-3 p-1.5 rounded-md text-muted hover:text-muted-light hover:bg-surface-card transition-colors"
          title="跳过引导"
        >
          <X size={16} />
        </button>

        {/* 步骤指示点 */}
        <div className="flex items-center gap-1.5 mb-5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-accent' : i < step ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-surface-border'
              }`}
            />
          ))}
        </div>

        {/* 图标 + 文案 */}
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center mb-4">
            {current.icon}
          </div>
          <h3 className="text-lg font-semibold text-muted-light mb-2">{current.title}</h3>
          <p className="text-sm text-muted leading-relaxed">{current.desc}</p>
        </div>

        {/* 键盘提示徽标（末步） */}
        {isLast && (
          <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted/80">
            <Keyboard size={13} />
            <span>方向键浏览 · 空格试听 · 输入字符快速定位</span>
          </div>
        )}

        {/* 操作区 */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={finish}
            className="text-xs text-muted hover:text-muted-light transition-colors"
          >
            跳过引导
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-light hover:bg-surface-card transition-colors"
              >
                <ArrowLeft size={13} />上一步
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setStep((s) => Math.min(STEPS.length - 1, s + 1)))}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              {isLast ? '开始使用' : '下一步'}<ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
