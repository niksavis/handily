import type {
  AgentStatus,
  ConfigRow,
  EngineInterface,
  RenderElement,
  RenderInput,
  SessionAppendMessage,
} from 'claude-code'
import type { ReplyElements } from './draw'
import { paletteColor, type PaletteSetting } from './palette'
import { endTimeText, type TimeFormat } from './turn-time'
import { displayWidth } from './width'

export type TurnLine = { word: string; durationMs: number; endTime: string | undefined }

export type BackgroundTask = { id: string; type: string }

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
const BACKGROUND_TASKS = { plugin: 'handily-reply-view', key: 'backgroundTasks' } as const
const WORK_VERSION = { plugin: 'handily-reply-view', key: 'workVersion' } as const
const RUNNING_AGENT: readonly AgentStatus[] = ['pending', 'running', 'waiting']
const AGENT_TASK = 'subagent'

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
  const end = lineEndOf(`${word}${duration}`, line.endTime, columns)
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

export async function endTimeOf(
  $: EngineInterface,
  requestId: string,
  format: TimeFormat,
): Promise<string | undefined> {
  if (requestId === '') return undefined
  const { value: endedAt } = await $.state.get({
    plugin: 'handily-reply-view',
    key: 'endedAt',
    id: requestId,
  })
  return endedAt === undefined ? undefined : endTimeText(endedAt, await $.clock.now(), format)
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

export async function keepBackgroundTasks(
  $: EngineInterface,
  tasks: readonly BackgroundTask[] | undefined,
): Promise<void> {
  const kept = (tasks ?? []).filter((task) => task.type !== AGENT_TASK).map((task) => task.id)
  await $.state.set(BACKGROUND_TASKS, kept)
}

export async function noteWorkChange($: EngineInterface): Promise<void> {
  const { value: version = 0 } = await $.state.get(WORK_VERSION)
  await $.state.set(WORK_VERSION, version + 1)
}

export async function isWorkRunning($: EngineInterface): Promise<boolean> {
  await $.state.get(WORK_VERSION)
  const { value: tasks = [] } = await $.state.get(BACKGROUND_TASKS)
  if (tasks.length > 0) return true
  const agents = await $.agent.list()
  return agents.some((agent) => RUNNING_AGENT.includes(agent.status))
}
