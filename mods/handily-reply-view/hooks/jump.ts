import type { UiOpenResult, UiPane, UiScrollResult } from 'claude-code'
import { plural } from './draw'
import { clockTime } from './prompt'
import {
  atNumber,
  promptAt,
  promptsOf,
  shownLinesOf,
  toolCount,
  type Rail,
  type RailPrompt,
} from './rail'
import { marked, type ToastParts } from './toast'
import { fitted } from './width'

export const PROMPTS_PANE = { id: 'prompts', title: 'prompts' } as const

export type RailPort = {
  scroll: (requestId: string) => Promise<UiScrollResult>
  pane: () => Promise<UiPane | undefined>
  open: () => Promise<UiOpenResult>
  close: () => Promise<void>
  showToast: (parts: ToastParts) => void
  log: (text: string) => void
  redraw: () => Promise<void>
  hasEarlierPrompts: () => Promise<boolean>
}

export type RailCommand =
  | { kind: 'toggle' }
  | { kind: 'close' }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'prompt'; number: number }

export type Jumped = { isMoved: true } | { isMoved: false; words: string }

export const NO_PROMPT_TEXT =
  'No prompt yet in this session. The prompts tab opens after your first prompt.'
const CLOSED_TEXT = 'Prompts tab closed.'
const RESUMED_TEXT =
  'No prompt since this session resumed. Prompts from before the resume are not listed. The prompts tab opens after your next prompt.'
const GONE = 'that prompt is no longer in this list'
const NOT_OPEN_TEXT = 'The prompts tab is not open. Run /replies prompts to open it.'
const FULLSCREEN_ONLY = 'jumps work in fullscreen only'
const NOT_DRAWN = 'its row is no longer drawn'
const NOT_MOVED = 'Claude Code did not move the transcript'
const NOT_DRAWN_DENY = 'nothing drawn'
const PROMPT_NUMBER = /^[1-9]\d{0,8}$/
const QUOTED_COLUMNS = 60

export function railCommandOf(words: readonly string[]): RailCommand | undefined {
  const [first, second, ...rest] = words
  if (rest.length > 0) return undefined
  if (first === 'prompts') {
    if (second === undefined) return { kind: 'toggle' }
    return second === 'close' ? { kind: 'close' } : undefined
  }
  if (second === undefined && (first === 'next' || first === 'prev')) return { kind: first }
  if (first === 'prompt' && second !== undefined && PROMPT_NUMBER.test(second)) {
    return { kind: 'prompt', number: Number(second) }
  }
  return undefined
}

function refusalWords(deny: string, isFullscreen: boolean | undefined): string {
  if (isFullscreen === false) return FULLSCREEN_ONLY
  return deny.includes(NOT_DRAWN_DENY) ? NOT_DRAWN : NOT_MOVED
}

async function denyOf(port: RailPort, prompt: RailPrompt): Promise<string | undefined> {
  try {
    return (await port.scroll(prompt.requestId)).deny
  } catch (error) {
    return String(error)
  }
}

async function refused(rail: Rail, port: RailPort, number: number, words: string): Promise<Jumped> {
  rail.failure = { number, words }
  await port.redraw()
  return { isMoved: false, words }
}

export async function jumpTo(
  rail: Rail,
  port: RailPort,
  number: number,
  isFullscreen: boolean | undefined,
  requestId?: string,
): Promise<Jumped> {
  const prompt = promptAt(rail, number)
  if (prompt === undefined || (requestId !== undefined && prompt.requestId !== requestId)) {
    return refused(rail, port, number, GONE)
  }
  const deny = await denyOf(port, prompt)
  if (deny === undefined) {
    rail.at = number
    rail.failure = undefined
    await port.redraw()
    return { isMoved: true }
  }
  port.log(`reply-view: the jump to prompt ${String(number)} was refused: ${deny}`)
  return refused(rail, port, number, refusalWords(deny, isFullscreen))
}

function firstLineOf(prompt: RailPrompt): string {
  return shownLinesOf(prompt.text)[0] ?? ''
}

function promptRange(count: number): string {
  return count === 1 ? 'prompt 1' : `prompts 1-${String(count)}`
}

function noPromptText(rail: Rail, number: number): string {
  const count = promptsOf(rail).length
  return `No prompt ${String(number)}. This session has ${promptRange(count)}.`
}

function ofCount(number: number, count: number): string {
  return `${String(number)} of ${String(count)}`
}

async function toastUnlessShown(port: RailPort, parts: ToastParts): Promise<void> {
  if ((await port.pane())?.isShown !== true) port.showToast(parts)
}

async function jumpCommand(
  rail: Rail,
  port: RailPort,
  number: number,
  isFullscreen: boolean,
): Promise<string> {
  const prompt = promptAt(rail, number)
  if (prompt === undefined) return noPromptText(rail, number)
  const count = promptsOf(rail).length
  const firstLine = firstLineOf(prompt)
  const quoted = JSON.stringify(fitted(firstLine, QUOTED_COLUMNS))
  const jumped = await jumpTo(rail, port, number, isFullscreen)
  if (!jumped.isMoved) {
    await toastUnlessShown(port, [
      marked('blocked', `Could not jump to prompt ${String(number)}`),
      { quoted: firstLine },
      jumped.words,
    ])
    return `Could not jump to prompt ${String(number)}: ${jumped.words}.`
  }
  const time = clockTime(prompt.at)
  const tools = plural(toolCount(prompt), 'tool')
  await toastUnlessShown(port, [
    marked('toDo', `Prompt ${ofCount(number, count)}`),
    { quoted: firstLine },
    `${time} · ${tools}`,
  ])
  return `Prompt ${ofCount(number, count)}, ${time}, ${tools}: ${quoted}`
}

async function stepCommand(
  rail: Rail,
  port: RailPort,
  by: 1 | -1,
  isFullscreen: boolean,
): Promise<string> {
  const count = promptsOf(rail).length
  const at = atNumber(rail)
  const target = at + by
  if (target >= 1 && target <= count) return jumpCommand(rail, port, target, isFullscreen)
  const edge = `Already at the ${by < 0 ? 'first' : 'last'} prompt`
  await toastUnlessShown(port, [marked('toDo', edge), `prompt ${ofCount(at, count)}`])
  return `${edge}: prompt ${ofCount(at, count)}.`
}

async function toggleRail(rail: Rail, port: RailPort): Promise<string> {
  const pane = await port.pane()
  if (pane?.isShown === true && pane.isPlaced) {
    await port.close()
    return CLOSED_TEXT
  }
  const opened = await port.open()
  const count = promptsOf(rail).length
  const summary = `${plural(count, 'prompt')}, at ${String(atNumber(rail))}`
  if (opened.isPlaced) return `Prompts tab opened: ${summary}.`
  return `Prompts tab opened, but this session does not show it yet: ${opened.reason}`
}

export async function runRailCommand(
  rail: Rail,
  port: RailPort,
  command: RailCommand,
  isFullscreen: boolean,
): Promise<string> {
  if (command.kind === 'close') {
    if ((await port.pane()) === undefined) return NOT_OPEN_TEXT
    await port.close()
    return CLOSED_TEXT
  }
  if (promptsOf(rail).length === 0) {
    return (await port.hasEarlierPrompts()) ? RESUMED_TEXT : NO_PROMPT_TEXT
  }
  switch (command.kind) {
    case 'toggle':
      return toggleRail(rail, port)
    case 'next':
      return stepCommand(rail, port, 1, isFullscreen)
    case 'prev':
      return stepCommand(rail, port, -1, isFullscreen)
    case 'prompt':
      return jumpCommand(rail, port, command.number, isFullscreen)
  }
}
