import { DIAGRAM_LIMITS, DRAWN_DIAGRAM_KINDS, MERMAID_KINDS } from './mermaid'

export const UNDRAWN_STATEMENTS: readonly string[] = ['direction', 'box', 'create', 'destroy']

function listedWithOr(words: readonly string[]): string {
  const last = words.at(-1) ?? ''
  return words.length < 2 ? last : `${words.slice(0, -1).join(', ')} or ${last}`
}

const C4_FAMILY = /^C4[A-Z]/

function hintedKinds(kinds: readonly string[]): string[] {
  const family = kinds.filter((kind) => C4_FAMILY.test(kind))
  const others = kinds.filter((kind) => !C4_FAMILY.test(kind))
  const allFamily = MERMAID_KINDS.filter((kind) => C4_FAMILY.test(kind))
  if (family.length === 0 || family.length !== allFamily.length) return [...kinds]
  const at = kinds.indexOf(family[0] ?? '')
  return [...others.slice(0, at), 'C4', ...others.slice(at)]
}

export function diagramHint(kinds: readonly string[]): string {
  const undrawn = hintedKinds(MERMAID_KINDS.filter((kind) => !kinds.includes(kind)))
  const boxes = String(DIAGRAM_LIMITS.boxes)
  const participants = String(DIAGRAM_LIMITS.participants)
  return [
    'The terminal draws a mermaid block in a reply as a diagram.',
    'Add one when a diagram reads better than text.',
    undrawn.length === 0
      ? 'Each Mermaid kind draws.'
      : `Each Mermaid kind draws except ${undrawn.join(', ')}.`,
    'A flowchart is TD or LR and has no subgraph in a subgraph.',
    'Keep each label short.',
    `Use at most ${boxes} boxes and ${participants} participants.`,
    `Do not use ${listedWithOr(UNDRAWN_STATEMENTS)}.`,
    'The reply must read well without the diagram.',
  ].join(' ')
}

export const DIAGRAM_HINT = diagramHint(DRAWN_DIAGRAM_KINDS)
