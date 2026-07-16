import toast from 'react-hot-toast'
import { useAppStore } from '../stores/appStore'

/**
 * 执行一步撤销：弹栈回滚后端事务，并刷新所有相关视图。
 * 抽成独立函数，供 Ctrl+Z 与各处右键菜单复用。
 */
export async function performUndo(): Promise<void> {
  try {
    const peek = await window.api.undoPeek()
    if (!peek) {
      toast('没有可撤销的操作', { icon: '↩️' })
      return
    }
    const res = await window.api.undoPerform()
    if (res.success) {
      toast.success(`已撤销：${res.label}`)
      const store = useAppStore.getState()
      await Promise.all([
        store.refreshSounds(),
        store.refreshTags(),
        store.refreshTagStats(),
        store.refreshStats(),
        store.refreshCollections(),
        store.refreshSmartFolders()
      ])
    } else {
      toast.error(`撤销失败${res.error ? '：' + res.error : ''}`)
    }
  } catch {
    toast.error('撤销失败')
  }
}
