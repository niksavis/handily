import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  RenderElement,
  TextProps,
} from 'claude-code'
import type { GitView, NoteLine, NoteTone } from './gitview'
import type { GitCount, GitLetter, GitMarks } from './status'
import {
  type EntryRow,
  type Folders,
  type Listing,
  type TreeRow,
  ROOT_PATH,
  childPath,
  entryRow,
} from './tree'
import { displayWidth, fitted } from './width'

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  bodyColumns: number
}

export type PaneActions = {
  toggle: (path: string) => void
  showAll: (path: string) => void
  refresh: () => void
  retry: () => void
}

export const INLINE_ROWS = 8

const FILES_TITLE = 'Files'
const REFRESH = 'refresh'
const RETRY = 'retry'
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
const NOTE_GAP = '  '
const INDENT = '  '
const DETAIL_INDENT = '  '
const MARKED_ROOM = 3
const OPEN_MARK = '▾'
const CLOSED_MARK = '▸'
const RULE = '─'
const NOT_LISTED = 'not listed'
const DOCK_HINT = 'a dock (fullscreen, 110 columns) shows the tree'
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

type LetterColor = 'success' | 'warning' | 'error'

type Part = { text: string; color?: LetterColor; dimColor?: boolean }

const LETTER_COLORS: Readonly<Record<GitLetter, LetterColor>> = {
  M: 'warning',
  A: 'success',
  '?': 'success',
  D: 'error',
  R: 'warning',
  U: 'error',
}

const TONES: Readonly<Record<NoteTone, TextProps>> = {
  plain: {},
  dim: { dimColor: true },
  error: { color: 'error' },
  warning: { color: 'warning' },
}

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

function shownName(name: string): string {
  return name.replace(UNSAFE, escapedUnits)
}

function countText(count: number): string {
  return count.toLocaleString('en-US')
}

function indentOf(depth: number): string {
  return INDENT.repeat(depth)
}

function wrapped(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const joined = current === '' ? word : `${current} ${word}`
    if (current !== '' && displayWidth(joined) > width) {
      lines.push(current)
      current = word
    } else {
      current = joined
    }
  }
  lines.push(current)
  return lines.map((part) => fitted(part, width))
}

function drawHeader(
  elements: PaneElements,
  rootName: string,
  gitHeader: string,
  width: number,
): RenderElement {
  const { Box, Text } = elements
  return Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: FILES_TITLE }),
      Text({
        children: fitted(`  ${shownName(rootName)}${gitHeader}`, width - displayWidth(FILES_TITLE)),
      }),
    ],
  })
}

function refreshButton(elements: PaneElements, actions: PaneActions): RenderElement {
  return elements.Button({
    key: 'refresh',
    label: REFRESH,
    hotkey: 'r',
    onPress: () => {
      actions.refresh()
    },
  })
}

function retryButton(elements: PaneElements, actions: PaneActions): RenderElement {
  return elements.Button({
    key: 'retry',
    label: RETRY,
    onPress: () => {
      actions.retry()
    },
  })
}

function drawNote(elements: PaneElements, note: NoteLine, actions: PaneActions): RenderElement[] {
  const { Box, Text, bodyColumns } = elements
  if (!note.hasRetry) {
    return wrapped(note.text, bodyColumns).map((part) =>
      Text({ ...TONES[note.tone], children: part }),
    )
  }
  const room = bodyColumns - displayWidth(RETRY) - BUTTON_CHROME - displayWidth(NOTE_GAP)
  const parts = note.text === '' ? [] : wrapped(note.text, room)
  const last = parts.pop()
  const texts =
    last === undefined
      ? []
      : [Text({ ...TONES[note.tone], children: last }), Text({ children: NOTE_GAP })]
  return [
    ...parts.map((part) => Text({ ...TONES[note.tone], children: part })),
    Box({ flexDirection: 'row', children: [...texts, retryButton(elements, actions)] }),
  ]
}

function drawNotes(
  elements: PaneElements,
  notes: readonly NoteLine[],
  actions: PaneActions,
): RenderElement[] {
  return notes.flatMap((note) => drawNote(elements, note, actions))
}

function folderText(row: { name: string; depth: number }, mark: string): string {
  return `${indentOf(row.depth)}${mark} ${shownName(row.name)}/`
}

function fittedParts(parts: readonly Part[], width: number): Part[] {
  let rest = fitted(parts.map((part) => part.text).join(''), width)
  const kept: Part[] = []
  for (const part of parts) {
    if (rest === '') break
    if (rest.startsWith(part.text)) {
      kept.push(part)
      rest = rest.slice(part.text.length)
    } else {
      kept.push({ ...part, text: rest })
      break
    }
  }
  return kept
}

function drawParts(Text: PaneElements['Text'], parts: readonly Part[]): RenderElement[] {
  return parts.map((part) =>
    Text({ color: part.color, dimColor: part.dimColor, children: part.text }),
  )
}

function countParts(counts: readonly GitCount[]): Part[] {
  return counts.flatMap(({ letter, count }, index) => [
    { text: index === 0 ? '  ' : ' ' },
    { text: `${letter}${count === null ? '' : String(count)}`, color: LETTER_COLORS[letter] },
  ])
}

function markedParts(letter: GitLetter, name: string): Part[] {
  const color = LETTER_COLORS[letter]
  return [{ text: letter, color }, { text: ' ' }, { text: name, color }]
}

function drawFolder(
  elements: PaneElements,
  row: EntryRow & { kind: 'folder' },
  draw: TreeDraw,
): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  const indent = displayWidth(indentOf(row.depth))
  const mark = row.isOpen ? OPEN_MARK : CLOSED_MARK
  const label = [
    { text: `${mark} ${shownName(row.name)}/` },
    ...countParts(draw.marks?.countsOf(row.path) ?? []),
  ]
  return Box({
    key: `folder:${row.path}`,
    flexDirection: 'row',
    paddingLeft: indent,
    children: [
      Button({
        key: `open:${row.path}`,
        plain: true,
        onPress: () => {
          draw.actions.toggle(row.path)
        },
        children: drawParts(Text, fittedParts(label, bodyColumns - indent)),
      }),
    ],
  })
}

function renameDetail(
  elements: PaneElements,
  row: EntryRow & { kind: 'file' },
  marks: GitMarks,
): RenderElement[] {
  const renamed = marks.renamedFromOf(row.path)
  if (renamed === undefined) return []
  const where = renamed.isStaged ? 'staged' : 'not staged'
  const text = `${indentOf(row.depth)}${INDENT}${DETAIL_INDENT}renamed from ${shownName(renamed.from)} · ${where}`
  return [elements.Text({ children: fitted(text, elements.bodyColumns) })]
}

function drawFile(
  elements: PaneElements,
  row: EntryRow & { kind: 'file' },
  marks: GitMarks | undefined,
): RenderElement[] {
  const { Box, Text, bodyColumns } = elements
  const name = `${indentOf(row.depth)}${INDENT}${shownName(row.name)}`
  const letter = marks?.letterOf(row.path)
  if (letter === undefined || marks === undefined) {
    return [Text({ dimColor: row.isDot, children: fitted(name, bodyColumns) })]
  }
  const indent = indentOf(
    Math.min(row.depth, Math.floor(Math.max(bodyColumns - MARKED_ROOM, 0) / 2)),
  )
  const parts = [{ text: indent }, ...markedParts(letter, shownName(row.name))]
  return [
    Box({
      key: `file:${row.path}`,
      flexDirection: 'row',
      children: drawParts(Text, fittedParts(parts, bodyColumns)),
    }),
    ...renameDetail(elements, row, marks),
  ]
}

type TreeDraw = { actions: PaneActions; marks: GitMarks | undefined }

function drawEntry(elements: PaneElements, row: EntryRow, draw: TreeDraw): RenderElement[] {
  const { Text, bodyColumns } = elements
  switch (row.kind) {
    case 'pruned':
      return [
        Text({
          children: fitted(`${folderText(row, CLOSED_MARK)}  ${NOT_LISTED}`, bodyColumns),
        }),
      ]
    case 'file':
      return drawFile(elements, row, draw.marks)
    case 'folder':
      return [drawFolder(elements, row, draw)]
  }
}

function drawFailed(
  elements: PaneElements,
  failed: { name: string; depth: number; reason: string },
): RenderElement {
  const text = `${indentOf(failed.depth)}Cannot list ${shownName(failed.name)}/: ${failed.reason}.`
  return elements.Text({ color: 'error', children: fitted(text, elements.bodyColumns) })
}

function drawMore(
  elements: PaneElements,
  row: TreeRow & { kind: 'more' },
  actions: PaneActions,
): RenderElement {
  const { Box, Button, bodyColumns } = elements
  const indent = displayWidth(indentOf(row.depth) + INDENT)
  const label = `+${countText(row.hidden)} more in ${shownName(row.name)}/`
  return Box({
    key: `more-row:${row.path}`,
    paddingLeft: indent,
    children: [
      Button({
        key: `more:${row.path}`,
        label: fitted(label, bodyColumns - indent - BUTTON_CHROME),
        onPress: () => {
          actions.showAll(row.path)
        },
      }),
    ],
  })
}

function drawRow(elements: PaneElements, row: TreeRow, draw: TreeDraw): RenderElement[] {
  switch (row.kind) {
    case 'more':
      return [drawMore(elements, row, draw.actions)]
    case 'failed':
      return [drawFailed(elements, row)]
    case 'empty':
      return [elements.Text({ dimColor: true, children: 'This folder is empty.' })]
    default:
      return drawEntry(elements, row, draw)
  }
}

export function drawTree(
  elements: PaneElements,
  rootName: string,
  rows: readonly TreeRow[],
  view: { git: GitView; actions: PaneActions },
): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const { git, actions } = view
  const draw: TreeDraw = { actions, marks: git.marks }
  return Box({
    flexDirection: 'column',
    children: [
      drawHeader(elements, rootName, git.header, bodyColumns),
      Box({ flexDirection: 'row', children: [refreshButton(elements, actions)] }),
      ...drawNotes(elements, git.notes, actions),
      Text({ children: RULE.repeat(Math.max(bodyColumns, 0)) }),
      ...rows.flatMap((row) => drawRow(elements, row, draw)),
      ...drawNotes(elements, git.footer, actions),
    ],
  })
}

function flatRow(elements: PaneElements, row: EntryRow, git: GitView): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const { marks } = git
  const name = shownName(row.name)
  const slot = git.isRepo ? INDENT : ''
  const letter = row.kind === 'file' ? marks?.letterOf(row.path) : undefined
  const parts: Part[] = (() => {
    switch (row.kind) {
      case 'pruned':
        return [{ text: `${slot}${name}/  ${NOT_LISTED}` }]
      case 'folder':
        return [{ text: `${slot}${name}/` }, ...countParts(marks?.countsOf(row.path) ?? [])]
      case 'file':
        return letter === undefined
          ? [{ text: `${slot}${name}`, dimColor: row.isDot }]
          : markedParts(letter, name)
    }
  })()
  return Box({
    key: `flat:${row.path}`,
    flexDirection: 'row',
    children: drawParts(Text, fittedParts(parts, bodyColumns)),
  })
}

function inlineRows(
  elements: PaneElements,
  root: Listing,
  rootName: string,
  git: GitView,
): RenderElement[] {
  const { Text, bodyColumns } = elements
  if (root.kind === 'failed') {
    return [drawFailed(elements, { name: rootName, depth: 0, reason: root.reason })]
  }
  if (root.sorted.length === 0) {
    return [Text({ dimColor: true, children: 'This folder is empty.' })]
  }
  const closed: Folders = { open: new Set(), whole: new Set() }
  const rows = root.sorted.map((entry) =>
    entryRow(entry, childPath(ROOT_PATH, entry.name), 0, closed),
  )
  if (rows.length <= INLINE_ROWS) return rows.map((row) => flatRow(elements, row, git))
  const shown = rows.slice(0, INLINE_ROWS - 1)
  const hidden = countText(rows.length - shown.length)
  return [
    ...shown.map((row) => flatRow(elements, row, git)),
    Text({ dimColor: true, children: fitted(`+${hidden} more: ${DOCK_HINT}`, bodyColumns) }),
  ]
}

export function drawInline(
  elements: PaneElements,
  rootName: string,
  root: Listing,
  view: { git: GitView; actions: PaneActions },
): RenderElement {
  const { Box, bodyColumns } = elements
  const headerWidth = bodyColumns - displayWidth(REFRESH) - BUTTON_CHROME - BUTTON_GAP
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          drawHeader(elements, rootName, view.git.header, headerWidth),
          refreshButton(elements, view.actions),
        ],
      }),
      ...inlineRows(elements, root, rootName, view.git),
    ],
  })
}
