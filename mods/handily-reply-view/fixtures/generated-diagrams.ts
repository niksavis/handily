import { parseMermaid, type Flowchart, type SequenceDiagram } from '../hooks/mermaid'
import { displayWidth, graphemesOf } from '../hooks/width'

export const REPLY_COLUMNS = 78

export function flowchartOf(source: string): Flowchart {
  const result = parseMermaid(source)
  if (result.kind !== 'flowchart') throw new Error(`not a flowchart: ${JSON.stringify(result)}`)
  return result
}

export function sequenceOf(source: string): SequenceDiagram {
  const result = parseMermaid(source)
  if (result.kind !== 'sequence') throw new Error(`not a sequence: ${JSON.stringify(result)}`)
  return result
}

export function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)
}

export function linesOf(...lines: string[]): string {
  return lines.join('\n')
}

const LINE_UP = 1
const LINE_DOWN = 2
const LINE_LEFT = 4
const LINE_RIGHT = 8

const LINE_ENDS: Readonly<Record<string, number>> = {
  '─': LINE_LEFT | LINE_RIGHT,
  '╌': LINE_LEFT | LINE_RIGHT,
  '│': LINE_UP | LINE_DOWN,
  '╎': LINE_UP | LINE_DOWN,
  '┌': LINE_DOWN | LINE_RIGHT,
  '┐': LINE_DOWN | LINE_LEFT,
  '└': LINE_UP | LINE_RIGHT,
  '┘': LINE_UP | LINE_LEFT,
  '├': LINE_UP | LINE_DOWN | LINE_RIGHT,
  '┤': LINE_UP | LINE_DOWN | LINE_LEFT,
  '┬': LINE_LEFT | LINE_RIGHT | LINE_DOWN,
  '┴': LINE_LEFT | LINE_RIGHT | LINE_UP,
  '┼': LINE_UP | LINE_DOWN | LINE_LEFT | LINE_RIGHT,
}

const LINE_STEPS = [
  [LINE_UP, -1, 0, LINE_DOWN],
  [LINE_DOWN, 1, 0, LINE_UP],
  [LINE_LEFT, 0, -1, LINE_RIGHT],
  [LINE_RIGHT, 0, 1, LINE_LEFT],
] as const

type DrawnBox = { name: string; top: number; left: number; bottom: number; right: number }

const cellColumns = new Map<string, number>()

function columnsOf(grapheme: string): number {
  const known = cellColumns.get(grapheme)
  if (known !== undefined) return known
  const columns = displayWidth(grapheme)
  cellColumns.set(grapheme, columns)
  return columns
}

function cellGrid(lines: readonly string[]): string[][] {
  return lines.map((line) =>
    graphemesOf(line).flatMap((grapheme) =>
      columnsOf(grapheme) > 1 ? [grapheme, ''] : [grapheme],
    ),
  )
}

function drawnBoxes(grid: readonly string[][]): DrawnBox[] {
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  const boxes: DrawnBox[] = []
  grid.forEach((cells, top) => {
    cells.forEach((cell, left) => {
      if (cell !== '┌' && cell !== '╭') return
      let right = left + 1
      while ('─┬┴'.includes(at(top, right))) right += 1
      if (!'┐╮'.includes(at(top, right)) || right === left + 1) return
      let bottom = top + 1
      while (at(bottom, left) === '│' && at(bottom, right) === '│') bottom += 1
      const closed = '└╰'.includes(at(bottom, left)) && '┘╯'.includes(at(bottom, right))
      if (bottom === top + 1 || !closed) return
      for (let col = left + 1; col < right; col++) if (!'─┬┴'.includes(at(bottom, col))) return
      const row = (grid[top + 1] ?? []).slice(left + 1, right)
      const name = row.join('').trim().replace(/^◇ /, '')
      if (name !== '') boxes.push({ name, top, left, bottom, right })
    })
  })
  return boxes
}

export function drawnLinks(lines: readonly string[]): string[] {
  const grid = cellGrid(lines)
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  const boxes = drawnBoxes(grid)
  const inBox = (row: number, col: number) =>
    boxes.some(
      ({ top, left, bottom, right }) => row >= top && row <= bottom && col >= left && col <= right,
    )
  const ends = (row: number, col: number) => (inBox(row, col) ? 0 : (LINE_ENDS[at(row, col)] ?? 0))
  const upright = (row: number, col: number) => ends(row, col) === (LINE_UP | LINE_DOWN)
  const reaches = (row: number, col: number, step: number, bit: number) => {
    let next = col + step
    while (upright(row, next)) next += step
    return (ends(row, next) & bit) !== 0
  }
  const crossing = (row: number, col: number) =>
    upright(row, col) && reaches(row, col, -1, LINE_RIGHT) && reaches(row, col, 1, LINE_LEFT)
  const keyOf = (row: number, col: number, across: number) =>
    `${String(row)},${String(col)}${across !== 0 && crossing(row, col) ? ',across' : ''}`
  const parent = new Map<string, string>()
  const root = (key: string): string => {
    const up = parent.get(key)
    if (up === undefined || up === key) return key
    const top = root(up)
    parent.set(key, top)
    return top
  }
  grid.forEach((cells, row) => {
    cells.forEach((_, col) => {
      const bits = crossing(row, col) ? ends(row, col) | LINE_LEFT | LINE_RIGHT : ends(row, col)
      for (const [bit, down, across, back] of LINE_STEPS) {
        const next = row + down
        const beside = col + across
        const meets = across !== 0 && crossing(next, beside) ? back : ends(next, beside)
        if ((bits & bit) === 0 || (meets & back) === 0) continue
        parent.set(root(keyOf(row, col, across)), root(keyOf(next, beside, across)))
      }
    })
  })
  const sources = new Map<string, Set<string>>()
  const targets = new Map<string, Set<string>>()
  const pairs = new Set<string>()
  const attach = (
    side: Map<string, Set<string>>,
    row: number,
    col: number,
    bit: number,
    name: string,
  ) => {
    if ((ends(row, col) & bit) === 0) return
    const key = root(keyOf(row, col, 0))
    side.set(key, new Set([...(side.get(key) ?? []), name]))
  }
  for (const box of boxes) {
    for (let col = box.left + 1; col < box.right; col++) {
      if (at(box.bottom, col) === '┬') attach(sources, box.bottom + 1, col, LINE_UP, box.name)
      if (at(box.top, col) === '┴') attach(targets, box.top - 1, col, LINE_DOWN, box.name)
      if (at(box.bottom + 1, col) === '▲') attach(targets, box.bottom + 2, col, LINE_UP, box.name)
      if (at(box.top - 1, col) !== '▼') continue
      const above = boxes.find(
        (other) => other.bottom === box.top - 2 && col > other.left && col < other.right,
      )
      if (above !== undefined && at(box.top - 2, col) === '┬')
        pairs.add(`${above.name}>${box.name}`)
      else attach(targets, box.top - 2, col, LINE_DOWN, box.name)
    }
    for (let row = box.top + 1; row < box.bottom; row++) {
      if (at(row, box.left - 1) === '▶') attach(targets, row, box.left - 2, LINE_RIGHT, box.name)
      else attach(targets, row, box.left - 1, LINE_RIGHT, box.name)
      if (at(row, box.right + 1) === '◀') attach(targets, row, box.right + 2, LINE_LEFT, box.name)
      else attach(sources, row, box.right + 1, LINE_LEFT, box.name)
    }
  }
  for (const [key, from] of sources) {
    for (const source of from) {
      for (const target of targets.get(key) ?? []) pairs.add(`${source}>${target}`)
    }
  }
  return [...pairs].sort()
}

export function chartLinks(chart: Flowchart): string[] {
  return [...new Set(chart.edges.map((edge) => `${edge.from}>${edge.to}`))].sort()
}

export function generatedCharts(seed: number, count: number): string[] {
  let state = seed
  const next = (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * below)
  }
  return Array.from({ length: count }, () => {
    const direction = next(2) === 0 ? 'TD' : 'LR'
    const boxes = 2 + next(7)
    const lines = [`flowchart ${direction}`, `  ${numbered('N', boxes).join(' & ')}`]
    const edges = 1 + next(11)
    for (let index = 0; index < edges; index++) {
      const from = 1 + next(boxes)
      const to = 1 + next(boxes)
      const arrow = next(5) === 0 ? '-.->' : '-->'
      const label = next(10) < 3 ? `|e${String(index)}|` : ''
      if (from !== to) lines.push(`  N${String(from)} ${arrow}${label} N${String(to)}`)
    }
    return linesOf(...lines)
  })
}

export function groupedCharts(seed: number, count: number): string[] {
  let state = seed
  const next = (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * below)
  }
  return generatedCharts(seed, count).map((source) => {
    const [header = '', declared = '', ...edges] = source.split('\n')
    const names = declared.trim().split(' & ')
    const groups = 1 + next(2)
    const owner = names.map((_, at) => (at < groups ? at : next(groups + 1) - 1))
    const blocks = Array.from({ length: groups }, (_, group) => [
      `  subgraph G${String(group)} [Group ${String(group)}]`,
      ...names.filter((_, at) => owner[at] === group).map((name) => `    ${name}`),
      '  end',
    ])
    return linesOf(header, declared, ...blocks.flat(), ...edges)
  })
}

const ARROW_HEADS = '▶◀×▷◁'
const ARROW_SHAFTS = '─╌'

export function drawnMessages(lines: readonly string[]): string[] {
  const grid = cellGrid(lines)
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  const header = grid.findIndex((cells) => cells.includes('┬'))
  const lifelines = (grid[header] ?? []).flatMap((cell, col) => (cell === '┬' ? [col] : []))
  const isShaft = (row: number, col: number) => ARROW_SHAFTS.includes(at(row, col))
  const senderOf = (row: number, from: number, step: number) => {
    let col = from
    for (;;) {
      if (isShaft(row, col)) col += step
      else if (lifelines.includes(col) && at(row, col) === '│' && isShaft(row, col + step))
        col += step
      else break
    }
    return lifelines.includes(col) && at(row, col) === '│' ? lifelines.indexOf(col) : -1
  }
  const found: string[] = []
  grid.forEach((_, row) => {
    if (row <= header) return
    lifelines.forEach((lifeline, index) => {
      const isLoop = at(row, lifeline) === '│' && at(row, lifeline + 3) === '┐'
      if (isLoop && isShaft(row, lifeline + 1)) {
        found.push(`${String(index)}>${String(index)}`)
      }
      if (ARROW_HEADS.includes(at(row, lifeline - 1)) && isShaft(row, lifeline - 2)) {
        const from = senderOf(row, lifeline - 2, -1)
        if (from >= 0) found.push(`${String(from)}>${String(index)}`)
      }
      if (ARROW_HEADS.includes(at(row, lifeline + 1)) && isShaft(row, lifeline + 2)) {
        const from = senderOf(row, lifeline + 2, 1)
        if (from >= 0) found.push(`${String(from)}>${String(index)}`)
      }
    })
  })
  return found
}

export function heldMessages(diagram: SequenceDiagram): string[] {
  const index = diagram.participants.map((participant) => participant.id)
  return diagram.events.flatMap((event) =>
    event.kind === 'message'
      ? [`${String(index.indexOf(event.from))}>${String(index.indexOf(event.to))}`]
      : [],
  )
}

export function generatedSequences(seed: number, count: number): string[] {
  let state = seed
  const next = (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * below)
  }
  const arrows = ['->>', '-->>', '-x', '--x', '-)', '--)']
  return Array.from({ length: count }, () => {
    const people = numbered('P', 2 + next(5))
    const lines = ['sequenceDiagram', ...people.map((person) => `  participant ${person}`)]
    const events = 1 + next(12)
    for (let index = 0; index < events; index++) {
      const from = people[next(people.length)] ?? 'P1'
      const to = people[next(people.length)] ?? 'P1'
      const label = next(3) === 0 ? '' : ` m${String(index)}`
      if (next(5) === 0) lines.push(`  Note over ${from}: n${String(index)}`)
      else lines.push(`  ${from}${arrows[next(arrows.length)] ?? '->>'}${to}:${label}`)
    }
    return linesOf(...lines)
  })
}
