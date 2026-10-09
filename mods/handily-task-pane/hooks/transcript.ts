import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { TaskPaneCallRow, TaskPaneList, TaskPaneStatus, TaskPaneTask } from '../types'
import { doneCount, paneTaskText, statusMark, statusWord } from './tasks'
import { displayWidth, fitted } from './width'

type RowElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

export type CallRowLook = { elements: RowElements; hasToolMarker: boolean }

type Part = { text: string; color?: ThemeKey }

const MARKER = '●'
const MARKER_WIDTH = displayWidth(`${MARKER} `)
const TITLE_GAP = 2

const MARK_COLORS: Record<TaskPaneStatus, ThemeKey> = {
  pending: 'subtle',
  in_progress: 'claude',
  completed: 'success',
}

export function addedRow(task: TaskPaneTask): TaskPaneCallRow {
  return { kind: 'added', id: task.id, title: paneTaskText(task) }
}

export function statusRow(task: TaskPaneTask, status: TaskPaneStatus): TaskPaneCallRow {
  return { kind: 'status', id: task.id, status, title: paneTaskText(task) }
}

export function removedRow(task: TaskPaneTask): TaskPaneCallRow {
  return { kind: 'removed', id: task.id, title: paneTaskText(task) }
}

export function movedRow(task: TaskPaneTask, before: number): TaskPaneCallRow {
  return { kind: 'moved', id: task.id, before, title: paneTaskText(task) }
}

export function listRow(list: TaskPaneList): TaskPaneCallRow {
  return { kind: 'list', done: doneCount(list), total: list.tasks.length }
}

function taskName(id: number): string {
  return `Task ${String(id)}`
}

function headOf(row: TaskPaneCallRow): Part[] {
  switch (row.kind) {
    case 'added':
      return [{ text: `${taskName(row.id)} added` }]
    case 'status':
      return [
        { text: `${taskName(row.id)} ` },
        { text: statusMark(row.status), color: MARK_COLORS[row.status] },
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

function tailOf(row: TaskPaneCallRow): string {
  if (row.kind !== 'list') return row.title
  if (row.total === 0) return 'empty'
  return `${String(row.done)} of ${String(row.total)} done`
}

function tailRoom(look: CallRowLook, head: readonly Part[], columns: number): number {
  const marker = look.hasToolMarker ? MARKER_WIDTH : 0
  const headWidth = head.reduce((sum, part) => sum + displayWidth(part.text), 0)
  return columns - marker - headWidth - TITLE_GAP
}

function shownTail(
  look: CallRowLook,
  row: TaskPaneCallRow,
  head: readonly Part[],
  columns?: number,
) {
  const tail = tailOf(row)
  if (columns === undefined) return tail
  const room = tailRoom(look, head, columns)
  return room < 1 ? '' : fitted(tail, room)
}

export function drawCallRow(
  look: CallRowLook,
  row: TaskPaneCallRow,
  columns?: number,
): RenderElement {
  const { Box, Text } = look.elements
  const head = headOf(row)
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
