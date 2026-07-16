import { useEffect, useRef, useState } from 'react'
import type { ReactNode, MouseEvent } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem =
  | {
      type: 'item'
      label: string
      icon?: ReactNode
      onClick?: () => void
      disabled?: boolean
      danger?: boolean
      shortcut?: string
    }
  | { type: 'separator' }
  | { type: 'header'; label: string }

export interface ContextMenuState {
  x: number
  y: number
}

interface PopupMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

const MENU_W = 220
const MENU_MAX_H = 340

/**
 * 通用右键菜单：通过 createPortal 挂到 document.body，
 * 固定定位、视口内夹紧，点击外部 / Esc / 滚动 / 缩放时自动关闭。
 * 菜单内部再次发生 contextmenu 时阻止浏览器原生菜单冒泡。
 */
export function PopupMenu({ x, y, items, onClose }: PopupMenuProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const [portalReady, setPortalReady] = useState(false)
  // 用 state 缓存最终坐标，允许渲染后微调
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // 确保 DOM body 已就绪再渲染 portal（防止 SSR/hydration 边界崩溃）
  useEffect(() => {
    setPortalReady(true)
    return () => { setPortalReady(false) }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // 坐标计算：Portal 挂到 body 后用 clientX/clientY 直接定位 fixed 元素。
  // 若检测到实际渲染位置与预期不符（Electron 缩放/DPI 边界情况），做一次校正。
  useEffect(() => {
    if (!portalReady) return
    const left = Math.min(x, window.innerWidth - MENU_W - 8)
    const top = Math.min(y, window.innerHeight - MENU_MAX_H - 8)
    setPos({ left, top })
    // Portal 首次挂载后一帧校验：如果菜单被裁剪或偏移，重新计算
    const raf = requestAnimationFrame(() => {
      if (!ref.current || !mounted.current) return
      const rect = ref.current.getBoundingClientRect()
      // 如果菜单右边缘超出窗口或有明显左偏移，强制修正
      if (rect.right > window.innerWidth + 2 || rect.left < -2) {
        setPos({ left: Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8)), top: Math.max(0, top) })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [portalReady, x, y])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      // 仅左键点击菜单外部时关闭；右键由 open 处理重定位
      if (e.button !== 0) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onScrollOrResize = () => { if (mounted.current) onClose() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('wheel', onScrollOrResize, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('wheel', onScrollOrResize)
    }
  }, [onClose])

  if (!portalReady || typeof document === 'undefined' || !document.body || !pos) return null

  const menu = (
    <div
      ref={ref}
      className="fixed z-[9999] w-[220px] max-h-[340px] overflow-y-auto py-1.5 rounded-xl border border-surface-border bg-surface-panel shadow-2xl"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.type === 'separator') {
          return <div key={i} className="h-px bg-surface-border/60 my-1.5" />
        }
        if (it.type === 'header') {
          return (
            <div key={i} className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted/70">
              {it.label}
            </div>
          )
        }
        return (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return
              onClose()
              it.onClick?.()
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
              it.disabled
                ? 'text-muted/40 cursor-not-allowed'
                : it.danger
                  ? 'text-red-400 hover:bg-red-500/10'
                  : 'text-muted-light hover:bg-accent/15 hover:text-accent-light'
            }`}
          >
            {it.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{it.icon}</span>}
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="text-[10px] text-muted/60 shrink-0">{it.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )

  // 用 Portal 挂到 body，彻底避免父容器 overflow/transform 对 fixed 定位的干扰
  return createPortal(menu, document.body)
}

/**
 * 右键菜单状态管理 hook。在容器上挂 onContextMenu={open}，
 * 命中元素内部已 stopPropagation 的菜单不会冒泡触发本 hook。
 */
export function useContextMenu() {
  const [pos, setPos] = useState<ContextMenuState | null>(null)

  const open = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPos({ x: e.clientX, y: e.clientY })
  }
  const close = () => setPos(null)

  return { pos, open, close }
}
