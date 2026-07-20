// SoundVault 宠物规则引擎 · 运行时（事件历史、冷却、状态型规则）
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/renderer/pet/pet-runtime.js
// 适配：动作类型改用 playSpriteAnim / openPetSettings；移除 keyframe/pomodoro 相关分支。
import type { PetAction, PetEventContext, PetRule, RuleCondition } from './types'
import {
  evaluateRules,
  eventMatchesRule,
  getActiveGlobalCooldown,
  isContinuousMouseMoveRule
} from './ruleEngine'
import { normalizeCondition } from './ruleUtils'

export interface RuleRuntimeOptions {
  rules?: PetRule[]
  maxHistory?: number
  now?: () => number
  onTimerActions?: ((actions: PetAction[], eventContext: PetEventContext) => void) | null
}

export interface RuleRuntime {
  evaluateEvent(event: PetEventContext): PetAction[]
  getLastTriggeredAtByRuleId(): Record<string, number>
  getRuleState(): Record<string, unknown>
  getRecentEvents(): PetEventContext[]
  resetPendingMouseMoveEnters(event?: PetEventContext): void
  destroy(): void
}

export function createRuleRuntime(options: RuleRuntimeOptions = {}): RuleRuntime {
  const { rules = [], maxHistory = 40, now = Date.now, onTimerActions = null } = options
  const eventHistory: PetEventContext[] = []
  const lastTriggeredAtByRuleId: Record<string, number> = {}

  // 状态型规则每规则状态
  const ruleState: Record<string, {
    conditionTrueSince: number | null
    active: boolean
    exitTrueSince: number | null
    lastMatchingEvent: PetEventContext | null
    lastExitEvent: PetEventContext | null
  }> = {}
  let pendingExitActions: PetAction[] = []
  let exitTimer: ReturnType<typeof setInterval> | null = null
  const EXIT_CHECK_INTERVAL_MS = 500
  const MOUSE_MOVE_SUSTAIN_MAX_GAP_MS = 300

  function getMouseMoveCondition(rule: PetRule) {
    if (!rule || !Array.isArray(rule.conditions)) return null
    return rule.conditions.find((condition) => condition && condition.type === 'mouseMove') || null
  }

  function hasExitState(rule: PetRule): boolean {
    const state = rule && rule.state ? rule.state : null
    return Boolean(
      state &&
        ((Array.isArray(state.exitConditions) && state.exitConditions.length > 0) ||
          (Array.isArray(state.exitActions) && state.exitActions.length > 0))
    )
  }

  function isStatefulRule(rule: PetRule): boolean {
    const condition = getMouseMoveCondition(rule)
    if (!condition) return false
    const sustainMs = Number(condition && condition.sustainMs)
    return (Number.isFinite(sustainMs) && sustainMs > 0) || hasExitState(rule)
  }

  function buildExitRule(rule: PetRule): PetRule | null {
    const state = rule && rule.state ? rule.state : null
    if (!state || !Array.isArray(state.exitConditions) || state.exitConditions.length === 0) {
      return null
    }
    return { id: rule.id, name: rule.name, conditions: state.exitConditions }
  }

  function getConditionSustainMs(condition: { sustainMs?: number } | null): number {
    const sustainMs = Number(condition && condition.sustainMs)
    return Number.isFinite(sustainMs) && sustainMs > 0 ? sustainMs : 0
  }

  function getExitSustainMs(rule: PetRule, currentEvent: PetEventContext | null): number {
    const exitRule = buildExitRule(rule)
    if (!exitRule) return 0
    const conditions = (exitRule.conditions || []).filter((condition) => condition && typeof condition === 'object')
    const requiredConditions = conditions.filter((condition) => condition.required !== false)
    const optionalConditions = conditions.filter((condition) => condition.required === false)
    const sustainSource =
      requiredConditions.length > 0
        ? requiredConditions
        : optionalConditions.filter((condition) => !currentEvent || condition.type === currentEvent.type)
    return sustainSource.reduce((max, condition) => Math.max(max, getConditionSustainMs(condition)), 0)
  }

  function getState(ruleId: string) {
    if (!ruleState[ruleId]) {
      ruleState[ruleId] = {
        conditionTrueSince: null,
        active: false,
        exitTrueSince: null,
        lastMatchingEvent: null,
        lastExitEvent: null
      }
    }
    return ruleState[ruleId]
  }

  function defaultExitActions(): PetAction[] {
    return [{ type: 'showPet' }]
  }

  function resolveExitActions(rule: PetRule): PetAction[] {
    const exitActions =
      rule && rule.state && Array.isArray(rule.state.exitActions) && rule.state.exitActions.length > 0
        ? rule.state.exitActions
        : defaultExitActions()
    return exitActions.map((action) => ({ ...action }))
  }

  function ensureExitTimer() {
    const anyPending = Object.keys(ruleState).some((id) => {
      const state = ruleState[id]
      return state && state.active
    })
    if (anyPending && !exitTimer) {
      exitTimer = setInterval(tickStateChecks, EXIT_CHECK_INTERVAL_MS)
    } else if (!anyPending && exitTimer) {
      clearInterval(exitTimer)
      exitTimer = null
    }
  }

  function tickStateChecks() {
    const currentNow = now()
    for (const rule of rules) {
      if (!isStatefulRule(rule)) continue
      const state = getState(rule.id)
      if (!state.active) continue
      const exitSustainMs = getExitSustainMs(rule, state.lastExitEvent)
      if (!Number.isFinite(exitSustainMs) || exitSustainMs <= 0) continue
      if (state.exitTrueSince !== null && currentNow - state.exitTrueSince >= exitSustainMs) {
        flushExit(rule, currentNow)
      }
    }
    ensureExitTimer()
  }

  function dispatchTimerActions(actions: PetAction[], eventContext: PetEventContext): boolean {
    if (typeof onTimerActions === 'function') {
      onTimerActions(actions, eventContext)
      return true
    }
    return false
  }

  function enterRule(
    rule: PetRule,
    timestamp: number,
    eventContext: PetEventContext,
    dispatchImmediately = false
  ): PetAction[] {
    const state = getState(rule.id)
    if (state.active) return []
    state.active = true
    state.exitTrueSince = null
    lastTriggeredAtByRuleId[rule.id] = timestamp
    const actions = collectRuleActions(rule)
    if (dispatchImmediately) {
      dispatchTimerActions(actions, { ...eventContext, timestamp, stateTransition: 'enter', ruleId: rule.id })
      return []
    }
    return actions
  }

  function flushExit(rule: PetRule, timestamp: number) {
    const state = getState(rule.id)
    if (!state.active) return
    const eventContext: PetEventContext = state.lastExitEvent
      ? { ...state.lastExitEvent, timestamp, stateTransition: 'exit', ruleId: rule.id }
      : { type: 'stateExit' as const, ruleId: rule.id, timestamp, eventSource: 'ruleRuntime' as const }
    state.active = false
    state.conditionTrueSince = null
    state.exitTrueSince = null
    state.lastMatchingEvent = null
    state.lastExitEvent = null
    lastTriggeredAtByRuleId[rule.id] = timestamp
    const exitActions = resolveExitActions(rule)
    if (
      dispatchTimerActions(
        exitActions,
        eventContext || { type: 'stateExit' as const, ruleId: rule.id, timestamp: now(), eventSource: 'ruleRuntime' as const }
      )
    ) {
      return
    }
    pendingExitActions.push(...exitActions)
  }

  function collectRuleActions(rule: PetRule): PetAction[] {
    const actions = Array.isArray(rule.actions) ? rule.actions : []
    if (rule.actionStrategy === 'random' && actions.length > 0) {
      return [actions[Math.floor(Math.random() * actions.length)]]
    }
    return actions.map((action) => ({ ...action }))
  }

  function shouldEvaluateRuleForEvent(rule: PetRule, event: PetEventContext): boolean {
    if (event && event.timerRuleId && ['timer', 'randomTimer'].includes(event.type) && rule && rule.id !== event.timerRuleId) {
      return false
    }
    return true
  }

  function getRuleConditions(rule: PetRule): RuleCondition[] {
    if (Array.isArray(rule && rule.conditions)) return rule.conditions as RuleCondition[]
    return []
  }

  function eventMatchesAnyConditionType(rule: PetRule, event: PetEventContext): boolean {
    if (!event || !event.type) return false
    return getRuleConditions(rule).some((condition) => condition && condition.type === event.type)
  }

  function isDragEvent(event: PetEventContext): boolean {
    return event && ['dragStart', 'dragging', 'dragEnd'].includes(event.type)
  }

  function resetPendingMouseMoveEnters(event: PetEventContext) {
    for (const rule of rules) {
      if (!isStatefulRule(rule)) continue
      const state = getState(rule.id)
      if (state.active || state.conditionTrueSince === null) continue
      state.conditionTrueSince = null
      state.lastMatchingEvent = null
    }
  }

  function advanceStatefulRules(currentEvent: PetEventContext, timestamp: number): PetAction[] {
    if (isDragEvent(currentEvent)) {
      resetPendingMouseMoveEnters(currentEvent)
    }

    const justEntered: PetAction[] = []
    const activeGlobalCooldown = getActiveGlobalCooldown(rules, timestamp, lastTriggeredAtByRuleId)
    for (const rule of rules) {
      if (!isStatefulRule(rule)) continue
      if (!shouldEvaluateRuleForEvent(rule, currentEvent)) continue
      const state = getState(rule.id)
      if (!state.active && activeGlobalCooldown && !isContinuousMouseMoveRule(rule)) continue
      const enterEventRelevant = eventMatchesAnyConditionType(rule, currentEvent)
      const matches = enterEventRelevant ? eventMatchesRule(rule, currentEvent, eventHistory, timestamp) : false
      const wasActive = state.active
      let emittedThisTick = false

      if (matches) {
        const previousMatchingTimestamp =
          state.lastMatchingEvent && typeof state.lastMatchingEvent.timestamp === 'number'
            ? state.lastMatchingEvent.timestamp
            : null
        const matchingGapMs = previousMatchingTimestamp === null ? 0 : timestamp - previousMatchingTimestamp
        if (state.conditionTrueSince !== null && Number.isFinite(matchingGapMs) && matchingGapMs > MOUSE_MOVE_SUSTAIN_MAX_GAP_MS) {
          state.conditionTrueSince = timestamp
        } else if (state.conditionTrueSince === null) {
          state.conditionTrueSince = timestamp
        }
        state.lastMatchingEvent = currentEvent
        const sustainedCondition = getMouseMoveCondition(rule)
        const sustainMs = Number(sustainedCondition && sustainedCondition.sustainMs)
        const threshold = Number.isFinite(sustainMs) && sustainMs > 0 ? sustainMs : 0
        if (!state.active && timestamp - state.conditionTrueSince >= threshold) {
          justEntered.push(...enterRule(rule, timestamp, currentEvent))
          emittedThisTick = true
        }
      } else if (enterEventRelevant) {
        state.conditionTrueSince = null
        state.lastMatchingEvent = null
      }

      if (state.active) {
        const exitRule = buildExitRule(rule)
        const exitEventRelevant = exitRule ? eventMatchesAnyConditionType(exitRule, currentEvent) : false
        const exitMatches = exitEventRelevant
          ? eventMatchesRule(exitRule as PetRule, currentEvent, eventHistory, timestamp)
          : false
        if (exitEventRelevant && exitMatches) {
          if (state.exitTrueSince === null) {
            state.exitTrueSince = timestamp
          }
          state.lastExitEvent = currentEvent
        } else if (exitEventRelevant) {
          state.exitTrueSince = null
          state.lastExitEvent = null
        }

        const exitSustainMs = getExitSustainMs(rule, currentEvent)
        if (exitRule && exitMatches && (!Number.isFinite(exitSustainMs) || exitSustainMs <= 0)) {
          flushExit(rule, timestamp)
        } else if (
          Number.isFinite(exitSustainMs) &&
          exitSustainMs > 0 &&
          state.exitTrueSince !== null &&
          timestamp - state.exitTrueSince >= exitSustainMs
        ) {
          flushExit(rule, timestamp)
        }
      }

      if (state.active && wasActive && rule.continuous === true && enterEventRelevant && !emittedThisTick) {
        justEntered.push(...collectRuleActions(rule))
      }
    }
    return justEntered
  }

  return {
    evaluateEvent(event: PetEventContext): PetAction[] {
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : now()
      const nextEvent = { ...event, timestamp }
      eventHistory.push(nextEvent)
      if (eventHistory.length > maxHistory) {
        eventHistory.splice(0, eventHistory.length - maxHistory)
      }

      const enterActions = advanceStatefulRules(nextEvent, timestamp)
      const hasActiveStateful = Object.keys(ruleState).some((id) => ruleState[id] && ruleState[id].active)

      let actions: PetAction[] = []
      if (enterActions.length > 0) {
        actions = enterActions
      } else if (pendingExitActions.length > 0) {
        actions = pendingExitActions
        pendingExitActions = []
      } else if (!hasActiveStateful) {
        const candidateRules = rules.filter((rule) => !isStatefulRule(rule) && shouldEvaluateRuleForEvent(rule, nextEvent))
        const cooldownRules = rules.filter((rule) => !isStatefulRule(rule))
        const activeGlobalCooldown = getActiveGlobalCooldown(cooldownRules, timestamp, lastTriggeredAtByRuleId)
        if (activeGlobalCooldown) {
          // global cooldown active — skip one-shot matches
        }
        const matchedRules = evaluateRules({
          rules: candidateRules,
          eventHistory,
          now: timestamp,
          lastTriggeredAtByRuleId,
          cooldownRules
        })
        const executedRuleIds: string[] = []
        let stoppedByRuleId: string | null = null
        for (const rule of matchedRules) {
          const ruleActions = collectRuleActions(rule)
          if (ruleActions.length === 0) continue
          lastTriggeredAtByRuleId[rule.id] = timestamp
          executedRuleIds.push(rule.id)
          actions.push(...ruleActions)
          if (rule.stopOnMatch !== false) {
            stoppedByRuleId = rule.id
            break
          }
        }
        void executedRuleIds
        void stoppedByRuleId
      }

      ensureExitTimer()
      return actions
    },

    getLastTriggeredAtByRuleId() {
      return { ...lastTriggeredAtByRuleId }
    },

    getRuleState() {
      const snapshot: Record<string, unknown> = {}
      for (const id of Object.keys(ruleState)) {
        snapshot[id] = { ...ruleState[id] }
      }
      return snapshot
    },

    getRecentEvents() {
      return eventHistory.slice()
    },

    resetPendingMouseMoveEnters(event?: PetEventContext) {
      resetPendingMouseMoveEnters(event || ({ type: 'manualReset', eventSource: 'ruleRuntime' } as PetEventContext))
      ensureExitTimer()
    },

    destroy() {
      if (exitTimer) {
        clearInterval(exitTimer)
        exitTimer = null
      }
    }
  }
}

// 工具：把进度通过关键帧映射（保留 desktop-pet 的 keyframe 插值，便于高级动画）
export function clampNumber(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

export function clampProgress(value: number): number {
  const progress = clampNumber(value, 0, 1)
  return progress === null ? 0 : progress
}

export function mapProgressThroughKeyframes(progress: number, keyframes: Array<{ input: number; output: number }>): number {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return clampProgress(progress)
  const normalized = keyframes
    .map((kf, index) => ({
      input: clampProgress(Number(kf.input ?? index / Math.max(1, keyframes.length))),
      output: clampProgress(Number(kf.output ?? kf.input ?? index / Math.max(1, keyframes.length)))
    }))
    .filter((kf) => Number.isFinite(kf.input) && Number.isFinite(kf.output))
    .sort((left, right) => left.input - right.input)
  const value = clampProgress(progress)
  if (normalized.length <= 1) return value
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const left = normalized[index]
    const right = normalized[index + 1]
    if (value >= left.input && value <= right.input) {
      const span = right.input - left.input
      const t = span > 0 ? (value - left.input) / span : 0
      return clampProgress(left.output + (right.output - left.output) * t)
    }
  }
  return value
}

// 避免未使用告警（normalizeCondition 在运行时内部被引用）
void normalizeCondition
