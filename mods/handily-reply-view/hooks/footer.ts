import type {
  ConfigRow,
  EngineInterface,
  RenderElement,
  RenderInput,
  SessionAppendMessage,
} from 'claude-code'
import type { ReplyElements } from './draw'
import { paletteColor, type PaletteSetting } from './palette'
import { clockTime } from './prompt'
import { displayWidth } from './width'

export type TurnLine = { word: string; durationMs: number; endedAt: number | undefined }

type FooterElements = Pick<ReplyElements, 'Box' | 'Text'>

type LineEnd = { done: string; time: string }

const GLYPH = '✻'
const GLYPH_COLUMNS = 2
const SEPARATOR = ' · '
const DONE = 'done '
const SECOND = 1000
const MINUTE_SECONDS = 60
const HOUR_SECONDS = 60 * MINUTE_SECONDS
const DAY_SECONDS = 24 * HOUR_SECONDS
const TURN_LINE_ROW = 'turn_duration'
const TURN_DURATION_ROW = 'turnDuration'
const SHOWS_TURN_DURATION = { plugin: 'handily-reply-view', key: 'showsTurnDuration' } as const

function engineDuration(ms: number): string {
  if (ms < MINUTE_SECONDS * SECOND) return `${String(Math.floor(ms / SECOND))}s`
  const total = Math.round(ms / SECOND)
  const days = Math.floor(total / DAY_SECONDS)
  const hours = Math.floor((total % DAY_SECONDS) / HOUR_SECONDS)
  const minutes = Math.floor((total % HOUR_SECONDS) / MINUTE_SECONDS)
  const seconds = total % MINUTE_SECONDS
  if (days > 0) return `${String(days)}d ${String(hours)}h ${String(minutes)}m`
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m ${String(seconds)}s`
  return `${String(minutes)}m ${String(seconds)}s`
}

export function isEngineTurnLine(e: RenderInput<'TurnDuration'>): boolean {
  const { durationMs, isExpanded, waitingFor } = e.props
  const isReadable = Number.isFinite(durationMs) && durationMs >= 0
  return e.surface !== 'terminal' || isExpanded === true || waitingFor !== undefined || !isReadable
}

function lineEndOf(head: string, time: string | undefined, columns: number): LineEnd | undefined {
  if (time === undefined) return undefined
  const ends: LineEnd[] = [
    { done: DONE, time },
    { done: '', time },
  ]
  return ends.find(
    (end) => GLYPH_COLUMNS + displayWidth(`${head}${SEPARATOR}${end.done}${end.time}`) <= columns,
  )
}

export function turnLine(
  elements: FooterElements,
  line: TurnLine,
  columns: number,
  palette: PaletteSetting,
): RenderElement {
  const { Box, Text } = elements
  const color = paletteColor('number', palette)
  const word = `${line.word} for `
  const duration = engineDuration(line.durationMs)
  const time = line.endedAt === undefined ? undefined : clockTime(line.endedAt)
  const end = lineEndOf(`${word}${duration}`, time, columns)
  return Box({
    flexDirection: 'row',
    marginTop: 1,
    width: '100%',
    children: [
      Box({ minWidth: GLYPH_COLUMNS, children: Text({ dimColor: true, children: GLYPH }) }),
      Text({
        children: [
          Text({ dimColor: true, children: word }),
          Text({ color, children: duration }),
          ...(end === undefined
            ? []
            : [
                Text({ dimColor: true, children: `${SEPARATOR}${end.done}` }),
                Text({ color, children: end.time }),
              ]),
        ],
      }),
    ],
  })
}

export function isTurnLineRow(message: SessionAppendMessage): boolean {
  return message.type === 'system' && message.name === TURN_LINE_ROW
}

export async function keepTurnEnd(
  $: EngineInterface,
  requestId: string,
  endedAt: number,
): Promise<void> {
  await $.state.set({ plugin: 'handily-reply-view', key: 'endedAt', id: requestId }, endedAt)
}

export async function turnEndOf(
  $: EngineInterface,
  requestId: string,
): Promise<number | undefined> {
  if (requestId === '') return undefined
  const { value } = await $.state.get({
    plugin: 'handily-reply-view',
    key: 'endedAt',
    id: requestId,
  })
  return value
}

function showsTurnDurationIn(rows: readonly ConfigRow[]): boolean {
  return rows.find((row) => row.key === TURN_DURATION_ROW)?.value === true
}

export async function keepTurnDurationSetting($: EngineInterface): Promise<void> {
  try {
    await $.state.set(SHOWS_TURN_DURATION, showsTurnDurationIn(await $.config.list()))
  } catch (error) {
    $.ui.log(`handily-reply-view: the Show turn duration setting was not read: ${String(error)}`, {
      to: 'debug',
    })
  }
}

export async function keepChangedTurnDurationSetting(
  $: EngineInterface,
  key: string,
): Promise<void> {
  if (key === TURN_DURATION_ROW) await keepTurnDurationSetting($)
}

export async function showsTurnDuration($: EngineInterface): Promise<boolean> {
  return (await $.state.get(SHOWS_TURN_DURATION)).value === true
}
