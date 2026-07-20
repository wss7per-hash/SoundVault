// SoundVault 宠物 · 默认配置与默认规则模板
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/shared/defaults.js，动作/事件适配声波小精灵。
import type { PetConfig, PetRule } from './types'

// 默认文案（点击/随机互动气泡），模板与配置共用，避免 TDZ 引用。
const DEFAULT_MESSAGES = {
  clickMessages: ['♪ 这个我喜欢！', '♫ 听起来不错~', '嗨，继续放！'],
  randomMessages: ['在听什么呢？', '需要我帮你找音效吗？', 'SoundVault 随时待命~'],
  bubbleDurationMs: 2000
}

const DEFAULT_RULE_TEMPLATES: PetRule[] = [
  {
    id: 'default-audio-bounce',
    name: '播放时跳动',
    enabled: true,
    conditions: [{ type: 'audioLevel', required: true, filters: [{ field: 'audioLevel', operator: '>', value: 0.05 }] }],
    cooldownMs: 0,
    priority: 80,
    actionStrategy: 'sequence',
    actions: [{ type: 'playSpriteAnim', animation: 'bounce' }]
  },
  {
    id: 'default-audio-stop-idle',
    name: '停止播放回归待机',
    enabled: true,
    conditions: [{ type: 'audioStop', required: true }],
    cooldownMs: 300,
    priority: 70,
    actionStrategy: 'sequence',
    actions: [{ type: 'playSpriteAnim', animation: 'idle' }]
  },
  {
    id: 'default-click-greeting',
    name: '点击打招呼',
    enabled: true,
    conditions: [{ type: 'click', required: true, filters: [] }],
    cooldownMs: 800,
    priority: 50,
    actionStrategy: 'sequence',
    actions: [
      { type: 'playSpriteAnim', animation: 'click' },
      { type: 'randomMessage', messages: DEFAULT_MESSAGES.clickMessages, durationMs: 2000 }
    ]
  },
  {
    id: 'default-dragging',
    name: '拖动中',
    enabled: true,
    conditions: [{ type: 'dragStart', required: false }, { type: 'dragging', required: false }],
    cooldownMs: 0,
    priority: 90,
    actionStrategy: 'sequence',
    actions: [{ type: 'playSpriteAnim', animation: 'drag' }]
  },

  {
    id: 'default-hover',
    name: '悬停互动',
    enabled: true,
    conditions: [{ type: 'mouseEnter', required: true }],
    cooldownMs: 1000,
    priority: 30,
    actionStrategy: 'sequence',
    actions: [{ type: 'playSpriteAnim', animation: 'wave' }]
  },
  {
    id: 'default-random-timer',
    name: '随机互动',
    enabled: true,
    conditions: [{ type: 'randomTimer', required: true }],
    cooldownMs: 8000,
    priority: 10,
    actionStrategy: 'sequence',
    actions: [
      { type: 'playSpriteAnim', animation: 'surprised' },
      { type: 'randomMessage', messages: DEFAULT_MESSAGES.randomMessages, durationMs: 2000 }
    ]
  },
  {
    id: 'default-timed',
    name: '定时互动',
    enabled: true,
    conditions: [{ type: 'timer', required: true }],
    cooldownMs: 8000,
    priority: 10,
    actionStrategy: 'sequence',
    actions: [{ type: 'showMessage', text: '在听什么呢？', durationMs: 2000 }]
  },
  {
    id: 'default-idle-sleep',
    name: '休息状态',
    enabled: true,
    conditions: [{ type: 'idleDuration', required: true, filters: [{ field: 'elapsedMs', operator: '>=', value: 90000, unit: 'ms' }] }],
    cooldownMs: 12000,
    priority: 5,
    actionStrategy: 'sequence',
    actions: [{ type: 'playSpriteAnim', animation: 'sleep' }, { type: 'showMessage', text: 'Zzz...', durationMs: 2000 }]
  }
]

export const DEFAULT_PET_CONFIG: PetConfig = {
  enabled: true,
  display: {
    x: 80,
    y: 160,
    scale: 0.7,
    opacity: 1,
    alwaysOnTop: true,
    clickThrough: false,
    locked: false
  },
  messages: { ...DEFAULT_MESSAGES },
  sprite: {
    hue: 265,
    name: '声波小精灵'
  },
  triggerRules: DEFAULT_RULE_TEMPLATES
}

export { DEFAULT_RULE_TEMPLATES }
