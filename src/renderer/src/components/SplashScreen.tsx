import { useEffect, useState, useRef } from 'react'

/**
 * SplashScreen — 炫酷启动动画（声音素材库主题）
 * 全屏覆盖层，数据真正加载完成后淡出。
 * 动效：粒子网络 + 声波涟漪环 + 中央旋转环 + 均衡器音柱 + Logo 流光 + 扫描进度
 * 与 App.loadData 挂钩：数据就绪（或最长超时）后才进入淡出阶段。
 */
export function SplashScreen({ onDone, ready = false }: { onDone: () => void; ready?: boolean }): JSX.Element {
  const [phase, setPhase] = useState(0) // 0=入场 → 1=元素亮起 → 2=扫描完成 → 3=淡出
  const [progress, setProgress] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  const doneRef = useRef(false)
  const phaseRef = useRef(0)
  const readyRef = useRef(ready)
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { readyRef.current = ready }, [ready])

  // 均衡器音柱的随机参数（仅生成一次）
  const bars = useRef(
    Array.from({ length: 34 }, () => ({
      dur: 0.45 + Math.random() * 0.9,
      delay: Math.random() * 0.8,
      h: 16 + Math.random() * 30,
    }))
  ).current

  // 收尾：跳到 100% → 进入淡出 → 卸载
  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    setProgress(100)
    setPhase(3)
    setTimeout(onDone, 800)
  }

  // ---- Canvas 粒子网络 ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    interface P { x: number; y: number; vx: number; vy: number; r: number; a: number; da: number }
    const particles: P[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.6 + 0.5,
      a: Math.random() * 0.4 + 0.1,
      da: (Math.random() - 0.5) * 0.008,
    }))

    let frame = 0
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      frame++
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy
        p.a += p.da
        if (p.a <= 0.05 || p.a >= 0.6) p.da *= -1
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(124, 114, 230, ${p.a})`
        ctx.fill()
      })
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = dx * dx + dy * dy
          if (dist < 14400) {
            const opacity = (1 - dist / 14400) * 0.12
            ctx.strokeStyle = `rgba(124, 114, 230, ${opacity})`
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }
      animRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // ---- 入场时序 ----
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 250)
    const t2 = setTimeout(() => setPhase(2), 1200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // ---- 模拟进度条（卡在 92%，等 finish 跳 100%）----
  useEffect(() => {
    if (phase < 1) return
    const interval = setInterval(() => {
      setProgress(p => {
        if (doneRef.current) return 100
        const next = p + Math.random() * 8 + 3
        return next >= 92 ? 92 : next
      })
    }, 140)
    return () => clearInterval(interval)
  }, [phase])

  // ---- 退出控制：最短展示 1400ms，随后等待数据就绪，最长 4500ms ----
  useEffect(() => {
    const minT = setTimeout(() => {
      if (readyRef.current && phaseRef.current >= 2) finish()
    }, 1400)
    const poll = setInterval(() => {
      if (readyRef.current && phaseRef.current >= 2) finish()
    }, 120)
    const maxT = setTimeout(() => finish(), 4500)
    return () => { clearTimeout(minT); clearInterval(poll); clearTimeout(maxT) }
  }, [])

  const isExiting = phase === 3

  const centerStyle = {
    opacity: phase >= 1 ? (isExiting ? 0 : 1) : 0,
    transform: `scale(${phase >= 1 ? 1 : 0.85}) translateY(${phase >= 1 ? 0 : 14}px)`,
    transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
  }

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-[#1a1a18] transition-opacity duration-700 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <style>{`
        @keyframes sv-ripple {
          0%   { transform: scale(0.5); opacity: 0.55; }
          80%  { opacity: 0.08; }
          100% { transform: scale(1.9); opacity: 0; }
        }
        @keyframes sv-eq {
          0%   { transform: scaleY(0.15); }
          100% { transform: scaleY(1); }
        }
        @keyframes sv-spin { to { transform: rotate(360deg); } }
        @keyframes sv-shimmer {
          0%   { background-position: 0% 50%; }
          100% { background-position: 220% 50%; }
        }
        @keyframes sv-sweep {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
      `}</style>

      {/* 粒子背景 */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* 中央径向光晕 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          style={{
            width: 540, height: 540,
            background: 'radial-gradient(circle, rgba(124,114,230,0.18), rgba(83,74,183,0.05) 40%, transparent 70%)',
            filter: 'blur(8px)',
          }}
        />
      </div>

      {/* 声波涟漪环 */}
      <div className="absolute inset-0 flex items-center justify-center">
        {[0, 1, 2, 3, 4].map(i => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: 150, height: 150,
              border: '1px solid rgba(124,114,230,0.5)',
              animation: `sv-ripple 3.2s ease-out ${i * 0.62}s infinite`,
            }}
          />
        ))}
      </div>

      {/* 中央主视觉 */}
      <div className="relative z-10 flex flex-col items-center" style={centerStyle}>
        {/* Logo 图标 + 旋转环 */}
        <div className="relative flex items-center justify-center" style={{ width: 104, height: 104 }}>
          <div
            className="absolute rounded-full"
            style={{
              width: 104, height: 104,
              border: '2px solid transparent',
              borderTopColor: '#7C72E6',
              borderRightColor: 'rgba(83,74,183,0.6)',
              animation: 'sv-spin 2.6s linear infinite',
            }}
          />
          <div
            className="w-24 h-24 rounded-3xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #534AB7, #7C72E6)',
              boxShadow: '0 12px 44px rgba(83,74,183,0.45)',
            }}
          >
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h2l2-6 3 14 3-18 3 12 2-2h3" />
            </svg>
          </div>
        </div>

        {/* 品牌名（流光）*/}
        <h1
          className="mt-6 text-3xl font-bold tracking-wider"
          style={{
            background: 'linear-gradient(90deg,#D3D1C7,#9b94f0,#534AB7,#9b94f0,#D3D1C7)',
            backgroundSize: '220% 100%',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            animation: 'sv-shimmer 5s linear infinite',
          }}
        >
          SoundVault
        </h1>
        <p className="mt-2 text-[11px] text-[#8a8a82] tracking-[0.35em] uppercase">
          AI Sound Effect Library
        </p>

        {/* 均衡器音柱 */}
        <div className="mt-7 flex items-end justify-center gap-[3px]" style={{ height: 48 }}>
          {bars.map((b, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full"
              style={{
                height: `${b.h}px`,
                transformOrigin: 'bottom',
                background: 'linear-gradient(to top, #534AB7, #7C72E6)',
                animation: `sv-eq ${b.dur}s ease-in-out ${b.delay}s infinite alternate`,
              }}
            />
          ))}
        </div>
      </div>

      {/* 底部进度 */}
      <div
        className="absolute bottom-24 flex flex-col items-center gap-3"
        style={{
          opacity: phase >= 1 ? (isExiting ? 0 : 1) : 0,
          transform: `translateY(${phase >= 1 ? 0 : 20}px)`,
          transition: 'all 0.6s ease-out',
          transitionDelay: '0.3s',
        }}
      >
        <div className="relative w-56 h-[3px] bg-[#2a2a28] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg,#534AB7,#7C72E6)',
              transition: 'width 0.2s ease-out',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)',
              animation: 'sv-sweep 1.6s ease-in-out infinite',
            }}
          />
        </div>
        <p className="text-xs text-[#8a8a82]">
          {phase >= 3 ? 'SoundVault 已就绪' : '正在加载声音素材库…'}
        </p>
      </div>

      {/* 版本号 */}
      <div className="absolute bottom-5 right-5 text-[10px] text-[#6a6a64]/60 font-mono">
        v1.0.0
      </div>
    </div>
  )
}
