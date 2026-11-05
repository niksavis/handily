import { shownLabel } from './flowchart'
import { PLAIN_LOOKS, relabelled, type InkedDrawing, type Label } from './ink'
import {
  AccessibilityLines,
  DiagramFault,
  doesNotParse,
  lineFault,
  refuseOverLimits,
  textLines,
  type Refusal,
  type Statement,
} from './mermaid'
import { withLooks } from './outline'
import { drawStack, stackOrder, type Piece, type Stack, type StackBox } from './stack'
import { wrapCell } from './table'
import { displayWidth } from './width'

export type RequirementField = { key: string; value: string[] }

export type RequirementBox = {
  name: string
  type: string
  isElement: boolean
  fields: RequirementField[]
}

export type RequirementRelation = { from: string; to: string; type: string }

export type RequirementDiagram = {
  kind: 'requirement'
  boxes: RequirementBox[]
  relations: RequirementRelation[]
}

type FieldSyntax = { key: string; values: Readonly<Record<string, string>> | null }

type OpenBox = { box: RequirementBox; keys: Readonly<Record<string, FieldSyntax>>; line: number }

type WrittenRelation = RequirementRelation & { line: number }

const HEADER = 'requirement'
const DRAWN_HEADER = 'requirementdiagram'
const REQUIREMENT_TYPES: Readonly<Record<string, string>> = {
  requirement: 'Requirement',
  functionalrequirement: 'Functional Requirement',
  interfacerequirement: 'Interface Requirement',
  performancerequirement: 'Performance Requirement',
  physicalrequirement: 'Physical Requirement',
  designconstraint: 'Design Constraint',
}
const ELEMENT = 'element'
const ELEMENT_TYPE = 'Element'
const RISKS: Readonly<Record<string, string>> = { low: 'Low', medium: 'Medium', high: 'High' }
const METHODS: Readonly<Record<string, string>> = {
  analysis: 'Analysis',
  demonstration: 'Demonstration',
  inspection: 'Inspection',
  test: 'Test',
}
const REQUIREMENT_FIELDS: Readonly<Record<string, FieldSyntax>> = {
  id: { key: 'ID', values: null },
  text: { key: 'Text', values: null },
  risk: { key: 'Risk', values: RISKS },
  verifymethod: { key: 'Verification', values: METHODS },
}
const ELEMENT_FIELDS: Readonly<Record<string, FieldSyntax>> = {
  type: { key: 'Type', values: null },
  docref: { key: 'Doc Ref', values: null },
}
const RELATIONS: ReadonlySet<string> = new Set([
  'contains',
  'copies',
  'derives',
  'satisfies',
  'verifies',
  'refines',
  'traces',
])
const CONTAINS = 'contains'
const KEYWORDS: ReadonlySet<string> = new Set([
  'title',
  'requirementdiagram',
  'id',
  'text',
  'risk',
  'verifymethod',
  ...Object.keys(REQUIREMENT_TYPES),
  ...Object.keys(RISKS),
  ...Object.keys(METHODS),
  ELEMENT,
  ...RELATIONS,
  'type',
  'docref',
  'style',
  'classdef',
  'class',
])
const NAME = String.raw`"[^"]*"|\w[^:,{<>\-="]*`
const FORWARD = new RegExp(String.raw`^(${NAME})\s*-\s*([A-Za-z]+)\s*->\s*(${NAME})$`)
const BACKWARD = new RegExp(String.raw`^(${NAME})\s*<-\s*([A-Za-z]+)\s*-\s*(${NAME})$`)
const DEFINITION = /^([A-Za-z]+)\b\s*(.*?)\s*\{$/
const STYLE_SEPARATOR = ':::'
const CLASS_ASSIGNMENT = new RegExp(String.raw`^(?:${NAME}):::`)
const STYLE_STATEMENT = /^(?:style|classDef|class)(?=\s|$)/i
const DIRECTION = /direction\s+(?:TB|BT|RL|LR)/i
const HASH_COMMENT = /^#/
const FIELD = /^([A-Za-z]+)\s*:\s*(.*)$/
const QUOTED = /^"([^"]*)"$/
const UNQUOTED = /^\w[^:,{<>\-=]*$/
const FIRST_WORD = /^\w+/
const BODY_END = '}'
const NARROWER_WRAPS: readonly number[] = [48, 40, 36, 32, 28, 24, 22, 20, 18, 16, 14, 12]
const LEAST_VALUE_COLUMNS = 10
const HANGING_INDENT = '  '
const KEY_INK = 'label'
const NAME_LOOKS = { isBold: true }

function fault(reason: string): DiagramFault {
  return new DiagramFault({ kind: 'refused', reason, line: null, limit: null })
}

function isKeyword(word: string): boolean {
  return KEYWORDS.has(word.toLowerCase())
}

function valueOf(raw: string, line: number): string {
  const text = raw.trim()
  const quoted = QUOTED.exec(text)
  if (quoted !== null) return quoted[1] ?? ''
  const word = FIRST_WORD.exec(text)?.[0] ?? ''
  if (!UNQUOTED.test(text) || isKeyword(word)) throw doesNotParse(line)
  return text
}

export class RequirementBuilder {
  private readonly boxes = new Map<string, RequirementBox>()
  private readonly relations: WrittenRelation[] = []
  private readonly accessibility = new AccessibilityLines()
  private open: OpenBox | null = null

  add(statement: Statement): void {
    const { line, text } = statement
    if (HASH_COMMENT.test(text)) return
    if (this.open !== null) {
      this.addField(this.open, text, line)
      return
    }
    if (this.accessibility.skips(text) || DIRECTION.test(text)) return
    if (STYLE_STATEMENT.test(text)) return
    if (this.relate(text, line) || this.define(text, line)) return
    if (CLASS_ASSIGNMENT.test(text)) return
    throw doesNotParse(line)
  }

  build(): RequirementDiagram {
    if (this.open !== null) {
      const { box, line } = this.open
      throw lineFault(
        line,
        `${box.isElement ? 'element' : 'requirement'} ${box.name} has no closing brace`,
      )
    }
    if (this.boxes.size === 0)
      throw fault('the requirement diagram has no requirements or elements')
    for (const relation of this.relations) {
      for (const name of [relation.from, relation.to]) {
        if (!this.boxes.has(name)) {
          throw lineFault(
            relation.line,
            `line ${String(relation.line)}: no requirement or element has the name ${name}`,
          )
        }
      }
      if (relation.from === relation.to) {
        throw lineFault(relation.line, 'a relationship from a box to itself does not draw yet')
      }
    }
    refuseOverLimits([
      ['boxes', this.boxes.size],
      ['edges', this.relations.length],
    ])
    return {
      kind: 'requirement',
      boxes: [...this.boxes.values()],
      relations: this.relations.map(({ from, to, type }) => ({ from, to, type })),
    }
  }

  private relate(text: string, line: number): boolean {
    const forward = FORWARD.exec(text)
    const backward = forward === null ? BACKWARD.exec(text) : null
    const found = forward ?? backward
    if (found === null) return false
    const type = (found[2] ?? '').toLowerCase()
    if (!RELATIONS.has(type)) throw doesNotParse(line)
    const left = valueOf(found[1] ?? '', line)
    const right = valueOf(found[3] ?? '', line)
    const [from, to] = forward === null ? [right, left] : [left, right]
    this.relations.push({ from, to, type, line })
    return true
  }

  private define(text: string, line: number): boolean {
    const found = DEFINITION.exec(text)
    const keyword = (found?.[1] ?? '').toLowerCase()
    const type = keyword === ELEMENT ? ELEMENT_TYPE : REQUIREMENT_TYPES[keyword]
    if (found === null || type === undefined) return false
    const written = found[2] ?? ''
    const separator = written.indexOf(STYLE_SEPARATOR)
    const name = valueOf(separator < 0 ? written : written.slice(0, separator), line)
    const isElement = keyword === ELEMENT
    const known = this.boxes.get(name)
    if (known !== undefined && known.isElement !== isElement) {
      throw lineFault(line, `line ${String(line)}: the name ${name} is in use already`)
    }
    const box = known ?? { name, type, isElement, fields: [] }
    const keys = isElement ? ELEMENT_FIELDS : REQUIREMENT_FIELDS
    this.open = { box: known === undefined ? box : { ...box, fields: [] }, keys, line }
    if (known === undefined) this.boxes.set(name, box)
    return true
  }

  private addField(open: OpenBox, text: string, line: number): void {
    if (text === BODY_END) {
      this.open = null
      return
    }
    const found = DIRECTION.test(text) ? null : FIELD.exec(text)
    const syntax = open.keys[(found?.[1] ?? '').toLowerCase()]
    const raw = (found?.[2] ?? '').trim()
    if (syntax === undefined || raw === '') throw doesNotParse(line)
    const value = syntax.values === null ? valueOf(raw, line) : syntax.values[raw.toLowerCase()]
    if (value === undefined) throw doesNotParse(line)
    if (open.box.fields.some((field) => field.key === syntax.key)) return
    open.box.fields.push({ key: syntax.key, value: textLines(value) })
  }
}

export function requirementBuilder(header: Statement): RequirementBuilder | null {
  if (!header.text.startsWith(HEADER)) return null
  if (header.text.toLowerCase() !== DRAWN_HEADER) throw doesNotParse(header.line)
  return new RequirementBuilder()
}

function wrappedLabel(label: Label, wrap: number | null): Label[] {
  return wrap === null ? [label] : relabelled(label, wrapCell(label.text, wrap))
}

function keyPiece(text: string): Piece {
  return { text, ink: KEY_INK, looks: PLAIN_LOOKS }
}

function labelPieces(label: Label): Piece[] {
  return label.runs.map((run) => ({ text: run.text, ink: 'plain', looks: run.looks }))
}

function fieldRows(field: RequirementField, wrap: number | null): Piece[][] {
  const key = `${field.key}: `
  const keyWidth = displayWidth(key)
  const values = field.value.map(shownLabel)
  const isBeside = wrap === null || wrap - keyWidth >= LEAST_VALUE_COLUMNS
  if (isBeside) {
    const room = wrap === null ? null : wrap - keyWidth
    const lines = values.flatMap((value) => wrappedLabel(value, room))
    const indent = ' '.repeat(keyWidth)
    return lines.map((value, at) => [keyPiece(at === 0 ? key : indent), ...labelPieces(value)])
  }
  const lines = values.flatMap((value) => wrappedLabel(value, wrap - HANGING_INDENT.length))
  return [
    [keyPiece(key.trimEnd())],
    ...lines.map((value) => [keyPiece(HANGING_INDENT), ...labelPieces(value)]),
  ]
}

function stackBoxOf(box: RequirementBox, wrap: number | null): StackBox {
  const type = shownLabel(`«${box.type}»`)
  const name = withLooks(shownLabel(box.name), NAME_LOOKS)
  return {
    title: [...wrappedLabel(type, wrap), ...wrappedLabel(name, wrap)],
    body: box.fields.flatMap((field) => fieldRows(field, wrap)),
  }
}

function stackOf(diagram: RequirementDiagram, wrap: number | null): Stack {
  const index = new Map(diagram.boxes.map((box, at) => [box.name, at]))
  const ties = diagram.relations.map((relation) => ({
    from: index.get(relation.from) ?? 0,
    to: index.get(relation.to) ?? 0,
    rank: relation.type === CONTAINS ? 0 : 1,
  }))
  const order = stackOrder(diagram.boxes.length, ties)
  const place = new Map(order.map((at, position) => [diagram.boxes[at]?.name ?? '', position]))
  return {
    boxes: order.flatMap((at) => {
      const box = diagram.boxes[at]
      return box === undefined ? [] : [stackBoxOf(box, wrap)]
    }),
    links: diagram.relations.map((relation) => {
      const isContains = relation.type === CONTAINS
      return {
        from: place.get(relation.from) ?? 0,
        to: place.get(relation.to) ?? 0,
        stroke: isContains ? 'solid' : 'dashed',
        fromEnd: { mark: isContains ? 'circledPlus' : null, text: null },
        toEnd: { mark: isContains ? null : 'arrow', text: null },
        label: [shownLabel(`«${relation.type}»`)],
      }
    }),
  }
}

export function drawRequirements(
  diagram: RequirementDiagram,
  width: number,
): InkedDrawing | Refusal {
  let drawn = drawStack(stackOf(diagram, null), width)
  for (const wrap of NARROWER_WRAPS) {
    if (drawn.kind === 'drawing') return drawn
    drawn = drawStack(stackOf(diagram, wrap), width)
  }
  return drawn
}
