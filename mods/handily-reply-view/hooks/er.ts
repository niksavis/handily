import { MOST_ROWS, ROUNDED_CORNERS, shown, shownLabel, tooWide, widestLabel } from './flowchart'
import {
  drawingOf,
  PLAIN_LOOKS,
  plainLabel,
  prefixed,
  type Ink,
  type InkedDrawing,
  type Label,
  type Looks,
} from './ink'
import {
  DiagramFault,
  doesNotParse,
  lineFault,
  notDrawnYet,
  refuseOverLimits,
  type Refusal,
  type Statement,
  type Stroke,
} from './mermaid'
import { Grid } from './sequence'
import { displayWidth } from './width'

export const MOST_ATTRIBUTES = 12

export type Cardinality = '1' | '0..1' | '0..n' | '1..n'

export type Attribute = { type: string; name: string; keys: string; comment: string }

export type Entity = { id: string; label: string; attributes: Attribute[] }

export type EntityRelation = {
  from: string
  to: string
  fromCard: Cardinality
  toCard: Cardinality
  stroke: Stroke
  label: string
}

export type EntityDiagram = { kind: 'er'; entities: Entity[]; relations: EntityRelation[] }

const ENTITY = String.raw`"[^"]*"|[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*`
const STYLE_CLASS = String.raw`(?::::[\p{L}\p{N}_-]+(?:,[\p{L}\p{N}_-]+)*)?`
const LEFT_CARDINALITY = String.raw`\|o|\|\||\}o|\}\|`
const RIGHT_CARDINALITY = String.raw`o\||\|\||o\{|\|\{`
const CARDINALITY_WORDS = String.raw`one or zero|zero or one|one or more|one or many|many\(1\)|1\+|zero or more|zero or many|many\(0\)|0\+|only one|1`
const SYMBOL_RELATION = new RegExp(
  String.raw`^(${ENTITY})${STYLE_CLASS}\s*(${LEFT_CARDINALITY})(--|\.\.)(${RIGHT_CARDINALITY})\s*(${ENTITY})${STYLE_CLASS}\s*:(.*)$`,
  'u',
)
const WORD_RELATION = new RegExp(
  String.raw`^(${ENTITY})${STYLE_CLASS}\s+(${CARDINALITY_WORDS})\s+(optionally to|to)\s+(${CARDINALITY_WORDS})\s+(${ENTITY})${STYLE_CLASS}\s*:(.*)$`,
  'u',
)
const LOOSE_RELATION = new RegExp(
  String.raw`^(?:${ENTITY})${STYLE_CLASS}\s*(\S*(?:--|\.\.)\S*)\s*(?:${ENTITY})${STYLE_CLASS}\s*:`,
  'u',
)
const DECLARATION = new RegExp(
  String.raw`^(${ENTITY})(?:\[("[^"]*"|[^\]"]+)\])?${STYLE_CLASS}\s*(\{\s*\}|\{)?$`,
  'u',
)
const ATTRIBUTE = new RegExp(
  String.raw`^(\p{L}[\p{L}\p{N}_\-()\[\]]*\??)\s+(\*?[\p{L}_][\p{L}\p{N}_\-()\[\]]*)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$`,
  'u',
)
const KEY_SEPARATOR = /\s*,\s*/
const BODY_END = '}'
const EMPTY_BODY = /^\{\s*\}$/
const QUOTED = /^"([^"]*)"$/
const IGNORED_STATEMENT =
  /^(?:(?:classDef|class|style)\s+\S|acc(?:Title|Descr)\s*:|direction\s+(?:TB|BT|LR|RL)$)/
const SUBGRAPH = /^subgraph(?:\s|$)/
const DASHED = '..'
const OPTIONAL_LINE = 'optionally to'

const SYMBOLS: Readonly<Record<string, Cardinality>> = {
  '|o': '0..1',
  'o|': '0..1',
  '||': '1',
  '}o': '0..n',
  'o{': '0..n',
  '}|': '1..n',
  '|{': '1..n',
}

const WORDS: Readonly<Record<string, Cardinality>> = {
  'one or zero': '0..1',
  'zero or one': '0..1',
  'one or more': '1..n',
  'one or many': '1..n',
  'many(1)': '1..n',
  '1+': '1..n',
  'zero or more': '0..n',
  'zero or many': '0..n',
  'many(0)': '0..n',
  '0+': '0..n',
  'only one': '1',
  '1': '1',
}

const KEY_LOOKS: Looks = { ...PLAIN_LOOKS, isBold: true }
const COLUMN_GAP = '  '
const STUB_ROOM = 4
const CHANNEL_SPACING = 2
const LABEL_GAP = 2

const STROKES: Readonly<Record<Stroke, { across: string; down: string }>> = {
  solid: { across: '─', down: '│' },
  dashed: { across: '╌', down: '╎' },
}

function unquoted(text: string): string {
  return QUOTED.exec(text.trim())?.[1] ?? text.trim()
}

function fault(reason: string): DiagramFault {
  return new DiagramFault({ kind: 'refused', reason, line: null, limit: null })
}

type RelationParts = {
  first: string
  second: string
  firstCard: Cardinality | undefined
  secondCard: Cardinality | undefined
  stroke: Stroke
  label: string
}

function symbolParts(text: string): RelationParts | null {
  const found = SYMBOL_RELATION.exec(text)
  if (found === null) return null
  return {
    first: found[1] ?? '',
    second: found[5] ?? '',
    firstCard: SYMBOLS[found[2] ?? ''],
    secondCard: SYMBOLS[found[4] ?? ''],
    stroke: found[3] === DASHED ? 'dashed' : 'solid',
    label: found[6] ?? '',
  }
}

function wordParts(text: string): RelationParts | null {
  const found = WORD_RELATION.exec(text)
  if (found === null) return null
  return {
    first: found[1] ?? '',
    second: found[5] ?? '',
    firstCard: WORDS[found[2] ?? ''],
    secondCard: WORDS[found[4] ?? ''],
    stroke: found[3] === OPTIONAL_LINE ? 'dashed' : 'solid',
    label: found[6] ?? '',
  }
}

export class EntityBuilder {
  private readonly entities = new Map<string, Entity>()
  private readonly relations: EntityRelation[] = []
  private open: Entity | null = null

  add(statement: Statement): void {
    const { line, text } = statement
    if (this.open !== null) {
      this.addToBody(this.open, text, line)
      return
    }
    if (IGNORED_STATEMENT.test(text)) return
    if (SUBGRAPH.test(text)) throw notDrawnYet(line, 'subgraph')
    if (this.relate(text, line) || this.declare(text)) return
    const cardinality = LOOSE_RELATION.exec(text)?.[1]
    if (cardinality !== undefined) {
      throw lineFault(line, `line ${String(line)}: the cardinality ${cardinality} does not parse`)
    }
    throw doesNotParse(line)
  }

  build(): EntityDiagram {
    if (this.open !== null) throw fault(`entity ${this.open.label} has no closing brace`)
    if (this.entities.size === 0) throw fault('the ER diagram has no entities')
    for (const entity of this.entities.values()) {
      if (entity.attributes.length > MOST_ATTRIBUTES) {
        throw fault(
          `entity ${entity.label} has ${String(entity.attributes.length)} attributes, at most ${String(MOST_ATTRIBUTES)} draw`,
        )
      }
    }
    refuseOverLimits([
      ['boxes', this.entities.size],
      ['edges', this.relations.length],
    ])
    return { kind: 'er', entities: [...this.entities.values()], relations: this.relations }
  }

  private entity(written: string): Entity {
    const id = unquoted(written)
    const known = this.entities.get(id)
    if (known !== undefined) return known
    const made: Entity = { id, label: id, attributes: [] }
    this.entities.set(id, made)
    return made
  }

  private addToBody(entity: Entity, text: string, line: number): void {
    if (text === BODY_END) {
      this.open = null
      return
    }
    const found = ATTRIBUTE.exec(text)
    if (found === null) throw doesNotParse(line)
    entity.attributes.push({
      type: found[1] ?? '',
      name: found[2] ?? '',
      keys: (found[3] ?? '').split(KEY_SEPARATOR).filter(Boolean).join(', '),
      comment: found[4] ?? '',
    })
  }

  private relate(text: string, line: number): boolean {
    const parts = symbolParts(text) ?? wordParts(text)
    if (parts === null) return false
    const from = this.entity(parts.first)
    const to = this.entity(parts.second)
    if (parts.firstCard === undefined || parts.secondCard === undefined) throw doesNotParse(line)
    if (from === to) {
      throw lineFault(line, 'a relationship from an entity to itself does not draw yet')
    }
    this.relations.push({
      from: from.id,
      to: to.id,
      fromCard: parts.firstCard,
      toCard: parts.secondCard,
      stroke: parts.stroke,
      label: unquoted(parts.label),
    })
    return true
  }

  private declare(text: string): boolean {
    const found = DECLARATION.exec(text)
    if (found === null) return false
    const entity = this.entity(found[1] ?? '')
    if (found[2] !== undefined) entity.label = unquoted(found[2])
    const body = found[3]
    if (body !== undefined && !EMPTY_BODY.test(body)) this.open = entity
    return true
  }
}

type Piece = { text: string; ink: Ink; looks: Looks }

type Side = { relation: EntityRelation; upper: number; lower: number; channel: number }

type Stub = { side: Side; text: Label; row: number }

type BoxPlan = { title: Label; rows: Piece[][]; height: number; stubs: Stub[] }

type Columns = { keys: number; name: number; type: number; comment: number }

function columnsOf(attributes: readonly Attribute[]): Columns {
  const most = (pick: (attribute: Attribute) => string) =>
    Math.max(0, ...attributes.map((attribute) => displayWidth(shown(pick(attribute)))))
  return {
    keys: most((attribute) => attribute.keys),
    name: most((attribute) => attribute.name),
    type: most((attribute) => attribute.type),
    comment: most((attribute) => attribute.comment),
  }
}

function padded(text: string, columns: number): string {
  return text + ' '.repeat(Math.max(0, columns - displayWidth(text)))
}

function attributeRow(attribute: Attribute, columns: Columns): Piece[] {
  const pieces: Piece[] = []
  if (columns.keys > 0) {
    pieces.push({ text: shown(attribute.keys), ink: 'plain', looks: KEY_LOOKS })
    pieces.push({
      text: padded('', columns.keys - displayWidth(attribute.keys) + 1),
      ink: 'plain',
      looks: PLAIN_LOOKS,
    })
  }
  pieces.push({
    text: padded(shown(attribute.name), columns.name) + COLUMN_GAP,
    ink: 'plain',
    looks: PLAIN_LOOKS,
  })
  const type =
    columns.comment > 0 ? padded(shown(attribute.type), columns.type) : shown(attribute.type)
  pieces.push({ text: type, ink: 'label', looks: PLAIN_LOOKS })
  if (attribute.comment !== '') {
    pieces.push({ text: COLUMN_GAP + shown(attribute.comment), ink: 'label', looks: PLAIN_LOOKS })
  }
  return pieces
}

function rowWidth(pieces: readonly Piece[]): number {
  return displayWidth(
    pieces
      .map((piece) => piece.text)
      .join('')
      .trimEnd(),
  )
}

function sidesOf(diagram: EntityDiagram, index: ReadonlyMap<string, number>) {
  const centers = new Map<number, EntityRelation>()
  const sides: Omit<Side, 'channel'>[] = []
  for (const relation of diagram.relations) {
    const from = index.get(relation.from) ?? 0
    const to = index.get(relation.to) ?? 0
    if (to === from + 1 && !centers.has(from)) {
      centers.set(from, relation)
      continue
    }
    sides.push({ relation, upper: Math.min(from, to), lower: Math.max(from, to) })
  }
  const ordered = sides
    .map((side, order) => ({ side, order }))
    .sort(
      (one, other) =>
        one.side.lower - one.side.upper - (other.side.lower - other.side.upper) ||
        one.order - other.order,
    )
    .map(({ side }, channel) => ({ ...side, channel }))
  return { centers, sides: ordered }
}

function stubText(side: Side, isUpper: boolean, index: ReadonlyMap<string, number>): Label {
  const { relation } = side
  const fromIsUpper = (index.get(relation.from) ?? 0) === side.upper
  const ownsLabel = fromIsUpper === isUpper
  const card = ownsLabel ? relation.fromCard : relation.toCard
  const label = relation.label.trim()
  return ownsLabel && label !== '' ? prefixed(`${card} `, shownLabel(label)) : plainLabel(card)
}

function centerLines(relation: EntityRelation): Label[] {
  const label = relation.label.trim()
  return [
    plainLabel(relation.fromCard),
    ...(label === '' ? [] : [shownLabel(label)]),
    plainLabel(relation.toCard),
  ]
}

function attributeRows(entities: readonly Entity[]): Piece[][][] {
  const shared = columnsOf(entities.flatMap((entity) => entity.attributes))
  const own = entities.map((entity) => {
    const columns = columnsOf(entity.attributes)
    return entity.attributes.map((attribute) => attributeRow(attribute, columns))
  })
  const together = entities.map((entity) =>
    entity.attributes.map((attribute) => attributeRow(attribute, shared)),
  )
  const widestOf = (boxes: readonly Piece[][][]) =>
    Math.max(0, ...boxes.flatMap((rows) => rows.map(rowWidth)))
  const titles = widestLabel(entities.map((entity) => shownLabel(entity.label)))
  return widestOf(together) <= Math.max(titles, widestOf(own)) ? together : own
}

function boxPlans(
  diagram: EntityDiagram,
  sides: readonly Side[],
  index: ReadonlyMap<string, number>,
): BoxPlan[] {
  const attributes = attributeRows(diagram.entities)
  return diagram.entities.map((entity, at) => {
    const rows = attributes[at] ?? []
    const entries = sides
      .filter((side) => side.lower === at)
      .sort((one, other) => one.channel - other.channel)
    const exits = sides
      .filter((side) => side.upper === at)
      .sort((one, other) => other.channel - one.channel)
    const ruleRows = rows.length > 0 ? 1 : 0
    const last = 1 + ruleRows + rows.length
    const free = [1, ...rows.map((_, row) => 2 + ruleRows + row)]
    for (let row = last + 1; free.length < entries.length + exits.length; row++) free.push(row)
    const stubs = [
      ...entries.map((side) => ({ side, isUpper: false })),
      ...exits.map((side) => ({ side, isUpper: true })),
    ].map(({ side, isUpper }, order) => ({
      side,
      text: stubText(side, isUpper, index),
      row: free[order] ?? 1,
    }))
    const height = Math.max(last, ...stubs.map((stub) => stub.row)) + 2
    return { title: shownLabel(entity.label), rows, height, stubs }
  })
}

function drawBox(grid: Grid, plan: BoxPlan, top: number, width: number, ink: Ink): void {
  const [topLeft, topRight, bottomLeft, bottomRight] = ROUNDED_CORNERS
  const across = STROKES.solid.across.repeat(width - 2)
  const inside = ' '.repeat(width - 2)
  grid.put(top, 0, `${topLeft}${across}${topRight}`, ink)
  for (let row = top + 1; row < top + plan.height - 1; row++) {
    grid.put(row, 0, `${STROKES.solid.down}${inside}${STROKES.solid.down}`, ink)
  }
  grid.putLabel(top + 1, 2, plan.title, ink)
  if (plan.rows.length > 0) grid.put(top + 2, 0, `├${across}┤`, ink)
  plan.rows.forEach((pieces, at) => {
    let col = 2
    for (const piece of pieces) {
      grid.put(top + 3 + at, col, piece.text, piece.ink, piece.looks)
      col += displayWidth(piece.text)
    }
  })
  grid.put(top + plan.height - 1, 0, `${bottomLeft}${across}${bottomRight}`, ink)
}

type Layout = {
  plans: BoxPlan[]
  tops: number[]
  height: number
  boxWidth: number
  channelLeft: number
  columns: number
  centers: Map<number, EntityRelation>
  sides: Side[]
}

function layoutOf(diagram: EntityDiagram): Layout {
  const index = new Map(diagram.entities.map((entity, at) => [entity.id, at]))
  const { centers, sides } = sidesOf(diagram, index)
  const plans = boxPlans(diagram, sides, index)
  const inner = Math.max(
    ...plans.map((plan) => Math.max(widestLabel([plan.title]), ...plan.rows.map(rowWidth))),
  )
  const boxWidth = inner + 4
  const middle = Math.floor(boxWidth / 2)
  const tops: number[] = []
  let height = 0
  plans.forEach((plan, at) => {
    tops.push(height)
    height += plan.height
    const center = centers.get(at)
    if (at < plans.length - 1) height += center === undefined ? 1 : centerLines(center).length
  })
  const centerRight = Math.max(
    boxWidth,
    ...[...centers.values()].map(
      (relation) => middle + LABEL_GAP + widestLabel(centerLines(relation)),
    ),
  )
  const stubRight = Math.max(
    0,
    ...plans.flatMap((plan) =>
      plan.stubs.map((stub) => boxWidth + displayWidth(stub.text.text) + STUB_ROOM),
    ),
  )
  const channelLeft = Math.max(stubRight, centerRight + 1)
  const columns =
    sides.length === 0 ? centerRight : channelLeft + CHANNEL_SPACING * (sides.length - 1) + 1
  return { plans, tops, height, boxWidth, channelLeft, columns, centers, sides }
}

function drawCenter(grid: Grid, layout: Layout, at: number, relation: EntityRelation): void {
  const middle = Math.floor(layout.boxWidth / 2)
  const above = layout.tops[at] ?? 0
  const bottom = above + (layout.plans[at]?.height ?? 0) - 1
  grid.put(bottom, middle, '┬', at)
  grid.put(layout.tops[at + 1] ?? 0, middle, '┴', at + 1)
  centerLines(relation).forEach((line, row) => {
    grid.put(bottom + 1 + row, middle, STROKES[relation.stroke].down, 'line')
    grid.putLabel(bottom + 1 + row, middle + LABEL_GAP, line, 'label')
  })
}

function drawStubs(grid: Grid, layout: Layout): Map<Side, number[]> {
  const rows = new Map<Side, number[]>()
  layout.plans.forEach((plan, at) => {
    for (const stub of plan.stubs) {
      const row = (layout.tops[at] ?? 0) + stub.row
      const column = layout.channelLeft + CHANNEL_SPACING * stub.side.channel
      const { across } = STROKES[stub.side.relation.stroke]
      const isUpper = stub.side.upper === at
      grid.put(row, layout.boxWidth - 1, '├', at)
      grid.put(row, layout.boxWidth, across.repeat(column - layout.boxWidth), 'line')
      grid.put(row, layout.boxWidth + 1, ' ', 'line')
      grid.putLabel(row, layout.boxWidth + 2, stub.text, 'label')
      grid.put(row, layout.boxWidth + 2 + displayWidth(stub.text.text), ' ', 'line')
      grid.put(row, column, isUpper ? '┐' : '┘', 'line')
      rows.set(stub.side, [...(rows.get(stub.side) ?? []), row])
    }
  })
  return rows
}

function drawChannels(grid: Grid, layout: Layout, rows: ReadonlyMap<Side, number[]>): void {
  for (const side of layout.sides) {
    const ends = rows.get(side) ?? []
    const column = layout.channelLeft + CHANNEL_SPACING * side.channel
    const { down } = STROKES[side.relation.stroke]
    for (let row = Math.min(...ends) + 1; row < Math.max(...ends); row++) {
      grid.put(row, column, down, 'line')
    }
  }
}

export function drawEntities(diagram: EntityDiagram, width: number): InkedDrawing | Refusal {
  const layout = layoutOf(diagram)
  if (layout.columns > width) return tooWide(layout.columns, width)
  if (layout.height > MOST_ROWS) {
    return {
      kind: 'refused',
      reason: `${String(layout.height)} rows, at most ${String(MOST_ROWS)} draw`,
      line: null,
      limit: null,
    }
  }
  const grid = new Grid()
  layout.plans.forEach((plan, at) => {
    drawBox(grid, plan, layout.tops[at] ?? 0, layout.boxWidth, at)
  })
  layout.centers.forEach((relation, at) => {
    drawCenter(grid, layout, at, relation)
  })
  drawChannels(grid, layout, drawStubs(grid, layout))
  return drawingOf(
    Array.from({ length: layout.height }, (_, row) => grid.line(row, 0, layout.columns - 1)),
  )
}
