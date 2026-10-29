import type { AgentLook, AgentRow } from './agents'
import type { Signal, SignalLooks } from './signals'

export const LANES_FROM = 80
export const LANE_CELLS = 20

const IDLE_CELL = '·'
const RUN_CELL = '━'
const END_MARKS: Partial<Record<AgentLook, Signal>> = { needsYou: 'waitsForYou', failed: 'blocked' }

export type LaneAxis = { from: number; to: number }

export type Lane = { before: string; run: string; mark: string; after: string }

export function hasLanes(bodyColumns: number): boolean {
  return bodyColumns >= LANES_FROM
}

export function laneAxis(rows: readonly AgentRow[], now: number): LaneAxis | null {
  if (rows.length === 0) return null
  return { from: Math.min(...rows.map((row) => row.startedAt)), to: now }
}

function cellAt(axis: LaneAxis, at: number): number {
  const span = axis.to - axis.from
  if (span <= 0) return LANE_CELLS
  return ((Math.min(at, axis.to) - axis.from) * LANE_CELLS) / span
}

export function laneOf(row: AgentRow, axis: LaneAxis, signals: SignalLooks): Lane {
  const first = Math.min(Math.floor(cellAt(axis, row.startedAt)), LANE_CELLS - 1)
  const last = Math.max(first, Math.ceil(cellAt(axis, row.startedAt + row.ageMs)) - 1)
  const end = Math.min(last, LANE_CELLS - 1)
  const ending = END_MARKS[row.look]
  const mark = ending === undefined ? RUN_CELL : signals[ending].mark
  return {
    before: IDLE_CELL.repeat(first),
    run: RUN_CELL.repeat(end - first),
    mark,
    after: IDLE_CELL.repeat(LANE_CELLS - end - 1),
  }
}
