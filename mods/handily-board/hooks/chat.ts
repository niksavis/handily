import type { BoardList, BoardTask } from '../types'
import { askedTasks, quoted } from './tasks'

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
export const STALE_AFTER_MS = 2 * MINUTES_PER_HOUR * MINUTE_MS
const TITLE_WORD_AT_LEAST = 4
const SAID_AT_MOST = 200
const WORD_PART = '[\\p{L}\\p{N}_]'
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g
const LETTERS = /\p{L}+/gu
const SPACES = /\s+/gu

export type KeptPrompt = { text: string; after: number; at: number; seq: number }

export type ChatMark = { said: string; option: number; at: number; seq: number }

export type PersonWords = {
  kept: KeptPrompt[]
  seq: number
  marks: Map<number, ChatMark>
  keptOpen: Map<number, number>
}

export type ChatView = {
  kept: readonly KeptPrompt[]
  marks: ReadonlyMap<number, ChatMark>
}

export function newPersonWords(): PersonWords {
  return { kept: [], seq: 0, marks: new Map(), keptOpen: new Map() }
}

type Span = { start: number; end: number }

function wordPattern(word: string): RegExp {
  const literal = word.replace(REGEX_SYNTAX, '\\$&')
  return new RegExp(`(?<!${WORD_PART})${literal}(?!${WORD_PART})`, 'giu')
}

function spansOf(text: string, word: string): Span[] {
  return [...text.matchAll(wordPattern(word))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }))
}

export function holdsWord(text: string, word: string): boolean {
  return word !== '' && spansOf(text, word).length > 0
}

function isInside(span: Span, other: Span): boolean {
  const isLonger = other.end - other.start > span.end - span.start
  return isLonger && other.start <= span.start && span.end <= other.end
}

export function heldOptions(text: string, options: readonly string[]): number[] {
  const spans = options.map((option) => (option === '' ? [] : spansOf(text, option)))
  return options.flatMap((_option, index) => {
    const others = spans.filter((_spans, at) => at !== index).flat()
    const own = spans[index] ?? []
    return own.some((span) => !others.some((other) => isInside(span, other))) ? [index] : []
  })
}

function openAsked(list: BoardList): BoardTask[] {
  return askedTasks(list).filter((task) => task.result === undefined)
}

function isSince(prompt: KeptPrompt, task: BoardTask): boolean {
  return prompt.after >= task.id
}

function saidLine(text: string, option: string): string {
  const line = text.split('\n').find((one) => holdsWord(one, option)) ?? text
  const flat = line.replace(SPACES, ' ').trim()
  const characters = Array.from(flat)
  if (characters.length <= SAID_AT_MOST) return flat
  const [first] = spansOf(flat, option)
  const at = Array.from(flat.slice(0, first?.start ?? 0)).length
  const start = Math.max(Math.min(at - SAID_AT_MOST / 2, characters.length - SAID_AT_MOST), 0)
  return characters
    .slice(start, start + SAID_AT_MOST)
    .join('')
    .trim()
}

function chatMarkOf(task: BoardTask, words: PersonWords): ChatMark | undefined {
  const options = task.options ?? []
  const since = words.keptOpen.get(task.id) ?? -1
  const prompt = words.kept.findLast(
    (one) => isSince(one, task) && one.seq > since && heldOptions(one.text, options).length > 0,
  )
  if (prompt === undefined) return words.marks.get(task.id)
  const held = heldOptions(prompt.text, options)
  const [index] = held
  const option = index === undefined ? undefined : options[index]
  if (held.length !== 1 || index === undefined || option === undefined) return undefined
  return { said: saidLine(prompt.text, option), option: index + 1, at: prompt.at, seq: prompt.seq }
}

export function noteChatMarks(words: PersonWords, list: BoardList): void {
  const open = openAsked(list).filter((task) => task.kind === 'decide')
  const marks = new Map<number, ChatMark>()
  for (const task of open) {
    const mark = chatMarkOf(task, words)
    if (mark !== undefined) marks.set(task.id, mark)
  }
  const openIds = new Set(open.map((task) => task.id))
  for (const id of words.keptOpen.keys()) {
    if (!openIds.has(id)) words.keptOpen.delete(id)
  }
  words.marks = marks
}

export function keepChatOpen(words: PersonWords, id: number): void {
  const mark = words.marks.get(id)
  words.keptOpen.set(id, mark?.seq ?? words.seq)
  words.marks.delete(id)
}

export function forgetPersonWords(words: PersonWords): void {
  words.kept = []
  words.marks.clear()
  words.keptOpen.clear()
}

function titleWords(title: string): string[] {
  return (title.match(LETTERS) ?? []).filter(
    (word) => Array.from(word).length >= TITLE_WORD_AT_LEAST,
  )
}

export function namesTask(text: string, task: BoardTask): boolean {
  if (holdsWord(text, String(task.id))) return true
  return titleWords(task.title).some((word) => holdsWord(text, word))
}

export function staleFor(
  task: BoardTask,
  now: number,
  kept: readonly KeptPrompt[],
): number | undefined {
  if (task.result !== undefined || task.isWithdrawn === true || task.askedAt === undefined) {
    return undefined
  }
  const open = now - task.askedAt
  if (open < STALE_AFTER_MS) return undefined
  const isNamed = kept.some((one) => isSince(one, task) && namesTask(one.text, task))
  return isNamed ? undefined : open
}

export function openText(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / MINUTE_MS)
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${String(hours)}h ${String(minutes % MINUTES_PER_HOUR)}m`
  return `${String(Math.floor(hours / HOURS_PER_DAY))}d ${String(hours % HOURS_PER_DAY)}h`
}

function andText(ids: readonly number[]): string {
  const words = ids.map(String)
  const last = words.pop() ?? ''
  return words.length === 0 ? last : `${words.join(', ')} and ${last}`
}

type SharedOption = { label: string; ids: number[] }

export function sharedOptionsText(list: BoardList, text: string): string | undefined {
  const shared = new Map<string, SharedOption>()
  for (const task of openAsked(list).filter((one) => one.kind === 'decide')) {
    const options = task.options ?? []
    for (const index of heldOptions(text, options)) {
      const label = options[index] ?? ''
      const key = label.toLocaleLowerCase()
      const known = shared.get(key)
      if (known === undefined) shared.set(key, { label, ids: [task.id] })
      else if (!known.ids.includes(task.id)) known.ids.push(task.id)
    }
  }
  const sentences = [...shared.values()]
    .filter((one) => one.ids.length >= 2)
    .map(
      (one) =>
        `This prompt holds ${quoted(one.label)}, an option of tasks ${andText(one.ids)}: ask which one; close none.`,
    )
  return sentences.length === 0 ? undefined : sentences.join(' ')
}
