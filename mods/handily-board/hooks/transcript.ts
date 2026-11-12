import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { BoardCallRow, BoardList, BoardStatus, BoardTask } from '../types'
import type { SignalLooks } from './signals'
import { doneCount, idsText, ownList, paneTaskText, statusLook, statusWord } from './tasks'
import { displayWidth, fitted } from './width'

type RowElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

export type CallRowLook = { elements: RowElements; hasToolMarker: boolean; signals: SignalLooks }

type Part = { text: string; color?: ThemeKey }

type AddedManyRow = Extract<BoardCallRow, { kind: 'addedMany' }>

const MARKER = '●'
const MARKER_WIDTH = displayWidth(`${MARKER} `)
const TITLE_GAP = 2
const TITLE_JOIN = ' · '
const RANGE_FROM = 3
const CUT_MARK = '…'

export function addedRow(task: BoardTask): BoardCallRow {
  return { kind: 'added', id: task.id, title: paneTaskText(task) }
}

export function addedManyRow(tasks: readonly BoardTask[], before: number | null): BoardCallRow {
  return {
    kind: 'addedMany',
    ids: tasks.map((task) => task.id),
    before,
    titles: tasks.map(paneTaskText),
  }
}

export function statusRow(task: BoardTask, status: BoardStatus): BoardCallRow {
  return { kind: 'status', id: task.id, status, title: paneTaskText(task) }
}

export function removedRow(task: BoardTask): BoardCallRow {
  return { kind: 'removed', id: task.id, title: paneTaskText(task) }
}

export function movedRow(task: BoardTask, before: number): BoardCallRow {
  return { kind: 'moved', id: task.id, before, title: paneTaskText(task) }
}

export function listRow(list: BoardList): BoardCallRow {
  const own = ownList(list)
  return { kind: 'list', done: doneCount(own), total: own.tasks.length }
}

function taskName(id: number): string {
  return `Task ${String(id)}`
}

function isRun(ids: readonly number[]): boolean {
  return ids.every((id, index) => index === 0 || ids[index - 1] === id - 1)
}

function moreMark(hidden: number): string {
  return `+${String(hidden)}`
}

function listedIds(ids: readonly number[], hidden: number): string {
  const listed = ids
    .slice(0, ids.length - hidden)
    .map(String)
    .join(', ')
  return hidden === 0 ? listed : `${listed} ${moreMark(hidden)}`
}

function manyHead(row: AddedManyRow, ids: string): string {
  const place = row.before === null ? '' : ` before ${String(row.before)}`
  return `Tasks ${ids} added${place}`
}

function fittedManyHead(row: AddedManyRow, room: number | undefined): string {
  const { ids } = row
  if (ids.length >= RANGE_FROM && isRun(ids)) return manyHead(row, idsText(ids))
  const lastHidden = ids.length - 1
  for (let hidden = 0; hidden < lastHidden; hidden += 1) {
    const head = manyHead(row, listedIds(ids, hidden))
    if (room === undefined || displayWidth(head) <= room) return head
  }
  return manyHead(row, listedIds(ids, lastHidden))
}

function shownTitles(titles: readonly string[], shown: number, room: number): string | undefined {
  const hidden = titles.length - shown
  const mark = hidden === 0 ? '' : `${' '.repeat(TITLE_GAP)}${moreMark(hidden)}`
  const joined = titles.slice(0, shown).join(TITLE_JOIN)
  const text = fitted(joined, room - displayWidth(mark))
  const kept = text === joined ? joined : text.slice(0, -CUT_MARK.length)
  const lead = titles.slice(0, shown - 1).join(TITLE_JOIN)
  const leadLength = shown === 1 ? 0 : lead.length + TITLE_JOIN.length
  return kept.length > leadLength ? `${text}${mark}` : undefined
}

function fittedTitles(titles: readonly string[], room: number): string {
  for (let shown = titles.length; shown > 0; shown -= 1) {
    const tail = shownTitles(titles, shown, room)
    if (tail !== undefined) return tail
  }
  return ''
}

function markPart(status: BoardStatus, signals: SignalLooks): Part {
  const { mark, color } = statusLook(status, signals)
  return { text: mark, color }
}

function headOf(row: BoardCallRow, signals: SignalLooks, room: number | undefined): Part[] {
  switch (row.kind) {
    case 'added':
      return [{ text: `${taskName(row.id)} added` }]
    case 'addedMany':
      return [{ text: fittedManyHead(row, room) }]
    case 'status':
      return [
        { text: `${taskName(row.id)} ` },
        markPart(row.status, signals),
        { text: ` ${statusWord(row.status)}` },
      ]
    case 'removed':
      return [{ text: `${taskName(row.id)} removed` }]
    case 'moved':
      return [{ text: `${taskName(row.id)} moved before ${String(row.before)}` }]
    case 'list':
      return [{ text: 'Task list' }]
  }
}

function tailOf(row: BoardCallRow): string {
  switch (row.kind) {
    case 'addedMany':
      return row.titles.join(TITLE_JOIN)
    case 'list':
      return row.total === 0 ? 'empty' : `${String(row.done)} of ${String(row.total)} done`
    default:
      return row.title
  }
}

function rowWidthOf(look: CallRowLook, columns: number | undefined): number | undefined {
  if (columns === undefined) return undefined
  return columns - (look.hasToolMarker ? MARKER_WIDTH : 0)
}

function tailRoom(head: readonly Part[], rowWidth: number): number {
  const headWidth = head.reduce((sum, part) => sum + displayWidth(part.text), 0)
  return rowWidth - headWidth - TITLE_GAP
}

function shownTail(row: BoardCallRow, head: readonly Part[], rowWidth: number | undefined) {
  if (rowWidth === undefined) return tailOf(row)
  const room = tailRoom(head, rowWidth)
  if (room < 1) return ''
  return row.kind === 'addedMany' ? fittedTitles(row.titles, room) : fitted(tailOf(row), room)
}

export function drawCallRow(look: CallRowLook, row: BoardCallRow, columns?: number): RenderElement {
  const { Box, Text } = look.elements
  const rowWidth = rowWidthOf(look, columns)
  const head = headOf(row, look.signals, rowWidth)
  const tail = shownTail(row, head, rowWidth)
  const headBox = Box({
    flexDirection: 'row',
    flexShrink: 0,
    children: head.map((part) => Text({ color: part.color, children: part.text })),
  })
  const tailBox =
    tail === ''
      ? null
      : Box({
          flexShrink: 1,
          marginLeft: TITLE_GAP,
          children: Text({ dimColor: row.kind === 'list', wrap: 'truncate-end', children: tail }),
        })
  const marker = look.hasToolMarker
    ? Box({
        flexShrink: 0,
        marginRight: 1,
        children: Text({ color: 'success', children: MARKER }),
      })
    : null
  return Box({ key: 'row', flexDirection: 'row', children: [marker, headBox, tailBox] })
}
