// 声波小精灵 · 宠物窗口渲染根
// 透明窗口内的全屏 canvas；rAF 循环驱动 SpriteRenderer；
// 持有规则运行时 + 动作分发器，处理指针事件 / timer / 音频联动。
import { useEffect, useRef, useState } from 'react'
import { SpriteRenderer } from './sprite'
import { createRuleRuntime, type RuleRuntime } from './engine/ruleRuntime'
import { UserTriggerManager, type SpriteActionExecutors } from './engine/userTriggerManager'
import type { PetConfig, PetEventContext, SpriteAnimId, PetConfigStored } from './engine/types'
import { DEFAULT_PET_CONFIG } from './engine/defaults'

const W = 240
const H = 300
const MENU_W = 152
const MENU_H = 232
const PERSISTENT: SpriteAnimId[] = ['drag', 'sleep']
const TRANSIENT_MS: Record<string, number> = { click: 600, surprised: 800, wave: 900, bounce: 350 }

// 右键小精灵弹出的菜单（窗口内 HTML 浮层，规避原生菜单坐标/焦点问题）
type PetMenuItem =
  | { type: 'separator' }
  | { id: string; label: string; icon?: string; danger?: boolean }
const PET_MENU_ITEMS: PetMenuItem[] = [
  { id: 'settings', label: '打开设置', icon: '⚙️' },
  { id: 'hide', label: '隐藏小精灵', icon: '🙈' },
  { id: 'reset', label: '重置位置', icon: '📍' },
  { id: 'top', label: '切换置顶', icon: '📌' },
  { id: 'about', label: '关于声波小精灵', icon: '💡' },
  { type: 'separator' },
  { id: 'quit', label: '退出 SoundVault', icon: '⏻', danger: true }
]

export function PetWindow(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 跟踪窗口真实屏幕坐标（拖动/重置后保持同步，避免起点漂移）
  const posRef = useRef({ x: 80, y: 160 })
  const alwaysOnTopRef = useRef(true)
  // 右键菜单浮层状态（位置为窗口内 client 坐标）
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 })
  const menuActionRef = useRef<(id: string) => void>(() => {})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let config: PetConfig = JSON.parse(JSON.stringify(DEFAULT_PET_CONFIG))
    const sprite = new SpriteRenderer(config.sprite.hue, config.sprite.name)

    const audioLevelRef = { current: 0 }
    const audioPlayingRef = { current: false }
    const lastAudioRuleRef = { current: 0 }
    const lastRealLevelAtRef = { current: 0 }
    const transientUntilRef = { current: 0 }
    const transientAnimRef = { current: 'idle' as SpriteAnimId }
    const persistentRef = { current: null as SpriteAnimId | null }
    const lastActivityRef = { current: performance.now() }
    const dragRef = {
      active: false,
      moved: false,
      startClientX: 0,
      startClientY: 0,
      startX: 0,
      startY: 0,
      boundsReady: false
    }

    let runtime: RuleRuntime | null = null
    let manager: UserTriggerManager | null = null
    let raf = 0
    let fixedTimer = 0
    let randomTimer: number | undefined = undefined
    let idleTimer = 0

    const applyDisplay = (disp: PetConfig['display']) => {
      if (wrapRef.current) {
        wrapRef.current.style.transform = `scale(${Math.max(0.3, disp.scale)})`
        wrapRef.current.style.opacity = String(Math.max(0, Math.min(1, disp.opacity)))
      }
    }
    const markActivity = () => { lastActivityRef.current = performance.now() }
    const clearSleep = () => { if (persistentRef.current === 'sleep') persistentRef.current = null }

    const triggerAnim = (id: SpriteAnimId) => {
      const now = performance.now()
      if (PERSISTENT.includes(id)) { persistentRef.current = id; sprite.setAnim(id, now); return }
      if (id === 'idle') { persistentRef.current = null; transientAnimRef.current = 'idle'; sprite.setAnim('idle', now); return }
      transientAnimRef.current = id
      sprite.setAnim(id, now)
      transientUntilRef.current = now + (TRANSIENT_MS[id] ?? 700)
    }

    const persistDisplay = () => { window.api.pet.setDisplay(config.display).catch(() => {}) }

    const dispatch = (ev: PetEventContext) => {
      markActivity()
      const actions = runtime?.evaluateEvent(ev) ?? []
      for (const a of actions) manager?.executeAction(a, ev)
    }

    const applyStored = (s: PetConfigStored | null) => {
      if (!s) return
      if (typeof s.enabled === 'boolean') config.enabled = s.enabled
      if (s.display) {
        config.display = { ...config.display, ...s.display }
        posRef.current = { x: config.display.x ?? 80, y: config.display.y ?? 160 }
        alwaysOnTopRef.current = !!config.display.alwaysOnTop
      }
      if (s.sprite) config.sprite = { ...config.sprite, ...s.sprite }
      if (s.messages) config.messages = { ...config.messages, ...s.messages }
      if (s.ruleEnabled) {
        for (const r of config.triggerRules) {
          if (typeof s.ruleEnabled[r.id] === 'boolean') r.enabled = s.ruleEnabled[r.id]
        }
      }
    }

    const buildExecutors = (): SpriteActionExecutors => ({
      playSpriteAnim: (anim) => { if (anim) triggerAnim(anim) },
      showMessage: (text, opts) => sprite.showMessage(text, opts?.durationMs ?? config.messages.bubbleDurationMs),
      changeDisplay: (action) => {
        if (typeof action.scale === 'number') { config.display.scale = action.scale; applyDisplay(config.display); persistDisplay() }
        if (typeof action.opacity === 'number') { config.display.opacity = action.opacity; applyDisplay(config.display); persistDisplay() }
      },
      setVisibility: (visible) => { if (visible) window.api.pet.show(); else window.api.pet.hide() },
      resetPosition: () => window.api.pet.resetPosition(),
      openPetSettings: () => window.api.pet.openSettings()
    })

    const rebuild = () => {
      runtime = createRuleRuntime({
        rules: config.triggerRules,
        onTimerActions: (actions, ev) => { for (const a of actions) manager?.executeAction(a, ev) }
      })
      manager = new UserTriggerManager(buildExecutors())
    }

    // 初始化：拉取配置 → 合并默认规则集 → 应用 → 构建运行时
    let destroyed = false
    window.api.pet.getConfig().then((cfg: PetConfigStored | null) => {
      if (destroyed) return
      applyStored(cfg)
      sprite.setHue(config.sprite.hue)
      sprite.setName(config.sprite.name)
      applyDisplay(config.display)
      rebuild()
      startLoop()
      attachHandlers()
    }).catch(() => {
      if (destroyed) return
      rebuild()
      startLoop()
      attachHandlers()
    })

    const startLoop = () => {
      fixedTimer = window.setInterval(() => {
        dispatch({ type: 'timer', timerRuleId: 'default-timed', timestamp: performance.now(), eventSource: 'timer' })
      }, 8000)
      const scheduleRandom = () => {
        randomTimer = window.setTimeout(() => {
          dispatch({ type: 'randomTimer', timerRuleId: 'default-random-timer', timestamp: performance.now(), eventSource: 'timer' })
          scheduleRandom()
        }, 10000 + Math.random() * 12000)
      }
      scheduleRandom()
      idleTimer = window.setInterval(() => {
        const elapsed = performance.now() - lastActivityRef.current
        dispatch({ type: 'idleDuration', elapsedMs: elapsed, timestamp: performance.now(), eventSource: 'timer' })
      }, 1000)
    }

    const onAudio = (ev: { type: 'level' | 'start' | 'stop'; level?: number }) => {
      const now = performance.now()
      if (ev.type === 'start') {
        audioPlayingRef.current = true
        clearSleep()
        dispatch({ type: 'audioStart', timestamp: now, eventSource: 'audio' })
      } else if (ev.type === 'stop') {
        audioPlayingRef.current = false
        dispatch({ type: 'audioStop', timestamp: now, eventSource: 'audio' })
      } else if (ev.type === 'level') {
        audioLevelRef.current = ev.level ?? 0
        audioPlayingRef.current = true
        lastRealLevelAtRef.current = now
        clearSleep()
      }
    }
    const unsubAudio = window.api.pet.onAudioEvent(onAudio)

    const unsubConfig = window.api.pet.onConfigChanged(() => {
      window.api.pet.getConfig().then((cfg: PetConfigStored | null) => {
        applyStored(cfg)
        sprite.setHue(config.sprite.hue)
        sprite.setName(config.sprite.name)
        applyDisplay(config.display)
        rebuild()
      }).catch(() => {})
    })

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) return
      if (config.display.locked) return
      dragRef.active = true
      dragRef.moved = false
      dragRef.startClientX = e.clientX
      dragRef.startClientY = e.clientY
      // 以当前已知坐标作为起点，并异步用主进程真实窗口坐标校准，
      // 避免「重置 / 外部移动」后起点漂移导致拖动跳变。
      dragRef.startX = posRef.current.x
      dragRef.startY = posRef.current.y
      dragRef.boundsReady = false
      window.api.pet.getBounds().then((b) => {
        if (b) { dragRef.startX = b.x; dragRef.startY = b.y; dragRef.boundsReady = true }
      }).catch(() => {})
      try { canvas.setPointerCapture(e.pointerId) } catch { /* noop */ }
      triggerAnim('drag')
      dispatch({ type: 'dragStart', timestamp: performance.now(), eventSource: 'petPointer' })
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.active) return
      const dx = e.clientX - dragRef.startClientX
      const dy = e.clientY - dragRef.startClientY
      if (!dragRef.moved && Math.hypot(dx, dy) < 3) return
      dragRef.moved = true
      // 绝对定位：起点 + 指针位移，直接 setPosition（同步、无累积误差 → 不抖）
      const nx = Math.round(dragRef.startX + dx)
      const ny = Math.round(dragRef.startY + dy)
      posRef.current = { x: nx, y: ny }
      window.api.pet.moveTo(nx, ny)
      dispatch({ type: 'dragging', dragDeltaX: dx, dragDeltaY: dy, dragDistance: Math.hypot(dx, dy), timestamp: performance.now(), eventSource: 'petPointer' })
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!dragRef.active) return
      dragRef.active = false
      try { canvas.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      if (dragRef.moved) {
        persistentRef.current = null
        dispatch({ type: 'dragEnd', timestamp: performance.now(), eventSource: 'petPointer' })
      } else {
        dispatch({ type: 'click', timestamp: performance.now(), eventSource: 'petPointer' })
      }
    }
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      triggerAnim('surprised')
      setMenu({ open: true, x: e.clientX, y: e.clientY })
    }

    // 右键菜单各功能实现（原生菜单不可靠，改由窗口内 HTML 浮层触发）
    const handleMenuAction = (id: string) => {
      switch (id) {
        case 'settings':
          window.api.pet.openSettings()
          break
        case 'hide':
          window.api.pet.setEnabled(false)
          break
        case 'reset':
          window.api.pet.resetPosition()
          break
        case 'top': {
          const next = !alwaysOnTopRef.current
          alwaysOnTopRef.current = next
          config.display.alwaysOnTop = next
          window.api.pet.setDisplay({ alwaysOnTop: next })
          break
        }
        case 'about':
          sprite.showMessage('声波小精灵 · SoundVault 的桌面小伙伴 ♪', 3200)
          break
        case 'quit':
          window.api.pet.quit()
          break
      }
      setMenu((m) => ({ ...m, open: false }))
    }
    menuActionRef.current = handleMenuAction
    const onEnter = () => dispatch({ type: 'mouseEnter', timestamp: performance.now(), eventSource: 'petPointer' })
    const onLeave = () => dispatch({ type: 'mouseLeave', timestamp: performance.now(), eventSource: 'petPointer' })

    const attachHandlers = () => {
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('contextmenu', onContextMenu)
      canvas.addEventListener('mouseenter', onEnter)
      canvas.addEventListener('mouseleave', onLeave)
    }

    const frame = () => {
      const now = performance.now()
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr)
        canvas.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      let effLevel = audioLevelRef.current
      if (audioPlayingRef.current && now - lastRealLevelAtRef.current > 350) {
        // 真实电平缺失（如媒体被 Web Audio 标记污染而返回静默）时，
        // 用合成包络保证精灵随播放产生可视反馈
        effLevel = 0.3 + 0.35 * Math.abs(Math.sin(now / 140))
      }
      if (audioPlayingRef.current) audioLevelRef.current = effLevel
      sprite.setAudioLevel(effLevel)
      sprite.setAudioPlaying(audioPlayingRef.current)

      if (audioPlayingRef.current && now - lastAudioRuleRef.current > 100) {
        lastAudioRuleRef.current = now
        dispatch({ type: 'audioLevel', audioLevel: audioLevelRef.current, timestamp: now, eventSource: 'audio' })
      }

      let eff: SpriteAnimId
      if (persistentRef.current) eff = persistentRef.current
      else if (now < transientUntilRef.current) eff = transientAnimRef.current
      else eff = audioPlayingRef.current ? 'bounce' : 'idle'
      sprite.setAnim(eff, now)

      sprite.draw(ctx, W, H, now)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      destroyed = true
      cancelAnimationFrame(raf)
      clearInterval(fixedTimer)
      if (randomTimer) clearTimeout(randomTimer)
      clearInterval(idleTimer)
      unsubAudio()
      unsubConfig()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('mouseenter', onEnter)
      canvas.removeEventListener('mouseleave', onLeave)
      runtime?.destroy()
    }
  }, [])

  return (
    <>
      <div
        ref={wrapRef}
        style={{ width: W, height: H, transformOrigin: 'bottom center', position: 'relative' }}
      >
        <canvas ref={canvasRef} style={{ width: W, height: H, display: 'block' }} />
      </div>

      {menu.open && (
        <>
          {/* 点击空白处关闭菜单（同时吞掉指针事件，避免误触拖动） */}
          <div
            onClick={() => setMenu((m) => ({ ...m, open: false }))}
            style={{ position: 'absolute', inset: 0, zIndex: 20 }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: Math.min(Math.max(4, menu.x), W - MENU_W - 4),
              top: Math.min(Math.max(4, menu.y), H - MENU_H - 4),
              width: MENU_W,
              zIndex: 21,
              background: 'rgba(28, 26, 44, 0.96)',
              borderRadius: 14,
              padding: 6,
              boxShadow: '0 8px 26px rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
              userSelect: 'none'
            }}
          >
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '2px 8px 6px' }}>
              声波小精灵
            </div>
            {PET_MENU_ITEMS.map((it, i) =>
              'type' in it ? (
                <div key={i} style={{ height: 1, background: 'rgba(255,255,255,0.10)', margin: '4px 4px' }} />
              ) : (
                <div
                  key={i}
                  onClick={() => menuActionRef.current(it.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 9,
                    fontSize: 13,
                    color: it.danger ? '#ff8f8f' : '#f3eefb',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = it.danger ? 'rgba(255,90,90,0.18)' : 'rgba(255,138,190,0.22)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span style={{ opacity: 0.9 }}>{it.icon}</span>
                  <span>{it.label}</span>
                </div>
              )
            )}
          </div>
        </>
      )}
    </>
  )
}
