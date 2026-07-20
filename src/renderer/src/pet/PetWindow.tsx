// 声波小精灵 · 宠物窗口渲染根
// 透明窗口内的全屏 canvas；rAF 循环驱动 SpriteRenderer；
// 持有规则运行时 + 动作分发器，处理指针事件 / timer / 音频联动。
import { useEffect, useRef, useState } from 'react'
import { SpriteRenderer, type PetMood } from './sprite'
import { createRuleRuntime, type RuleRuntime } from './engine/ruleRuntime'
import { UserTriggerManager, type SpriteActionExecutors } from './engine/userTriggerManager'
import type { PetConfig, PetEventContext, SpriteAnimId, PetConfigStored } from './engine/types'
import { DEFAULT_PET_CONFIG } from './engine/defaults'

const W = 240
const H = 300
const MENU_W = 152
const MENU_H = 280
const PET_CX = W / 2
const PET_CY = H - 92

// 选中音效时宠物点评文案（用 AI 分析结果拼一句）
function buildSelectionComment(p: {
  fileName: string
  description?: string | null
  useCases?: string | null
  onomatopoeia?: string[] | null
}): string {
  const name = p.fileName || '这个音效'
  const clean = (s?: string | null) => (s ? s.replace(/[。.\s]+$/, '') : '')
  const bits: string[] = []
  const desc = clean(p.description)
  if (desc) bits.push(desc)
  const uc = clean(p.useCases)
  if (uc) bits.push(`适合${uc}`)
  if (p.onomatopoeia && p.onomatopoeia.length) bits.push(`拟声「${p.onomatopoeia.slice(0, 3).join('、')}」`)
  return bits.length ? `${name}：${bits.join('，')}～` : `${name}，这个我还没分析过呢～`
}

// A2 懂你的库：用库统计生成友好气泡（空闲时偶尔冒一句）
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}
function buildStatsComment(stats: Record<string, any>): string {
  const total: number = stats.total ?? 0
  if (total === 0) return '你的库还是空的，拖点音效进来我们就热闹啦～'
  const analyzed: number = stats.analyzed ?? 0
  const unanalyzed: number = stats.unanalyzed ?? 0
  const starred: number = stats.starred ?? 0
  const byExt: { wav: number; mp3: number; flac: number; other: number } = stats.byExt ?? { wav: 0, mp3: 0, flac: 0, other: 0 }
  const tagCount: number = stats.tagCount ?? 0
  const withOno: number = stats.withOnomatopoeia ?? 0
  const totalDurationMs: number = stats.totalDurationMs ?? 0
  const pool: string[] = [
    `你库里已经有 ${total} 个音效啦～`,
    `我已经帮 ${analyzed} 个做过 AI 分析，${unanalyzed > 0 ? `${unanalyzed} 个还在等我呢` : '全部都读完啦'}`,
    starred > 0 ? `你收藏了 ${starred} 个心头好 ♥` : `试试右键音效「收藏」，挑几个心头好呀`,
    byExt.wav > 0 ? `WAV 占了 ${byExt.wav} 个，是你最常用的格式` : `你攒了 ${formatDuration(totalDurationMs)} 的素材，真不少`,
    tagCount > 0 ? `已经打了 ${tagCount} 个标签，整理得真工整` : `给音效加点标签，找起来更顺手哦`,
    withOno > 0 ? `有 ${withOno} 个音效带拟声词，念起来可好玩了` : `让 AI 分析一下，就能知道它们的拟声词啦`
  ]
  return pool[Math.floor(Math.random() * pool.length)]
}
// B3 新手引导序列文案（首次启动 / 右键「重新引导」时按顺序弹出）
const ONBOARDING_STEPS = [
  '你好呀，我是声波小精灵 ♪',
  '按住我拖动，可以把我放到任意位置～',
  '右键我有更多功能，比如 AI 生成音效',
  '播放音效时，我会跟着节奏唱歌哦！'
]
// 靠近判定的半径（指针距小精灵中心小于此值视为「靠近」）
const PROXIMITY_RADIUS = 82
const HOVER_MS = 700
const PERSISTENT: SpriteAnimId[] = ['drag', 'sleep']
const TRANSIENT_MS: Record<string, number> = { click: 600, surprised: 800, wave: 900, bounce: 350 }

// 右键小精灵弹出的菜单（窗口内 HTML 浮层，规避原生菜单坐标/焦点问题）
type PetMenuItem =
  | { type: 'separator' }
  | { id: string; label: string; icon?: string; danger?: boolean }
const PET_MENU_ITEMS: PetMenuItem[] = [
  { id: 'settings', label: '打开设置', icon: '⚙️' },
  { id: 'hide', label: '隐藏小精灵', icon: '🙈' },
  { id: 'top', label: '切换置顶', icon: '📌' },
  { id: 'about', label: '关于声波小精灵', icon: '💡' },
  { id: 'pause', label: '暂停互动', icon: '⏸️' },
  { id: 'breath', label: '跟随音量呼吸', icon: '💨' },
  { type: 'separator' },
  { id: 'quit', label: '退出 SoundVault', icon: '⏻', danger: true }
]

export function PetWindow(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 跟踪窗口真实屏幕坐标（拖动/重置后保持同步，避免起点漂移）
  const posRef = useRef({ x: 0, y: 0 })
  const alwaysOnTopRef = useRef(true)
  // 右键菜单浮层状态（位置为窗口内 client 坐标）
  // 行为开关（暂停互动 / 跟随音量呼吸）——镜像 config.behavior
  const [behavior, setBehavior] = useState<{ audioBreath: boolean; paused: boolean }>({ audioBreath: true, paused: false })
  // 消息气泡（窗口内 HTML 浮层，不受 canvas scale 影响，保证文字清晰可读）
  const [bubble, setBubble] = useState<{ text: string } | null>(null)
  const bubbleTimerRef = useRef(0 as number)
  const bubbleUntilRef = useRef(0 as number)
  const scaleRef = useRef(0.35)

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
    const breathRef = { current: 0 }
    const hoverTimerRef = { current: 0 as number }
    const nearRef = { current: false }
    const trialArmedRef = { current: false }
    const dragRef = {
      active: false,
      moved: false,
      startClientX: 0,
      startClientY: 0,
      startX: 0,
      startY: 0
    }

    let runtime: RuleRuntime | null = null
    let manager: UserTriggerManager | null = null
    let raf = 0
    let fixedTimer = 0
    let randomTimer: number | undefined = undefined
    let idleTimer = 0
    let statsTimer = 0
    // 情绪：开心临时态截止时间戳（戳一下/选中音效时点亮）
    const happyUntilRef = { current: 0 }

    const applyDisplay = (disp: PetConfig['display']) => {
      scaleRef.current = Math.max(0.3, disp.scale)
      if (wrapRef.current) {
        wrapRef.current.style.transform = `scale(${Math.max(0.3, disp.scale)})`
        wrapRef.current.style.opacity = String(Math.max(0, Math.min(1, disp.opacity)))
      }
    }
    const markActivity = () => { lastActivityRef.current = performance.now() }
    const clearSleep = () => { if (persistentRef.current === 'sleep') persistentRef.current = null }
    // 消息气泡：以窗口内 HTML 浮层呈现（不随 canvas scale 缩小，文字清晰可读）
    const showBubble = (text: string, ms: number) => {
      setBubble({ text })
      bubbleUntilRef.current = performance.now() + ms
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = window.setTimeout(() => setBubble(null), ms)
    }

    const triggerAnim = (id: SpriteAnimId) => {
      const now = performance.now()
      if (PERSISTENT.includes(id)) { persistentRef.current = id; sprite.setAnim(id, now); return }
      if (id === 'idle') { persistentRef.current = null; transientAnimRef.current = 'idle'; sprite.setAnim('idle', now); return }
      transientAnimRef.current = id
      sprite.setAnim(id, now)
      transientUntilRef.current = now + (TRANSIENT_MS[id] ?? 700)
    }

    const persistDisplay = () => { window.api.pet.setDisplay(config.display).catch(() => {}) }
    const persistBehavior = () => {
      window.api.pet.setBehavior({ audioBreath: config.behavior.audioBreath, paused: config.behavior.paused })
    }

    const dispatch = (ev: PetEventContext) => {
      // 暂停互动：冻结所有规则反应（仍保留待机待动画与手动拖拽）
      if (config.behavior.paused) return
      markActivity()
      const actions = runtime?.evaluateEvent(ev) ?? []
      for (const a of actions) manager?.executeAction(a, ev)
    }

    const applyStored = (s: PetConfigStored | null) => {
      if (!s) return
      if (typeof s.enabled === 'boolean') config.enabled = s.enabled
      if (s.display) {
        config.display = { ...config.display, ...s.display }
        posRef.current = { x: config.display.x ?? 0, y: config.display.y ?? 0 }
        alwaysOnTopRef.current = !!config.display.alwaysOnTop
      }
      if (s.sprite) config.sprite = { ...config.sprite, ...s.sprite }
      if (s.behavior) config.behavior = { ...config.behavior, ...s.behavior }
      if (s.messages) config.messages = { ...config.messages, ...s.messages }
      if (s.ruleEnabled) {
        for (const r of config.triggerRules) {
          if (typeof s.ruleEnabled[r.id] === 'boolean') r.enabled = s.ruleEnabled[r.id]
        }
      }
      setBehavior({ audioBreath: !!config.behavior.audioBreath, paused: !!config.behavior.paused })
    }

    const buildExecutors = (): SpriteActionExecutors => ({
      playSpriteAnim: (anim) => { if (anim) triggerAnim(anim) },
      showMessage: (text, opts) => showBubble(text ?? '', opts?.durationMs ?? config.messages.bubbleDurationMs),
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
      if (cfg && !cfg.onboarded) runOnboarding()
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
      // A2 懂你的库：空闲且当前无气泡时，偶尔用真实库统计冒一句友好提示
      statsTimer = window.setInterval(() => {
        const now = performance.now()
        if (now < bubbleUntilRef.current + 2000) return
        if (now - lastActivityRef.current < 25000) return
        window.api.getStats().then((s: any) => {
          if (s) showBubble(buildStatsComment(s), 3600)
        }).catch(() => {})
      }, 52000)
    }

    // B3 新手引导：顺序播放气泡序列，结束后把 onboarded 持久化为 true
    let onboardingTimer = 0
    const runOnboarding = () => {
      let i = 0
      const step = () => {
        if (i >= ONBOARDING_STEPS.length) {
          window.api.pet.saveConfig({ onboarded: true }).catch(() => {})
          return
        }
        showBubble(ONBOARDING_STEPS[i], 3500)
        i++
        onboardingTimer = window.setTimeout(step, 3800)
      }
      step()
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

    // 主进程原生「关于」菜单触发后，由主进程转发文本，这里显示气泡
    const unsubAbout = window.api.pet.onAbout((text: string) => showBubble(text, 3200))

    const unsubConfig = window.api.pet.onConfigChanged(() => {
      window.api.pet.getConfig().then((cfg: PetConfigStored | null) => {
        applyStored(cfg)
        sprite.setHue(config.sprite.hue)
        sprite.setName(config.sprite.name)
        applyDisplay(config.display)
        rebuild()
      }).catch(() => {})
    })

    // B1：主窗口选中音效 → 宠物开心一下并用 AI 分析结果点评
    const unsubSelection = window.api.pet.onSelectionChanged((p: {
      fileName: string
      description?: string | null
      useCases?: string | null
      onomatopoeia?: string[] | null
    }) => {
      happyUntilRef.current = performance.now() + 2200
      showBubble(buildSelectionComment(p), 4200)
    })

    // B2：从主窗口拖卡片到宠物窗口上方时，点亮高亮并提示「松手就能试听」
    const unsubTrial = window.api.pet.onTrialHover((armed: boolean) => {
      trialArmedRef.current = armed
      sprite.setTrialArmed(armed)
      if (armed) {
        happyUntilRef.current = performance.now() + 1500
        showBubble('松手就能试听啦～', 1400)
      }
    })

    // B3：右键菜单「重新引导」→ 重跑气泡序列
    const unsubReplay = window.api.pet.onReplayOnboarding(() => runOnboarding())

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) return
      if (config.display.locked) return
      dragRef.active = true
      dragRef.moved = false
      dragRef.startClientX = e.clientX
      dragRef.startClientY = e.clientY
      // 同步取起点：posRef 始终与主进程同步（每次 moveTo 后立即更新），
      // 无需异步 getBounds——消除了「首帧跳变」的根因。
      dragRef.startX = posRef.current.x
      dragRef.startY = posRef.current.y
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
      // 绝对定位：起点 + 指针位移，直接 setPosition（同步发 IPC，无 rAF 延迟）
      const nx = Math.round(dragRef.startX + dx)
      const ny = Math.round(dragRef.startY + dy)
      posRef.current = { x: nx, y: ny }
      window.api.pet.moveTo(nx, ny)
      dispatch({ type: 'dragging', dragDeltaX: dx, dragDeltaY: dy, dragDistance: Math.hypot(dx, dy), timestamp: performance.now(), eventSource: 'petPointer' })
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!dragRef.active) return
      dragRef.active = false
      if (dragRef.moved) {
        // flush 最终位置 + 持久化到 DB（主进程 moveTo 不再写 DB，由渲染端统一保存）
        const nx = posRef.current.x
        const ny = posRef.current.y
        window.api.pet.moveTo(nx, ny)
        window.api.pet.setDisplay({ x: nx, y: ny }).catch(() => {})
      }
      try { canvas.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      if (dragRef.moved) {
        persistentRef.current = null
        dispatch({ type: 'dragEnd', timestamp: performance.now(), eventSource: 'petPointer' })
      } else {
        dispatch({ type: 'click', timestamp: performance.now(), eventSource: 'petPointer' })
        happyUntilRef.current = performance.now() + 2600
      }
    }
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      triggerAnim('surprised')
      // 交给主进程弹出原生 OS 菜单（定位到精灵右侧，不遮挡本体）
      window.api.pet.showContextMenu()
    }

    // 双击：被戳了一下
    const onDoubleClick = () => {
      triggerAnim('surprised')
      dispatch({ type: 'doubleClick', timestamp: performance.now(), eventSource: 'petPointer' })
      happyUntilRef.current = performance.now() + 2600
    }
    // 指针在窗口内移动（非拖拽）：计算与精灵中心距离，进入/离开「靠近」区时触发 proximity
    const onHoverMove = (e: PointerEvent) => {
      if (dragRef.active) return
      const dist = Math.hypot(e.clientX - PET_CX, e.clientY - PET_CY)
      const near = dist < PROXIMITY_RADIUS
      if (near && !nearRef.current) {
        nearRef.current = true
        happyUntilRef.current = performance.now() + 1500
        dispatch({ type: 'proximity', stateTransition: 'enter', distanceToPetCenter: dist, timestamp: performance.now(), eventSource: 'petPointer' })
      } else if (!near && nearRef.current) {
        nearRef.current = false
        dispatch({ type: 'proximity', stateTransition: 'exit', distanceToPetCenter: dist, timestamp: performance.now(), eventSource: 'petPointer' })
      }
    }

    // 右键菜单已改为主进程原生 OS 菜单（见 main 的 buildPetContextMenu），
    // 由 onContextMenu → window.api.pet.showContextMenu() 触发，定位到精灵右侧、不遮挡本体。
    const onEnter = () => {
      dispatch({ type: 'mouseEnter', timestamp: performance.now(), eventSource: 'petPointer' })
      // 悬停持续一段时间后触发 hoverDuration（寒暄）
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = window.setTimeout(() => {
        dispatch({ type: 'hoverDuration', elapsedMs: HOVER_MS, timestamp: performance.now(), eventSource: 'petPointer' })
      }, HOVER_MS)
    }
    const onLeave = () => {
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = 0 }
      if (nearRef.current) {
        nearRef.current = false
        dispatch({ type: 'proximity', stateTransition: 'exit', distanceToPetCenter: PROXIMITY_RADIUS, timestamp: performance.now(), eventSource: 'petPointer' })
      }
      dispatch({ type: 'mouseLeave', timestamp: performance.now(), eventSource: 'petPointer' })
    }

    const attachHandlers = () => {
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointermove', onHoverMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('dblclick', onDoubleClick)
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

      // 随音量呼吸：开启且播放时按音量平滑缩放，否则平滑归零
      const breathTarget = config.behavior.audioBreath && audioPlayingRef.current ? effLevel : 0
      breathRef.current += (breathTarget - breathRef.current) * 0.18
      sprite.setBreath(breathRef.current)

      if (audioPlayingRef.current && now - lastAudioRuleRef.current > 100) {
        lastAudioRuleRef.current = now
        dispatch({ type: 'audioLevel', audioLevel: audioLevelRef.current, timestamp: now, eventSource: 'audio' })
      }

      let eff: SpriteAnimId
      if (persistentRef.current) eff = persistentRef.current
      else if (now < transientUntilRef.current) eff = transientAnimRef.current
      else eff = (audioPlayingRef.current && !config.behavior.paused && config.behavior.audioBreath) ? 'sing' : 'idle'
      sprite.setAnim(eff, now)

      // 情绪状态机（A1）：开心(临时)>专注(播放)>瞌睡(久置)>待机
      let mood: PetMood = 'idle'
      if (now < happyUntilRef.current) mood = 'happy'
      else if (audioPlayingRef.current) mood = 'focus'
      else if (now - lastActivityRef.current > 55000) mood = 'sleepy'
      sprite.setMood(mood)

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
      if (statsTimer) clearInterval(statsTimer)
      if (onboardingTimer) clearTimeout(onboardingTimer)
      unsubAudio()
      unsubConfig()
      unsubAbout()
      unsubSelection()
      unsubTrial()
      unsubReplay()
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointermove', onHoverMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('mouseenter', onEnter)
      canvas.removeEventListener('mouseleave', onLeave)
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
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

      {bubble && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: Math.round(148 * scaleRef.current + 10),
            maxWidth: 200,
            padding: '8px 12px',
            background: 'rgba(28, 26, 44, 0.96)',
            color: '#f3eefb',
            borderRadius: 12,
            fontSize: 13,
            lineHeight: 1.4,
            textAlign: 'center',
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
            pointerEvents: 'none',
            zIndex: 30,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {bubble.text}
        </div>
      )}
    </>
  )
}
