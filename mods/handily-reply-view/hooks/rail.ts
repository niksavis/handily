import type { ApiContentBlock } from 'claude-code'

export type RailPrompt = {
  requestId: string
  text: string
  at: number
  tools: Map<string, number>
  endedAt: number | undefined
}

export type RailEntry = { kind: 'prompt'; prompt: RailPrompt } | { kind: 'compaction'; at: number }

export type JumpFailure = { number: number; words: string }

export type Rail = {
  entries: RailEntry[]
  at: number | undefined
  failure: JumpFailure | undefined
}

const IMAGE_WORD = '[image]'
const LINE_BREAKS = /\r\n|\r|\n/
const CONTROLS = /\p{Cc}/gu
const BIDI_CONTROLS = /[\u{061C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu

export function newRail(): Rail {
  return { entries: [], at: undefined, failure: undefined }
}

export function clearRail(rail: Rail): void {
  rail.entries = []
  rail.at = undefined
  rail.failure = undefined
}

export function promptsOf(rail: Rail): RailPrompt[] {
  return rail.entries.flatMap((entry) => (entry.kind === 'prompt' ? [entry.prompt] : []))
}

export function promptAt(rail: Rail, number: number): RailPrompt | undefined {
  return number >= 1 ? promptsOf(rail)[number - 1] : undefined
}

export function atNumber(rail: Rail): number {
  return rail.at ?? promptsOf(rail).length
}

function blockText(block: ApiContentBlock): string {
  if (block.type === 'image') return IMAGE_WORD
  return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
}

export function promptTextOf(content: readonly ApiContentBlock[]): string {
  return content
    .map(blockText)
    .filter((text) => text.trim() !== '')
    .join(' ')
}

export function shownLinesOf(text: string): string[] {
  return text
    .trim()
    .split(LINE_BREAKS)
    .map((line) => line.replace(BIDI_CONTROLS, '').replace(CONTROLS, ' ').trimEnd())
}

export function addPrompt(rail: Rail, requestId: string, text: string, at: number): boolean {
  if (text.trim() === '') return false
  endTurn(rail, at)
  const prompt: RailPrompt = { requestId, text, at, tools: new Map(), endedAt: undefined }
  rail.entries.push({ kind: 'prompt', prompt })
  rail.at = undefined
  return true
}

function runningPrompt(rail: Rail): RailPrompt | undefined {
  const newest = promptsOf(rail).at(-1)
  return newest?.endedAt === undefined ? newest : undefined
}

export function isTurnRunning(rail: Rail): boolean {
  return runningPrompt(rail) !== undefined
}

export function noteTool(rail: Rail, tool: string): boolean {
  const prompt = runningPrompt(rail)
  if (prompt === undefined) return false
  prompt.tools.set(tool, (prompt.tools.get(tool) ?? 0) + 1)
  return true
}

export function endTurn(rail: Rail, at: number): void {
  const prompt = runningPrompt(rail)
  if (prompt !== undefined) prompt.endedAt = at
}

export function noteCompaction(rail: Rail, at: number): void {
  rail.entries.push({ kind: 'compaction', at })
}

export function toolCount(prompt: RailPrompt): number {
  let count = 0
  for (const calls of prompt.tools.values()) count += calls
  return count
}

export function toolsByCount(prompt: RailPrompt): [string, number][] {
  return [...prompt.tools].sort(([, left], [, right]) => right - left)
}
