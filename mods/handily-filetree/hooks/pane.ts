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
  ThemeKey,
} from 'claude-code'
import { filterValue } from './agents'
import {
  BUTTON_CHROME,
  BUTTON_GAP,
  type ButtonSpec,
  buttonOf,
  buttonRows,
  rowWidth,
} from './buttons'
import {
  COLUMN_HOTKEY,
  COLUMN_LABELS,
  type ColumnDraw,
  type ColumnValue,
  columnValue,
} from './column'
import { FAMILY_COLORS, TYPE_ICONS, fileTypeOf } from './fileicons'
import type { GitView, NoteLine, NoteTone } from './gitview'
import { GLYPH_SETS, type GlyphSet } from './glyphs'
import { type LineCount, type LineMarks, lineNumber } from './lines'
import {
  type MarkColumn,
  hiddenText,
  isShared,
  markCell,
  markWidth,
  noTaskFilesText,
  sharedLabel,
  sightCells,
  taskCountsText,
  type TaskCounts,
  touchText,
} from './marks'
import type { GitCount, GitLetter, GitMarks, IgnoredMarks } from './status'
import type { EntryRow, Listing, TreeRow } from './tree'
import type { Mark, Sight, Touch } from './touches'
import { displayWidth, fitted } from './width'
import { type WorkPath, chainTop, flatEntryRow } from './work'
import type { FiletreeColumn, FiletreeView } from '../types'

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Select: ElementConstructor<SelectProps> | undefined
  Code: ElementConstructor<CodeProps>
  Markdown: ElementConstructor<MarkdownProps>
  bodyColumns: number
  glyphs: GlyphSet
  hasIcons: boolean
  surface: RenderSurface
}

export type TaskDraw = {
  id: number
  title: string | null
  counts: TaskCounts
  clear: () => void
}

export type TouchDraw = {
  column: MarkColumn
  fileMark: (path: string) => Mark | undefined
  folderMark: (path: string) => Mark | undefined
  labelOf: (agent: string) => string
  touchesOf: (path: string) => readonly Touch[]
  shownPath: (path: string) => string
  paths: readonly WorkPath[]
  sights: readonly Sight[]
  agents: readonly string[]
  agent: string | undefined
  inView: string | undefined
  pick: (value: string) => void
  runsOn: (path: string) => boolean
  now: number
  task: TaskDraw | undefined
}

export type LastTurnDraw = { total: number; isNoteShown: boolean; press: () => void }

type PaneView = {
  git: GitView
  actions: PaneActions
  touched: TouchDraw
  opened: string | undefined
  choice: FiletreeView
  lastTurn: LastTurnDraw | undefined
  column: ColumnDraw
}

export type PaneActions = {
  toggle: (path: string) => void
  showAll: (path: string) => void
  refresh: () => void
  retry: () => void
  switchView: () => void
  openFile: (path: string) => void
  preview: (path: string) => void
  diff: (path: string, isFolder: boolean) => void
  back: () => void
  copy: (text: string, surface: RenderSurface) => void
  mention: (path: string) => void
}

export const INLINE_ROWS = 8

const TREE_ROWS = 1000

const FILES_TITLE = 'Files'
const REFRESH = 'refresh'
const RETRY = 'retry'
const CLEAR = 'clear'
const MARK_GAP = 1
const COUNT_GAP = 1
const LINES_BODY = 41
const BINARY = 'bin'
const UPSTREAM = 'upstream'
const PART_GAP = ' · '
const SELECT_CHROME = 2
const FILTER_KEY = 'agent'
const FILTER_LABEL = 'agent'
const ALL_LABEL = 'all'
const NOW_TITLE = 'Now'
const LAST_TURN_KEY = 'last-turn'
const NO_EDITS = 'no edits'
const BASH_EDITS_NOTE = 'edits by Bash commands are not listed'
const NOTHING_YET = 'nothing read or edited yet'
const INLINE_GAP = '  '
const NOTE_GAP = '  '
const INDENT = '  '
const DETAIL_INDENT = '  '
const MARKED_ROOM = 3
const RULE = '─'
const RULE_SURFACE: RenderSurface = 'terminal'
const COLUMN_KEY = 'column'
const COLUMN_ROW_KEY = 'column-row'
const FOLDER_DIFF_KEY = 'diff-folder'
const ROW_BACKGROUND: ThemeKey = 'subtle'
const PLAIN_FOLDER: ThemeKey = 'planMode'
const IGNORED = 'ignored'
const NOT_LISTED = 'not listed'
const DOCK_HINT = 'a dock (fullscreen, 110 columns) shows the tree'
const NO_WORK = 'No changed or touched files.'
const ALL_FILES_HINT = 'shows the whole tree.'
const WORK_NOTE = 'work view: touched and changed files'
const WORK_MORE_KEY = 'more-work'
const CUT_VIEW_KEY = 'cut-view'
const CUT_NOTE = `${countText(TREE_ROWS)} rows drawn, the most a pane takes.`
const CLOSE_FOLDER = 'Close a folder'
const VIEW_LABELS: Readonly<Record<FiletreeView, string>> = {
  work: 'all files',
  all: 'work only',
}
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

type LetterColor = 'success' | 'warning' | 'error'

export type Part = {
  text: string
  color?: ThemeKey
  dimColor?: boolean
  bold?: boolean
  backgroundColor?: ThemeKey
}

type Look = Pick<Part, 'color' | 'dimColor'>

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

const STRONGEST_FIRST: readonly LetterColor[] = ['error', 'warning', 'success']

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

export type HeaderRows = 'one' | 'two'

function countLook(count: number, color: ThemeKey): Look {
  return count === 0 ? { dimColor: true } : { color }
}

function lineParts(count: LineCount): Part[] {
  return [
    { text: `+${lineNumber(count.added)}`, ...countLook(count.added, 'success') },
    { text: ' ' },
    { text: `-${lineNumber(count.removed)}`, ...countLook(count.removed, 'error') },
  ]
}

function hasRightColumn(elements: PaneElements): boolean {
  return elements.bodyColumns >= LINES_BODY
}

function upstreamParts(git: GitView, rows: HeaderRows): Part[] {
  if (rows === 'one' || git.upstream === undefined) return []
  return [{ text: `${UPSTREAM} ${shownName(git.upstream)}`, dimColor: true }]
}

export function drawHeader(
  elements: PaneElements,
  rootName: string,
  git: GitView,
  width: number,
  rows: HeaderRows,
): RenderElement {
  const { Box, Text } = elements
  const room = width - displayWidth(FILES_TITLE)
  const head: Part[] = [
    { text: `  ${shownName(rootName)}` },
    ...git.header.map((part) => ({ ...part, text: shownName(part.text) })),
  ]
  const total = hasRightColumn(elements) ? git.lines?.total : undefined
  const totals = total === undefined ? [] : lineParts(total)
  const withTotals = [...head, { text: ' ' }, ...totals]
  const isTotalsOnTop = totals.length > 0 && partsWidth(withTotals) <= room
  const top = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: FILES_TITLE }),
      ...drawParts(Text, fittedParts(isTotalsOnTop ? withTotals : head, room)),
    ],
  })
  const moved = isTotalsOnTop || rows === 'one' ? [] : totals
  const upstream = upstreamParts(git, rows)
  const gap = moved.length > 0 && upstream.length > 0 ? [{ text: PART_GAP, dimColor: true }] : []
  const second = [...moved, ...gap, ...upstream]
  if (second.length === 0) return top
  return Box({
    flexDirection: 'column',
    children: [
      top,
      Box({ flexDirection: 'row', children: drawParts(Text, fittedParts(second, width)) }),
    ],
  })
}

function refreshSpec(actions: PaneActions): ButtonSpec {
  return {
    key: 'refresh',
    label: REFRESH,
    hotkey: 'r',
    onPress: () => {
      actions.refresh()
    },
  }
}

function refreshButton(elements: PaneElements, actions: PaneActions): RenderElement {
  return buttonOf(elements.Button, refreshSpec(actions), displayWidth(REFRESH))
}

function columnSpec(column: ColumnDraw): ButtonSpec {
  return {
    key: COLUMN_KEY,
    label: COLUMN_LABELS[column.choice],
    hotkey: COLUMN_HOTKEY,
    onPress: () => {
      column.cycle()
    },
  }
}

function isColumnOnRule(elements: PaneElements): boolean {
  return elements.surface === RULE_SURFACE
}

function drawRule(elements: PaneElements, column: ColumnDraw): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  if (!hasRightColumn(elements) || !isColumnOnRule(elements)) {
    return Text({ children: RULE.repeat(Math.max(bodyColumns, 0)) })
  }
  const spec = columnSpec(column)
  const rule = RULE.repeat(Math.max(bodyColumns - rowWidth([spec]) - BUTTON_GAP, 0))
  return Box({
    key: COLUMN_ROW_KEY,
    flexDirection: 'row',
    children: [Text({ children: `${rule} ` }), buttonOf(Button, spec, bodyColumns)],
  })
}

function viewSpec(actions: PaneActions, choice: FiletreeView): ButtonSpec {
  return {
    key: 'view',
    label: VIEW_LABELS[choice],
    hotkey: 'v',
    onPress: () => {
      actions.switchView()
    },
  }
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

function controlRows(
  elements: PaneElements,
  view: PaneView,
  columns: readonly ButtonSpec[],
): RenderElement[] {
  const { Box, Text, Button, bodyColumns } = elements
  const switcher = view.touched.task === undefined ? [viewSpec(view.actions, view.choice)] : []
  const refresh = refreshSpec(view.actions)
  const specs = [...switcher, refresh]
  const select = filterSelect(elements, view.touched)
  const filter = { children: select, width: filterWidth(elements, view.touched) }
  const room = { room: bodyColumns, indent: 0, key: 'controls' }
  if (select.length === 0) return buttonRows(elements, [...specs, ...columns], room)
  const width = rowWidth(specs) + BUTTON_GAP + filter.width
  if (width > bodyColumns) {
    return [
      ...buttonRows(elements, specs, { ...room, tail: filter }),
      ...buttonRows(elements, columns, { ...room, key: COLUMN_ROW_KEY }),
    ]
  }
  const isBeside = width + BUTTON_GAP + rowWidth(columns) <= bodyColumns
  const after = [refresh, ...(isBeside ? columns : [])]
  return [
    Box({
      flexDirection: 'row',
      children: [
        ...switcher.flatMap((spec) => [
          buttonOf(Button, spec, bodyColumns),
          Text({ children: ' ' }),
        ]),
        ...select,
        ...after.flatMap((spec) => [Text({ children: ' ' }), buttonOf(Button, spec, bodyColumns)]),
      ],
    }),
    ...(isBeside ? [] : buttonRows(elements, columns, { ...room, key: COLUMN_ROW_KEY })),
  ]
}

function drawControls(elements: PaneElements, view: PaneView): RenderElement[] {
  const isBelow = hasRightColumn(elements) && !isColumnOnRule(elements)
  return controlRows(elements, view, isBelow ? [columnSpec(view.column)] : [])
}

function drawTaskLine(elements: PaneElements, task: TaskDraw): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  const head = `Task ${String(task.id)}`
  const clear: ButtonSpec = { key: 'clear-task', label: CLEAR, hotkey: 'c', onPress: task.clear }
  const room = bodyColumns - displayWidth(head) - rowWidth([clear]) - 2 * displayWidth(NOTE_GAP)
  const title = task.title === null ? '' : fitted(shownName(task.title), Math.max(room, 0))
  return Box({
    key: 'task',
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: head }),
      Text({ children: title === '' ? NOTE_GAP : `${NOTE_GAP}${title}${NOTE_GAP}` }),
      buttonOf(Button, clear, displayWidth(CLEAR)),
    ],
  })
}

function drawTaskCounts(elements: PaneElements, task: TaskDraw): RenderElement[] {
  const { counts } = task
  const isEmpty = counts.edit + counts.read === 0
  const text = isEmpty ? noTaskFilesText(task.id) : taskCountsText(counts, task.id, elements.glyphs)
  return wrapped(text, elements.bodyColumns).map((part) =>
    elements.Text({ dimColor: isEmpty, children: part }),
  )
}

function lastTurnLabel(total: number): string {
  if (total === 0) return `last turn: ${NO_EDITS}`
  return `last turn: ${countText(total)} ${total === 1 ? 'edit' : 'edits'}`
}

function drawLastTurn(elements: PaneElements, lastTurn: LastTurnDraw | undefined): RenderElement[] {
  if (lastTurn === undefined) return []
  const spec: ButtonSpec = {
    key: LAST_TURN_KEY,
    label: lastTurnLabel(lastTurn.total),
    hotkey: 'l',
    onPress: () => {
      lastTurn.press()
    },
  }
  const { bodyColumns } = elements
  const note =
    lastTurn.total === 0 && lastTurn.isNoteShown
      ? wrapped(BASH_EDITS_NOTE, bodyColumns).map((part) =>
          elements.Text({ dimColor: true, children: part }),
        )
      : []
  return [
    ...buttonRows(elements, [spec], { room: bodyColumns, indent: 0, key: LAST_TURN_KEY }),
    ...note,
  ]
}

function drawTop(elements: PaneElements, view: PaneView): RenderElement[] {
  const { touched, git, actions } = view
  if (touched.task === undefined) {
    return [
      ...drawControls(elements, view),
      ...drawLastTurn(elements, view.lastTurn),
      ...drawNotes(elements, git.notes, actions),
      ...inViewNote(elements, touched),
      ...drawNow(elements, touched),
    ]
  }
  return [
    drawTaskLine(elements, touched.task),
    ...drawControls(elements, view),
    ...drawNotes(elements, git.notes, actions),
    ...inViewNote(elements, touched),
    ...drawTaskCounts(elements, touched.task),
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
    glyphs: elements.glyphs,
    isNow: sight.isRunning === true,
  })
  const age = cells.age === '' ? [] : drawParts(Text, [agePart(cells)])
  const line = Box({
    key: `now:${sight.agent}`,
    flexDirection: 'row',
    children: [Text({ children: cells.mark }), Text({ children: cells.path }), ...age],
  })
  if (sight.hidden === 0) return [line]
  return [line, Text({ children: fitted(hiddenText(sight.hidden, sight.source), bodyColumns) })]
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
    Text({
      color: part.color,
      dimColor: part.dimColor,
      bold: part.bold,
      backgroundColor: part.backgroundColor,
      children: part.text,
    }),
  )
}

function padded(parts: readonly Part[], width: number): Part[] {
  const room = width - partsWidth(parts)
  return room > 0 ? [...parts, { text: ' '.repeat(room) }] : [...parts]
}

function onBackground(parts: readonly Part[], color: ThemeKey | undefined): Part[] {
  if (color === undefined) return [...parts]
  return parts.map((part) => ({ ...part, backgroundColor: color }))
}

function hasChangeList(counts: readonly GitCount[]): boolean {
  return counts.every(({ count }) => count !== null)
}

function countParts(counts: readonly GitCount[]): Part[] {
  return counts.flatMap(({ letter, count }, index) => [
    { text: index === 0 ? '  ' : ' ' },
    { text: `${letter}${count === null ? '' : String(count)}`, color: LETTER_COLORS[letter] },
  ])
}

function partsWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, part) => sum + displayWidth(part.text), 0)
}

type CountCell = { width: number; parts: readonly Part[]; reservesMark: boolean }

type CountColumn = { width: number; cellOf: (path: string, isFolder: boolean) => CountCell }

type CountPath = { path: string; isFolder: boolean }

type ColumnPath = CountPath & { hasMark: boolean }

function countCellParts(lines: LineMarks, path: string, isFolder: boolean): Part[] {
  const found = isFolder ? lines.folderOf(path) : lines.fileOf(path)
  if (found === undefined) return []
  return found === BINARY ? [{ text: BINARY, dimColor: true }] : lineParts(found)
}

function countColumn(
  lines: LineMarks | undefined,
  paths: readonly CountPath[],
): CountColumn | undefined {
  if (lines === undefined) return undefined
  const width = Math.max(
    0,
    ...paths.map(({ path, isFolder }) => partsWidth(countCellParts(lines, path, isFolder))),
  )
  if (width === 0) return undefined
  return {
    width,
    cellOf: (path, isFolder) => ({
      width,
      parts: countCellParts(lines, path, isFolder),
      reservesMark: true,
    }),
  }
}

function valueOf(view: PaneView, path: string): ColumnValue | undefined {
  const { column } = view
  return columnValue(column.choice, column.factsOf(path), view.touched.now)
}

function valueColumn(view: PaneView, paths: readonly ColumnPath[]): CountColumn | undefined {
  const { column, git } = view
  const files = paths
    .filter(({ path, isFolder }) => !isFolder && git.marks?.letterOf(path) !== 'D')
    .map(({ path }) => path)
  column.want(files, column.choice === 'lines')
  const values = new Map(
    files.flatMap((path) => {
      const value = valueOf(view, path)
      return value === undefined ? [] : [[path, value.text] as const]
    }),
  )
  const width = Math.max(0, ...[...values.values()].map((text) => displayWidth(text)))
  if (width === 0) return undefined
  const reservesMark = paths.some(({ hasMark }) => hasMark)
  return {
    width,
    cellOf: (path, isFolder) => {
      const text = isFolder ? undefined : values.get(path)
      const parts = text === undefined ? [] : [{ text, dimColor: true }]
      return { width, parts, reservesMark }
    },
  }
}

function rightColumn(
  elements: PaneElements,
  view: PaneView,
  paths: readonly ColumnPath[],
): CountColumn | undefined {
  if (!hasRightColumn(elements)) return undefined
  if (view.column.choice === 'changes') return countColumn(view.git.lines, paths)
  return valueColumn(view, paths)
}

function nameRoom(
  width: number,
  touched: TouchDraw,
  mark: Mark | undefined,
  count: CountCell | undefined,
): number {
  const countRoom = count === undefined ? 0 : count.width + COUNT_GAP
  const hasMarkRoom = mark !== undefined || count?.reservesMark === true
  const markRoom = hasMarkRoom ? markWidth(touched.column) + MARK_GAP : 0
  return width - countRoom - markRoom
}

function markLabel(touched: TouchDraw, mark: Mark): string {
  return isShared(mark) ? sharedLabel(mark) : shownName(touched.labelOf(mark.agent))
}

function agePart(cell: { age: string; isNow: boolean }): Part {
  return cell.isNow ? { text: cell.age, bold: true } : { text: cell.age, dimColor: true }
}

function markParts(
  touched: TouchDraw,
  mark: Mark,
  site: { glyphs: GlyphSet; isNow: boolean },
): Part[] {
  const label = markLabel(touched, mark)
  const cell = markCell(touched.column, mark, { label, now: touched.now, ...site })
  return cell.age === '' ? [{ text: cell.mark }] : [{ text: cell.mark }, agePart(cell)]
}

type LineCells = { mark: Mark | undefined; count: CountCell | undefined; isNow: boolean }

function markedLine(
  parts: readonly Part[],
  width: number,
  touched: TouchDraw,
  cells: LineCells,
  glyphs: GlyphSet,
): { head: Part[]; tail: Part[] } {
  const { mark, count, isNow } = cells
  const room = nameRoom(width, touched, mark, count)
  const head = fittedParts(parts, room)
  const isCounted = count !== undefined && count.parts.length > 0
  if (mark === undefined && !isCounted) return { head, tail: [] }
  const gap = { text: ' '.repeat(Math.max(room - partsWidth(head), 0)) }
  const countTail =
    count === undefined
      ? []
      : [{ text: ' '.repeat(COUNT_GAP + count.width - partsWidth(count.parts)) }, ...count.parts]
  const markTail =
    mark === undefined
      ? []
      : [{ text: ' '.repeat(MARK_GAP) }, ...markParts(touched, mark, { glyphs, isNow })]
  return { head, tail: [gap, ...countTail, ...markTail] }
}

function folderColor(counts: readonly GitCount[]): LetterColor | undefined {
  const colors = new Set(counts.map(({ letter }) => LETTER_COLORS[letter]))
  return STRONGEST_FIRST.find((color) => colors.has(color))
}

function hasDotPart(name: string): boolean {
  return name.split('/').some((part) => part.startsWith('.'))
}

function isIgnoredPath(ignored: IgnoredMarks | undefined, path: string): boolean {
  return ignored?.isIgnored(path) === true
}

function folderLook(counts: readonly GitCount[], isDim: boolean): Look {
  const color = folderColor(counts)
  if (color !== undefined) return { color }
  return isDim ? { dimColor: true } : { color: PLAIN_FOLDER }
}

type FolderName = {
  name: string
  counts: readonly GitCount[]
  isIgnored: boolean
  isListed: boolean
}

function folderNameParts(lead: readonly Part[], label: string, folder: FolderName): Part[] {
  const isIgnored = folder.isIgnored && folder.counts.length === 0
  const look = folderLook(folder.counts, isIgnored || hasDotPart(folder.name))
  const word: Part[] =
    isIgnored && folder.isListed ? [{ text: `  ${IGNORED}`, dimColor: true }] : []
  return [...lead, { text: label, ...look }, ...word]
}

function treeFolderParts(
  elements: PaneElements,
  row: { name: string; depth: number; isOpen: boolean },
  folder: FolderName,
): Part[] {
  const role = row.isOpen ? 'folderOpen' : 'folderClosed'
  const indent: Part[] = row.depth === 0 ? [] : [{ text: indentOf(row.depth) }]
  const chevron: Part = { text: `${GLYPH_SETS.plain[role]} `, dimColor: true }
  const icon = elements.hasIcons ? `${elements.glyphs[role]} ` : ''
  return folderNameParts([...indent, chevron], `${icon}${shownName(row.name)}/`, folder)
}

function drawFolder(
  elements: PaneElements,
  row: EntryRow & { kind: 'folder' },
  draw: TreeDraw,
): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  const top = chainTop(row)
  const gitCounts = draw.marks?.countsOf(top) ?? []
  const isIgnored = isIgnoredPath(draw.ignored, row.path)
  const nameParts = treeFolderParts(elements, row, {
    name: row.name,
    counts: gitCounts,
    isIgnored,
    isListed: true,
  })
  const line = markedLine(
    [...nameParts, ...countParts(gitCounts)],
    bodyColumns,
    draw.touched,
    {
      mark: row.isOpen ? undefined : draw.touched.folderMark(row.path),
      count: draw.counts?.cellOf(top, true),
      isNow: false,
    },
    elements.glyphs,
  )
  return Box({
    key: `folder:${row.path}`,
    flexDirection: 'row',
    children: [
      Button({
        key: `open:${row.path}`,
        plain: true,
        onPress: () => {
          draw.actions.toggle(row.path)
        },
        children: drawParts(Text, padded([...line.head, ...line.tail], bodyColumns)),
      }),
    ],
  })
}

function drawPruned(
  elements: PaneElements,
  row: EntryRow & { kind: 'pruned' },
  draw: TreeDraw,
): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const parts = [
    ...treeFolderParts(
      elements,
      { ...row, isOpen: false },
      {
        name: row.name,
        counts: [],
        isIgnored: isIgnoredPath(draw.ignored, row.path),
        isListed: false,
      },
    ),
    { text: `  ${NOT_LISTED}` },
  ]
  return Box({
    key: `pruned:${row.path}`,
    flexDirection: 'row',
    children: drawParts(Text, fittedParts(parts, bodyColumns)),
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

function hasTypeIcons(elements: PaneElements): boolean {
  return elements.hasIcons && hasRightColumn(elements)
}

function typeIconParts(elements: PaneElements, name: string, isDim: boolean): Part[] {
  if (!hasTypeIcons(elements)) return []
  const { icon, family } = TYPE_ICONS[fileTypeOf(name)]
  const look: Look = isDim ? { dimColor: true } : { color: FAMILY_COLORS[family] }
  return [{ text: `${icon} `, ...look }]
}

type FileName = {
  lead: string
  slot: string
  name: string
  letter: GitLetter | undefined
  isDim: boolean
}

function fileNameParts(elements: PaneElements, file: FileName): Part[] {
  const shown = shownName(file.name)
  const icon = typeIconParts(elements, file.name, file.isDim)
  if (file.letter === undefined) {
    const lead = `${file.lead}${file.slot}`
    if (icon.length === 0) return [{ text: `${lead}${shown}`, dimColor: file.isDim }]
    return [{ text: lead }, ...icon, { text: shown, dimColor: file.isDim }]
  }
  const color = LETTER_COLORS[file.letter]
  const lead: Part[] = file.lead === '' ? [] : [{ text: file.lead }]
  return [...lead, { text: file.letter, color }, { text: ' ' }, ...icon, { text: shown, color }]
}

function rowBackground(isRunning: boolean): ThemeKey | undefined {
  return isRunning ? ROW_BACKGROUND : undefined
}

function fileLine(
  elements: PaneElements,
  row: EntryRow & { kind: 'file' },
  draw: TreeDraw,
): Part[] {
  const { bodyColumns } = elements
  const { marks, touched } = draw
  const mark = touched.fileMark(row.path)
  const letter = marks?.letterOf(row.path)
  const isDim = letter === undefined && (row.isDot || isIgnoredPath(draw.ignored, row.path))
  const count = draw.counts?.cellOf(row.path, false)
  const isRunning = touched.runsOn(row.path)
  const room = nameRoom(bodyColumns, touched, mark, count)
  const iconRoom = partsWidth(typeIconParts(elements, row.name, isDim))
  const depth =
    letter === undefined
      ? row.depth
      : Math.min(row.depth, Math.floor(Math.max(room - MARKED_ROOM - iconRoom, 0) / 2))
  const parts = fileNameParts(elements, {
    lead: indentOf(depth),
    slot: letter === undefined ? INDENT : '',
    name: row.name,
    letter,
    isDim,
  })
  const isNow = mark?.isRunning === true
  const line = markedLine(parts, bodyColumns, touched, { mark, count, isNow }, elements.glyphs)
  return onBackground(padded([...line.head, ...line.tail], bodyColumns), rowBackground(isRunning))
}

function stateWords(marks: GitMarks, path: string): string | undefined {
  const letter = marks.letterOf(path)
  if (letter === undefined) return undefined
  const word = STATE_WORDS[letter]
  if (UNSTAGED_LETTERS.has(letter)) return word
  return `${word}, ${marks.isStagedOf(path) ? 'staged' : 'not staged'}`
}

function stateText(
  marks: GitMarks,
  path: string,
  count: CountCell | undefined,
): string | undefined {
  const words = stateWords(marks, path)
  if (words === undefined || count === undefined || count.parts.length === 0) return words
  return `${words}${PART_GAP}${count.parts.map((part) => part.text).join('')}`
}

function folderOf(path: string): string | undefined {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? undefined : path.slice(0, cut)
}

function folderDiffSpecs(path: string, draw: TreeDraw): ButtonSpec[] {
  const folder = folderOf(path)
  if (folder === undefined || draw.marks === undefined) return []
  const counts = draw.marks.countsOf(folder)
  if (counts.length === 0 || !hasChangeList(counts)) return []
  return [
    {
      key: FOLDER_DIFF_KEY,
      label: `diff ${shownName(folder)}/`,
      onPress: () => {
        draw.actions.diff(folder, true)
      },
    },
  ]
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
    ...folderDiffSpecs(path, draw),
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
    .map((touch) => touchText(touch, (agent) => shownName(touched.labelOf(agent)), touched.now))
  const changes = draw.choice === 'changes' ? draw.counts?.cellOf(row.path, false) : undefined
  const state = marks === undefined ? undefined : stateText(marks, row.path, changes)
  const why = draw.whyOf(row.path)
  const lines = [...touches, ...[state, why].filter((line) => line !== undefined)]
  return [
    ...lines
      .flatMap((text) => wrapped(text, room))
      .map((text) => Text({ children: fitted(`${' '.repeat(indent)}${text}`, bodyColumns) })),
    ...buttonRows(elements, rowButtons(row.path, draw), { room, indent, key: 'opened' }),
  ]
}

function drawFile(
  elements: PaneElements,
  row: EntryRow & { kind: 'file' },
  draw: TreeDraw,
): RenderElement[] {
  const { Box, Text, Button } = elements
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
          children: drawParts(Text, fileLine(elements, row, draw)),
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
  ignored: IgnoredMarks | undefined
  counts: CountColumn | undefined
  choice: FiletreeColumn
  whyOf: (path: string) => string | undefined
  touched: TouchDraw
  opened: string | undefined
  isRepo: boolean
}

function drawEntry(elements: PaneElements, row: EntryRow, draw: TreeDraw): RenderElement[] {
  switch (row.kind) {
    case 'pruned':
      return [drawPruned(elements, row, draw)]
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

function moreButton(
  elements: PaneElements,
  more: { key: string; rowKey: string; path: string; indent: number; label: string },
  actions: PaneActions,
): RenderElement {
  const { Box, Button, bodyColumns } = elements
  return Box({
    key: more.rowKey,
    paddingLeft: more.indent,
    children: [
      Button({
        key: more.key,
        label: fitted(more.label, bodyColumns - more.indent - BUTTON_CHROME),
        onPress: () => {
          actions.showAll(more.path)
        },
      }),
    ],
  })
}

function drawMore(
  elements: PaneElements,
  row: TreeRow & { kind: 'more' },
  actions: PaneActions,
): RenderElement {
  const indent = displayWidth(indentOf(row.depth) + INDENT)
  const label = `+${countText(row.hidden)} more in ${shownName(row.name)}/`
  const keys = { key: `more:${row.path}`, rowKey: `more-row:${row.path}` }
  return moreButton(elements, { ...keys, path: row.path, indent, label }, actions)
}

function drawWorkMore(
  elements: PaneElements,
  row: TreeRow & { kind: 'workMore' },
  actions: PaneActions,
): RenderElement {
  const folders = `${countText(row.folders)} ${row.folders === 1 ? 'folder' : 'folders'}`
  const label =
    row.changed === 0
      ? `+${countText(row.rows)} more`
      : `+${countText(row.changed)} changed in ${folders}`
  const keys = { key: WORK_MORE_KEY, rowKey: `${WORK_MORE_KEY}-row` }
  return moreButton(elements, { ...keys, path: row.path, indent: 0, label }, actions)
}

function drawRow(elements: PaneElements, row: TreeRow, draw: TreeDraw): RenderElement[] {
  switch (row.kind) {
    case 'more':
      return [drawMore(elements, row, draw.actions)]
    case 'workMore':
      return [drawWorkMore(elements, row, draw.actions)]
    case 'failed':
      return [drawFailed(elements, row)]
    case 'empty':
      return [elements.Text({ dimColor: true, children: 'This folder is empty.' })]
    default:
      return drawEntry(elements, row, draw)
  }
}

function drawNoWork(elements: PaneElements, actions: PaneActions): RenderElement[] {
  const { Box, Text, Button, bodyColumns } = elements
  const spec: ButtonSpec = {
    key: 'all-files',
    label: VIEW_LABELS.work,
    onPress: () => {
      actions.switchView()
    },
  }
  const button = buttonOf(Button, spec, Math.max(bodyColumns - BUTTON_CHROME, 1))
  const hint = ` ${ALL_FILES_HINT}`
  const lead = wrapped(NO_WORK, bodyColumns).map((part) => Text({ children: part }))
  if (rowWidth([spec]) + displayWidth(hint) <= bodyColumns) {
    return [...lead, Box({ flexDirection: 'row', children: [button, Text({ children: hint })] })]
  }
  return [
    ...lead,
    Box({ flexDirection: 'row', children: [button] }),
    ...wrapped(ALL_FILES_HINT, bodyColumns).map((part) => Text({ children: part })),
  ]
}

function drawCutNote(elements: PaneElements, view: PaneView): RenderElement[] {
  const { Box, Text, Button, bodyColumns } = elements
  const lines = (text: string) => wrapped(text, bodyColumns).map((part) => Text({ children: part }))
  const isWorkTree = view.choice === 'work' || view.touched.task !== undefined
  if (isWorkTree) return [...lines(CUT_NOTE), ...lines(`${CLOSE_FOLDER}.`)]
  const spec: ButtonSpec = {
    key: CUT_VIEW_KEY,
    label: VIEW_LABELS.all,
    onPress: () => {
      view.actions.switchView()
    },
  }
  const ask = `${CLOSE_FOLDER}, or `
  const button = buttonOf(Button, spec, Math.max(bodyColumns - BUTTON_CHROME - 1, 1))
  const end = Text({ children: '.' })
  if (displayWidth(ask) + rowWidth([spec]) + 1 <= bodyColumns) {
    return [
      ...lines(CUT_NOTE),
      Box({ flexDirection: 'row', children: [Text({ children: ask }), button, end] }),
    ]
  }
  return [
    ...lines(CUT_NOTE),
    ...lines(ask.trimEnd()),
    Box({ flexDirection: 'row', children: [button, end] }),
  ]
}

function isEntry(row: TreeRow): row is EntryRow {
  return row.kind === 'file' || row.kind === 'folder' || row.kind === 'pruned'
}

function treeCountPath(row: EntryRow): CountPath {
  switch (row.kind) {
    case 'file':
      return { path: row.path, isFolder: false }
    case 'folder':
      return { path: chainTop(row), isFolder: true }
    case 'pruned':
      return { path: row.path, isFolder: true }
  }
}

function flatCountPath(row: EntryRow): CountPath {
  return { path: row.path, isFolder: row.kind !== 'file' }
}

function workNote(elements: PaneElements, rows: readonly TreeRow[]): RenderElement[] {
  if (!rows.some(isEntry)) return []
  return wrapped(WORK_NOTE, elements.bodyColumns).map((part) =>
    elements.Text({ dimColor: true, children: part }),
  )
}

function rowMark(row: EntryRow, touched: TouchDraw): Mark | undefined {
  switch (row.kind) {
    case 'file':
      return touched.fileMark(row.path)
    case 'folder':
      return row.isOpen ? undefined : touched.folderMark(row.path)
    case 'pruned':
      return undefined
  }
}

function columnPaths(
  rows: readonly EntryRow[],
  touched: TouchDraw,
  pathOf: (row: EntryRow) => CountPath,
): ColumnPath[] {
  return rows.map((row) => ({ ...pathOf(row), hasMark: rowMark(row, touched) !== undefined }))
}

function whyOf(elements: PaneElements, view: PaneView): (path: string) => string | undefined {
  return (path) => (hasRightColumn(elements) ? valueOf(view, path)?.why : undefined)
}

export function drawTree(
  elements: PaneElements,
  rootName: string,
  rows: readonly TreeRow[],
  view: PaneView,
): RenderElement {
  const { Box, bodyColumns } = elements
  const { git, actions, touched, opened } = view
  const isTask = touched.task !== undefined
  const isWork = view.choice === 'work' && !isTask
  const isCut = rows.length > TREE_ROWS
  const drawn = isCut ? rows.slice(0, TREE_ROWS) : rows
  const paths = columnPaths(drawn.filter(isEntry), touched, treeCountPath)
  const draw: TreeDraw = {
    actions,
    marks: git.marks,
    ignored: git.ignored,
    counts: rightColumn(elements, view, paths),
    choice: view.column.choice,
    whyOf: whyOf(elements, view),
    touched,
    opened,
    isRepo: git.isRepo,
  }
  const body =
    isWork && rows.length === 0
      ? drawNoWork(elements, actions)
      : [
          ...drawn.flatMap((row) => drawRow(elements, row, draw)),
          ...(isCut ? drawCutNote(elements, view) : []),
        ]
  return Box({
    flexDirection: 'column',
    children: [
      drawHeader(elements, rootName, git, bodyColumns, 'two'),
      ...drawTop(elements, view),
      drawRule(elements, view.column),
      ...body,
      ...drawNotes(elements, git.footer, actions),
      ...(isWork ? workNote(elements, rows) : []),
    ],
  })
}

function flatParts(elements: PaneElements, row: EntryRow, view: PaneView): Part[] {
  const { git } = view
  const { marks } = git
  const name = shownName(row.name)
  const slot = git.isRepo ? INDENT : ''
  switch (row.kind) {
    case 'pruned':
      return [{ text: `${slot}${name}/  ${NOT_LISTED}` }]
    case 'folder': {
      const counts = marks?.countsOf(row.path) ?? []
      const isIgnored = isIgnoredPath(git.ignored, row.path)
      const folder = { name: row.name, counts, isIgnored, isListed: true }
      return [...folderNameParts([{ text: slot }], `${name}/`, folder), ...countParts(counts)]
    }
    case 'file': {
      const letter = marks?.letterOf(row.path)
      const isDim = letter === undefined && (row.isDot || isIgnoredPath(git.ignored, row.path))
      return fileNameParts(elements, { lead: '', slot, name: row.name, letter, isDim })
    }
  }
}

function flatRow(
  elements: PaneElements,
  row: EntryRow,
  view: PaneView,
  counts: CountColumn | undefined,
): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const { touched } = view
  const { path, isFolder } = flatCountPath(row)
  const isRunning = row.kind === 'file' && touched.runsOn(row.path)
  const mark = rowMark(row, touched)
  const line = markedLine(
    flatParts(elements, row, view),
    bodyColumns,
    touched,
    {
      mark,
      count: counts?.cellOf(path, isFolder),
      isNow: row.kind === 'file' && mark?.isRunning === true,
    },
    elements.glyphs,
  )
  const parts = [...line.head, ...line.tail]
  return Box({
    key: `flat:${row.path}`,
    flexDirection: 'row',
    children: drawParts(
      Text,
      isRunning ? onBackground(padded(parts, bodyColumns), ROW_BACKGROUND) : parts,
    ),
  })
}

function inlineRows(
  elements: PaneElements,
  site: { root: Listing; rootName: string; work: readonly WorkPath[] },
  view: PaneView,
): RenderElement[] {
  const { Text, bodyColumns } = elements
  const { root, rootName, work } = site
  if (root.kind === 'failed') {
    return [drawFailed(elements, { name: rootName, depth: 0, reason: root.reason })]
  }
  if (root.sorted.length === 0) {
    return [Text({ dimColor: true, children: 'This folder is empty.' })]
  }
  if (work.length === 0) return [Text({ children: fitted(NO_WORK, bodyColumns) })]
  const rows = work.map(flatEntryRow)
  const shown = rows.length <= INLINE_ROWS ? rows : rows.slice(0, INLINE_ROWS - 1)
  const counts = rightColumn(elements, view, columnPaths(shown, view.touched, flatCountPath))
  const drawn = shown.map((row) => flatRow(elements, row, view, counts))
  if (rows.length <= INLINE_ROWS) return drawn
  const hidden = countText(rows.length - shown.length)
  return [
    ...drawn,
    Text({ dimColor: true, children: fitted(`+${hidden} more: ${DOCK_HINT}`, bodyColumns) }),
  ]
}

export function drawInline(
  elements: PaneElements,
  site: { root: Listing; rootName: string; work: readonly WorkPath[] },
  view: PaneView,
): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  const select = filterSelect(elements, view.touched)
  const filterRoom =
    select.length === 0 ? 0 : filterWidth(elements, view.touched) + displayWidth(INLINE_GAP)
  const columns = hasRightColumn(elements) ? [columnSpec(view.column)] : []
  const columnRoom = columns.length === 0 ? 0 : rowWidth(columns) + BUTTON_GAP
  const headerWidth =
    bodyColumns - displayWidth(REFRESH) - BUTTON_CHROME - BUTTON_GAP - filterRoom - columnRoom
  const gap = select.length === 0 ? [] : [Text({ children: INLINE_GAP })]
  const columnButtons = columns.flatMap((spec) => [
    buttonOf(Button, spec, bodyColumns),
    Text({ children: ' ' }),
  ])
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          drawHeader(elements, site.rootName, view.git, headerWidth, 'one'),
          Box({
            flexDirection: 'row',
            children: [...select, ...gap, ...columnButtons, refreshButton(elements, view.actions)],
          }),
        ],
      }),
      ...inlineRows(elements, site, view),
    ],
  })
}
