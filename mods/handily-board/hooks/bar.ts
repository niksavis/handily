export const BAR_FILLED = '▰'
export const BAR_EMPTY = '▱'

const BAR_CELLS_AT_MOST = 8

export type BarCells = { done: number; doing: number; toDo: number }

export function barCells(done: number, doing: number, total: number): BarCells {
  const cells = Math.min(total, BAR_CELLS_AT_MOST)
  const doneCells = Math.floor((done * cells) / total)
  const doingShare = Math.max(Math.floor((doing * cells) / total), 1)
  const doingCells = doing === 0 ? 0 : Math.min(doingShare, cells - doneCells)
  return { done: doneCells, doing: doingCells, toDo: cells - doneCells - doingCells }
}

export function progressBar(done: number, total: number): string {
  const cells = barCells(done, 0, total)
  return BAR_FILLED.repeat(cells.done) + BAR_EMPTY.repeat(cells.toDo)
}
