import type { HookStream, TurnStepChunk, TurnStepResult } from 'claude-code'
import type { ReplyViewHeld } from '../types'
import { DRAWN_CHARACTERS_AT_MOST, plural } from './draw'

export const HOLD_BOUND_MS = 8_000

export const BLOCK_HELD_AT_MOST = 6_000

const FENCE_LINE = /^\s*(```|~~~)/

export const STREAMINGS = ['held', 'live'] as const

export type Streaming = (typeof STREAMINGS)[number]

export const DEFAULT_STREAMING: Streaming = 'held'

export function isStreaming(value: unknown): value is Streaming {
  return STREAMINGS.some((option) => option === value)
}

export type Release = 'block end' | 'size' | 'stream end'

export type Cut = { count: number; isFenced: boolean }

export function blockCut(chunks: readonly TurnStepChunk[], isFenced: boolean): Cut {
  let fenced = isFenced
  let line = ''
  let isAtEnd = false
  let cut: Cut = { count: 0, isFenced }
  chunks.forEach((chunk, index) => {
    if (chunk.kind === 'text') {
      const parts = (line + chunk.text).split('\n')
      line = parts.pop() ?? ''
      for (const part of parts) {
        if (FENCE_LINE.test(part)) {
          isAtEnd = fenced
          fenced = !fenced
        } else {
          isAtEnd = !fenced && part.trim() === ''
        }
      }
    }
    if (isAtEnd && line === '') cut = { count: index + 1, isFenced: fenced }
  })
  return cut
}

function fencedAfter(chunks: readonly TurnStepChunk[], isFenced: boolean): boolean {
  const text = chunks.map((chunk) => (chunk.kind === 'text' ? chunk.text : '')).join('')
  return text
    .split('\n')
    .slice(0, -1)
    .reduce((fenced, part) => (FENCE_LINE.test(part) ? !fenced : fenced), isFenced)
}

export type HoldPort = {
  now: () => Promise<number>
  show: (held: ReplyViewHeld | null) => Promise<void>
  note: (text: string) => Promise<void>
}

const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/
const PROGRESS_WORD = 'writing reply'

type Hold = {
  index: number
  startedAt: number
  isLive: boolean
  isByBlock: boolean
  isFenced: boolean
  sinceCut: number
  chunks: TurnStepChunk[]
  characters: number
  texts: number
  engines: number
  line: string
  held: ReplyViewHeld
}

function newHold(index: number, startedAt: number): Hold {
  return {
    index,
    startedAt,
    isLive: false,
    isByBlock: false,
    isFenced: false,
    sinceCut: 0,
    chunks: [],
    characters: 0,
    texts: 0,
    engines: 0,
    line: '',
    held: { lines: 0, tables: 0 },
  }
}

function counted(hold: Hold, text: string): ReplyViewHeld {
  const parts = (hold.line + text).split('\n')
  hold.line = parts.pop() ?? ''
  const tables = parts.filter((line) => TABLE_RULE.test(line)).length
  return {
    lines: hold.held.lines + parts.length,
    tables: hold.held.tables + tables,
  }
}

export function progressText(held: ReplyViewHeld): string {
  const parts = [PROGRESS_WORD, plural(held.lines, 'line')]
  if (held.tables > 0) parts.push(plural(held.tables, 'table'))
  return parts.join(' · ')
}

function blockNote(hold: Hold, now: number): string {
  return `reply-view: block ${String(hold.index)} streams by markdown block after ${String(now - hold.startedAt)} ms`
}

function releaseNote(hold: Hold, release: Release, now: number): string {
  return `reply-view: block ${String(hold.index)} released by ${release} after ${String(now - hold.startedAt)} ms: ${String(hold.texts)} text and ${String(hold.engines)} engine chunks held`
}

export async function* heldStep(
  stream: HookStream<TurnStepChunk, TurnStepResult>,
  port: HoldPort,
): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  let hold: Hold | null = null
  const release = async (reason: Release): Promise<TurnStepChunk[]> => {
    if (hold === null || hold.chunks.length === 0) return []
    const chunks = hold.chunks
    hold.chunks = []
    await port.note(releaseNote(hold, reason, await port.now()))
    await port.show(null)
    return chunks
  }
  try {
    for await (const chunk of stream) {
      if (chunk.kind === 'engine') {
        if (hold !== null && hold.chunks.length > 0) {
          hold.chunks.push(chunk)
          hold.engines += 1
        } else {
          yield chunk
        }
        continue
      }
      if (chunk.kind !== 'text') {
        yield* await release('block end')
        hold = null
        yield chunk
        continue
      }
      if (hold?.index !== chunk.index) {
        yield* await release('block end')
        hold = newHold(chunk.index, await port.now())
      }
      if (hold.isLive) {
        yield chunk
        continue
      }
      if (hold.isByBlock) {
        hold.chunks.push(chunk)
        hold.characters += chunk.text.length
        hold.sinceCut += chunk.text.length
        const found = blockCut(hold.chunks, hold.isFenced)
        const count = hold.sinceCut > BLOCK_HELD_AT_MOST ? hold.chunks.length : found.count
        if (count === 0) continue
        const out = hold.chunks.splice(0, count)
        hold.isFenced = count === found.count ? found.isFenced : fencedAfter(out, hold.isFenced)
        hold.sinceCut = hold.chunks.reduce(
          (sum, one) => sum + (one.kind === 'text' ? one.text.length : 0),
          0,
        )
        yield* out
        continue
      }
      hold.chunks.push(chunk)
      hold.texts += 1
      hold.characters += chunk.text.length
      const now = await port.now()
      if (hold.characters > DRAWN_CHARACTERS_AT_MOST) {
        hold.isLive = true
        yield* await release('size')
        continue
      }
      if (now - hold.startedAt >= HOLD_BOUND_MS) {
        hold.isByBlock = true
        await port.note(blockNote(hold, now))
        await port.show(null)
        const found = blockCut(hold.chunks, false)
        const out = hold.chunks.splice(0, found.count)
        hold.isFenced = found.isFenced
        hold.sinceCut = hold.chunks.reduce(
          (sum, one) => sum + (one.kind === 'text' ? one.text.length : 0),
          0,
        )
        yield* out
        continue
      }
      const held = counted(hold, chunk.text)
      const isChanged = held.lines !== hold.held.lines || held.tables !== hold.held.tables
      hold.held = held
      if (isChanged || hold.texts === 1) await port.show(held)
    }
    return await stream.result
  } finally {
    if (hold !== null && hold.chunks.length > 0) {
      const chunks = hold.chunks
      hold.chunks = []
      await port.note(releaseNote(hold, 'stream end', await port.now()))
      await port.show(null)
      yield* chunks
    }
  }
}
