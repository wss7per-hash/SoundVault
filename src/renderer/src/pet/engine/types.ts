// SoundVault 宠物规则引擎 · 类型定义
// 移植自 duzexu/desktop-pet (GPL-3.0)，仅借鉴其规则引擎模型，渲染层改为声波小精灵。
// https://github.com/duzexu/desktop-pet

/** 声波小精灵可用的程序化动画状态（替代 desktop-pet 的素材 asset） */
export type SpriteAnimId = 'idle' | 'bounce' | 'click' | 'surprised' | 'sleep' | 'drag' | 'wave' | 'sing'

/** 触发器事件类型（SoundVault 宠物专用；含音频联动事件） */
export type PetEventType =
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'dragStart'
  | 'dragging'
  | 'dragEnd'
  | 'mouseEnter'
  | 'mouseLeave'
  | 'hoverDuration'
  | 'proximity'
  | 'idleDuration'
  | 'audioStart'
  | 'audioLevel'
  | 'audioStop'
  | 'mouseMove'
  | 'stateExit'
  | 'stateEnter'
  | 'manualReset'
  | 'timer'
  | 'randomTimer'

/** 条件过滤器：字段 + 运算符 + 期望值 */
export interface RuleFilter {
  field: string
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'between' | 'in' | 'notIn'
  value: number | string | boolean | Array<number | string>
  unit?: string
}

/** 单个触发条件 */
export interface RuleCondition {
  type: PetEventType
  required?: boolean
  filters?: RuleFilter[]
  /** 状态型规则（鼠标靠近等）进入所需的持续毫秒 */
  sustainMs?: number
}

/** 动作类型 */
export type PetActionType =
  | 'blank'
  | 'delay'
  | 'playSpriteAnim'
  | 'showMessage'
  | 'randomMessage'
  | 'changeScale'
  | 'changeOpacity'
  | 'movePet'
  | 'hidePet'
  | 'showPet'
  | 'resetPosition'
  | 'changeDisplay'
  | 'openPetSettings'

/** 单个动作描述 */
export interface PetAction {
  type: PetActionType
  animation?: SpriteAnimId
  text?: string
  messages?: string[]
  scale?: number
  opacity?: number
  durationMs?: number
  progressFrom?: string
  progress?: number
  /** delay 动作的等待时长 */
  delayMs?: number
  /** 进度偏移（用于 changeDisplay 等动作的百分比映射） */
  offset?: number
}

/** 状态型规则的退出侧 */
export interface RuleState {
  exitConditions?: RuleCondition[]
  exitActions?: PetAction[]
}

/** 一条规则 */
export interface PetRule {
  id: string
  name: string
  enabled?: boolean
  conditions?: RuleCondition[]
  priority?: number
  cooldownMs?: number
  conditionWindowMs?: number
  actionStrategy?: 'sequence' | 'random'
  stopOnMatch?: boolean
  continuous?: boolean
  actions?: PetAction[]
  state?: RuleState
  timerRuleId?: string
}

/** 宠物配置（持久化到 settings 表） */
export interface PetConfig {
  enabled: boolean
  display: {
    x: number
    y: number
    scale: number
    opacity: number
    alwaysOnTop: boolean
    clickThrough: boolean
    locked: boolean
  }
  messages: {
    clickMessages: string[]
    randomMessages: string[]
    bubbleDurationMs: number
  }
  sprite: {
    /** 主色（HSL 或 hex），决定小精灵外观 */
    hue: number
    /** 名称，显示在气泡/设置里 */
    name: string
  }
  behavior: {
    /** 随音量呼吸：播放时随音量缩放 + 光晕脉动 */
    audioBreath: boolean
    /** 暂停互动：冻结所有规则反应 */
    paused: boolean
  }
  triggerRules: PetRule[]
}

/** 事件上下文（传给规则引擎的当前事件） */
export interface PetEventContext {
  type: PetEventType
  timestamp?: number
  eventSource?: 'petPointer' | 'audio' | 'timer' | 'ruleRuntime'
  isInsidePet?: boolean
  distanceToPetCenter?: number
  distanceToPetBounds?: number
  dragDeltaX?: number
  dragDeltaY?: number
  dragDistance?: number
  dragDurationMs?: number
  deltaX?: number
  deltaY?: number
  speed?: number
  direction?: string
  angleToPet?: number
  angleToPetDegrees?: number
  angleToPetProgress?: number
  isMovingTowardPet?: boolean
  isMovingAwayFromPet?: boolean
  elapsedMs?: number
  durationMs?: number
  audioLevel?: number
  currentHour?: number
  dayOfWeek?: number
  label?: string
  /** 状态型规则进入/退出过渡标记（运行时内部使用） */
  stateTransition?: 'enter' | 'exit'
  /** 触发该事件的规则 id（状态型规则内部使用） */
  ruleId?: string
  /** 定时器事件归属的规则 id（用于避免自我触发） */
  timerRuleId?: string
}

/** 规则评估返回的匹配结果 */
export interface EvaluatedRule {
  rule: PetRule
  actions: PetAction[]
}

// 跨进程共享类型统一放 src/shared/pet-types，避免 preload 跨 project 引用(TS6307)
export type { PetConfigStored, PetDisplayStored, PetAudioEvent } from '../../../../shared/pet-types'
