export const SIDE_BY_SIDE = ['on', 'off'] as const

export type SideBySide = (typeof SIDE_BY_SIDE)[number]

export const DEFAULT_SIDE_BY_SIDE: SideBySide = 'on'

export const COLUMNS_BETWEEN = 3

export function isSideBySide(value: unknown): value is SideBySide {
  return SIDE_BY_SIDE.some((option) => option === value)
}

export function sharedRows<T>(
  blocks: readonly T[],
  columnsOf: (block: T) => number | null,
  room: number,
): T[][] {
  const rows: T[][] = []
  let open: { row: T[]; used: number } | null = null
  for (const block of blocks) {
    const columns = columnsOf(block)
    if (columns === null) {
      rows.push([block])
      open = null
      continue
    }
    if (open !== null && open.used + COLUMNS_BETWEEN + columns <= room) {
      open.row.push(block)
      open.used += COLUMNS_BETWEEN + columns
      continue
    }
    open = { row: [block], used: columns }
    rows.push(open.row)
  }
  return rows
}
