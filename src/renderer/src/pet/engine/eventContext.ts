// SoundVault 宠物规则引擎 · 事件上下文几何计算
// 移植自 duzexu/desktop-pet (GPL-3.0) 的 src/shared/event-context.js
// （用于鼠标靠近类条件的 distanceToPetCenter / angleToPet 计算）

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function distanceBetween(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

export function getPetCenter(petPosition: Rect): Point {
  return {
    x: petPosition.x + petPosition.width / 2,
    y: petPosition.y + petPosition.height / 2
  }
}

export function isPointInsideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

export function distanceToBounds(point: Point, rect: Rect): number {
  if (isPointInsideRect(point, rect)) return 0
  const nearestX = Math.max(rect.x, Math.min(point.x, rect.x + rect.width))
  const nearestY = Math.max(rect.y, Math.min(point.y, rect.y + rect.height))
  return distanceBetween(point, { x: nearestX, y: nearestY })
}

export function getDirection(deltaX: number, deltaY: number): string {
  if (deltaX === 0 && deltaY === 0) return 'none'
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX > 0 ? 'right' : 'left'
  }
  return deltaY > 0 ? 'down' : 'up'
}

export function getAngleContext(point: Point, center: Point): {
  angleToPet: number
  angleToPetDegrees: number
  angleToPetProgress: number
} {
  const angle = Math.atan2(point.y - center.y, point.x - center.x)
  const normalizedAngle = angle < 0 ? angle + Math.PI * 2 : angle
  const progressFromTop = (normalizedAngle / (Math.PI * 2) + 0.25) % 1
  return {
    angleToPet: round(angle, 4),
    angleToPetDegrees: round(progressFromTop * 360),
    angleToPetProgress: round(progressFromTop, 4)
  }
}
