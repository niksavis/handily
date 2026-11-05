import { drawFlowchart } from './flowchart'
import type { InkedDrawing } from './ink'
import {
  AccessibilityLines,
  DiagramFault,
  doesNotParse,
  lineFault,
  refuseOverLimits,
  textLines,
  type FlowDirection,
  type FlowEdge,
  type FlowGroup,
  type FlowNode,
  type Refusal,
  type Statement,
} from './mermaid'
import { titledDrawing } from './outline'

export type ArchitectureSide = 'L' | 'R' | 'T' | 'B'

export type ArchitectureGroup = { id: string; title: string | null; parent: string | null }

export type ArchitectureNode = {
  id: string
  isJunction: boolean
  title: string | null
  parent: string | null
}

export type ArchitectureEdge = {
  from: string
  to: string
  fromSide: ArchitectureSide
  toSide: ArchitectureSide
  intoFrom: boolean
  intoTo: boolean
  title: string | null
}

export type ArchitectureDiagram = {
  kind: 'architecture'
  title: string | null
  groups: ArchitectureGroup[]
  nodes: ArchitectureNode[]
  edges: ArchitectureEdge[]
}

type Written<T> = T & { line: number }

type Member = { id: string; title: string | null; parent: string | null; line: number }

const HEADER = /^architecture/
const DRAWN_HEADER = 'architecture-beta'
const ID = String.raw`\w(?:[-\w]*\w)?`
const QUOTED_TEXT = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`
const TITLE_TEXT = String.raw`\[(?:${QUOTED_TEXT}|[^[\]]+)\]`
const ICON = String.raw`\([\w\-:]+\)`
const PLACE = String.raw`(?:\s+in\s+(${ID}))?`
const GROUP = new RegExp(String.raw`^group\s+(${ID})\s*(?:${ICON})?\s*(${TITLE_TEXT})?${PLACE}$`)
const SERVICE = new RegExp(
  String.raw`^service\s+(${ID})\s*(?:${ICON}|${QUOTED_TEXT})?\s*(${TITLE_TEXT})?${PLACE}$`,
)
const JUNCTION = new RegExp(String.raw`^junction\s+(${ID})${PLACE}$`)
const EDGE = new RegExp(
  String.raw`^(${ID})(\{group\})?\s*:\s*([LRTB])\s*(<)?\s*(?:--|-\s*(${TITLE_TEXT})\s*-)\s*(>)?\s*([LRTB])\s*:\s*(${ID})(\{group\})?$`,
)
const ALIGN = new RegExp(String.raw`^align\s+(?:row|column)\s+(${ID}(?:\s+${ID})+)$`)
const TITLE = /^title(?:[\t ](.*))?$/
const WHITESPACE = /\s+/
const QUOTES = /^(["'])(.*)\1$/
const ESCAPED_QUOTE = /\\(["'])/g
const ACROSS_SIDES: ReadonlySet<string> = new Set(['L', 'R'])
const LEADING_SIDES: ReadonlySet<string> = new Set(['L', 'T'])
const JUNCTION_MARK = '●'
const BOTH_WAYS = '⇄'
const INSIDE = ' in '

function titleOf(written: string | undefined): string | null {
  if (written === undefined) return null
  const inner = written.slice(1, -1).trim()
  const quoted = QUOTES.exec(inner)
  return quoted === null ? inner : (quoted[2] ?? '').replace(ESCAPED_QUOTE, '$1').trim()
}

export class ArchitectureBuilder {
  private title: string | null = null
  private readonly groups: Written<ArchitectureGroup>[] = []
  private readonly services: Written<ArchitectureNode>[] = []
  private readonly junctions: Written<ArchitectureNode>[] = []
  private readonly edges: (Written<ArchitectureEdge> & { viaGroup: boolean })[] = []
  private readonly aligns: { members: string[]; line: number }[] = []
  private readonly accessibility = new AccessibilityLines()

  add({ line, text }: Statement): void {
    if (this.accessibility.skips(text)) return
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = (title[1] ?? '').trim()
      return
    }
    const handled =
      this.group(text, line) ||
      this.service(text, line) ||
      this.junction(text, line) ||
      this.edge(text, line) ||
      this.align(text, line)
    if (!handled) throw doesNotParse(line)
  }

  build(): ArchitectureDiagram {
    const kinds = new Map<string, 'group' | 'node'>()
    for (const group of this.groups) this.register(kinds, group, 'group')
    for (const node of [...this.services, ...this.junctions]) this.register(kinds, node, 'node')
    for (const edge of this.edges) this.check(kinds, edge)
    for (const align of this.aligns) this.checkAlign(kinds, align)
    const nodes = [...this.services, ...this.junctions]
    if (nodes.length === 0) {
      throw new DiagramFault({
        kind: 'refused',
        reason: 'the architecture diagram has no services',
        line: null,
        limit: null,
      })
    }
    refuseOverLimits([
      ['boxes', nodes.length],
      ['edges', this.edges.length],
    ])
    return {
      kind: 'architecture',
      title: this.title,
      groups: this.groups.map(({ id, title, parent }) => ({ id, title, parent })),
      nodes: nodes.map(({ id, isJunction, title, parent }) => ({ id, isJunction, title, parent })),
      edges: this.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        fromSide: edge.fromSide,
        toSide: edge.toSide,
        intoFrom: edge.intoFrom,
        intoTo: edge.intoTo,
        title: edge.title,
      })),
    }
  }

  private register(
    kinds: Map<string, 'group' | 'node'>,
    member: Member,
    kind: 'group' | 'node',
  ): void {
    const { id, parent, line } = member
    if (kinds.has(id)) throw lineFault(line, `line ${String(line)}: the id ${id} is in use already`)
    if (parent !== null) {
      if (parent === id)
        throw lineFault(line, `line ${String(line)}: ${id} cannot be inside itself`)
      const known = kinds.get(parent)
      if (known === undefined) {
        throw lineFault(line, `line ${String(line)}: no group has the id ${parent}`)
      }
      if (known === 'node') throw lineFault(line, `line ${String(line)}: ${parent} is not a group`)
    }
    kinds.set(id, kind)
  }

  private check(
    kinds: ReadonlyMap<string, 'group' | 'node'>,
    edge: Written<ArchitectureEdge> & { viaGroup: boolean },
  ): void {
    const { line } = edge
    for (const id of [edge.from, edge.to]) {
      const kind = kinds.get(id)
      if (kind === undefined) {
        throw lineFault(line, `line ${String(line)}: no service or junction has the id ${id}`)
      }
      if (kind === 'group') {
        throw lineFault(line, `line ${String(line)}: an edge cannot end at the group ${id}`)
      }
    }
    if (edge.from === edge.to) {
      throw lineFault(line, 'an edge from a service to itself does not draw yet')
    }
    const nodes = [...this.services, ...this.junctions]
    const parentOf = (id: string) => nodes.find((node) => node.id === id)?.parent ?? null
    const from = parentOf(edge.from)
    if (edge.viaGroup && from !== null && from === parentOf(edge.to)) {
      throw lineFault(line, `line ${String(line)}: the edge does not pass between two groups`)
    }
  }

  private checkAlign(
    kinds: ReadonlyMap<string, 'group' | 'node'>,
    align: { members: string[]; line: number },
  ): void {
    const { line } = align
    const seen = new Set<string>()
    for (const id of align.members) {
      if (kinds.get(id) !== 'node') {
        throw lineFault(line, `line ${String(line)}: no service or junction has the id ${id}`)
      }
      if (seen.has(id)) throw lineFault(line, `line ${String(line)}: align names ${id} twice`)
      seen.add(id)
    }
  }

  private group(text: string, line: number): boolean {
    const found = GROUP.exec(text)
    if (found === null) return false
    this.groups.push({
      id: found[1] ?? '',
      title: titleOf(found[2]),
      parent: found[3] ?? null,
      line,
    })
    return true
  }

  private service(text: string, line: number): boolean {
    const found = SERVICE.exec(text)
    if (found === null) return false
    this.services.push({
      id: found[1] ?? '',
      isJunction: false,
      title: titleOf(found[2]),
      parent: found[3] ?? null,
      line,
    })
    return true
  }

  private junction(text: string, line: number): boolean {
    const found = JUNCTION.exec(text)
    if (found === null) return false
    this.junctions.push({
      id: found[1] ?? '',
      isJunction: true,
      title: null,
      parent: found[2] ?? null,
      line,
    })
    return true
  }

  private edge(text: string, line: number): boolean {
    const found = EDGE.exec(text)
    if (found === null) return false
    this.edges.push({
      from: found[1] ?? '',
      fromSide: (found[3] ?? 'R') as ArchitectureSide,
      intoFrom: found[4] !== undefined,
      title: titleOf(found[5]),
      intoTo: found[6] !== undefined,
      toSide: (found[7] ?? 'L') as ArchitectureSide,
      to: found[8] ?? '',
      viaGroup: found[2] !== undefined || found[9] !== undefined,
      line,
    })
    return true
  }

  private align(text: string, line: number): boolean {
    const found = ALIGN.exec(text)
    if (found === null) return false
    this.aligns.push({ members: (found[1] ?? '').split(WHITESPACE), line })
    return true
  }
}

export function architectureBuilder(header: Statement): ArchitectureBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (header.text !== DRAWN_HEADER) throw doesNotParse(header.line)
  return new ArchitectureBuilder()
}

function directionOf(edges: readonly ArchitectureEdge[]): FlowDirection {
  const across = edges.filter(
    (edge) => ACROSS_SIDES.has(edge.fromSide) && ACROSS_SIDES.has(edge.toSide),
  ).length
  const down = edges.filter(
    (edge) => !ACROSS_SIDES.has(edge.fromSide) && !ACROSS_SIDES.has(edge.toSide),
  ).length
  return across > down ? 'LR' : 'TD'
}

function edgeOf(edge: ArchitectureEdge): FlowEdge {
  const isOneWay = edge.intoFrom !== edge.intoTo
  const isReversed = isOneWay ? edge.intoFrom : LEADING_SIDES.has(edge.fromSide)
  const title = edge.title ?? ''
  const written = edge.intoFrom && edge.intoTo ? `${BOTH_WAYS} ${title}`.trim() : title
  return {
    from: isReversed ? edge.to : edge.from,
    to: isReversed ? edge.from : edge.to,
    stroke: 'solid',
    arrow: isOneWay,
    label: textLines(written).filter((line) => line !== ''),
  }
}

function nodeOf(node: ArchitectureNode): FlowNode {
  if (node.isJunction) return { id: node.id, shape: 'rounded', label: [JUNCTION_MARK] }
  return { id: node.id, shape: 'rounded', label: textLines(node.title ?? node.id) }
}

function frameTitle(group: ArchitectureGroup, groups: ReadonlyMap<string, ArchitectureGroup>) {
  const names: string[] = []
  const seen = new Set<string>()
  for (
    let at: ArchitectureGroup | undefined = group;
    at !== undefined && !seen.has(at.id);
    at = at.parent === null ? undefined : groups.get(at.parent)
  ) {
    seen.add(at.id)
    names.push(textLines(at.title ?? at.id).join(' '))
  }
  return names.join(INSIDE)
}

function groupsOf(diagram: ArchitectureDiagram): FlowGroup[] {
  const groups = new Map(diagram.groups.map((group) => [group.id, group]))
  return diagram.groups.flatMap((group) => {
    const nodes = diagram.nodes.filter((node) => node.parent === group.id).map((node) => node.id)
    return nodes.length === 0 ? [] : [{ id: group.id, label: [frameTitle(group, groups)], nodes }]
  })
}

export function drawArchitecture(
  diagram: ArchitectureDiagram,
  width: number,
): InkedDrawing | Refusal {
  const groups = groupsOf(diagram)
  const drawn = drawFlowchart(
    {
      kind: 'flowchart',
      direction: directionOf(diagram.edges),
      nodes: diagram.nodes.map(nodeOf),
      edges: diagram.edges.map(edgeOf),
      ...(groups.length === 0 ? {} : { groups }),
    },
    width,
  )
  return titledDrawing(diagram.title, drawn, width)
}
