import type { ThemeKey } from 'claude-code'
import type { Atom, Part } from './parts'
import { escaped } from './tasks'

export type RequestFacts = {
  model: string | undefined
  effort: string | undefined
  mode: string | undefined
}

export const NO_REQUEST: RequestFacts = { model: undefined, effort: undefined, mode: undefined }

const MODEL_PREFIX = 'claude-'

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
  return { ...facts, model, effort: effort === undefined ? undefined : String(effort) }
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
