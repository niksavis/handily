import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { BoardCallRow, BoardList, BoardStatus, BoardTask } from '../types'
import type { SignalLooks } from './signals'
import { doneCount, ownList, paneTaskText, statusLook, statusWord } from './tasks'
import { displayWidth, fitted } from './width'

type RowElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

export type CallRowLook = { elements: RowElements; hasToolMarker: boolean; signals: SignalLooks }

type Part = { text: string; color?: ThemeKey }

const MARKER = '●'
const MARKER_WIDTH = displayWidth(`${MARKER} `)
const TITLE_GAP = 2

export function addedRow(task: BoardTask): BoardCallRow {
  return { kind: 'added', id: task.id, title: paneTaskText(task) }
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

function markPart(status: BoardStatus, signals: SignalLooks): Part {
  const { mark, color } = statusLook(status, signals)
  return { text: mark, color }
}

function headOf(row: BoardCallRow, signals: SignalLooks): Part[] {
  switch (row.kind) {
    case 'added':
      return [{ text: `${taskName(row.id)} added` }]
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
  if (row.kind !== 'list') return row.title
  if (row.total === 0) return 'empty'
  return `${String(row.done)} of ${String(row.total)} done`
}

function tailRoom(look: CallRowLook, head: readonly Part[], columns: number): number {
  const marker = look.hasToolMarker ? MARKER_WIDTH : 0
  const headWidth = head.reduce((sum, part) => sum + displayWidth(part.text), 0)
  return columns - marker - headWidth - TITLE_GAP
}

function shownTail(look: CallRowLook, row: BoardCallRow, head: readonly Part[], columns?: number) {
  const tail = tailOf(row)
  if (columns === undefined) return tail
  const room = tailRoom(look, head, columns)
  return room < 1 ? '' : fitted(tail, room)
}

export function drawCallRow(look: CallRowLook, row: BoardCallRow, columns?: number): RenderElement {
  const { Box, Text } = look.elements
  const head = headOf(row, look.signals)
  const tail = shownTail(look, row, head, columns)
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
