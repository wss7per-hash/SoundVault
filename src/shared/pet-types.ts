// SoundVault 宠物（声波小精灵）· 跨进程共享类型
// 同时被主进程(preload, tsconfig.node) 与渲染进程(engine, tsconfig.web) 使用，
// 因此放在 src/shared 下、被两个 tsconfig 共同 include，避免跨 project 引用(TS6307)。
// 仅用基础类型，不依赖渲染端 engine/types，保证两侧独立编译通过。

/** 持久化的显示状态（宠物窗口位置/缩放/透明度等），均为可选覆盖 */
export interface PetDisplayStored {
  x?: number
  y?: number
  scale?: number
  opacity?: number
  alwaysOnTop?: boolean
  clickThrough?: boolean
  locked?: boolean
}

/**
 * 持久化到 settings 表的「精简宠物配置」。
 * 仅存用户可改的部分；完整规则集(triggerRules)由渲染端 DEFAULT_PET_CONFIG 补全，
 * 避免主进程重复维护默认规则。ruleEnabled 为各规则启停覆盖。
 */
export interface PetConfigStored {
  enabled?: boolean
  display?: PetDisplayStored
  sprite?: { hue?: number; name?: string }
  messages?: {
    clickMessages?: string[]
    randomMessages?: string[]
    bubbleDurationMs?: number
  }
  ruleEnabled?: Record<string, boolean>
}

/** 主窗口播放音效时上报给宠物窗口的音频事件 */
export interface PetAudioEvent {
  type: 'level' | 'start' | 'stop'
  level?: number
}
