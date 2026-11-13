import { shown, shownLabel, widestLabel } from './flowchart'
import { PLAIN_LOOKS, plainLabel, type InkedDrawing, type Looks } from './ink'
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
import { drawStack, rowWidth, type Piece, type Stack } from './stack'
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

function stackOf(diagram: EntityDiagram): Stack {
  const index = new Map(diagram.entities.map((entity, at) => [entity.id, at]))
  const attributes = attributeRows(diagram.entities)
  return {
    boxes: diagram.entities.map((entity, at) => ({
      title: [shownLabel(entity.label)],
      body: attributes[at] ?? [],
    })),
    links: diagram.relations.map((relation) => {
      const label = relation.label.trim()
      return {
        from: index.get(relation.from) ?? 0,
        to: index.get(relation.to) ?? 0,
        stroke: relation.stroke,
        fromEnd: { mark: null, text: plainLabel(relation.fromCard) },
        toEnd: { mark: null, text: plainLabel(relation.toCard) },
        label: label === '' ? [] : [shownLabel(label)],
      }
    }),
  }
}

export function drawEntities(diagram: EntityDiagram, width: number): InkedDrawing | Refusal {
  return drawStack(stackOf(diagram), width)
}
