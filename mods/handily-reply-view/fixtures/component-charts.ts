import type { Flowchart } from '../hooks/mermaid'
import { displayWidth, graphemesOf } from '../hooks/width'
import { linesOf } from './generated-diagrams'

export const NATURAL_COLUMNS = 400
export const FRAME_BORDERS = 4
export const WIDTH_FACTOR = 1.75

type DrawnFrame = { top: number; left: number; bottom: number; right: number }

type DrawnBox = { name: string; top: number; left: number; right: number }

export function componentCharts(seed: number, count: number): string[] {
  let state = seed
  const next = (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * below)
  }
  return Array.from({ length: count }, () => {
    const direction = next(2) === 0 ? 'TD' : 'LR'
    const groups = 2 + next(6)
    const declared: string[] = []
    const edges: string[] = []
    let box = 0
    for (let group = 0; group < groups; group++) {
      const size = 1 + next(4)
      const first = box + 1
      declared.push(`  subgraph G${String(group)}`)
      for (let member = 0; member < size; member++) {
        box += 1
        declared.push(`    N${String(box)}`)
        if (member > 0) edges.push(`  N${String(first + next(member))} --> N${String(box)}`)
      }
      declared.push('  end')
    }
    for (let edge = 0; edge < groups; edge++) {
      const from = 1 + next(box)
      const to = 1 + next(box)
      if (from < to) edges.push(`  N${String(from)} --> N${String(to)}`)
    }
    return linesOf(`flowchart ${direction}`, ...declared, ...edges)
  })
}

export function withoutGroups(chart: Flowchart): Flowchart {
  return { kind: 'flowchart', direction: chart.direction, nodes: chart.nodes, edges: chart.edges }
}

export function widthOf(drawing: readonly string[]): number {
  return Math.max(...drawing.map(displayWidth))
}

export function drawnFrames(drawing: readonly string[]): DrawnFrame[] {
  const grid = drawing.map((line) => [...graphemesOf(line)])
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  return grid.flatMap((cells, top) =>
    cells.flatMap((cell, left) => {
      if (cell !== '┌' || !'┄ '.includes(at(top, left + 1))) return []
      let bottom = top + 1
      while (bottom < grid.length && at(bottom, left) !== '└') bottom += 1
      let right = left + 1
      while (right < (grid[bottom]?.length ?? 0) && at(bottom, right) !== '┘') right += 1
      return at(bottom, right) === '┘' ? [{ top, left, bottom, right }] : []
    }),
  )
}

export function drawnBoxes(drawing: readonly string[]): DrawnBox[] {
  return drawing.flatMap((line, top) => {
    const cells = [...graphemesOf(line)]
    return cells.flatMap((cell, left) => {
      if (cell !== '╭') return []
      let right = left + 1
      while ('─┬┴'.includes(cells[right] ?? ' ')) right += 1
      const name = [...graphemesOf(drawing[top + 1] ?? '')]
        .slice(left + 1, right)
        .join('')
        .trim()
      return [{ name, top, left, right }]
    })
  })
}

export function frameTitle(drawing: readonly string[], frame: DrawnFrame): string {
  return [...graphemesOf(drawing[frame.top] ?? '')]
    .slice(frame.left, frame.right + 1)
    .join('')
    .replace(/[┌┐┄│╎]/g, '')
    .trim()
}
