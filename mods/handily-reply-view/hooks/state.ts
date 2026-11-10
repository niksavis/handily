import { drawFlowchart, type FlowDrawing, type LayoutMeter } from './flowchart'
import {
  DiagramFault,
  doesNotParse,
  lineFault,
  notDrawnYet,
  refuseOverLimits,
  textLines,
  type FlowDirection,
  type FlowEdge,
  type FlowNode,
  type Refusal,
  type Statement,
} from './mermaid'

export const PSEUDO_STATE = '[*]'

export type StateNode = { id: string; label: string[] }

export type Transition = { from: string; to: string; label: string[] }

export type StateDiagram = {
  kind: 'state'
  direction: FlowDirection
  states: StateNode[]
  transitions: Transition[]
}

const START_MARK = '●'
const END_MARK = '◉'
const END_PREFIX = '[*]<'
const TRAILING_COMMENT = /\s+%%.*$/
const STATE_ID = String.raw`[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*`
const STATE_END = String.raw`(?:${STATE_ID}|\[\*\])`
const STYLE_CLASS = String.raw`(?::::[\p{L}\p{N}_-]+(?:,[\p{L}\p{N}_-]+)*)?`
const TRANSITION = new RegExp(
  String.raw`^(${STATE_END})${STYLE_CLASS}\s*-->\s*(${STATE_END})${STYLE_CLASS}\s*(?::(.*))?$`,
  'u',
)
const DESCRIPTION = new RegExp(String.raw`^(${STATE_ID})\s*:(.*)$`, 'u')
const BARE_STATE = new RegExp(String.raw`^(${STATE_ID})${STYLE_CLASS}$`, 'u')
const STATE_KEYWORD = /^state\s+(.*)$/
const QUOTED_STATE = new RegExp(String.raw`^"([^"]*)"\s+as\s+(${STATE_ID})(.*)$`, 'u')
const NAMED_STATE = new RegExp(String.raw`^(${STATE_ID})(.*)$`, 'u')
const SPECIAL_STATE = /^\s*(?:<<(\w+)>>|\[\[(\w+)\]\])$/
const SPECIAL_KINDS: ReadonlySet<string> = new Set(['choice', 'fork', 'join'])
const COMPOSITE_OPENING = /^\s*\{$/
const STATE_STYLE = new RegExp(String.raw`^${STYLE_CLASS}$`, 'u')
const DIRECTION = /^direction\s+(\S+)$/
const DRAWN_DIRECTIONS: Readonly<Record<string, FlowDirection>> = { TB: 'TD', TD: 'TD', LR: 'LR' }
const REFUSED_DIRECTIONS: ReadonlySet<string> = new Set(['RL', 'BT'])
const IGNORED_STATEMENT =
  /^(?:(?:classDef|class|style)\s+\S|acc(?:Title|Descr)\s*:|hide\s+empty\s+description$)/
const NOTE = /^note(?:\s|$)/
const CONCURRENCY = '--'

export class StateBuilder {
  private direction: FlowDirection = 'TD'
  private readonly states = new Map<string, { id: string; descriptions: string[] }>()
  private readonly transitions: Transition[] = []

  add(statement: Statement): void {
    const line = statement.line
    const text = statement.text.replace(TRAILING_COMMENT, '')
    if (IGNORED_STATEMENT.test(text)) return
    if (NOTE.test(text)) throw notDrawnYet(line, 'note')
    if (text === CONCURRENCY) throw notDrawnYet(line, 'concurrency')
    const direction = DIRECTION.exec(text)?.[1]
    if (direction !== undefined) {
      this.direction = this.directionOf(direction, line)
      return
    }
    const keyword = STATE_KEYWORD.exec(text)?.[1]
    if (keyword !== undefined) {
      this.declare(keyword.trim(), line)
      return
    }
    const handled = this.transition(text, line) || this.describe(text) || this.bare(text)
    if (!handled) throw doesNotParse(line)
  }

  build(): StateDiagram {
    if (this.states.size === 0) {
      throw new DiagramFault({
        kind: 'refused',
        reason: 'the state diagram has no states',
        line: null,
        limit: null,
      })
    }
    refuseOverLimits([
      ['boxes', this.states.size],
      ['edges', this.transitions.length],
    ])
    return {
      kind: 'state',
      direction: this.direction,
      states: [...this.states.values()].map(({ id, descriptions }) => ({
        id,
        label: descriptions.length === 0 ? [id] : descriptions.flatMap(textLines),
      })),
      transitions: this.transitions,
    }
  }

  private directionOf(written: string, line: number): FlowDirection {
    const drawn = DRAWN_DIRECTIONS[written]
    if (drawn !== undefined) return drawn
    if (REFUSED_DIRECTIONS.has(written)) throw notDrawnYet(line, `direction ${written}`)
    throw doesNotParse(line)
  }

  private state(id: string): { id: string; descriptions: string[] } {
    const known = this.states.get(id)
    if (known !== undefined) return known
    const made = { id, descriptions: [] }
    this.states.set(id, made)
    return made
  }

  private declare(rest: string, line: number): void {
    const quoted = QUOTED_STATE.exec(rest)
    const named = quoted === null ? NAMED_STATE.exec(rest) : null
    const id = quoted?.[2] ?? named?.[1]
    if (id === undefined) throw doesNotParse(line)
    const after = (quoted?.[3] ?? named?.[2] ?? '').trim()
    if (COMPOSITE_OPENING.test(after)) {
      throw lineFault(line, `state ${id} holds nested states, which do not draw yet`)
    }
    const special = SPECIAL_STATE.exec(after)
    const kind = special?.[1] ?? special?.[2]
    if (kind !== undefined) {
      throw SPECIAL_KINDS.has(kind) ? notDrawnYet(line, kind) : doesNotParse(line)
    }
    const description = after.startsWith(':') ? after.slice(1).trim() : null
    if (description === null && !STATE_STYLE.test(after)) throw doesNotParse(line)
    const state = this.state(id)
    if (quoted?.[1] !== undefined) state.descriptions.push(quoted[1])
    if (description !== null && description !== '') state.descriptions.push(description)
  }

  private transition(text: string, line: number): boolean {
    const found = TRANSITION.exec(text)
    if (found === null) return false
    const from = found[1] ?? ''
    const to = found[2] ?? ''
    if (from === PSEUDO_STATE && to === PSEUDO_STATE) throw doesNotParse(line)
    if (from !== PSEUDO_STATE) this.state(from)
    if (to !== PSEUDO_STATE) this.state(to)
    const label = (found[3] ?? '').trim()
    this.transitions.push({ from, to, label: label === '' ? [] : textLines(label) })
    return true
  }

  private describe(text: string): boolean {
    const found = DESCRIPTION.exec(text)
    if (found === null) return false
    const description = (found[2] ?? '').trim()
    const state = this.state(found[1] ?? '')
    if (description !== '') state.descriptions.push(description)
    return true
  }

  private bare(text: string): boolean {
    const id = BARE_STATE.exec(text)?.[1]
    if (id === undefined) return false
    this.state(id)
    return true
  }
}

function endOf(from: string): string {
  return `${END_PREFIX}${from}`
}

function pointsOf(diagram: StateDiagram): FlowNode[] {
  const starts = diagram.transitions.some((transition) => transition.from === PSEUDO_STATE)
  const ends = diagram.transitions
    .filter((transition) => transition.to === PSEUDO_STATE)
    .map((transition) => endOf(transition.from))
  return [
    ...(starts ? [{ id: PSEUDO_STATE, shape: 'point' as const, label: [START_MARK] }] : []),
    ...[...new Set(ends)].map((id) => ({ id, shape: 'point' as const, label: [END_MARK] })),
  ]
}

function edgeOf(transition: Transition): FlowEdge {
  return {
    from: transition.from,
    to: transition.to === PSEUDO_STATE ? endOf(transition.from) : transition.to,
    stroke: 'solid',
    arrow: true,
    label: transition.label,
  }
}

export function drawState(
  diagram: StateDiagram,
  width: number,
  meter: LayoutMeter = { steps: 0 },
): FlowDrawing | Refusal {
  const states: FlowNode[] = diagram.states.map((state) => ({
    id: state.id,
    shape: 'rounded',
    label: state.label,
  }))
  return drawFlowchart(
    {
      kind: 'flowchart',
      direction: diagram.direction,
      nodes: [...states, ...pointsOf(diagram)],
      edges: diagram.transitions.map(edgeOf),
    },
    width,
    meter,
    'kept-then-wrapped-labels',
  )
}
