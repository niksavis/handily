import { shownLabel, tooWide, widestLabel } from './flowchart'
import type { Ink, InkedDrawing, InkRun, Label } from './ink'
import {
  doesNotParse,
  lineFault,
  notDrawnYet,
  textLines,
  type Refusal,
  type Statement,
} from './mermaid'
import { drawnOutline, inkedLine, part, wrappedLabel, withLooks, type Part } from './outline'
import { displayWidth } from './width'

export type MindmapShape =
  'default' | 'square' | 'rounded' | 'circle' | 'bang' | 'cloud' | 'hexagon'

export type MindmapNode = { label: string[]; shape: MindmapShape; children: MindmapNode[] }

export type Mindmap = { kind: 'mindmap'; root: MindmapNode }

type ShapeSyntax = { opening: string; closing: string; shape: MindmapShape }

const HEADER = /^mindmap\b/
const DRAWN_HEADER = 'mindmap'
const ICON = /^::icon\(/
const CLASS = /^:::/
const OPENING = /[([{)]/
const BRACKET = /[()[\]{}]/
const QUOTED = /^"([^"]*)"$/
const MARKDOWN_STRING = '"`'
const SHAPES: readonly ShapeSyntax[] = [
  { opening: '((', closing: '))', shape: 'circle' },
  { opening: '))', closing: '((', shape: 'bang' },
  { opening: '{{', closing: '}}', shape: 'hexagon' },
  { opening: '(', closing: ')', shape: 'rounded' },
  { opening: ')', closing: '(', shape: 'cloud' },
  { opening: '[', closing: ']', shape: 'square' },
]

function shapedNode(line: number, text: string): MindmapNode | null {
  const at = text.search(OPENING)
  if (at < 0) return null
  if (BRACKET.test(text.slice(0, at))) throw doesNotParse(line)
  const shaped = text.slice(at)
  for (const { opening, closing, shape } of SHAPES) {
    const fits = shaped.length >= opening.length + closing.length
    if (!fits || !shaped.startsWith(opening) || !shaped.endsWith(closing)) continue
    const inside = shaped.slice(opening.length, shaped.length - closing.length).trim()
    const quoted = QUOTED.exec(inside)
    const label = quoted === null ? inside : (quoted[1] ?? '')
    if (label.trim() === '' || (quoted === null && BRACKET.test(label))) throw doesNotParse(line)
    return { label: textLines(label), shape, children: [] }
  }
  throw doesNotParse(line)
}

function nodeOf({ line, text }: Statement): MindmapNode {
  if (text.includes(MARKDOWN_STRING)) throw notDrawnYet(line, 'markdown strings')
  const shaped = shapedNode(line, text)
  if (shaped !== null) return shaped
  if (BRACKET.test(text)) throw doesNotParse(line)
  return { label: textLines(text), shape: 'default', children: [] }
}

export class MindmapBuilder {
  private root: MindmapNode | null = null
  private readonly open: { indent: number; node: MindmapNode }[] = []

  add(statement: Statement): void {
    const { line, text, indent } = statement
    if (CLASS.test(text)) return
    if (ICON.test(text)) throw notDrawnYet(line, 'icons')
    const node = nodeOf(statement)
    while ((this.open.at(-1)?.indent ?? -1) >= indent) this.open.pop()
    const parent = this.open.at(-1)
    if (parent !== undefined) parent.node.children.push(node)
    else if (this.root === null) this.root = node
    else throw lineFault(line, `line ${String(line)} starts a second root`)
    this.open.push({ indent, node })
  }

  build(): Mindmap | Refusal {
    if (this.root === null) {
      return { kind: 'refused', reason: 'the mindmap has no nodes', line: null, limit: null }
    }
    return { kind: 'mindmap', root: this.root }
  }
}

export function mindmapBuilder(header: Statement): MindmapBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (header.text !== DRAWN_HEADER) throw doesNotParse(header.line)
  return new MindmapBuilder()
}

type Frame = { top: string; bottom: string; sides: string; inset: number }

const ROUNDED: Frame = { top: '╭╮', bottom: '╰╯', sides: '││', inset: 0 }
const SQUARE: Frame = { top: '┌┐', bottom: '└┘', sides: '││', inset: 0 }
const CIRCLE: Frame = { top: '╭╮', bottom: '╰╯', sides: '()', inset: 1 }
const FRAMES: Readonly<Record<MindmapShape, Frame>> = {
  default: ROUNDED,
  rounded: ROUNDED,
  cloud: ROUNDED,
  bang: ROUNDED,
  square: SQUARE,
  hexagon: SQUARE,
  circle: CIRCLE,
}
const ACROSS = '─'
const TRUNK = '┬'
const TRUNK_COLUMN = 2
const ROOT_PADDING = 4
const TRUNK_INDENT = ' '.repeat(TRUNK_COLUMN)
const BRANCH = '├─ '
const LAST_BRANCH = '└─ '
const THROUGH = '│  '
const PAST = '   '
const LEAST_LABEL_COLUMNS = 10
const ROOT_INK: Ink = 'head'
const LINE_INK: Ink = 'line'

type Tree = { width: number; lines: InkRun[][]; needed: number }

function labelOf(lines: readonly string[]): Label[] {
  return lines.map(shownLabel).filter((line) => line.text.trim() !== '')
}

function wrappedLines(labels: readonly Label[], width: number): Label[] {
  return labels.flatMap((label) => wrappedLabel(label, width))
}

function rim(frame: Frame, corners: string, across: string): Part {
  return part(`${' '.repeat(frame.inset)}${corners[0] ?? ''}${across}${corners[1] ?? ''}`, ROOT_INK)
}

function rootLines(tree: Tree, root: MindmapNode): void {
  const labels = labelOf(root.label)
  tree.needed = Math.max(
    tree.needed,
    Math.min(widestLabel(labels), LEAST_LABEL_COLUMNS) + ROOT_PADDING,
  )
  const lines = wrappedLines(labels, tree.width - ROOT_PADDING)
  const inner = widestLabel(lines)
  const frame = FRAMES[root.shape]
  const across = inner + 2 - 2 * frame.inset
  const [left = '', right = ''] = Array.from(frame.sides)
  tree.lines.push(inkedLine([rim(frame, frame.top, ACROSS.repeat(across))]))
  for (const line of lines) {
    const pad = ' '.repeat(inner - displayWidth(line.text))
    tree.lines.push(
      inkedLine([
        part(`${left} `, ROOT_INK),
        { label: line, ink: ROOT_INK },
        part(`${pad} ${right}`, ROOT_INK),
      ]),
    )
  }
  const before = TRUNK_COLUMN - 1 - frame.inset
  const trunk = root.children.length === 0 ? ACROSS : TRUNK
  const bottom = ACROSS.repeat(before) + trunk + ACROSS.repeat(across - before - 1)
  tree.lines.push(inkedLine([rim(frame, frame.bottom, bottom)]))
}

function branchLines(
  tree: Tree,
  node: MindmapNode,
  prefix: string,
  isLast: boolean,
  ink: Ink,
  depth: number,
): void {
  const column = displayWidth(prefix) + displayWidth(BRANCH)
  const labels = labelOf(node.label)
  const styled = depth === 1 ? labels.map((label) => withLooks(label, { isBold: true })) : labels
  tree.needed = Math.max(tree.needed, column + Math.min(widestLabel(labels), LEAST_LABEL_COLUMNS))
  const lines = wrappedLines(styled, tree.width - column)
  const lead: Part = part(prefix, LINE_INK)
  lines.forEach((line, index) => {
    const mark = index === 0 ? (isLast ? LAST_BRANCH : BRANCH) : isLast ? PAST : THROUGH
    tree.lines.push(inkedLine([lead, part(mark, LINE_INK), { label: line, ink }]))
  })
  const inner = prefix + (isLast ? PAST : THROUGH)
  node.children.forEach((child, index) => {
    branchLines(tree, child, inner, index === node.children.length - 1, ink, depth + 1)
  })
}

export function drawMindmap(mindmap: Mindmap, width: number): InkedDrawing | Refusal {
  const tree: Tree = { width, lines: [], needed: 0 }
  const { root } = mindmap
  rootLines(tree, root)
  root.children.forEach((child, index) => {
    branchLines(tree, child, TRUNK_INDENT, index === root.children.length - 1, index, 1)
  })
  if (tree.needed > width) return tooWide(tree.needed, width)
  return drawnOutline(tree.lines)
}
