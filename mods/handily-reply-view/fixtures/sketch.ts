import { displayWidth } from '../hooks/width'

export type DrawnNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

export function isDrawnNode(value: unknown): value is DrawnNode {
  return typeof value === 'object' && value !== null
}

function numberProp(node: unknown, name: string): number {
  if (!isDrawnNode(node)) return 0
  const value = node.props?.[name]
  return typeof value === 'number' ? value : 0
}

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0)
}

export function plainText(node: unknown): string {
  if (typeof node === 'string') return node
  if (!isDrawnNode(node)) return ''
  return (node.children ?? []).map(plainText).join('')
}

export function textStrings(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (!isDrawnNode(node)) return []
  return (node.children ?? []).flatMap(textStrings)
}

export function nodesOf(node: unknown): DrawnNode[] {
  if (!isDrawnNode(node)) return []
  return [node, ...(node.children ?? []).flatMap(nodesOf)]
}

export function padded(line: string, width: number): string {
  return line + ' '.repeat(Math.max(width - displayWidth(line), 0))
}

function cutTo(line: string, width: number): string {
  let shown = ''
  for (const character of Array.from(line)) {
    if (displayWidth(shown + character) > width) break
    shown += character
  }
  return shown
}

function wrappedAt(line: string, width: number): string[] {
  if (displayWidth(line) <= width) return [line]
  const rows: string[] = []
  let row = ''
  for (const word of line.split(' ')) {
    const joined = row === '' ? word : `${row} ${word}`
    if (row !== '' && displayWidth(joined) > width) {
      rows.push(row)
      row = word
    } else {
      row = joined
    }
  }
  return [...rows, row]
}

function isGrower(node: unknown): boolean {
  return numberProp(node, 'flexGrow') > 0
}

function isAbsolute(node: unknown): boolean {
  return isDrawnNode(node) && node.props?.position === 'absolute'
}

function rowLines(children: readonly unknown[], width: number, gap: number): string[] {
  const sides = children.map((child) => [
    numberProp(child, 'marginLeft'),
    numberProp(child, 'marginRight'),
  ])
  const fixed = children.map((child) => (isGrower(child) ? null : sketchLines(child, width)))
  const widths = fixed.map((lines, index) =>
    lines === null
      ? 0
      : Math.max(numberProp(children[index], 'width'), ...lines.map((line) => displayWidth(line))),
  )
  const used = sum(widths) + sum(sides.flat()) + gap * Math.max(children.length - 1, 0)
  const filled = fixed.map((lines, index) => {
    if (lines !== null) return { lines, width: widths[index] ?? 0 }
    const room = Math.max(numberProp(children[index], 'minWidth'), width - used)
    const grown = sketchLines(children[index], room)
    return { lines: grown.length === 0 ? [''] : grown, width: room }
  })
  const height = Math.max(0, ...filled.map((block) => block.lines.length))
  return Array.from({ length: height }, (_, row) =>
    filled
      .map((block, index) => {
        const [left = 0, right = 0] = sides[index] ?? []
        return ' '.repeat(left) + padded(block.lines[row] ?? '', block.width) + ' '.repeat(right)
      })
      .join(' '.repeat(gap)),
  )
}

function framedLines(lines: readonly string[], width: number, padding: number): string[] {
  const rule = '─'.repeat(width - 2)
  const side = ' '.repeat(padding)
  const inner = width - 2 - 2 * padding
  return [
    `╭${rule}╮`,
    ...lines.map((line) => `│${side}${padded(line, inner)}${side}│`),
    `╰${rule}╯`,
  ]
}

function paintedOver(line: string, paint: string, left: number): string {
  const cells = Array.from(padded(line, left))
  Array.from(paint).forEach((character, index) => {
    cells[left + index] = character
  })
  return cells.join('')
}

function boxLines(node: DrawnNode, width: number): string[] {
  const props = node.props ?? {}
  const children = node.children ?? []
  const outer = typeof props.width === 'number' ? props.width : width
  const isFramed = props.borderStyle !== undefined
  const padding = numberProp(node, 'paddingX')
  const indent = numberProp(node, 'paddingLeft')
  const inner = outer - (isFramed ? 2 + 2 * padding : 0) - indent
  const gap = numberProp(node, 'gap')
  const flowing = children.filter((child) => !isAbsolute(child))
  const flowed =
    props.flexDirection === 'column'
      ? flowing.flatMap((child, index) => [
          ...(index > 0 ? Array<string>(gap).fill('') : []),
          ...sketchLines(child, inner),
        ])
      : rowLines(flowing, inner, gap)
  const indented = flowed.map((line) => (line === '' ? line : ' '.repeat(indent) + line))
  const lines = isFramed ? framedLines(indented, outer, padding) : indented
  for (const placed of children.filter(isAbsolute)) {
    const top = numberProp(placed, 'top')
    const left = numberProp(placed, 'left')
    sketchLines(placed, outer).forEach((line, row) => {
      lines[top + row] = paintedOver(lines[top + row] ?? '', line, left)
    })
  }
  return [...Array<string>(numberProp(node, 'marginTop')).fill(''), ...lines]
}

export function sketchLines(node: unknown, width: number): string[] {
  if (typeof node === 'string') return [node]
  if (!isDrawnNode(node)) return []
  const props = node.props ?? {}
  switch (node.type) {
    case 'Text':
      return plainText(node)
        .split('\n')
        .flatMap((line) =>
          typeof props.wrap === 'string' && props.wrap.startsWith('truncate')
            ? [cutTo(line, width)]
            : wrappedAt(line, width),
        )
    case 'Button':
      return [`[ ${String(props.label)} ]`]
    case 'Markdown':
      return String(props.text).split('\n')
    case 'Code':
      return String(props.source).split('\n')
    case 'Box':
      return boxLines(node, width)
    case 'engine':
      return ['(engine)']
    default:
      return []
  }
}

export function sketchOf(tree: unknown, columns: number): string[] {
  return sketchLines(tree, columns).map((line) => line.trimEnd())
}
