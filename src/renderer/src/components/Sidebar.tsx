import { useAppStore } from '../stores/appStore'
import { TagTree } from './TagTree'
import { CollectionsManager } from './CollectionsManager'
import { SmartFolderList, SmartClassifyPanel } from './SmartFolderBuilder'
import { Tags, Star, FolderCog, Trash2, RotateCcw, AlertTriangle, HardDrive } from 'lucide-react'
import logoMark from '../assets/images/logo-mark.png'
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'

export function Sidebar(): JSX.Element {
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)
  const trashVersion = useAppStore((s) => s.trashVersion)
  const bumpTrashVersion = useAppStore((s) => s.bumpTrashVersion)
  const refreshSounds = useAppStore((s) => s.refreshSounds)
  const refreshStats = useAppStore((s) => s.refreshStats)

  // 回收站快速操作所需状态
  const [trashCount, setTrashCount] = useState<number>(0)
  const [trashLoading, setTrashLoading] = useState(false)
  // 确认弹窗：'empty' = 清空回收站，'restore' = 恢复全部，null = 关闭
  const [confirmKind, setConfirmKind] = useState<'empty' | 'restore' | null>(null)
  const [deleteLocalFile, setDeleteLocalFile] = useState(false)

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

  // 订阅跨组件回收站变更（右侧 RecycleBin 面板操作后会 bump），保持计数同步
  useEffect(() => {
    if (sidebarTab === 'trash') loadTrashCount()
  }, [trashVersion, sidebarTab, loadTrashCount])

  // 打开确认弹窗（不直接执行）
  const askRestoreAll = () => {
    if (trashCount === 0) return
    setConfirmKind('restore')
  }
  const askEmptyTrash = () => {
    if (trashCount === 0) return
    setDeleteLocalFile(false)
    setConfirmKind('empty')
  }
  const closeConfirm = () => {
    setConfirmKind(null)
    setDeleteLocalFile(false)
  }

  const handleRestoreAll = async () => {
    setConfirmKind(null)
    setTrashLoading(true)
    try {
      const sounds = await window.api.getTrash()
      if (sounds.length > 0) {
        await window.api.restoreSounds(sounds.map((s) => s.id))
        toast.success(`已恢复 ${sounds.length} 个音效`)
        setTrashCount(0)
        // 同步右侧回收站面板 + 主库列表 + 统计
        bumpTrashVersion()
        await Promise.all([refreshSounds(), refreshStats()])
      }
    } catch {
      toast.error('恢复失败')
    } finally {
      setTrashLoading(false)
    }
  }

  const handleEmptyTrash = async () => {
    const alsoDeleteLocal = deleteLocalFile
    setConfirmKind(null)
    setDeleteLocalFile(false)
    setTrashLoading(true)
    try {
      const sounds = await window.api.getTrash()
      if (sounds.length > 0) {
        await window.api.permanentDelete(sounds.map((s) => s.id), alsoDeleteLocal)
        toast.success(
          `已永久删除 ${sounds.length} 个音效` +
          (alsoDeleteLocal ? '（本地文件也已删除）' : '（本地文件未受影响）')
        )
        setTrashCount(0)
        // 同步右侧回收站面板
        bumpTrashVersion()
      }
    } catch {
      toast.error('清空失败，文件可能被占用，请关闭占用后重试')
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
        {sidebarTab === 'trash' && confirmKind && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={closeConfirm}
          >
            <div
              className="bg-surface-panel border border-surface-border rounded-xl shadow-2xl w-[380px] p-5 mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              {confirmKind === 'restore' ? (
                <>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <RotateCcw size={18} className="text-accent-light" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-fg mb-1">恢复全部音效</h3>
                      <p className="text-xs text-muted leading-relaxed">
                        将把回收站中的 <strong className="text-fg">{trashCount}</strong> 个音效全部恢复到音效库。
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-surface-panel">
                    <button
                      onClick={closeConfirm}
                      className="px-3 py-1.5 text-xs text-muted-light bg-surface-card hover:bg-surface-border border border-surface-border rounded-md transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleRestoreAll}
                      disabled={trashLoading}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-accent hover:opacity-90 rounded-md transition-colors disabled:opacity-50"
                    >
                      {trashLoading ? '恢复中…' : '确认恢复全部'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <AlertTriangle size={18} className="text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-fg mb-1">清空回收站</h3>
                      <p className="text-xs text-muted leading-relaxed">
                        将从 SoundVault 库中<strong className="text-fg">永久移除</strong>回收站里全部 {trashCount} 个音效记录。
                        <br />此操作<span className="font-medium text-fg">不可撤销</span>。
                      </p>

                      <label className="flex items-start gap-2 mt-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={deleteLocalFile}
                          onChange={(e) => setDeleteLocalFile(e.target.checked)}
                          className="mt-0.5 accent-red-500"
                        />
                        <span className="text-xs text-muted group-hover:text-fg transition-colors leading-relaxed">
                          <HardDrive size={11} className="inline mr-1 -mt-0.5" />
                          同时删除本地音频文件（不可恢复）
                        </span>
                      </label>

                      {deleteLocalFile && (
                        <p className="text-[10px] text-red-400/80 mt-1.5 ml-5 leading-relaxed">
                          ⚠ 勾选后，原始音频文件将从磁盘彻底删除，无法通过系统回收站恢复！
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-surface-panel">
                    <button
                      onClick={closeConfirm}
                      className="px-3 py-1.5 text-xs text-muted-light bg-surface-card hover:bg-surface-border border border-surface-border rounded-md transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleEmptyTrash}
                      disabled={trashLoading}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors disabled:opacity-50"
                    >
                      {trashLoading ? '清空中…' : '确认清空'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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
                    onClick={askRestoreAll}
                    disabled={trashLoading}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent/15 text-accent-light hover:bg-accent/25 transition-colors disabled:opacity-40"
                  >
                    <RotateCcw size={12} />
                    恢复全部
                  </button>
                  <button
                    onClick={askEmptyTrash}
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
