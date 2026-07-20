// 声波小精灵 · 程序化 Canvas 渲染器
// 不依赖任何图片素材：纯 2D canvas 绘制一个由「声波」构成的吉祥物。
// 外观由 hue 决定，嘴部为波形线，振幅随 audioLevel（实时音量）起伏。
import type { SpriteAnimId } from './engine/types'

export interface SpriteRenderState {
  anim: SpriteAnimId
  animStartedAt: number
  audioLevel: number
  audioPlaying: boolean
  /** 随音量呼吸强度 0..1（由帧循环平滑后写入） */
  breath: number
  message: string | null
  messageUntil: number
  hue: number
  name: string
}

interface Pose {
  bobY: number
  squashX: number
  squashY: number
  tilt: number
  eyeScale: number
  mouth: 'wave' | 'o' | 'flat'
  shakeX: number
  glow: number
}

export class SpriteRenderer {
  private state: SpriteRenderState
  private nextBlinkAt = 0
  private blinkUntil = 0

  constructor(hue = 265, name = '声波小精灵') {
    this.state = {
      anim: 'idle',
      animStartedAt: performance.now(),
      audioLevel: 0,
      audioPlaying: false,
      breath: 0,
      message: null,
      messageUntil: 0,
      hue,
      name
    }
    this.scheduleBlink(performance.now())
  }

  setAnim(anim: SpriteAnimId, now = performance.now()): void {
    if (this.state.anim !== anim) {
      this.state.anim = anim
      this.state.animStartedAt = now
    }
  }

  setAudioLevel(level: number): void {
    this.state.audioLevel = Math.max(0, Math.min(1, level))
  }

  setAudioPlaying(playing: boolean): void {
    this.state.audioPlaying = playing
    if (!playing) this.state.audioLevel = 0
  }

  /** 设置随音量呼吸强度（0..1），由帧循环按音频电平平滑后写入 */
  setBreath(b: number): void {
    this.state.breath = Math.max(0, Math.min(1, b))
  }

  showMessage(text: string | undefined, durationMs: number, now = performance.now()): void {
    if (text) {
      this.state.message = text
      this.state.messageUntil = now + durationMs
    }
  }

  clearMessage(now = performance.now()): void {
    if (this.state.message && now > this.state.messageUntil) this.state.message = null
  }

  setHue(hue: number): void {
    this.state.hue = hue
  }

  setName(name: string): void {
    this.state.name = name
  }

  private scheduleBlink(now: number): void {
    this.nextBlinkAt = now + 2200 + Math.random() * 3200
  }

  private computeBlink(now: number): boolean {
    if (now >= this.nextBlinkAt && now < this.nextBlinkAt + 130) {
      if (this.blinkUntil !== this.nextBlinkAt) {
        this.blinkUntil = this.nextBlinkAt
        this.scheduleBlink(now)
      }
      return true
    }
    return false
  }

  private computePose(now: number): Pose {
    const t = (now - this.state.animStartedAt) / 1000
    const level = this.state.audioLevel
    const base: Pose = {
      bobY: 0,
      squashX: 1,
      squashY: 1,
      tilt: 0,
      eyeScale: 1,
      mouth: 'wave',
      shakeX: 0,
      glow: 0
    }

    switch (this.state.anim) {
      case 'idle': {
        base.bobY = Math.sin(now / 620) * 4
        const breathe = Math.sin(now / 1800)
        base.squashX = 1 + breathe * 0.02
        base.squashY = 1 - breathe * 0.02
        base.mouth = 'wave'
        break
      }
      case 'bounce': {
        const phase = (t * 3.2) % 1
        const jump = Math.sin(phase * Math.PI)
        base.bobY = -jump * 26
        const land = phase > 0.92 ? (phase - 0.92) / 0.08 : 0
        base.squashX = 1 + land * 0.18
        base.squashY = 1 - land * 0.18
        base.mouth = 'wave'
        base.glow = level * 0.6
        break
      }
      case 'click': {
        const pop = Math.sin(Math.min(1, t / 0.4) * Math.PI)
        base.squashX = 1 + pop * 0.14
        base.squashY = 1 + pop * 0.1
        base.eyeScale = 1 + pop * 0.2
        base.mouth = 'wave'
        break
      }
      case 'surprised': {
        base.eyeScale = 1.5
        base.bobY = -2
        base.mouth = 'o'
        base.shakeX = Math.sin(now / 40) * 1.5 * Math.max(0, 1 - t / 0.5)
        break
      }
      case 'wave': {
        base.tilt = Math.sin(t * 7) * 0.16
        base.bobY = Math.sin(t * 7) * 3
        base.eyeScale = 1.1
        base.mouth = 'wave'
        break
      }
      case 'drag': {
        base.squashX = 1.12
        base.squashY = 0.9
        base.tilt = 0.08
        base.mouth = 'wave'
        base.glow = 0.2
        break
      }
      case 'sleep': {
        const breathe = Math.sin(now / 2600)
        base.bobY = 6 + breathe * 2
        base.squashY = 1.04
        base.eyeScale = 0
        base.mouth = 'flat'
        break
      }
    }
    return base
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, now = performance.now()): void {
    ctx.clearRect(0, 0, W, H)
    this.clearMessage(now)
    const blink = this.computeBlink(now) && this.state.anim !== 'sleep'
    const p = this.computePose(now)

    const cx = W / 2
    const baseY = H - 92
    const r = 56
    const x = cx + p.shakeX
    const y = baseY + p.bobY
    // 随音量呼吸：整体缩放（叠加在姿态 squash 之上）
    const breath = Math.max(0, Math.min(1, this.state.breath))
    const breathScale = 1 + breath * 0.16
    const rx = r * p.squashX * breathScale
    const ry = r * p.squashY * breathScale

    const hue = this.state.hue
    const bodyFill = `hsl(${hue}, 72%, 66%)`
    const bodyFillDark = `hsl(${hue}, 62%, 55%)`
    const outline = `hsl(${hue}, 52%, 46%)`

    // 声音光晕（随呼吸轻微放大 + 增亮，呈现「随音量呼吸」的透明度脉动）
    if (p.glow > 0.01) {
      const g = ctx.createRadialGradient(x, y, r * 0.4 * breathScale, x, y, r * 1.8 * breathScale)
      g.addColorStop(0, `hsla(${hue}, 90%, 70%, ${0.35 * p.glow * (1 + breath * 0.6)})`)
      g.addColorStop(1, `hsla(${hue}, 90%, 70%, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r * 1.8 * breathScale, 0, Math.PI * 2)
      ctx.fill()
    }

    // 影子
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = '#000'
    const shadowScale = 1 - Math.max(0, -p.bobY) / 60
    ctx.beginPath()
    ctx.ellipse(cx, baseY + 72, rx * 0.72 * shadowScale, 9 * shadowScale, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(p.tilt)

    this.drawAntennae(ctx, rx, ry, hue, now)

    // 身体
    const grad = ctx.createLinearGradient(0, -ry, 0, ry)
    grad.addColorStop(0, bodyFill)
    grad.addColorStop(1, bodyFillDark)
    ctx.fillStyle = grad
    ctx.strokeStyle = outline
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // 肚子高光
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.ellipse(-rx * 0.18, ry * 0.12, rx * 0.5, ry * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // 眼睛（更大更圆，自带高光，更可爱）
    const eyeY = -ry * 0.18
    const eyeDX = rx * 0.36
    const eyeR = rx * 0.26 * p.eyeScale
    if (this.state.anim === 'sleep') {
      ctx.strokeStyle = outline
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      for (const sx of [-eyeDX, eyeDX]) {
        ctx.beginPath()
        ctx.arc(sx, eyeY, eyeR * 0.95, Math.PI * 0.12, Math.PI * 0.88)
        ctx.stroke()
      }
    } else if (blink) {
      ctx.strokeStyle = outline
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      for (const sx of [-eyeDX, eyeDX]) {
        ctx.beginPath()
        ctx.moveTo(sx - eyeR, eyeY)
        ctx.lineTo(sx + eyeR, eyeY)
        ctx.stroke()
      }
    } else {
      for (const sx of [-eyeDX, eyeDX]) {
        // 眼白
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.ellipse(sx, eyeY, eyeR, eyeR * 1.18, 0, 0, Math.PI * 2)
        ctx.fill()
        // 瞳孔
        ctx.fillStyle = '#2a2540'
        ctx.beginPath()
        ctx.arc(sx + eyeR * 0.12, eyeY + eyeR * 0.12, eyeR * 0.6, 0, Math.PI * 2)
        ctx.fill()
        // 大高光
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(sx - eyeR * 0.22, eyeY - eyeR * 0.28, eyeR * 0.34, 0, Math.PI * 2)
        ctx.fill()
        // 小高光
        ctx.beginPath()
        ctx.arc(sx + eyeR * 0.34, eyeY + eyeR * 0.36, eyeR * 0.14, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 嘴部波形
    const mouthY = ry * 0.34
    const mouthW = rx * 0.62
    ctx.strokeStyle = outline
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    if (p.mouth === 'o') {
      ctx.fillStyle = outline
      ctx.beginPath()
      ctx.ellipse(0, mouthY, rx * 0.12, ry * 0.12, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (p.mouth === 'flat') {
      ctx.beginPath()
      ctx.moveTo(-mouthW * 0.4, mouthY)
      ctx.lineTo(mouthW * 0.4, mouthY)
      ctx.stroke()
    } else {
      const amp = 2 + (this.state.audioPlaying ? this.state.audioLevel * 14 : 1 + Math.sin(now / 500) * 0.6)
      ctx.beginPath()
      const steps = 28
      for (let i = 0; i <= steps; i++) {
        const px = -mouthW / 2 + (mouthW * i) / steps
        const ph = (i / steps) * Math.PI * 4 + now / 120
        const env = Math.max(0.25, Math.sin((i / steps) * Math.PI))
        const py = mouthY + Math.sin(ph) * amp * env
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }

    // 腮红（更明显，更可爱）
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = `hsl(${(hue + 18) % 360}, 85%, 72%)`
    ctx.beginPath()
    ctx.ellipse(-rx * 0.52, ry * 0.18, rx * 0.15, ry * 0.1, 0, 0, Math.PI * 2)
    ctx.ellipse(rx * 0.52, ry * 0.18, rx * 0.15, ry * 0.1, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // 小脚丫
    ctx.fillStyle = bodyFillDark
    ctx.strokeStyle = outline
    ctx.lineWidth = 2.5
    for (const sx of [-rx * 0.34, rx * 0.34]) {
      ctx.beginPath()
      ctx.ellipse(sx, ry * 0.96, rx * 0.2, ry * 0.12, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // 闪亮小星星 ✦
    const tw = 0.5 + 0.5 * Math.sin(now / 300)
    ctx.save()
    ctx.globalAlpha = 0.75 * tw
    ctx.fillStyle = '#fff'
    this.drawSparkle(ctx, rx * 1.02, -ry * 0.95, 4 + 2.5 * tw)
    ctx.restore()

    ctx.restore() // tilt

    // 睡觉 Zzz
    if (this.state.anim === 'sleep') {
      ctx.save()
      ctx.fillStyle = `hsla(${hue}, 60%, 55%, 0.9)`
      ctx.font = 'bold 18px sans-serif'
      const zz = (Math.sin(now / 600) + 1) * 4
      ctx.fillText('Z', x + rx * 0.5, y - ry * 0.6 - zz)
      ctx.font = 'bold 13px sans-serif'
      ctx.fillText('z', x + rx * 0.78, y - ry * 0.95 - zz * 1.5)
      ctx.restore()
    }

    // 消息气泡
    if (this.state.message) {
      this.drawBubble(ctx, x, y - ry - 14, W, this.state.message, hue)
    }
  }

  private drawAntennae(ctx: CanvasRenderingContext2D, rx: number, ry: number, hue: number, now: number): void {
    const pulse = this.state.audioPlaying ? 1 + this.state.audioLevel * 0.6 : 1
    ctx.strokeStyle = `hsl(${hue}, 60%, 50%)`
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    for (const sx of [-0.45, 0.45]) {
      const bx = rx * sx
      const by = -ry * 0.92
      const tipX = bx + sx * 8
      const tipY = by - 16 * pulse - Math.sin(now / 200 + (sx > 0 ? 1 : 0)) * 2
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.quadraticCurveTo(bx + sx * 4, by - 10, tipX, tipY)
      ctx.stroke()
      ctx.fillStyle = `hsl(${hue}, 80%, 70%)`
      ctx.beginPath()
      ctx.arc(tipX, tipY, 4 * pulse, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    ctx.beginPath()
    ctx.moveTo(cx, cy - size)
    ctx.quadraticCurveTo(cx, cy, cx + size, cy)
    ctx.quadraticCurveTo(cx, cy, cx, cy + size)
    ctx.quadraticCurveTo(cx, cy, cx - size, cy)
    ctx.quadraticCurveTo(cx, cy, cx, cy - size)
    ctx.closePath()
    ctx.fill()
  }

  private drawBubble(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, W: number, text: string, hue: number): void {
    const maxW = 180
    const padX = 12
    const padY = 10
    const lineH = 22
    ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif'
    const lines = this.wrapText(ctx, text, maxW - padX * 2)
    const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2)
    const bh = lines.length * lineH + padY * 2
    let bx = cx - bw / 2
    bx = Math.max(6, Math.min(W - bw - 6, bx))
    const by = bottomY - bh

    ctx.save()
    ctx.fillStyle = 'rgba(28,26,40,0.95)'
    ctx.strokeStyle = `hsl(${hue}, 60%, 60%)`
    ctx.lineWidth = 1.5
    this.roundRect(ctx, bx, by, bw, bh, 12)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 7, by + bh - 1)
    ctx.lineTo(cx, by + bh + 9)
    ctx.lineTo(cx + 7, by + bh - 1)
    ctx.closePath()
    ctx.fillStyle = 'rgba(28,26,40,0.95)'
    ctx.fill()

    ctx.fillStyle = '#f3f1ff'
    ctx.textBaseline = 'top'
    lines.forEach((line, i) => {
      ctx.fillText(line, bx + padX, by + padY + i * lineH)
    })
    ctx.restore()
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const lines: string[] = []
    let cur = ''
    for (const ch of text) {
      if (ch === '\n') {
        lines.push(cur)
        cur = ''
        continue
      }
      const test = cur + ch
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur)
        cur = ch
      } else {
        cur = test
      }
    }
    if (cur) lines.push(cur)
    return lines.slice(0, 4)
  }
}
