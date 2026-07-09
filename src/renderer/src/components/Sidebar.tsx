import { useAppStore } from '../stores/appStore'
import { TagTree } from './TagTree'
import { CollectionsManager } from './CollectionsManager'
import { SmartFolderList } from './SmartFolderBuilder'
import { Tags, Folder, FolderCog, Trash2, Settings, Upload } from 'lucide-react'
import logoMark from '../assets/images/logo-mark.png'

export function Sidebar(): JSX.Element {
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)
  const toggleScanDialog = useAppStore((s) => s.toggleScanDialog)
  const toggleModelConfig = useAppStore((s) => s.toggleModelConfig)

  const tabs: Array<{
    key: typeof sidebarTab
    label: string
    icon: JSX.Element
  }> = [
    { key: 'tags', label: '标签', icon: <Tags size={16} /> },
    { key: 'collections', label: '合集', icon: <Folder size={16} /> },
    { key: 'smart', label: '智能', icon: <FolderCog size={16} /> },
    { key: 'trash', label: '回收站', icon: <Trash2 size={16} /> },
  ]

  return (
    <div className="w-[220px] border-r border-[#2a2a28] bg-surface-panel flex flex-col shrink-0">
      {/* App header */}
      <div className="h-12 border-b border-[#2a2a28] bg-surface-card flex items-center px-3 gap-2 shrink-0">
        <img src={logoMark} alt="SoundVault" className="w-7 h-7 rounded-lg object-cover" />
        <span className="text-base font-semibold text-muted-light tracking-tight">SoundVault</span>
        <div className="flex-1" />
        <button
          onClick={toggleScanDialog}
          className="p-1.5 hover:bg-surface-card rounded text-muted hover:text-accent-light transition-colors"
          title="导入音效"
        >
          <Upload size={16} />
        </button>
        <button
          onClick={toggleModelConfig}
          className="p-1.5 hover:bg-surface-card rounded text-muted hover:text-accent-light transition-colors"
          title="AI 模型配置"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Tab icons bar */}
      <div className="flex border-b border-[#2a2a28] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSidebarTab(tab.key)}
            className={`flex-1 py-2.5 flex items-center justify-center transition-colors ${
              sidebarTab === tab.key
                ? 'text-accent-light border-b border-accent'
                : 'text-muted hover:text-muted-light'
            }`}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {sidebarTab === 'tags' && <TagTree />}
        {sidebarTab === 'collections' && <CollectionsManager />}
        {sidebarTab === 'smart' && <SmartFolderList />}
        {sidebarTab === 'trash' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a28]">
              <div className="flex items-center gap-2">
                <Trash2 size={16} className="text-red-400" />
                <span className="text-sm font-medium text-muted-light">回收站</span>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted px-4 text-center">
                点击上方"回收站"标签<br />查看已删除的音效
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
