// SoundVault 宠物 · 默认配置与默认规则模板
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/shared/defaults.js，动作/事件适配声波小精灵。
import type { PetConfig, PetRule } from './types'

// 默认文案（点击/随机互动气泡），模板与配置共用，避免 TDZ 引用。
const DEFAULT_MESSAGES = {
  clickMessages: [
    '♪ 这个我喜欢！',
    '♫ 听起来不错~',
    '嗨，继续放！',
    '这段旋律好抓耳！',
    '加进收藏夹吧~',
    '节奏感拉满了！'
  ],
  randomMessages: [
    '在听什么呢？',
    '需要我帮你找音效吗？',
    'SoundVault 随时待命~',
    '今天也是爱音乐的一天 ♪',
    '要不要试试随机播放？',
    '我在这儿陪你听歌~'
  ],
  bubbleDurationMs: 2000
}

// 更丰富的默认互动气泡（双击/悬停/靠近等事件专用，不持久化，仅作为默认规则的动作文案）
const POKE_MESSAGES = ['哎哟，戳到我啦！', '嘿嘿，别闹~', '你戳中我啦！', '再戳就害羞了 >_<']
const HOVER_MESSAGES = ['陪我听会儿歌吧~', '在忙呀？', '需要什么音效尽管说', '我就在这儿哦']
const NEAR_MESSAGES = ['♪ 你在附近耶~', '离我这么近呀', '我感觉到你啦！', '要不要一起听？']

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
  },

  {
    id: 'default-double-click',
    name: '双击被戳',
    enabled: true,
    conditions: [{ type: 'doubleClick', required: true }],
    cooldownMs: 1000,
    priority: 60,
    actionStrategy: 'sequence',
    actions: [
      { type: 'playSpriteAnim', animation: 'surprised' },
      { type: 'randomMessage', messages: POKE_MESSAGES, durationMs: 2000 }
    ]
  },
  {
    id: 'default-hover-duration',
    name: '悬停寒暄',
    enabled: true,
    conditions: [{ type: 'hoverDuration', required: true, filters: [{ field: 'elapsedMs', operator: '>=', value: 700, unit: 'ms' }] }],
    cooldownMs: 4000,
    priority: 25,
    actionStrategy: 'sequence',
    actions: [
      { type: 'playSpriteAnim', animation: 'wave' },
      { type: 'randomMessage', messages: HOVER_MESSAGES, durationMs: 2200 }
    ]
  },
  {
    id: 'default-proximity-near',
    name: '靠近互动',
    enabled: true,
    conditions: [{ type: 'proximity', required: true, filters: [{ field: 'stateTransition', operator: '=', value: 'enter' }] }],
    cooldownMs: 3500,
    priority: 40,
    actionStrategy: 'sequence',
    actions: [
      { type: 'playSpriteAnim', animation: 'bounce' },
      { type: 'randomMessage', messages: NEAR_MESSAGES, durationMs: 2200 }
    ]
  }
]

export const DEFAULT_PET_CONFIG: PetConfig = {
  enabled: true,
  display: {
    x: 80,
    y: 160,
    scale: 0.35,
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
  behavior: {
    audioBreath: true,
    paused: false
  },
  triggerRules: DEFAULT_RULE_TEMPLATES
}

export { DEFAULT_RULE_TEMPLATES }
