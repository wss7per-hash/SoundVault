import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 竖列表的多选 + 连选（"框选"等价形态）通用 hook。
 *
 * 交互模型：
 *  - 拖拽连选：在行上按下左键并上下移动，经过的行被连续选中（替换式范围选择）。
 *  - Ctrl/Cmd + 点击：切换单个。
 *  - Shift + 点击：从上次点击到本次的范围选择。
 *  - 普通点击（无修饰、无拖拽）：触发 onActivate（激活/筛选），并清空选择。
 *
 * 该模型与 SoundGrid 的网格框选一致，但适配单列竖列表。
 */
export function useListSelection(orderedIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastClickedRef = useRef<string | null>(null)
  const dragStartRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  const didDragRef = useRef(false)

  // 全局 mouseup 结束拖拽
  useEffect(() => {
    const up = () => {
      isDraggingRef.current = false
      dragStartRef.current = null
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const range = useCallback(
    (fromId: string, toId: string, base: Set<string>) => {
      const a = orderedIds.indexOf(fromId)
      const b = orderedIds.indexOf(toId)
      if (a < 0 || b < 0) return base
      const [s, e] = a <= b ? [a, b] : [b, a]
      const next = new Set(base)
      for (let i = s; i <= e; i++) next.add(orderedIds[i])
      return next
    },
    [orderedIds]
  )

  const onRowMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDraggingRef.current = true
    dragStartRef.current = id
    didDragRef.current = false
  }, [])

  const onRowMouseEnter = useCallback(
    (id: string) => {
      if (!isDraggingRef.current || !dragStartRef.current) return
      didDragRef.current = true
      setSelectedIds(range(dragStartRef.current, id, new Set()))
    },
    [range]
  )

  const onRowClick = useCallback(
    (id: string, e: React.MouseEvent, onActivate: () => void) => {
      // 拖拽结束的 click：不触发激活，保留连选结果
      if (didDragRef.current) {
        didDragRef.current = false
        return
      }
      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const n = new Set(prev)
          if (n.has(id)) n.delete(id)
          else n.add(id)
          return n
        })
        lastClickedRef.current = id
        return
      }
      if (e.shiftKey && lastClickedRef.current) {
        setSelectedIds(range(lastClickedRef.current, id, new Set()))
        return
      }
      // 普通点击：激活（筛选/打开），并清空选择
      setSelectedIds(new Set())
      lastClickedRef.current = id
      onActivate()
    },
    [range]
  )

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  return { selectedIds, setSelectedIds, onRowMouseDown, onRowMouseEnter, onRowClick, clear }
}
