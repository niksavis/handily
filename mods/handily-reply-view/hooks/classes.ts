import { drawFlowchart, type FlowDrawing, type LayoutMeter } from './flowchart'
import {
  DiagramFault,
  doesNotParse,
  lineFault,
  notDrawnYet,
  refuseOverLimits,
  textLines,
  type FlowEdge,
  type FlowNode,
  type Refusal,
  type Statement,
  type Stroke,
} from './mermaid'

export const MOST_MEMBERS = 10

export type ClassBox = { id: string; name: string; annotation: string | null; members: string[] }

export type RelationKind = 'inheritance' | 'composition' | 'aggregation' | 'association' | 'link'

export type Relation = {
  from: string
  to: string
  kind: RelationKind
  stroke: Stroke
  fromCard: string
  toCard: string
  label: string[]
}

export type ClassDiagram = { kind: 'class'; classes: ClassBox[]; relations: Relation[] }

type EndSyntax = { kind: RelationKind; marksThisEnd: boolean }

const BACKTICK = '`'
const CLASS_ID = `${BACKTICK}[^${BACKTICK}]+${BACKTICK}|${String.raw`[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*`}`
const STYLE_CLASS = String.raw`(?::::[\p{L}\p{N}_-]+)?`
const CARDINALITY = String.raw`(?:"([^"]*)"\s*)?`
const LEFT_END = String.raw`<\||\*|<|\(\)|(?<=[\s"])o`
const RIGHT_END = String.raw`\|>|\*|>|\(\)|o(?=[\s"])`
const RELATION = new RegExp(
  String.raw`^(${CLASS_ID})\s*${CARDINALITY}(${LEFT_END})?(--|\.\.)(${RIGHT_END})?\s*${CARDINALITY}(${CLASS_ID})\s*(?::(.*))?$`,
  'u',
)
const DECLARATION = new RegExp(
  String.raw`^class\s+(${CLASS_ID})(~[^~\s]+~)?(?:\["([^"]*)"\])?${STYLE_CLASS}\s*(?:<<([^<>]+)>>)?\s*(\{\s*\}|\{)?$`,
  'u',
)
const MEMBER = new RegExp(String.raw`^(${CLASS_ID})\s*:(.*)$`, 'u')
const ANNOTATION = new RegExp(String.raw`^<<([^<>]+)>>\s+(${CLASS_ID})$`, 'u')
const BODY_ANNOTATION = /^<<([^<>]+)>>$/
const BODY_END = '}'
const EMPTY_BODY = /^\{\s*\}$/
const IGNORED_STATEMENT =
  /^(?:(?:classDef|cssClass|style|click|link|callback)\s+\S|acc(?:Title|Descr)\s*:|direction\s+(?:TB|TD|BT|LR|RL)$)/
const NAMESPACE = /^namespace(?:\s|$)/
const NOTE = /^note(?:\s|$)/
const LOLLIPOP = '()'
const DASHED = '..'

const ENDS: Readonly<Record<string, EndSyntax>> = {
  '<|': { kind: 'inheritance', marksThisEnd: true },
  '|>': { kind: 'inheritance', marksThisEnd: true },
  '*': { kind: 'composition', marksThisEnd: true },
  o: { kind: 'aggregation', marksThisEnd: true },
  '<': { kind: 'association', marksThisEnd: false },
  '>': { kind: 'association', marksThisEnd: false },
}

const MARKS: Readonly<Partial<Record<RelationKind, string>>> = {
  inheritance: '△',
  composition: '◆',
  aggregation: '◇',
}

function idOf(written: string): string {
  const isQuoted = written.length > 1 && written.startsWith(BACKTICK) && written.endsWith(BACKTICK)
  return isQuoted ? written.slice(1, -1) : written
}

function fault(reason: string): DiagramFault {
  return new DiagramFault({ kind: 'refused', reason, line: null, limit: null })
}

type Ends = { from: number; kind: RelationKind }

function endsOf(left: string | undefined, right: string | undefined, line: number): Ends {
  if (left === LOLLIPOP || right === LOLLIPOP) {
    throw lineFault(line, 'a lollipop interface does not draw yet')
  }
  if (left !== undefined && right !== undefined) {
    throw lineFault(line, 'a two-way relation does not draw yet')
  }
  const written = left ?? right
  const end = written === undefined ? undefined : ENDS[written]
  if (written !== undefined && end === undefined) throw doesNotParse(line)
  if (end === undefined) return { from: 0, kind: 'link' }
  const leftMarked = left !== undefined
  return { from: leftMarked === end.marksThisEnd ? 0 : 1, kind: end.kind }
}

export class ClassBuilder {
  private readonly classes = new Map<string, ClassBox>()
  private readonly relations: Relation[] = []
  private open: ClassBox | null = null

  add(statement: Statement): void {
    const { line, text } = statement
    if (this.open !== null) {
      this.addToBody(this.open, text)
      return
    }
    if (IGNORED_STATEMENT.test(text)) return
    if (NAMESPACE.test(text)) throw notDrawnYet(line, 'namespace')
    if (NOTE.test(text)) throw notDrawnYet(line, 'note')
    const handled =
      this.declare(text) || this.annotate(text) || this.relate(text, line) || this.member(text)
    if (!handled) throw doesNotParse(line)
  }

  build(): ClassDiagram {
    if (this.open !== null) throw fault(`class ${this.open.name} has no closing brace`)
    if (this.classes.size === 0) throw fault('the class diagram has no classes')
    for (const box of this.classes.values()) {
      if (box.members.length > MOST_MEMBERS) {
        throw fault(
          `class ${box.name} has ${String(box.members.length)} members, at most ${String(MOST_MEMBERS)} draw`,
        )
      }
    }
    refuseOverLimits([
      ['boxes', this.classes.size],
      ['edges', this.relations.length],
    ])
    return { kind: 'class', classes: [...this.classes.values()], relations: this.relations }
  }

  private box(written: string): ClassBox {
    const id = idOf(written)
    const known = this.classes.get(id)
    if (known !== undefined) return known
    const made: ClassBox = { id, name: id, annotation: null, members: [] }
    this.classes.set(id, made)
    return made
  }

  private addToBody(box: ClassBox, text: string): void {
    if (text === BODY_END) {
      this.open = null
      return
    }
    const annotation = BODY_ANNOTATION.exec(text)?.[1]
    if (annotation !== undefined) box.annotation = annotation.trim()
    else box.members.push(text)
  }

  private declare(text: string): boolean {
    const found = DECLARATION.exec(text)
    if (found === null) return false
    const box = this.box(found[1] ?? '')
    box.name = found[3] ?? `${box.id}${found[2] ?? ''}`
    if (found[4] !== undefined) box.annotation = found[4].trim()
    const body = found[5]
    if (body !== undefined && !EMPTY_BODY.test(body)) this.open = box
    return true
  }

  private annotate(text: string): boolean {
    const found = ANNOTATION.exec(text)
    if (found === null) return false
    this.box(found[2] ?? '').annotation = (found[1] ?? '').trim()
    return true
  }

  private relate(text: string, line: number): boolean {
    const found = RELATION.exec(text)
    if (found === null) return false
    const ends = endsOf(found[3], found[5], line)
    const sides = [
      { id: this.box(found[1] ?? '').id, card: (found[2] ?? '').trim() },
      { id: this.box(found[7] ?? '').id, card: (found[6] ?? '').trim() },
    ] as const
    const from = sides[ends.from]
    const to = sides[1 - ends.from]
    if (from === undefined || to === undefined) throw doesNotParse(line)
    const label = (found[8] ?? '').trim()
    this.relations.push({
      from: from.id,
      to: to.id,
      kind: ends.kind,
      stroke: found[4] === DASHED ? 'dashed' : 'solid',
      fromCard: from.card,
      toCard: to.card,
      label: label === '' ? [] : textLines(label),
    })
    return true
  }

  private member(text: string): boolean {
    const found = MEMBER.exec(text)
    if (found === null) return false
    const member = (found[2] ?? '').trim()
    if (member !== '') this.box(found[1] ?? '').members.push(member)
    return true
  }
}

function nodeOf(box: ClassBox): FlowNode {
  const title = box.annotation === null ? [box.name] : [`«${box.annotation}»`, box.name]
  return {
    id: box.id,
    shape: 'rounded',
    label: [...title, ...box.members],
    titleLines: title.length,
  }
}

function filled(...parts: readonly (readonly string[])[]): string[] {
  return parts.flat().filter((part) => part !== '')
}

function markerKey(relation: Relation, index: number): string {
  const shared = relation.fromCard === ''
  return `${BACKTICK}${shared ? `${relation.from} ${relation.kind} ${relation.stroke}` : String(index)}`
}

function chartParts(diagram: ClassDiagram): { markers: FlowNode[]; edges: FlowEdge[] } {
  const markers = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  diagram.relations.forEach((relation, index) => {
    const { from, to, stroke, kind } = relation
    const mark = MARKS[kind]
    if (mark === undefined) {
      const label = filled([relation.fromCard], relation.label, [relation.toCard])
      edges.push({ from, to, stroke, arrow: kind === 'association', label })
      return
    }
    const marker = markerKey(relation, index)
    if (!markers.has(marker)) {
      markers.set(marker, { id: marker, shape: 'point', label: [mark] })
      edges.push({ from, to: marker, stroke, arrow: false, label: filled([relation.fromCard]) })
    }
    edges.push({
      from: marker,
      to,
      stroke,
      arrow: false,
      label: filled(relation.label, [relation.toCard]),
    })
  })
  return { markers: [...markers.values()], edges }
}

export function drawClasses(
  diagram: ClassDiagram,
  width: number,
  meter: LayoutMeter = { steps: 0 },
): FlowDrawing | Refusal {
  const { markers, edges } = chartParts(diagram)
  return drawFlowchart(
    {
      kind: 'flowchart',
      direction: 'TD',
      nodes: [...diagram.classes.map(nodeOf), ...markers],
      edges,
    },
    width,
    meter,
  )
}
