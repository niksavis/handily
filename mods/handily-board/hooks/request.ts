import type { ThemeKey } from 'claude-code'
import { elapsedText } from './activity'
import { groupedCount } from './checks'
import type { Atom, Part } from './parts'
import { escaped } from './tasks'

export type RequestFacts = {
  model: string | undefined
  effort: string | undefined
  mode: string | undefined
  requests: number
  ttftMs: number | undefined
}

export const NO_REQUEST: RequestFacts = {
  model: undefined,
  effort: undefined,
  mode: undefined,
  requests: 0,
  ttftMs: undefined,
}

const MODEL_PREFIX = 'claude-'
const NO_REQUEST_YET = 'req —'
const TTFT_RANK = 2
const SECOND_MS = 1000
const DECIMAL_BELOW_MS = 10_000
const MINUTE_MS = 60_000

type ModeLook = { word: string; color?: ThemeKey }

const MODE_LOOKS: Readonly<Partial<Record<string, ModeLook>>> = {
  default: { word: 'default' },
  acceptEdits: { word: 'accept edits', color: 'autoAccept' },
  plan: { word: 'plan', color: 'planMode' },
  bypassPermissions: { word: 'bypass', color: 'error' },
  dontAsk: { word: 'dont ask' },
  auto: { word: 'auto' },
}

export function withStep(
  facts: RequestFacts,
  model: string,
  effort: string | number | undefined,
): RequestFacts {
  return {
    ...facts,
    model,
    effort: effort === undefined ? undefined : String(effort),
    requests: facts.requests + 1,
  }
}

export function withFirstToken(facts: RequestFacts, ms: number): RequestFacts {
  return { ...facts, ttftMs: Math.max(ms, 0) }
}

function secondsText(ms: number): string {
  if (ms >= MINUTE_MS) return elapsedText(ms)
  if (ms >= DECIMAL_BELOW_MS) return `${String(Math.round(ms / SECOND_MS))}s`
  return `${(ms / SECOND_MS).toFixed(1)}s`
}

function secondsWords(ms: number): string {
  if (ms >= DECIMAL_BELOW_MS) return `${String(Math.round(ms / SECOND_MS))} seconds`
  return `${(ms / SECOND_MS).toFixed(1)} seconds`
}

function requestsAtoms(facts: RequestFacts): Atom[] {
  if (facts.requests === 0) return [{ parts: [{ text: NO_REQUEST_YET }] }]
  const count = { parts: [{ text: `${groupedCount(facts.requests)} req` }] }
  const { ttftMs } = facts
  if (ttftMs === undefined) return [count]
  return [count, { parts: [{ text: `ttft ${secondsText(ttftMs)}` }], dropRank: TTFT_RANK }]
}

export function requestsWords(facts: RequestFacts): string | undefined {
  if (facts.requests === 0) return undefined
  const count = `Requests ${groupedCount(facts.requests)}`
  const { ttftMs } = facts
  if (ttftMs === undefined) return `${count}; no time to first token yet.`
  return `${count}; time to first token ${secondsWords(ttftMs)} (latest main request).`
}

export function withMode(facts: RequestFacts, mode: string | undefined): RequestFacts {
  return mode === undefined || mode === '' ? facts : { ...facts, mode }
}

function shownModel(model: string): string {
  const name = model.startsWith(MODEL_PREFIX) ? model.slice(MODEL_PREFIX.length) : model
  return escaped(name)
}

function modeLook(mode: string): ModeLook {
  return MODE_LOOKS[mode] ?? { word: escaped(mode) }
}

function modePart(mode: string): Part {
  const { word, color } = modeLook(mode)
  return color === undefined ? { text: word } : { text: word, color }
}

export function requestAtoms(facts: RequestFacts): Atom[] {
  return [
    facts.model === undefined ? null : { parts: [{ text: shownModel(facts.model) }] },
    facts.effort === undefined ? null : { parts: [{ text: escaped(facts.effort) }] },
    ...requestsAtoms(facts),
    facts.mode === undefined ? null : { parts: [modePart(facts.mode)] },
  ].filter((atom) => atom !== null)
}

export function requestWords(facts: RequestFacts): string | undefined {
  const words = [
    facts.model === undefined ? null : `model ${shownModel(facts.model)}`,
    facts.effort === undefined ? null : `effort ${escaped(facts.effort)}`,
    facts.mode === undefined ? null : `mode ${modeLook(facts.mode).word}`,
  ].filter((word) => word !== null)
  return words.length === 0 ? undefined : words.join(', ')
}
