// SoundVault 宠物规则引擎 · 纯匹配逻辑
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/shared/rule-engine.js
import type { PetEventContext, PetRule, RuleCondition, RuleFilter } from './types'
import { normalizeCondition, normalizeRuleConditions } from './ruleUtils'

const DEFAULT_CONDITION_WINDOW_MS = 1000

function compareValues(
  actual: unknown,
  operator: RuleFilter['operator'],
  expected: RuleFilter['value']
): boolean {
  switch (operator) {
    case '=':
      return actual === expected
    case '!=':
      return actual !== expected
    case '>':
      return (actual as number) > (expected as number)
    case '>=':
      return (actual as number) >= (expected as number)
    case '<':
      return (actual as number) < (expected as number)
    case '<=':
      return (actual as number) <= (expected as number)
    case 'between':
      return (
        Array.isArray(expected) &&
        expected.length >= 2 &&
        (actual as number) >= (expected[0] as number) &&
        (actual as number) <= (expected[1] as number)
      )
    case 'in':
      return Array.isArray(expected) && (expected as Array<unknown>).includes(actual)
    case 'notIn':
      return Array.isArray(expected) && !(expected as Array<unknown>).includes(actual)
    default:
      return false
  }
}

function eventMatchesCondition(event: PetEventContext, rawCondition: RuleCondition): boolean {
  const condition = normalizeCondition(rawCondition)
  if (!condition || !event || typeof event !== 'object' || event.type !== condition.type) return false

  return (condition.filters || []).every((filter) => {
    if (!filter || typeof filter !== 'object') return false
    if (!Object.prototype.hasOwnProperty.call(event, filter.field)) return false
    return compareValues(
      (event as unknown as Record<string, unknown>)[filter.field],
      filter.operator,
      filter.value
    )
  })
}

function getValidEvents(eventHistory: PetEventContext[]): PetEventContext[] {
  return eventHistory
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event && typeof event === 'object' && !Array.isArray(event))
    .sort((left, right) => {
      const leftTimestamp =
        typeof left.event.timestamp === 'number' ? left.event.timestamp : Number.NEGATIVE_INFINITY
      const rightTimestamp =
        typeof right.event.timestamp === 'number' ? right.event.timestamp : Number.NEGATIVE_INFINITY
      if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp
      return left.index - right.index
    })
    .map(({ event }) => event)
}

function getCurrentEvent(validEvents: PetEventContext[]): PetEventContext | null {
  return validEvents.length > 0 ? validEvents[validEvents.length - 1] : null
}

function isContinuousMouseMoveRule(rule: PetRule): boolean {
  return (
    rule.continuous === true &&
    normalizeRuleConditions(rule).some((condition) => condition && condition.type === 'mouseMove')
  )
}

function getActiveGlobalCooldown(
  rules: PetRule[],
  now: number,
  lastTriggeredAtByRuleId: Record<string, number>
): { ruleId: string; cooldownMs: number; remainingMs: number } | null {
  const rulesById = new Map(
    rules
      .filter((rule) => rule && typeof rule === 'object' && rule.id)
      .map((rule) => [rule.id, rule])
  )
  let activeCooldown: { ruleId: string; cooldownMs: number; remainingMs: number } | null = null

  for (const [ruleId, lastTriggeredAt] of Object.entries(lastTriggeredAtByRuleId || {})) {
    if (typeof lastTriggeredAt !== 'number') continue
    const rule = rulesById.get(ruleId)
    if (!rule || rule.enabled === false || isContinuousMouseMoveRule(rule)) continue

    const cooldownMs = Number(rule.cooldownMs)
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) continue

    const remainingMs = cooldownMs - (now - lastTriggeredAt)
    if (remainingMs <= 0) continue

    if (!activeCooldown || remainingMs > activeCooldown.remainingMs) {
      activeCooldown = { ruleId, cooldownMs, remainingMs }
    }
  }

  return activeCooldown
}

function isCoolingDown(
  _rule: PetRule,
  activeGlobalCooldown: { ruleId: string; cooldownMs: number; remainingMs: number } | null
): boolean {
  if (!activeGlobalCooldown) return false
  if (isContinuousMouseMoveRule(_rule)) return false
  return true
}

function matchesRule(rule: PetRule, validEvents: PetEventContext[], now: number): boolean {
  const conditions = normalizeRuleConditions(rule)
  const currentEvent = getCurrentEvent(validEvents)

  if (conditions.length === 0 || !currentEvent) return false

  const windowMs = typeof rule.conditionWindowMs === 'number' ? rule.conditionWindowMs : DEFAULT_CONDITION_WINDOW_MS
  const windowAnchor = typeof currentEvent.timestamp === 'number' ? currentEvent.timestamp : now
  const cutoff = windowAnchor - windowMs
  const recentEvents = validEvents.filter((event) => {
    return typeof event.timestamp !== 'number' || event.timestamp >= cutoff
  })
  const requiredConditions = conditions.filter((condition) => condition.required !== false)
  const optionalConditions = conditions.filter((condition) => condition.required === false)
  const currentEventAnchorsRule = conditions.some((condition) => eventMatchesCondition(currentEvent, condition))

  if (!currentEventAnchorsRule) return false

  const requiredMatched = requiredConditions.every((condition) => {
    return recentEvents.some((event) => eventMatchesCondition(event, condition))
  })
  if (!requiredMatched) return false

  if (optionalConditions.length === 0) return true

  return optionalConditions.some((condition) => {
    return recentEvents.some((event) => eventMatchesCondition(event, condition))
  })
}

/**
 * 测试单条规则是否被当前事件满足（状态型规则独立评估用）。
 * 移植自 desktop-pet rule-engine.js eventMatchesRule。
 */
export function eventMatchesRule(
  rule: PetRule,
  event: PetEventContext,
  eventHistory: PetEventContext[],
  now: number
): boolean {
  if (!rule || !event || typeof event !== 'object') return false
  const validEvents = getValidEvents([...eventHistory, event])
  return matchesRule(rule, validEvents, now)
}

export interface EvaluateRulesOptions {
  rules?: PetRule[]
  eventHistory?: PetEventContext[]
  now?: number
  lastTriggeredAtByRuleId?: Record<string, number>
  cooldownRules?: PetRule[]
}

export function evaluateRules(options: EvaluateRulesOptions = {}): PetRule[] {
  const { rules = [], eventHistory = [], now = Date.now(), lastTriggeredAtByRuleId = {}, cooldownRules = rules } = options
  const validEvents = getValidEvents(eventHistory)
  const activeGlobalCooldown = getActiveGlobalCooldown(cooldownRules, now, lastTriggeredAtByRuleId)

  return rules
    .filter((rule) => {
      if (!rule || typeof rule !== 'object') return false
      if (rule.enabled === false) return false
      if (
        Array.isArray(rule.conditions) &&
        rule.conditions.some((condition) => {
          const normalized = normalizeCondition(condition)
          const sustainMs = Number(normalized && normalized.sustainMs)
          return normalized && normalized.type === 'mouseMove' && Number.isFinite(sustainMs) && sustainMs > 0
        })
      )
        return false
      if (isCoolingDown(rule, activeGlobalCooldown)) return false
      return matchesRule(rule, validEvents, now)
    })
    .sort((left, right) => (right.priority || 0) - (left.priority || 0))
}

export { getActiveGlobalCooldown, isContinuousMouseMoveRule, getValidEvents, getCurrentEvent }
