import type { BoxProps, ElementConstructor, RenderElement, TextProps, ThemeKey } from 'claude-code'
import type { BoardActivity, BoardList, BoardTask } from '../types'
import { elapsedText } from './activity'
import { SIGNALS, type SignalLook } from './signals'
import { doneCount, escaped, paneTaskText, statusLook } from './tasks'
import { displayWidth, fitted } from './width'

export type MachineElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  bodyColumns: number
}

export type MachineWork = {
  now: number
  cwd: string
  list: BoardList
  activity: BoardActivity
}

const OWN_NAME = 'this'
const CARD_INDENT = 2
const BAR_CELLS_AT_MOST = 8
const BAR_DONE = '▰'
const BAR_TO_DO = '▱'
const PATH_SEPARATOR = /[/\\]/

export function progressBar(done: number, total: number): string {
  const cells = Math.min(total, BAR_CELLS_AT_MOST)
  const filled = Math.floor((done * cells) / total)
  return BAR_DONE.repeat(filled) + BAR_TO_DO.repeat(cells - filled)
}

function currentTask(list: BoardList): BoardTask | undefined {
  return (
    list.tasks.find((task) => task.status === 'in_progress') ??
    list.tasks.find((task) => task.status === 'pending')
  )
}

function cardLook(list: BoardList): SignalLook {
  const current = currentTask(list)
  if (current) return statusLook(current.status)
  return list.tasks.length === 0 ? SIGNALS.toDo : SIGNALS.done
}

function lastSegment(path: string): string {
  const segments = path.split(PATH_SEPARATOR).filter((segment) => segment !== '')
  return segments.at(-1) ?? path
}

type Part = { text: string; color?: ThemeKey; dimColor?: boolean; bold?: boolean }

function drawParts(elements: MachineElements, key: string, parts: readonly Part[]) {
  const { Box, Text } = elements
  return Box({
    key,
    flexDirection: 'row',
    children: parts.map(({ text, ...style }) => Text({ ...style, children: text })),
  })
}

function taskParts(list: BoardList, columns: number): Part[] {
  const total = list.tasks.length
  if (total === 0) return [{ text: 'no tasks', dimColor: true }]
  const done = doneCount(list)
  const current = currentTask(list)
  const look = current ? statusLook(current.status) : SIGNALS.done
  const title = current ? paneTaskText(current) : `all ${String(total)} done`
  const progress = ` ${progressBar(done, total)} ${String(done)}/${String(total)}`
  const lead = `${look.mark} `
  const room = columns - displayWidth(lead) - displayWidth(progress)
  return [
    { text: lead, color: look.color },
    { text: fitted(title, Math.max(room, 0)) },
    { text: progress, dimColor: true },
  ]
}

function placeText(work: MachineWork): string {
  const place = escaped(lastSegment(work.cwd))
  const { firstAt } = work.activity
  if (firstAt === null) return place
  return `${place} · ${elapsedText(work.now - firstAt)} elapsed`
}

export function drawMachine(elements: MachineElements, work: MachineWork): RenderElement {
  const { Box, Text, bodyColumns } = elements
  const detailColumns = Math.max(bodyColumns - CARD_INDENT, 0)
  const look = cardLook(work.list)
  return Box({
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: 'Sessions' }),
      drawParts(elements, 'card:this', [
        { text: `${look.mark} `, color: look.color },
        { text: OWN_NAME, bold: true },
      ]),
      Box({
        key: 'card:this:task',
        paddingLeft: CARD_INDENT,
        children: [drawParts(elements, 'task', taskParts(work.list, detailColumns))],
      }),
      Box({
        key: 'card:this:place',
        paddingLeft: CARD_INDENT,
        children: [Text({ dimColor: true, children: fitted(placeText(work), detailColumns) })],
      }),
    ],
  })
}
