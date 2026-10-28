export type LimitName = 'lines' | 'characters' | 'boxes' | 'edges' | 'participants' | 'events'

export const DIAGRAM_LIMITS: Readonly<Record<LimitName, number>> = {
  lines: 80,
  characters: 8000,
  boxes: 40,
  edges: 60,
  participants: 12,
  events: 60,
}

const LIMIT_NOUNS: Readonly<Record<LimitName, string>> = {
  lines: 'lines',
  characters: 'characters',
  boxes: 'boxes',
  edges: 'edges',
  participants: 'participants',
  events: 'messages and notes',
}

export type Refusal = {
  kind: 'refused'
  reason: string
  line: number | null
  limit: { name: LimitName; count: number; most: number } | null
}

export type Stroke = 'solid' | 'dashed'

export type FlowDirection = 'TD' | 'LR'

export type FlowShape = 'box' | 'rounded' | 'decision'

export type FlowNode = { id: string; shape: FlowShape; label: string[] }

export type FlowEdge = { from: string; to: string; stroke: Stroke; arrow: boolean; label: string[] }

export type Flowchart = {
  kind: 'flowchart'
  direction: FlowDirection
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export type Participant = { id: string; kind: 'participant' | 'actor'; label: string[] }

export type MessageHead = 'none' | 'arrow' | 'cross' | 'open'

export type Message = {
  kind: 'message'
  from: string
  to: string
  stroke: Stroke
  head: MessageHead
  text: string[]
  number: number | null
}

export type NotePlacement = 'left of' | 'right of' | 'over'

export type Note = {
  kind: 'note'
  placement: NotePlacement
  participants: string[]
  text: string[]
}

export type SequenceEvent = Message | Note

export type BlockKind = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect'

export type BlockSection = { label: string[]; from: number; to: number }

export type SequenceBlock = {
  kind: BlockKind
  depth: number
  section: number
  sections: BlockSection[]
}

export type SequenceDiagram = {
  kind: 'sequence'
  participants: Participant[]
  events: SequenceEvent[]
  blocks: SequenceBlock[]
}

export type MermaidDiagram = Flowchart | SequenceDiagram

type Statement = { line: number; text: string }

class DiagramFault extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason)
  }
}

const LINE_ENDING = /\r\n?/g
const COMMENT = /^%%/
const TRAILING_SEMICOLON = /;$/
const LINE_BREAK = /<br\s*\/?>/i
const FLOW_HEADER = /^(flowchart|graph)(?:\s+(\S+))?$/
const SEQUENCE_HEADER = 'sequenceDiagram'
const DIAGRAM_KIND = /^([A-Za-z][\w-]*)(?:\s[^-[\](){}|<>&]*)?$/
const DRAWN_DIRECTIONS: Readonly<Record<string, FlowDirection>> = { TD: 'TD', TB: 'TD', LR: 'LR' }
const REFUSED_DIRECTIONS: ReadonlySet<string> = new Set(['RL', 'BT'])
const IGNORED_FLOW_STATEMENT = /^(?:classDef|class|style|linkStyle|click)\s+(?=[^\s=&-])/
const REFUSED_FLOW_STATEMENT = /^(subgraph|direction)(?:\s|$)/
const REFUSED_SEQUENCE_STATEMENT = /^(box|create|destroy)(?:\s|$)/
const NODE_ID = /[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/uy
const RESERVED_NODE_ID = 'end'
const NODE_PROPERTIES = /@\{[^}]*\}/y
const IMAGE_PROPERTY = /\b(?:icon|img)\s*:/
const NODE_CLASS = /:::[\p{L}\p{N}_-]+/uy
const FAN_OUT = /\s*&\s*/y
const SPACES = /\s*/y
const TEXT_LINK_OPENING = /\s*--(?![->.])/y
const TEXT_LINK_CLOSING = '-->'
const PLAIN_LINK = /\s*(-\.->|-\.-|-->|---|==>)\s*/y
const PIPE = '|'
const QUOTED_TEXT = /"[^"]*"/y
const EDGE_LABEL = /^(?:"[^"]*"|[^"|]+)$/
const QUOTED = /^"([^"]*)"$/
const MARKDOWN_STRING = /^`[\s\S]*`$/
const ICON = /\bfa[bklrs]?:fa-/
const PARTICIPANT = /^(participant|actor)\s/
const ALIAS = /\sas\s/
const PARTICIPANT_ID = /^[^\s<>=:,;+"{}@-](?:[^<>=:,;"{}@]*[^\s<>=:,;"{}@-])?$/
const AUTONUMBER = 'autonumber'
const NOTE = /^note\s+(left\s+of|right\s+of|over)\s/i
const MESSAGE_ARROW = /-->>|->>|-->|--x|--\)|->|-x|-\)/
const ACTIVATION = /^\s*[+-]?/
const BLOCK_OPENING = /^(loop|alt|opt|par|critical|break|rect)(?:\s(.*))?$/
const BLOCK_SECTION = /^(else|and)(?:\s(.*))?$/
const BLOCK_END = 'end'
const SECTION_BLOCK: Readonly<Record<string, BlockKind>> = { else: 'alt', and: 'par' }

type ShapeSyntax = { opening: string; closing: string; shape: FlowShape }

const SHAPE_SYNTAX: readonly ShapeSyntax[] = [
  { opening: '(((', closing: ')))', shape: 'box' },
  { opening: '((', closing: '))', shape: 'rounded' },
  { opening: '([', closing: '])', shape: 'rounded' },
  { opening: '[[', closing: ']]', shape: 'box' },
  { opening: '[(', closing: ')]', shape: 'box' },
  { opening: '[/', closing: '/]', shape: 'box' },
  { opening: '[/', closing: '\\]', shape: 'box' },
  { opening: '[\\', closing: '\\]', shape: 'box' },
  { opening: '[\\', closing: '/]', shape: 'box' },
  { opening: '{{', closing: '}}', shape: 'box' },
  { opening: '[', closing: ']', shape: 'box' },
  { opening: '(', closing: ')', shape: 'rounded' },
  { opening: '{', closing: '}', shape: 'decision' },
  { opening: '>', closing: ']', shape: 'box' },
]

type ShapePattern = { pattern: RegExp; shape: FlowShape }

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

const SHAPE_PATTERNS: readonly ShapePattern[] = SHAPE_SYNTAX.map(({ opening, closing, shape }) => ({
  pattern: new RegExp(
    `${literal(opening)}(?:\\s*("[^"]*")\\s*|([^[\\](){}"]+?))${literal(closing)}`,
    'y',
  ),
  shape,
}))

type LinkSyntax = { stroke: Stroke; arrow: boolean }

const LINKS: Readonly<Record<string, LinkSyntax>> = {
  '-->': { stroke: 'solid', arrow: true },
  '---': { stroke: 'solid', arrow: false },
  '-.->': { stroke: 'dashed', arrow: true },
  '-.-': { stroke: 'dashed', arrow: false },
  '==>': { stroke: 'solid', arrow: true },
}

type ArrowSyntax = { stroke: Stroke; head: MessageHead }

const MESSAGE_ARROWS: Readonly<Record<string, ArrowSyntax>> = {
  '->': { stroke: 'solid', head: 'none' },
  '-->': { stroke: 'dashed', head: 'none' },
  '->>': { stroke: 'solid', head: 'arrow' },
  '-->>': { stroke: 'dashed', head: 'arrow' },
  '-x': { stroke: 'solid', head: 'cross' },
  '--x': { stroke: 'dashed', head: 'cross' },
  '-)': { stroke: 'solid', head: 'open' },
  '--)': { stroke: 'dashed', head: 'open' },
}

function lineFault(line: number, reason: string): DiagramFault {
  return new DiagramFault({ kind: 'refused', reason, line, limit: null })
}

function doesNotParse(line: number): DiagramFault {
  return lineFault(line, `line ${String(line)} does not parse`)
}

function notDrawnYet(line: number, name: string): DiagramFault {
  return lineFault(line, `${name} does not draw yet`)
}

function sourceLines(source: string): string[] {
  const lines = source.replace(LINE_ENDING, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function statementsOf(lines: readonly string[]): Statement[] {
  return lines
    .map((text, index) => ({
      line: index + 1,
      text: text.trim().replace(TRAILING_SEMICOLON, '').trimEnd(),
    }))
    .filter(({ text }) => text !== '' && !COMMENT.test(text))
}

function textLines(text: string): string[] {
  return text.split(LINE_BREAK).map((line) => line.trim())
}

function labelLines(raw: string, line: number): string[] {
  const quoted = QUOTED.exec(raw)
  const text = quoted === null ? raw : (quoted[1] ?? '')
  if (quoted !== null && MARKDOWN_STRING.test(text.trim())) {
    throw notDrawnYet(line, 'markdown strings')
  }
  if (ICON.test(text)) throw notDrawnYet(line, 'icons')
  return textLines(text)
}

function limitRefusal(name: LimitName, count: number): Refusal | null {
  const most = DIAGRAM_LIMITS[name]
  if (count <= most) return null
  return {
    kind: 'refused',
    reason: `${String(count)} ${LIMIT_NOUNS[name]}, at most ${String(most)} draw`,
    line: null,
    limit: { name, count, most },
  }
}

function refuseOverLimits(counts: readonly (readonly [LimitName, number])[]): void {
  for (const [name, count] of counts) {
    const refusal = limitRefusal(name, count)
    if (refusal !== null) throw new DiagramFault(refusal)
  }
}

class Cursor {
  private at = 0

  constructor(
    private readonly text: string,
    readonly line: number,
  ) {}

  take(pattern: RegExp): RegExpExecArray | null {
    pattern.lastIndex = this.at
    const found = pattern.exec(this.text)
    if (found !== null) this.at = pattern.lastIndex
    return found
  }

  skip(text: string): boolean {
    if (!this.text.startsWith(text, this.at)) return false
    this.at += text.length
    return true
  }

  takeThrough(closing: string): string | null {
    const end = this.text.indexOf(closing, this.at)
    if (end < 0) return null
    const taken = this.text.slice(this.at, end)
    this.at = end + closing.length
    return taken
  }

  get done(): boolean {
    return this.at >= this.text.length
  }
}

class FlowchartBuilder {
  private readonly nodes = new Map<string, FlowNode>()
  private readonly edges: FlowEdge[] = []
  private edgeCount = 0

  constructor(private readonly direction: FlowDirection) {}

  add(statement: Statement): void {
    const { line, text } = statement
    if (IGNORED_FLOW_STATEMENT.test(text)) return
    const refused = REFUSED_FLOW_STATEMENT.exec(text)?.[1]
    if (refused !== undefined) throw notDrawnYet(line, refused)
    const cursor = new Cursor(text, line)
    let sources = this.group(cursor)
    while (!cursor.done) {
      const link = this.link(cursor)
      const targets = this.group(cursor)
      this.edgeCount += sources.length * targets.length
      if (this.edgeCount <= DIAGRAM_LIMITS.edges) {
        for (const from of sources) {
          for (const to of targets) this.edges.push({ from, to, ...link, label: [...link.label] })
        }
      }
      sources = targets
    }
  }

  build(): Flowchart {
    refuseOverLimits([
      ['boxes', this.nodes.size],
      ['edges', this.edgeCount],
    ])
    return {
      kind: 'flowchart',
      direction: this.direction,
      nodes: [...this.nodes.values()],
      edges: this.edges,
    }
  }

  private group(cursor: Cursor): string[] {
    const ids = [this.node(cursor)]
    while (cursor.take(FAN_OUT) !== null) ids.push(this.node(cursor))
    return ids
  }

  private node(cursor: Cursor): string {
    const id = cursor.take(NODE_ID)?.[0]
    if (id === undefined || id === RESERVED_NODE_ID) throw doesNotParse(cursor.line)
    const properties = cursor.take(NODE_PROPERTIES)?.[0]
    if (properties !== undefined) {
      throw IMAGE_PROPERTY.test(properties)
        ? notDrawnYet(cursor.line, 'icons')
        : doesNotParse(cursor.line)
    }
    const shaped = this.shape(cursor)
    if (shaped !== null) this.nodes.set(id, { id, ...shaped })
    else if (!this.nodes.has(id)) this.nodes.set(id, { id, shape: 'box', label: [id] })
    cursor.take(NODE_CLASS)
    return id
  }

  private shape(cursor: Cursor): { shape: FlowShape; label: string[] } | null {
    for (const { pattern, shape } of SHAPE_PATTERNS) {
      const found = cursor.take(pattern)
      if (found !== null) {
        return { shape, label: labelLines(found[1] ?? found[2] ?? '', cursor.line) }
      }
    }
    return null
  }

  private link(cursor: Cursor): LinkSyntax & { label: string[] } {
    if (cursor.take(TEXT_LINK_OPENING) !== null) {
      return { stroke: 'solid', arrow: true, label: this.edgeLabel(cursor, TEXT_LINK_CLOSING) }
    }
    const syntax = LINKS[cursor.take(PLAIN_LINK)?.[1] ?? '']
    if (syntax === undefined) throw doesNotParse(cursor.line)
    if (!cursor.skip(PIPE)) return { ...syntax, label: [] }
    return { ...syntax, label: this.edgeLabel(cursor, PIPE) }
  }

  private edgeLabel(cursor: Cursor, closing: string): string[] {
    cursor.take(SPACES)
    const text = this.quotedEdgeLabel(cursor, closing) ?? cursor.takeThrough(closing)?.trim()
    if (text === undefined || !EDGE_LABEL.test(text)) throw doesNotParse(cursor.line)
    cursor.take(SPACES)
    return labelLines(text, cursor.line)
  }

  private quotedEdgeLabel(cursor: Cursor, closing: string): string | undefined {
    const quoted = cursor.take(QUOTED_TEXT)?.[0]
    if (quoted === undefined) return undefined
    cursor.take(SPACES)
    if (!cursor.skip(closing)) throw doesNotParse(cursor.line)
    return quoted
  }
}

type OpenBlock = { block: SequenceBlock; line: number }

class SequenceBuilder {
  private readonly participants = new Map<string, Participant>()
  private readonly events: SequenceEvent[] = []
  private readonly blocks: SequenceBlock[] = []
  private readonly open: OpenBlock[] = []
  private numbered: number | null = null

  add(statement: Statement): void {
    const { line, text } = statement
    const refused = REFUSED_SEQUENCE_STATEMENT.exec(text)?.[1]
    if (refused !== undefined) throw notDrawnYet(line, refused)
    if (text === AUTONUMBER) {
      this.numbered ??= 0
      return
    }
    if (text === BLOCK_END) {
      this.closeBlock(line)
      return
    }
    const handled =
      this.declare(statement) ||
      this.note(statement) ||
      this.openBlock(statement) ||
      this.section(statement) ||
      this.message(statement)
    if (!handled) throw doesNotParse(line)
  }

  build(): SequenceDiagram {
    const unclosed = this.open.at(0)
    if (unclosed !== undefined) {
      throw lineFault(unclosed.line, `line ${String(unclosed.line)} opens a block with no end`)
    }
    refuseOverLimits([
      ['participants', this.participants.size],
      ['events', this.events.length],
    ])
    return {
      kind: 'sequence',
      participants: [...this.participants.values()],
      events: this.events,
      blocks: this.blocks,
    }
  }

  private participant(id: string, line: number): string {
    if (!PARTICIPANT_ID.test(id)) throw doesNotParse(line)
    if (!this.participants.has(id)) {
      this.participants.set(id, { id, kind: 'participant', label: textLines(id) })
    }
    return id
  }

  private declare({ line, text }: Statement): boolean {
    const found = PARTICIPANT.exec(text)
    if (found === null) return false
    const named = text.slice(found[0].length).trim()
    const alias = ALIAS.exec(named)
    const id = this.participant(named.slice(0, alias?.index).trim(), line)
    const label = alias === null ? id : named.slice(alias.index + alias[0].length).trim()
    const kind = found[1] === 'actor' ? 'actor' : 'participant'
    this.participants.set(id, { id, kind, label: textLines(label) })
    return true
  }

  private note({ line, text }: Statement): boolean {
    const found = NOTE.exec(text)
    if (found === null) return false
    const rest = text.slice(found[0].length)
    const colon = rest.indexOf(':')
    if (colon < 0) throw doesNotParse(line)
    const placement = (found[1] ?? '').toLowerCase().replace(/\s+/, ' ') as NotePlacement
    const named = rest
      .slice(0, colon)
      .split(',')
      .map((id) => id.trim())
    const most = placement === 'over' ? 2 : 1
    if (named.length > most) throw doesNotParse(line)
    const participants = named.map((id) => this.participant(id, line))
    this.events.push({
      kind: 'note',
      placement,
      participants,
      text: textLines(rest.slice(colon + 1)),
    })
    return true
  }

  private openBlock({ line, text }: Statement): boolean {
    const found = BLOCK_OPENING.exec(text)
    if (found === null) return false
    const enclosing = this.open.at(-1)?.block
    const block: SequenceBlock = {
      kind: found[1] as BlockKind,
      depth: this.open.length,
      section: enclosing === undefined ? 0 : enclosing.sections.length - 1,
      sections: [this.newSection(found[2])],
    }
    this.blocks.push(block)
    this.open.push({ block, line })
    return true
  }

  private section({ line, text }: Statement): boolean {
    const found = BLOCK_SECTION.exec(text)
    if (found === null) return false
    const innermost = this.open.at(-1)?.block
    if (innermost === undefined || innermost.kind !== SECTION_BLOCK[found[1] ?? '']) {
      throw doesNotParse(line)
    }
    this.endSection(innermost)
    innermost.sections.push(this.newSection(found[2]))
    return true
  }

  private closeBlock(line: number): void {
    const innermost = this.open.pop()
    if (innermost === undefined) throw doesNotParse(line)
    this.endSection(innermost.block)
  }

  private newSection(label: string | undefined): BlockSection {
    const at = this.events.length
    return { label: label === undefined ? [] : textLines(label), from: at, to: at }
  }

  private endSection(block: SequenceBlock): void {
    const last = block.sections.at(-1)
    if (last !== undefined) last.to = this.events.length
  }

  private message({ line, text }: Statement): boolean {
    const arrow = MESSAGE_ARROW.exec(text)
    if (arrow === null) return false
    const syntax = MESSAGE_ARROWS[arrow[0]]
    const rest = text.slice(arrow.index + arrow[0].length).replace(ACTIVATION, '')
    const colon = rest.indexOf(':')
    if (syntax === undefined || colon < 0) throw doesNotParse(line)
    const from = this.participant(text.slice(0, arrow.index).trim(), line)
    const to = this.participant(rest.slice(0, colon).trim(), line)
    if (this.numbered !== null) this.numbered += 1
    this.events.push({
      kind: 'message',
      from,
      to,
      ...syntax,
      text: textLines(rest.slice(colon + 1)),
      number: this.numbered,
    })
    return true
  }
}

function flowDirection(
  header: Statement,
  keyword: string,
  written: string | undefined,
): FlowDirection {
  if (written === undefined) return 'TD'
  const direction = DRAWN_DIRECTIONS[written]
  if (direction !== undefined) return direction
  if (REFUSED_DIRECTIONS.has(written)) throw notDrawnYet(header.line, `${keyword} ${written}`)
  throw doesNotParse(header.line)
}

function unknownHeader(header: Statement): DiagramFault {
  const kind = DIAGRAM_KIND.exec(header.text)?.[1]
  if (kind === undefined || kind === SEQUENCE_HEADER) return doesNotParse(header.line)
  return notDrawnYet(header.line, kind)
}

function builderOf(header: Statement): FlowchartBuilder | SequenceBuilder {
  const flow = FLOW_HEADER.exec(header.text)
  if (flow !== null) {
    return new FlowchartBuilder(flowDirection(header, flow[1] ?? '', flow[2]))
  }
  if (header.text === SEQUENCE_HEADER) return new SequenceBuilder()
  throw unknownHeader(header)
}

function parsed(statements: readonly Statement[]): MermaidDiagram | Refusal {
  const [header, ...body] = statements
  if (header === undefined) {
    return { kind: 'refused', reason: 'the block is empty', line: null, limit: null }
  }
  try {
    const builder = builderOf(header)
    for (const statement of body) builder.add(statement)
    return builder.build()
  } catch (error) {
    if (!(error instanceof DiagramFault)) throw error
    return error.refusal
  }
}

export function parseMermaid(source: string): MermaidDiagram | Refusal {
  const lines = sourceLines(source)
  const statements = statementsOf(lines)
  if (statements.length === 0) return parsed(statements)
  return (
    limitRefusal('lines', lines.length) ??
    limitRefusal('characters', Array.from(lines.join('\n')).length) ??
    parsed(statements)
  )
}
