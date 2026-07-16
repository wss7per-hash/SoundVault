import { useCallback, useState } from 'react'
import type { MouseEvent } from 'react'

export interface NativeMenuItem {
  label: string
  enabled?: boolean
  danger?: boolean
  type?: 'separator' | 'normal'
}

/**
 * 使用 Electron 原生 Menu.popup() 弹出右键菜单。
 * 坐标由主进程处理，100% 精准，不受任何 CSS 影响。
 *
 * 用法：
 *   const { open } = useNativeContextMenu([
 *     { label: '新建标签', enabled: true },
 *     { type: 'separator' },
 *     { label: '删除', danger: true },
 *   ], (label) => {
 *     if (label === '新建标签') doSomething()
 *   })
 *   <div onContextMenu={open}>...</div>
 */
export function useNativeContextMenu(
  items: NativeMenuItem[],
  onItemClick?: (label: string) => void
) {
  const [clickedLabel, setClickedLabel] = useState<string | null>(null)

  const open = useCallback(async (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 过滤掉 separator 以外的 item 的 enabled 检查在原生层面处理
    const result = await window.api.showNativeContextMenu(items, e.clientX, e.clientY)
    if (result) {
      setClickedLabel(result)
      onItemClick?.(result)
    }
  }, [items, onItemClick])

  const clear = useCallback(() => setClickedLabel(null), [])

  return { clickedLabel, open, clear }
}
