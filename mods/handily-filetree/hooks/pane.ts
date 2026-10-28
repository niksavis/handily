import type {
  BoxProps,
  ButtonProps,
  CodeProps,
  ElementConstructor,
  MarkdownProps,
  RenderElement,
  RenderSurface,
  SelectProps,
  TextProps,
} from 'claude-code'
import { filterValue } from './agents'
import { BUTTON_CHROME, BUTTON_GAP, type ButtonSpec, buttonRows } from './buttons'
import type { GitView, NoteLine, NoteTone } from './gitview'
import { type MarkColumn, hiddenText, markCell, markWidth, sightCells, touchText } from './marks'
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
import type { Mark, Sight, Touch } from './touches'
import { displayWidth, fitted } from './width'

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Select: ElementConstructor<SelectProps> | undefined
  Code: ElementConstructor<CodeProps>
  Markdown: ElementConstructor<MarkdownProps>
  bodyColumns: number
}

export type TouchDraw = {
  column: MarkColumn
  fileMark: (path: string) => Mark | undefined
  folderMark: (path: string) => Mark | undefined
  labelOf: (agent: string) => string
  touchesOf: (path: string) => readonly Touch[]
  shownPath: (path: string) => string
  sights: readonly Sight[]
  agents: readonly string[]
  agent: string | undefined
  inView: string | undefined
  pick: (value: string) => void
  now: number
}

type PaneView = {
  git: GitView
  actions: PaneActions
  touched: TouchDraw
  opened: string | undefined
}

export type PaneActions = {
  toggle: (path: string) => void
  showAll: (path: string) => void
  refresh: () => void
  retry: () => void
  openFile: (path: string) => void
  preview: (path: string) => void
  diff: (path: string, isFolder: boolean) => void
  back: () => void
  copy: (text: string, surface: RenderSurface) => void
  mention: (path: string) => void
}

export const INLINE_ROWS = 8

const FILES_TITLE = 'Files'
const REFRESH = 'refresh'
const RETRY = 'retry'
const MARK_GAP = 1
const SELECT_CHROME = 2
const FILTER_KEY = 'agent'
const FILTER_LABEL = 'agent'
const ALL_LABEL = 'all'
const NOW_TITLE = 'Now'
const NOTHING_YET = 'nothing read or edited yet'
const INLINE_GAP = '  '
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

export type Part = { text: string; color?: LetterColor; dimColor?: boolean; bold?: boolean }

const STATE_WORDS: Readonly<Record<GitLetter, string>> = {
  M: 'modified',
  A: 'added',
  '?': 'untracked',
  D: 'deleted',
  R: 'renamed',
  U: 'conflict',
}

const UNSTAGED_LETTERS: ReadonlySet<GitLetter> = new Set(['?', 'U'])

export const LETTER_COLORS: Readonly<Record<GitLetter, LetterColor>> = {
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

export function shownName(name: string): string {
  return name.replace(UNSAFE, escapedUnits)
}

function countText(count: number): string {
  return count.toLocaleString('en-US')
}

function indentOf(depth: number): string {
  return INDENT.repeat(depth)
}

export function wrapped(text: string, width: number): string[] {
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

export function drawHeader(
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

function agentOptions(touched: TouchDraw): { value: string; label: string }[] {
  const agents = touched.agent === undefined ? touched.agents : [...touched.agents, touched.agent]
  const options = [...new Set(agents)].map((agent) => ({
    value: filterValue(agent),
    label: shownName(touched.labelOf(agent)),
  }))
  return [{ value: filterValue(undefined), label: ALL_LABEL }, ...options]
}

function filterSelect(elements: PaneElements, touched: TouchDraw): RenderElement[] {
  const { Select } = elements
  if (Select === undefined) return []
  return [
    Select({
      key: FILTER_KEY,
      label: FILTER_LABEL,
      options: agentOptions(touched),
      value: filterValue(touched.agent),
      onSelect: (value) => {
        touched.pick(value)
      },
    }),
  ]
}

function filterWidth(elements: PaneElements, touched: TouchDraw): number {
  if (elements.Select === undefined) return 0
  const shown = touched.agent === undefined ? ALL_LABEL : touched.labelOf(touched.agent)
  return displayWidth(`${FILTER_LABEL}: ${shownName(shown)}`) + SELECT_CHROME
}

function drawControls(
  elements: PaneElements,
  actions: PaneActions,
  touched: TouchDraw,
): RenderElement[] {
  const { Box, Text, bodyColumns } = elements
  const select = filterSelect(elements, touched)
  const refresh = refreshButton(elements, actions)
  const width = filterWidth(elements, touched) + BUTTON_GAP + displayWidth(REFRESH) + BUTTON_CHROME
  if (select.length === 0 || width <= bodyColumns) {
    const gap = select.length === 0 ? [] : [Text({ children: ' ' })]
    return [Box({ flexDirection: 'row', children: [...select, ...gap, refresh] })]
  }
  return [
    Box({ flexDirection: 'row', children: [refresh] }),
    Box({ flexDirection: 'row', children: select }),
  ]
}

function inViewNote(elements: PaneElements, touched: TouchDraw): RenderElement[] {
  if (touched.inView === undefined) return []
  const label = shownName(touched.labelOf(touched.inView))
  return wrapped(`${label} is in view, so only ${label} shows`, elements.bodyColumns).map((part) =>
    elements.Text({ dimColor: true, children: part }),
  )
}

function nowSummary(touched: TouchDraw): string {
  const count = touched.sights.length
  if (count === 0) return NOTHING_YET
  if (touched.agent !== undefined) return shownName(touched.labelOf(touched.agent))
  return `${String(count)} ${count === 1 ? 'agent' : 'agents'}`
}

function drawSight(elements: PaneElements, sight: Sight, touched: TouchDraw): RenderElement[] {
  const { Box, Text, bodyColumns } = elements
  const cells = sightCells(touched.column, sight, {
    label: shownName(touched.labelOf(sight.agent)),
    path: shownName(touched.shownPath(sight.path)),
    bodyColumns,
    now: touched.now,
  })
  const age = cells.age === '' ? [] : [Text({ dimColor: true, children: cells.age })]
  const line = Box({
    key: `now:${sight.agent}`,
    flexDirection: 'row',
    children: [Text({ children: cells.mark }), Text({ children: cells.path }), ...age],
  })
  if (sight.hidden === 0) return [line]
  return [line, Text({ children: fitted(hiddenText(sight.hidden), bodyColumns) })]
}

function drawNow(elements: PaneElements, touched: TouchDraw): RenderElement[] {
  const { Box, Text, bodyColumns } = elements
  const head = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: NOW_TITLE }),
      Text({
        children: fitted(`  ${nowSummary(touched)}`, bodyColumns - displayWidth(NOW_TITLE)),
      }),
    ],
  })
  return [head, ...touched.sights.flatMap((sight) => drawSight(elements, sight, touched))]
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

export function fittedParts(parts: readonly Part[], width: number): Part[] {
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

export function drawParts(Text: PaneElements['Text'], parts: readonly Part[]): RenderElement[] {
  return parts.map((part) =>
    Text({ color: part.color, dimColor: part.dimColor, bold: part.bold, children: part.text }),
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

function partsWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, part) => sum + displayWidth(part.text), 0)
}

function nameRoom(width: number, touched: TouchDraw, mark: Mark | undefined): number {
  return mark === undefined ? width : width - markWidth(touched.column) - MARK_GAP
}

function markParts(touched: TouchDraw, mark: Mark): Part[] {
  const label = shownName(touched.labelOf(mark.agent))
  const cell = markCell(touched.column, mark, label, touched.now)
  return cell.age === ''
    ? [{ text: cell.mark }]
    : [{ text: cell.mark }, { text: cell.age, dimColor: true }]
}

function markedLine(
  parts: readonly Part[],
  width: number,
  touched: TouchDraw,
  mark: Mark | undefined,
): { head: Part[]; tail: Part[] } {
  const room = nameRoom(width, touched, mark)
  const head = fittedParts(parts, room)
  if (mark === undefined) return { head, tail: [] }
  const gap = ' '.repeat(Math.max(room - partsWidth(head), 0) + MARK_GAP)
  return { head, tail: [{ text: gap }, ...markParts(touched, mark)] }
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
  const line = markedLine(
    label,
    bodyColumns - indent,
    draw.touched,
    draw.touched.folderMark(row.path),
  )
  const [name, ...counts] = line.head
  const countButton =
    counts.length === 0
      ? []
      : [
          Button({
            key: `diff:${row.path}`,
            plain: true,
            onPress: () => {
              draw.actions.diff(row.path, true)
            },
            children: drawParts(Text, counts),
          }),
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
        children: drawParts(Text, name === undefined ? [] : [name]),
      }),
      ...countButton,
      ...drawParts(Text, line.tail),
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

function fileLine(
  elements: PaneElements,
  row: EntryRow & { kind: 'file' },
  draw: TreeDraw,
): RenderElement[] {
  const { Text, bodyColumns } = elements
  const { marks, touched } = draw
  const mark = touched.fileMark(row.path)
  const name = `${indentOf(row.depth)}${INDENT}${shownName(row.name)}`
  const letter = marks?.letterOf(row.path)
  if (letter === undefined && mark === undefined) {
    return [Text({ dimColor: row.isDot, children: fitted(name, bodyColumns) })]
  }
  const room = nameRoom(bodyColumns, touched, mark)
  const parts =
    letter === undefined
      ? [{ text: name, dimColor: row.isDot }]
      : [
          { text: indentOf(Math.min(row.depth, Math.floor(Math.max(room - MARKED_ROOM, 0) / 2))) },
          ...markedParts(letter, shownName(row.name)),
        ]
  const line = markedLine(parts, bodyColumns, touched, mark)
  return drawParts(Text, [...line.head, ...line.tail])
}

function stateText(marks: GitMarks, path: string): string | undefined {
  const letter = marks.letterOf(path)
  if (letter === undefined) return undefined
  const word = STATE_WORDS[letter]
  if (UNSTAGED_LETTERS.has(letter)) return word
  return `${word}, ${marks.isStagedOf(path) ? 'staged' : 'not staged'}`
}

function rowButtons(path: string, draw: TreeDraw): ButtonSpec[] {
  const { actions } = draw
  const diff: ButtonSpec[] = draw.isRepo
    ? [
        {
          key: 'diff',
          label: 'diff',
          onPress: () => {
            actions.diff(path, false)
          },
        },
      ]
    : []
  return [
    {
      key: 'preview',
      label: 'preview',
      onPress: () => {
        actions.preview(path)
      },
    },
    ...diff,
    {
      key: 'copy-path',
      label: 'copy path',
      onPress: (e) => {
        actions.copy(path, e.surface)
      },
    },
    {
      key: 'to-prompt',
      label: '@ to prompt',
      onPress: () => {
        actions.mention(path)
      },
    },
  ]
}

function openedDetail(
  elements: PaneElements,
  row: EntryRow & { kind: 'file' },
  draw: TreeDraw,
): RenderElement[] {
  const { Text, bodyColumns } = elements
  const { touched, marks } = draw
  const indent = displayWidth(`${indentOf(row.depth)}${INDENT}${DETAIL_INDENT}`)
  const room = Math.max(bodyColumns - indent, 1)
  const touches = touched
    .touchesOf(row.path)
    .map((touch) => touchText(touch, shownName(touched.labelOf(touch.agent)), touched.now))
  const state = marks === undefined ? undefined : stateText(marks, row.path)
  const lines = state === undefined ? touches : [...touches, state]
  return [
    ...lines.map((text) => Text({ children: fitted(`${' '.repeat(indent)}${text}`, bodyColumns) })),
    ...buttonRows(elements, rowButtons(row.path, draw), { room, indent, key: 'opened' }),
  ]
}

function drawFile(
  elements: PaneElements,
  row: EntryRow & { kind: 'file' },
  draw: TreeDraw,
): RenderElement[] {
  const { Box, Button } = elements
  const { marks } = draw
  const isOpened = draw.opened === row.path
  return [
    Box({
      key: `file-row:${row.path}`,
      flexDirection: 'row',
      children: [
        Button({
          key: `file:${row.path}`,
          plain: true,
          onPress: () => {
            draw.actions.openFile(row.path)
          },
          children: fileLine(elements, row, draw),
        }),
      ],
    }),
    ...(marks === undefined ? [] : renameDetail(elements, row, marks)),
    ...(isOpened ? openedDetail(elements, row, draw) : []),
  ]
}

type TreeDraw = {
  actions: PaneActions
  marks: GitMarks | undefined
  touched: TouchDraw
  opened: string | undefined
  isRepo: boolean
}

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
      return drawFile(elements, row, draw)
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
  view: PaneView,
): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const { git, actions, touched, opened } = view
  const draw: TreeDraw = { actions, marks: git.marks, touched, opened, isRepo: git.isRepo }
  return Box({
    flexDirection: 'column',
    children: [
      drawHeader(elements, rootName, git.header, bodyColumns),
      ...drawControls(elements, actions, touched),
      ...drawNotes(elements, git.notes, actions),
      ...inViewNote(elements, touched),
      ...drawNow(elements, touched),
      Text({ children: RULE.repeat(Math.max(bodyColumns, 0)) }),
      ...rows.flatMap((row) => drawRow(elements, row, draw)),
      ...drawNotes(elements, git.footer, actions),
    ],
  })
}

function flatMark(row: EntryRow, touched: TouchDraw): Mark | undefined {
  switch (row.kind) {
    case 'file':
      return touched.fileMark(row.path)
    case 'folder':
      return touched.folderMark(row.path)
    case 'pruned':
      return undefined
  }
}

function flatRow(elements: PaneElements, row: EntryRow, view: PaneView): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const { git, touched } = view
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
  const line = markedLine(parts, bodyColumns, touched, flatMark(row, touched))
  return Box({
    key: `flat:${row.path}`,
    flexDirection: 'row',
    children: drawParts(Text, [...line.head, ...line.tail]),
  })
}

function inlineRows(
  elements: PaneElements,
  root: Listing,
  rootName: string,
  view: PaneView,
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
  if (rows.length <= INLINE_ROWS) return rows.map((row) => flatRow(elements, row, view))
  const shown = rows.slice(0, INLINE_ROWS - 1)
  const hidden = countText(rows.length - shown.length)
  return [
    ...shown.map((row) => flatRow(elements, row, view)),
    Text({ dimColor: true, children: fitted(`+${hidden} more: ${DOCK_HINT}`, bodyColumns) }),
  ]
}

export function drawInline(
  elements: PaneElements,
  rootName: string,
  root: Listing,
  view: PaneView,
): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const select = filterSelect(elements, view.touched)
  const filterRoom =
    select.length === 0 ? 0 : filterWidth(elements, view.touched) + displayWidth(INLINE_GAP)
  const headerWidth = bodyColumns - displayWidth(REFRESH) - BUTTON_CHROME - BUTTON_GAP - filterRoom
  const gap = select.length === 0 ? [] : [Text({ children: INLINE_GAP })]
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          drawHeader(elements, rootName, view.git.header, headerWidth),
          Box({
            flexDirection: 'row',
            children: [...select, ...gap, refreshButton(elements, view.actions)],
          }),
        ],
      }),
      ...inlineRows(elements, root, rootName, view),
    ],
  })
}
