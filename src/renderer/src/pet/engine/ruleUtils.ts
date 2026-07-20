// SoundVault 宠物规则引擎 · 条件归一化工具
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/shared/rule-utils.js
import type { RuleCondition } from './types'

export function normalizeCondition(condition: RuleCondition | null | undefined): RuleCondition | null {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    return null
  }
  return {
    type: condition.type,
    filters: Array.isArray(condition.filters) ? condition.filters.filter(Boolean) : [],
    sustainMs: condition.sustainMs,
    required: condition.required !== false
  }
}

export function normalizeRuleConditions(rule: { conditions?: RuleCondition[] }): RuleCondition[] {
  if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
    return rule.conditions.map(normalizeCondition).filter(Boolean) as RuleCondition[]
  }
  return []
}
