import { DIAGRAM_LIMITS, DRAWN_DIAGRAM_KINDS } from './mermaid'

export const UNDRAWN_STATEMENTS: readonly string[] = ['direction', 'box', 'create', 'destroy']

export const C4_KIND = /^C4[A-Z]/

export const C4_FAMILY = 'and the other C4 kinds'

function listedWithOr(words: readonly string[]): string {
  const last = words.at(-1) ?? ''
  return words.length < 2 ? last : `${words.slice(0, -1).join(', ')} or ${last}`
}

export function hintedKinds(kinds: readonly string[]): string[] {
  const family = kinds.filter((kind) => C4_KIND.test(kind))
  if (family.length < 2) return [...kinds]
  return kinds.flatMap((kind) => {
    if (!C4_KIND.test(kind)) return [kind]
    return kind === family[0] ? [`${kind} ${C4_FAMILY}`] : []
  })
}

export function diagramHint(kinds: readonly string[]): string {
  const boxes = String(DIAGRAM_LIMITS.boxes)
  const participants = String(DIAGRAM_LIMITS.participants)
  return [
    'The terminal draws a fenced mermaid block as a diagram.',
    'Add one when a diagram reads better than text.',
    `These kinds draw: ${hintedKinds(kinds).join(', ')}.`,
    'A flowchart is TD or LR and may use a subgraph that does not nest.',
    'Keep each label short.',
    `Use at most ${boxes} boxes and ${participants} participants.`,
    `Do not use ${listedWithOr(UNDRAWN_STATEMENTS)}.`,
    'The reply must read well without the diagram.',
  ].join(' ')
}

export const DIAGRAM_HINT = diagramHint(DRAWN_DIAGRAM_KINDS)
