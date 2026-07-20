// SoundVault 宠物规则引擎 · Schema（触发器参数、动作类型）
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/shared/schema.js，字段集合适配声波小精灵。
import type { PetEventType, SpriteAnimId } from './types'

export const SUPPORTED_OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'between', 'in', 'notIn'] as const

/** 动作类型集合（playAnimation → playSpriteAnim，openPanel → openPetSettings） */
export const SUPPORTED_ACTION_TYPES: string[] = [
  'blank',
  'delay',
  'playSpriteAnim',
  'showMessage',
  'randomMessage',
  'changeScale',
  'changeOpacity',
  'movePet',
  'hidePet',
  'showPet',
  'resetPosition',
  'changeDisplay',
  'openPetSettings'
]

/** 程序化 sprite 动画 id 集合 */
export const SUPPORTED_SPRITE_ANIMS: SpriteAnimId[] = [
  'idle',
  'bounce',
  'click',
  'surprised',
  'sleep',
  'drag',
  'wave'
]

const DISCRETE_POINTER_FIELDS = ['distanceToPetCenter']

const DRAG_PROGRESS_FIELDS = [
  'isInsidePet',
  'distanceToPetCenter',
  'distanceToPetBounds',
  'dragDeltaX',
  'dragDeltaY',
  'dragDistance',
  'dragDurationMs'
]

const TIME_FIELDS = ['elapsedMs']
const MOUSE_STILL_FIELDS = ['isInsidePet', 'distanceToPetCenter', 'distanceToPetBounds', 'durationMs']
const CLOCK_FIELDS = ['currentHour', 'dayOfWeek']
const AUDIO_FIELDS = ['audioLevel']

/** 各事件类型可使用的过滤字段（移植自 desktop-pet TRIGGER_PARAMETER_FIELDS） */
export const TRIGGER_PARAMETER_FIELDS: Record<PetEventType, string[]> = {
  click: DISCRETE_POINTER_FIELDS,
  doubleClick: DISCRETE_POINTER_FIELDS,
  rightClick: DISCRETE_POINTER_FIELDS,
  dragStart: DISCRETE_POINTER_FIELDS,
  dragging: DRAG_PROGRESS_FIELDS,
  dragEnd: DRAG_PROGRESS_FIELDS,
  mouseEnter: DISCRETE_POINTER_FIELDS,
  mouseLeave: DISCRETE_POINTER_FIELDS,
  mouseMove: DRAG_PROGRESS_FIELDS,
  proximity: DISCRETE_POINTER_FIELDS,
  hoverDuration: TIME_FIELDS,
  idleDuration: TIME_FIELDS,
  audioStart: AUDIO_FIELDS,
  audioLevel: AUDIO_FIELDS,
  audioStop: AUDIO_FIELDS,
  stateExit: [],
  stateEnter: [],
  manualReset: [],
  timer: CLOCK_FIELDS,
  randomTimer: CLOCK_FIELDS
}
