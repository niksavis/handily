import type { AskLook, DerivedState, StoreRow } from './store'

export type RowRank = AskLook | DerivedState

export const ATTENTION_ORDER: readonly RowRank[] = [
  'decide',
  'oldAsk',
  'approved',
  'withdrawn',
  'needsYou',
  'dead',
  'working',
  'quiet',
  'stale',
]

function rankOf(row: StoreRow): number {
  return ATTENTION_ORDER.indexOf(row.kind === 'ask' ? row.look : row.state)
}

function isOwn(row: StoreRow): boolean {
  return row.kind === 'session' && row.isOwn
}

export function byAttention(a: StoreRow, b: StoreRow): number {
  return (
    rankOf(a) - rankOf(b) ||
    Number(isOwn(b)) - Number(isOwn(a)) ||
    a.ageMs - b.ageMs ||
    a.key.localeCompare(b.key)
  )
}
