import { useMemo, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { SoundTools } from './SoundTools'
import { Wrench, X } from 'lucide-react'

interface ToolsPanelProps {
  onClose: () => void
}

/**
 * 一级「工具」视图（仿库洞察），从 Toolbar 按钮进入，无需先选中音频。
 * 顶部下拉选择要处理的音频，下方渲染 SoundTools。
 */
export function ToolsPanel({ onClose }: ToolsPanelProps): JSX.Element {
  const sounds = useAppStore((s) => s.sounds)
  const selectedSoundId = useAppStore((s) => s.selectedSoundId)
  const refreshSounds = useAppStore((s) => s.refreshSounds)

  const [toolId, setToolId] = useState<string | null>(
    selectedSoundId && sounds.some((s) => s.id === selectedSoundId)
      ? selectedSoundId
      : sounds[0]?.id ?? null
  )

  const toolSound = useMemo(
    () => sounds.find((s) => s.id === toolId) ?? null,
    [sounds, toolId]
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#161615]">
      {/* Header */}
      <div className="h-11 border-b border-[#2a2a28] flex items-center gap-3 px-4 shrink-0">
        <Wrench size={16} className="text-accent-light" />
        <span className="text-sm font-medium text-[#e8e6df]">工具</span>
        <span className="text-xs text-[#6a6a64]">本地 DSP 处理 · 零外部依赖</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={toolId ?? ''}
            onChange={(e) => setToolId(e.target.value || null)}
            className="bg-[#1f1f1d] border border-[#2a2a28] rounded-md text-xs text-[#b8b8b4] px-2 py-1.5 max-w-[320px] outline-none focus:border-accent/50"
          >
            {sounds.length === 0 && <option value="">（库为空）</option>}
            {sounds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.file_name}
              </option>
            ))}
          </select>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[#252524] text-[#6a6a64] hover:text-[#b8b8b4] transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {toolSound ? (
          <div className="max-w-2xl mx-auto">
            <SoundTools sound={toolSound} onUpdate={refreshSounds} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 h-full">
            <Wrench size={40} className="text-[#3a3a38] mb-3" />
            <p className="text-sm text-[#8a8a82] mb-1">请先导入音效</p>
            <p className="text-xs text-[#6a6a64]">工具需要对库中的音频进行处理，导入音频后即可使用。</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ToolsPanel
