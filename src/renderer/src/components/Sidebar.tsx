import { useAppStore } from '../stores/appStore'
import { TagTree } from './TagTree'
import { CollectionsManager } from './CollectionsManager'
import { SmartFolderList, SmartClassifyPanel } from './SmartFolderBuilder'
import { Tags, Star, FolderCog, Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import logoMark from '../assets/images/logo-mark.png'
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'

export function Sidebar(): JSX.Element {
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)

  // 回收站快速操作所需状态
  const [trashCount, setTrashCount] = useState<number>(0)
  const [trashLoading, setTrashLoading] = useState(false)

  const loadTrashCount = useCallback(async () => {
    try {
      const sounds = await window.api.getTrash()
      setTrashCount(sounds.length)
    } catch {
      setTrashCount(0)
    }
  }, [])

  useEffect(() => {
    if (sidebarTab === 'trash') loadTrashCount()
  }, [sidebarTab, loadTrashCount])

  const handleRestoreAll = async () => {
    if (trashCount === 0) return
    setTrashLoading(true)
    try {
      const sounds = await window.api.getTrash()
      if (sounds.length > 0) {
        await window.api.restoreSounds(sounds.map((s) => s.id))
        toast.success(`已恢复 ${sounds.length} 个音效`)
        setTrashCount(0)
      }
    } catch {
      toast.error('恢复失败')
    } finally {
      setTrashLoading(false)
    }
  }

  const handleEmptyTrash = async () => {
    if (trashCount === 0) return
    setTrashLoading(true)
    try {
      const sounds = await window.api.getTrash()
      if (sounds.length > 0) {
        await window.api.permanentDelete(sounds.map((s) => s.id))
        toast.success(`已永久删除 ${sounds.length} 个音效`)
        setTrashCount(0)
      }
    } catch {
      toast.error('清空失败')
    } finally {
      setTrashLoading(false)
    }
  }

  const tabs: Array<{
    key: typeof sidebarTab
    label: string
    icon: JSX.Element
  }> = [
    { key: 'tags', label: '标签', icon: <Tags size={16} /> },
    { key: 'collections', label: '收藏夹', icon: <Star size={16} /> },
    { key: 'smart', label: '智能', icon: <FolderCog size={16} /> },
    { key: 'trash', label: '回收站', icon: <Trash2 size={16} /> },
  ]

  return (
    <div className="w-[220px] border-r border-surface-panel bg-surface-panel flex flex-col shrink-0">
      {/* App header */}
      <div className="h-12 border-b border-surface-panel bg-surface-card flex items-center px-3 gap-2 shrink-0">
        <img src={logoMark} alt="SoundVault" className="w-7 h-7 rounded-lg object-cover" />
        <span className="text-base font-semibold text-muted-light tracking-tight">SoundVault</span>
      </div>

      {/* Tab icons bar */}
      <div className="flex border-b border-surface-panel shrink-0">
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
        {sidebarTab === 'smart' && (
          <>
            <SmartClassifyPanel />
            <SmartFolderList />
          </>
        )}
        {sidebarTab === 'trash' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-panel">
              <div className="flex items-center gap-2">
                <Trash2 size={16} className="text-red-400" />
                <span className="text-sm font-medium text-muted-light">回收站</span>
                {trashCount > 0 && (
                  <span className="text-[10px] font-medium text-red-400/80 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                    {trashCount}
                  </span>
                )}
              </div>
            </div>

            {trashCount === 0 ? (
              <div className="flex-1 flex items-center justify-center px-4">
                <p className="text-xs text-muted text-center leading-relaxed">
                  回收站是空的<br />
                  <span className="text-muted/60">删除的音效会保留在此处</span>
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
                <p className="text-[11px] text-muted leading-relaxed">
                  共 {trashCount} 个已删除音效，可在右侧列表中查看详情
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={handleRestoreAll}
                    disabled={trashLoading}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent/15 text-accent-light hover:bg-accent/25 transition-colors disabled:opacity-40"
                  >
                    <RotateCcw size={12} />
                    恢复全部
                  </button>
                  <button
                    onClick={handleEmptyTrash}
                    disabled={trashLoading}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                  >
                    <AlertTriangle size={12} />
                    清空回收站
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
