import { expect } from 'claude-code/testing'

export function isEngineRow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const row = value as { type?: unknown; ref?: unknown }
  return (
    row.type === 'engine' &&
    typeof row.ref === 'number' &&
    Number.isInteger(row.ref) &&
    row.ref >= 0
  )
}

export function expectEngineRow(value: unknown, message?: string): void {
  expect(value, message).toMatchObject({ type: 'engine', ref: expect.any(Number) })
  expect(isEngineRow(value), message ?? 'an engine row with a ref of 0 or more').toBe(true)
}

export function expectNoEngineRow(value: unknown, message?: string): void {
  expect(isEngineRow(value), message ?? 'a row that is not the engine row').toBe(false)
}
