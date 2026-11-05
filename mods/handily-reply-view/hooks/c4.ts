import { drawFlowchart } from './flowchart'
import type { InkedDrawing } from './ink'
import {
  AccessibilityLines,
  DiagramFault,
  doesNotParse,
  lineFault,
  refuseOverLimits,
  textLines,
  type FlowEdge,
  type FlowGroup,
  type FlowNode,
  type Refusal,
  type Statement,
} from './mermaid'
import { titledDrawing } from './outline'
import { wrapCell } from './table'

export const C4_VARIANTS = [
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
] as const

export type C4Variant = (typeof C4_VARIANTS)[number]

export type C4Shape = { base: string; isExternal: boolean; store: string }

export type C4Element = {
  alias: string
  shape: C4Shape
  label: string
  techn: string
  descr: string
  boundary: string | null
}

export type C4Boundary = { alias: string; label: string; type: string; parent: string | null }

export type C4Heads = 'forward' | 'back' | 'both'

export type C4Relation = { from: string; to: string; heads: C4Heads; label: string; techn: string }

export type C4Diagram = {
  kind: 'c4'
  variant: C4Variant
  title: string | null
  elements: C4Element[]
  boundaries: C4Boundary[]
  relations: C4Relation[]
}

type Argument = string | { key: string; value: string }

type ElementSyntax = { kind: 'element'; shape: C4Shape; slots: readonly string[] }

type BoundarySyntax = { kind: 'boundary'; fixedType: string | null; slots: readonly string[] }

type RelationSyntax = { kind: 'relation'; heads: C4Heads; isIndexed: boolean }

type StyleSyntax = { kind: 'style' }

type CallSyntax = ElementSyntax | BoundarySyntax | RelationSyntax | StyleSyntax

type OpenBoundary = { boundary: C4Boundary; line: number; statements: number }

type WrittenRelation = C4Relation & { line: number }

const HEADER = /^C4(?:Context|Container|Component|Dynamic|Deployment)/
const PERSON_SLOTS = ['alias', 'label', 'descr', 'sprite', 'tags', 'link'] as const
const TECHN_SLOTS = ['alias', 'label', 'techn', 'descr', 'sprite', 'tags', 'link'] as const
const BOUNDARY_SLOTS = ['alias', 'label', 'type', 'tags', 'link'] as const
const NODE_SLOTS = ['alias', 'label', 'type', 'descr', 'sprite', 'tags', 'link'] as const
const RELATION_SLOTS = ['from', 'to', 'label', 'techn', 'descr', 'sprite', 'tags', 'link'] as const
const STORES: readonly (readonly [string, string])[] = [
  ['', ''],
  ['Db', 'Database '],
  ['Queue', 'Queue '],
]
const BASES: readonly (readonly [string, string, readonly string[]])[] = [
  ['System', 'Software System', PERSON_SLOTS],
  ['Container', 'Container', TECHN_SLOTS],
  ['Component', 'Component', TECHN_SLOTS],
]

function elementSyntaxes(): [string, CallSyntax][] {
  const person = (isExternal: boolean): ElementSyntax => ({
    kind: 'element',
    shape: { base: 'Person', isExternal, store: '' },
    slots: PERSON_SLOTS,
  })
  return [
    ['Person', person(false)],
    ['Person_Ext', person(true)],
    ...BASES.flatMap(([keyword, base, slots]) =>
      STORES.flatMap(([suffix, store]) =>
        [false, true].map((isExternal): [string, CallSyntax] => [
          `${keyword}${suffix}${isExternal ? '_Ext' : ''}`,
          { kind: 'element', shape: { base, isExternal, store }, slots },
        ]),
      ),
    ),
  ]
}

const RELATION_HEADS: readonly (readonly [string, C4Heads])[] = [
  ['Rel', 'forward'],
  ['BiRel', 'both'],
  ['Rel_Up', 'forward'],
  ['Rel_U', 'forward'],
  ['Rel_Down', 'forward'],
  ['Rel_D', 'forward'],
  ['Rel_Left', 'forward'],
  ['Rel_L', 'forward'],
  ['Rel_Right', 'forward'],
  ['Rel_R', 'forward'],
  ['Rel_Back', 'back'],
]

const CALLS: ReadonlyMap<string, CallSyntax> = new Map<string, CallSyntax>([
  ...elementSyntaxes(),
  ['Boundary', { kind: 'boundary', fixedType: null, slots: BOUNDARY_SLOTS }],
  ['Enterprise_Boundary', { kind: 'boundary', fixedType: 'ENTERPRISE', slots: BOUNDARY_SLOTS }],
  ['System_Boundary', { kind: 'boundary', fixedType: 'SYSTEM', slots: BOUNDARY_SLOTS }],
  ['Container_Boundary', { kind: 'boundary', fixedType: 'CONTAINER', slots: BOUNDARY_SLOTS }],
  ['Deployment_Node', { kind: 'boundary', fixedType: null, slots: NODE_SLOTS }],
  ['Node', { kind: 'boundary', fixedType: null, slots: NODE_SLOTS }],
  ['Node_L', { kind: 'boundary', fixedType: null, slots: NODE_SLOTS }],
  ['Node_R', { kind: 'boundary', fixedType: null, slots: NODE_SLOTS }],
  ...RELATION_HEADS.map(([keyword, heads]): [string, CallSyntax] => [
    keyword,
    { kind: 'relation', heads, isIndexed: false },
  ]),
  ['RelIndex', { kind: 'relation', heads: 'forward', isIndexed: true }],
  ['UpdateElementStyle', { kind: 'style' }],
  ['UpdateRelStyle', { kind: 'style' }],
  ['UpdateLayoutConfig', { kind: 'style' }],
])

const DEFAULT_TYPES: Readonly<Record<string, string>> = {
  Boundary: 'system',
  Deployment_Node: 'node',
  Node: 'node',
  Node_L: 'node',
  Node_R: 'node',
}

const CALL = /^([A-Za-z_]+)\((.*)$/
const TITLE = /^title\s(.*)$/
const TITLE_STOP = /[#;]/
const ACC_DESCRIPTION = /^accDescription\s/
const DIRECTION = /direction\s+(?:TB|BT|RL|LR)/
const EMPTY_FIRST = /^ *,/
const ARGUMENT_READERS: readonly {
  pattern: RegExp
  read: (found: RegExpExecArray) => Argument
}[] = [
  { pattern: /^ *""/, read: () => '' },
  { pattern: /^ *"([^"]*)"/, read: (found) => (found[1] ?? '').trim() },
  {
    pattern: /^ *\$([^=]*)= *"([^"]+)"/,
    read: (found) => ({ key: (found[1] ?? '').trim(), value: (found[2] ?? '').trim() }),
  },
  { pattern: /^[^,]+(?=,)/, read: (found) => found[0].trim() },
]
const CALL_END = ')'
const EMPTY_PAIR = ',,'
const SEPARATOR = ','
const BRACE_OPEN = '{'
const BRACE_CLOSE = '}'
const INSIDE = ' in '
const BOTH_WAYS = '⇄'
const BOLDABLE = /^[^\s*](?:.*[^\s*])?$/
const BOLD_MARK = '**'
const WIDEST_WRAP = 32
const NARROWER_WRAPS: readonly number[] = [24, 16]

function fault(reason: string): DiagramFault {
  return new DiagramFault({ kind: 'refused', reason, line: null, limit: null })
}

function nextArgument(rest: string, line: number): { value: Argument; length: number } {
  for (const { pattern, read } of ARGUMENT_READERS) {
    const found = pattern.exec(rest)
    if (found !== null) return { value: read(found), length: found[0].length }
  }
  throw doesNotParse(line)
}

function argumentsOf(text: string, line: number): { values: Argument[]; rest: string } {
  const values: Argument[] = []
  const first = EMPTY_FIRST.exec(text)
  let at = first === null ? 0 : first[0].length
  if (first !== null) values.push('')
  while (at < text.length) {
    const rest = text.slice(at)
    if (rest.startsWith(CALL_END)) return { values, rest: rest.slice(CALL_END.length).trim() }
    if (rest.startsWith(EMPTY_PAIR)) {
      values.push('')
      at += EMPTY_PAIR.length
    } else if (rest.startsWith(SEPARATOR)) {
      at += SEPARATOR.length
    } else {
      const { value, length } = nextArgument(rest, line)
      values.push(value)
      at += length
    }
  }
  throw doesNotParse(line)
}

function fieldsOf(slots: readonly string[], values: readonly Argument[]): Map<string, string> {
  const fields = new Map<string, string>()
  values.forEach((value, at) => {
    if (typeof value !== 'string') fields.set(value.key, value.value)
    else if (slots[at] !== undefined) fields.set(slots[at], value)
  })
  return fields
}

function aliasOf(values: readonly Argument[], at: number, line: number): string {
  const alias = values[at]
  if (typeof alias !== 'string' || alias === '') throw doesNotParse(line)
  return alias
}

export class C4Builder {
  private title: string | null = null
  private readonly elements = new Map<string, C4Element>()
  private readonly boundaries = new Map<string, C4Boundary>()
  private readonly relations: WrittenRelation[] = []
  private readonly open: OpenBoundary[] = []
  private readonly accessibility = new AccessibilityLines()
  private pending: OpenBoundary | null = null

  constructor(private readonly variant: C4Variant) {}

  add({ line, text }: Statement): void {
    if (this.pending !== null) {
      if (text !== BRACE_OPEN) throw doesNotParse(line)
      this.open.push(this.pending)
      this.pending = null
      return
    }
    if (DIRECTION.test(text)) throw doesNotParse(line)
    if (this.accessibility.skips(text) || ACC_DESCRIPTION.test(text)) return
    if (text === BRACE_CLOSE) {
      this.close(line)
      return
    }
    const title = TITLE.exec(text)?.[1]
    if (title !== undefined) {
      if (TITLE_STOP.test(title)) throw doesNotParse(line)
      this.title = title.trim()
      return
    }
    const call = CALL.exec(text)
    const syntax = CALLS.get(call?.[1] ?? '')
    if (call === null || syntax === undefined) throw doesNotParse(line)
    const { values, rest } = argumentsOf(call[2] ?? '', line)
    const innermost = this.open.at(-1)
    if (innermost !== undefined) innermost.statements += 1
    if (syntax.kind === 'boundary') {
      this.begin(syntax, call[1] ?? '', values, rest, line)
      return
    }
    if (rest !== '') throw doesNotParse(line)
    if (syntax.kind === 'element') this.element(syntax, values, line)
    if (syntax.kind === 'relation') this.relate(syntax, values, line)
  }

  build(): C4Diagram {
    const unclosed = this.pending ?? this.open.at(0)
    if (unclosed !== undefined) {
      throw lineFault(unclosed.line, `line ${String(unclosed.line)} opens a boundary with no end`)
    }
    if (this.elements.size === 0) throw fault('the C4 diagram has no elements')
    for (const relation of this.relations) this.check(relation)
    refuseOverLimits([
      ['boxes', this.elements.size],
      ['edges', this.relations.length],
    ])
    return {
      kind: 'c4',
      variant: this.variant,
      title: this.title,
      elements: [...this.elements.values()],
      boundaries: [...this.boundaries.values()],
      relations: this.relations.map(({ from, to, heads, label, techn }) => ({
        from,
        to,
        heads,
        label,
        techn,
      })),
    }
  }

  private close(line: number): void {
    const closed = this.open.pop()
    if (closed === undefined || closed.statements === 0) throw doesNotParse(line)
  }

  private isTaken(alias: string): boolean {
    return this.elements.has(alias) || this.boundaries.has(alias)
  }

  private begin(
    syntax: BoundarySyntax,
    keyword: string,
    written: readonly Argument[],
    rest: string,
    line: number,
  ): void {
    if (rest !== '' && rest !== BRACE_OPEN) throw doesNotParse(line)
    const values = [...written]
    if (syntax.fixedType !== null) values.splice(2, 0, syntax.fixedType)
    const alias = aliasOf(values, 0, line)
    if (this.isTaken(alias)) {
      throw lineFault(line, `line ${String(line)}: the alias ${alias} is in use already`)
    }
    const fields = fieldsOf(syntax.slots, values)
    const boundary: C4Boundary = {
      alias,
      label: fields.get('label') ?? '',
      type: fields.get('type') ?? DEFAULT_TYPES[keyword] ?? '',
      parent: this.open.at(-1)?.boundary.alias ?? null,
    }
    this.boundaries.set(alias, boundary)
    const opened = { boundary, line, statements: 0 }
    if (rest === BRACE_OPEN) this.open.push(opened)
    else this.pending = opened
  }

  private element(syntax: ElementSyntax, values: readonly Argument[], line: number): void {
    const alias = aliasOf(values, 0, line)
    if (this.boundaries.has(alias)) {
      throw lineFault(line, `line ${String(line)}: the alias ${alias} is in use already`)
    }
    const fields = fieldsOf(syntax.slots, values)
    const known = this.elements.get(alias)
    this.elements.set(alias, {
      alias,
      shape: syntax.shape,
      label: fields.get('label') ?? '',
      techn: fields.get('techn') ?? known?.techn ?? '',
      descr: fields.get('descr') ?? known?.descr ?? '',
      boundary: this.open.at(-1)?.boundary.alias ?? null,
    })
  }

  private relate(syntax: RelationSyntax, written: readonly Argument[], line: number): void {
    const values = syntax.isIndexed ? written.slice(1) : written
    const fields = fieldsOf(RELATION_SLOTS, values)
    const from = aliasOf(values, 0, line)
    const to = aliasOf(values, 1, line)
    const label = fields.get('label')
    if (label === undefined) return
    const relation = {
      from,
      to,
      heads: syntax.heads,
      label,
      techn: fields.get('techn') ?? '',
      line,
    }
    const known = this.relations.findIndex((one) => one.from === from && one.to === to)
    if (known < 0) {
      this.relations.push(relation)
      return
    }
    const old = this.relations[known]
    this.relations[known] = { ...relation, techn: fields.get('techn') ?? old?.techn ?? '' }
  }

  private check(relation: WrittenRelation): void {
    const { line } = relation
    for (const alias of [relation.from, relation.to]) {
      if (this.boundaries.has(alias)) {
        throw lineFault(line, `a relation to the boundary ${alias} does not draw yet`)
      }
      if (!this.elements.has(alias)) {
        throw lineFault(line, `line ${String(line)}: no element has the alias ${alias}`)
      }
    }
    if (relation.from === relation.to) {
      throw lineFault(line, 'a relation from an element to itself does not draw yet')
    }
  }
}

export function c4Builder(header: Statement): C4Builder | null {
  const variant = HEADER.exec(header.text)?.[0]
  if (variant === undefined) return null
  const exact = C4_VARIANTS.find((name) => name === header.text)
  if (exact === undefined) throw doesNotParse(header.line)
  return new C4Builder(exact)
}

function bold(line: string): string {
  return BOLDABLE.test(line) && !line.includes(BOLD_MARK) ? `${BOLD_MARK}${line}${BOLD_MARK}` : line
}

function stereotypeOf(element: C4Element): string {
  const { base, isExternal, store } = element.shape
  const kind = `${isExternal ? 'External ' : ''}${store}${base}`
  return element.techn === '' ? `[${kind}]` : `[${kind}: ${element.techn}]`
}

function nodeOf(element: C4Element, wrap: number): FlowNode {
  const names = textLines(element.label).filter((line) => line !== '')
  const description = textLines(element.descr)
    .filter((line) => line !== '')
    .flatMap((line) => wrapCell(line, wrap))
  return {
    id: element.alias,
    shape: 'rounded',
    label: [...names.map(bold), stereotypeOf(element), ...description],
  }
}

function edgeOf(relation: C4Relation, number: number | null): FlowEdge {
  const numbered = number === null ? relation.label : `${String(number)}: ${relation.label}`
  const written = relation.heads === 'both' ? `${BOTH_WAYS} ${numbered}`.trim() : numbered
  const isBack = relation.heads === 'back'
  return {
    from: isBack ? relation.to : relation.from,
    to: isBack ? relation.from : relation.to,
    stroke: 'solid',
    arrow: relation.heads !== 'both',
    label: [
      ...textLines(written).filter((line) => line !== ''),
      ...(relation.techn === '' ? [] : [`[${relation.techn}]`]),
    ],
  }
}

function nameOf(boundary: C4Boundary): string {
  const label = textLines(boundary.label).join(' ').trim()
  return boundary.type === '' ? label : `${label} [${boundary.type}]`.trim()
}

function frameTitle(boundary: C4Boundary, boundaries: ReadonlyMap<string, C4Boundary>): string {
  const names: string[] = []
  for (
    let at: C4Boundary | undefined = boundary;
    at !== undefined;
    at = at.parent === null ? undefined : boundaries.get(at.parent)
  ) {
    names.push(at === boundary ? nameOf(at) : textLines(at.label).join(' ').trim())
  }
  return names.filter((name) => name !== '').join(INSIDE)
}

function groupsOf(diagram: C4Diagram): FlowGroup[] {
  const boundaries = new Map(diagram.boundaries.map((boundary) => [boundary.alias, boundary]))
  return diagram.boundaries.flatMap((boundary) => {
    const nodes = diagram.elements
      .filter((element) => element.boundary === boundary.alias)
      .map((element) => element.alias)
    if (nodes.length === 0) return []
    return [{ id: boundary.alias, label: [frameTitle(boundary, boundaries)], nodes }]
  })
}

function drawnAt(diagram: C4Diagram, wrap: number, width: number): InkedDrawing | Refusal {
  const isNumbered = diagram.variant === 'C4Dynamic'
  const groups = groupsOf(diagram)
  return drawFlowchart(
    {
      kind: 'flowchart',
      direction: 'TD',
      nodes: diagram.elements.map((element) => nodeOf(element, wrap)),
      edges: diagram.relations.map((relation, at) => edgeOf(relation, isNumbered ? at + 1 : null)),
      ...(groups.length === 0 ? {} : { groups }),
    },
    width,
  )
}

function shorter(
  one: InkedDrawing | Refusal,
  other: InkedDrawing | Refusal,
): InkedDrawing | Refusal {
  if (other.kind !== 'drawing') return one.kind === 'drawing' ? one : other
  return one.kind === 'drawing' && one.lines.length <= other.lines.length ? one : other
}

export function drawC4(diagram: C4Diagram, width: number): InkedDrawing | Refusal {
  const drawn = NARROWER_WRAPS.reduce(
    (best, wrap) => shorter(best, drawnAt(diagram, wrap, width)),
    drawnAt(diagram, WIDEST_WRAP, width),
  )
  return titledDrawing(diagram.title, drawn, width)
}
