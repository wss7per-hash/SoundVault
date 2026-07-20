// SoundVault 宠物规则引擎 · 动作分发器
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/renderer/pet/user-trigger-manager.js
// 适配：playAnimation → playSpriteAnim；openPanel → openPetSettings；移除 pomodoro/disableInteractions。
import type { PetAction, PetEventContext, SpriteAnimId } from './types'

export interface SpriteActionExecutors {
  playSpriteAnim?: (anim: SpriteAnimId | undefined, options?: PetAction) => void
  showMessage?: (text: string | undefined, options?: PetAction) => void
  changeDisplay?: (action: PetAction) => void
  movePet?: (action: PetAction) => void
  setVisibility?: (visible: boolean, meta?: Record<string, unknown>) => void
  resetPosition?: () => void
  openPetSettings?: () => void
}

export class UserTriggerManager {
  private actionExecutors: SpriteActionExecutors
  private logger: { warn: (m: string, ...a: unknown[]) => void; error: (m: string, ...a: unknown[]) => void }

  constructor(
    actionExecutors: SpriteActionExecutors = {},
    logger: { warn: (m: string, ...a: unknown[]) => void; error: (m: string, ...a: unknown[]) => void } = console
  ) {
    this.actionExecutors = actionExecutors
    this.logger = logger
  }

  resolveActionProgress(action: PetAction, _eventContext: Partial<PetEventContext> = {}): number {
    const rawProgress =
      action.progressFrom && Object.prototype.hasOwnProperty.call(_eventContext, action.progressFrom)
        ? (_eventContext as unknown as Record<string, unknown>)[action.progressFrom]
        : action.progress
    const scale = Number.isFinite(Number(action.scale)) ? Number(action.scale) : 1
    const offset = Number.isFinite(Number(action.offset)) ? Number(action.offset) : 0
    const progress = Number(rawProgress ?? 0) * scale + offset
    if (!Number.isFinite(progress)) return 0
    return Math.min(1, Math.max(0, progress))
  }

  executeAction(action: PetAction, eventContext: Partial<PetEventContext> = {}): void {
    if (!action || typeof action !== 'object') return
    const actionType = action.type
    if (!actionType) {
      this.logger.warn('Action missing type', action)
      return
    }

    try {
      switch (actionType) {
        case 'blank':
          break
        case 'delay':
          break
        case 'playSpriteAnim':
          if (this.actionExecutors.playSpriteAnim) {
            this.actionExecutors.playSpriteAnim(action.animation, action)
          }
          break
        case 'showMessage':
          if (this.actionExecutors.showMessage) {
            this.actionExecutors.showMessage(action.text, action)
          }
          break
        case 'randomMessage':
          if (this.actionExecutors.showMessage && action.messages) {
            const messages = Array.isArray(action.messages) ? action.messages : []
            if (messages.length > 0) {
              const msg = messages[Math.floor(Math.random() * messages.length)]
              this.actionExecutors.showMessage(msg, action)
            }
          }
          break
        case 'changeScale':
        case 'changeOpacity':
        case 'changeDisplay':
          if (this.actionExecutors.changeDisplay) {
            this.actionExecutors.changeDisplay(action)
          }
          break
        case 'movePet':
          if (this.actionExecutors.movePet) {
            this.actionExecutors.movePet(action)
          }
          break
        case 'hidePet':
        case 'showPet':
          if (this.actionExecutors.setVisibility) {
            this.actionExecutors.setVisibility(actionType === 'showPet', {
              sourceActionType: actionType,
              eventType: eventContext && eventContext.type
            })
          }
          break
        case 'resetPosition':
          if (this.actionExecutors.resetPosition) {
            this.actionExecutors.resetPosition()
          }
          break
        case 'openPetSettings':
          if (this.actionExecutors.openPetSettings) {
            this.actionExecutors.openPetSettings()
          }
          break
        default:
          this.logger.warn(`Unknown action type: ${actionType}`)
      }
    } catch (error) {
      this.logger.error(`Error executing action ${actionType}:`, error as Error)
    }
  }
}
