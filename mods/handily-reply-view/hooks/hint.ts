import { DIAGRAM_LIMITS, DRAWN_DIAGRAM_KINDS } from './mermaid'

export const UNDRAWN_STATEMENTS: readonly string[] = ['direction', 'box', 'create', 'destroy']

function listedWithOr(words: readonly string[]): string {
  const last = words.at(-1) ?? ''
  return words.length < 2 ? last : `${words.slice(0, -1).join(', ')} or ${last}`
}

export function diagramHint(kinds: readonly string[]): string {
  const boxes = String(DIAGRAM_LIMITS.boxes)
  const participants = String(DIAGRAM_LIMITS.participants)
  return [
    'The terminal draws a mermaid block in a reply as a diagram.',
    'When a flow, an exchange or a structure reads better as a diagram, add one fenced mermaid block.',
    `These kinds draw: ${kinds.join(', ')}.`,
    'A flowchart is TD or LR and may group boxes in a subgraph, but not a subgraph in a subgraph.',
    'Keep each label short.',
    `Use at most ${boxes} boxes and ${participants} participants.`,
    `Do not use ${listedWithOr(UNDRAWN_STATEMENTS)}.`,
    'The reply must read well without the diagram.',
  ].join(' ')
}

export const DIAGRAM_HINT = diagramHint(DRAWN_DIAGRAM_KINDS)
