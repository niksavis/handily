import type { RenderElement, ThemeKey } from 'claude-code'
import type { BoardCheck, BoardCheckDecision, BoardChecks } from '../types'
import type { PaneElements, RowLayout } from './pane'
import { type Part, drawPartLines } from './parts'
import { escaped } from './tasks'
import { displayWidth, fitted } from './width'

export const CHECKS_KEPT = 20
export const CHECKS_SHOWN = 5

const CHECKS_OPEN = 'session:checks'
const WORD_COLUMNS = 9
const LABEL_GAP = 3
const CALL_COLUMNS_AT_LEAST = 10
const DENIED_COLOR: ThemeKey = 'error'

export const EMPTY_CHECKS: BoardChecks = { allowed: 0, asked: 0, denied: 0, last: [] }

const VERDICT_WORDS = {
  allow: 'allowed',
  ask: 'asked',
  deny: 'denied',
} as const satisfies Record<BoardCheckDecision, keyof BoardChecks>

export function withCheck(checks: BoardChecks, check: BoardCheck): BoardChecks {
  const counted = VERDICT_WORDS[check.decision]
  return {
    ...checks,
    [counted]: checks[counted] + 1,
    last: [...checks.last, check].slice(-CHECKS_KEPT),
  }
}

export function checksTotal(checks: BoardChecks): number {
  return checks.allowed + checks.asked + checks.denied
}

function countParts(count: number, word: string): Part[] {
  return count === 0 ? [] : [{ text: `${String(count)} ${word}` }]
}

function summaryParts(checks: BoardChecks): Part[] {
  return [
    { text: `checks ${String(checksTotal(checks))}` },
    ...countParts(checks.allowed, VERDICT_WORDS.allow),
    ...countParts(checks.asked, VERDICT_WORDS.ask),
    ...countParts(checks.denied, VERDICT_WORDS.deny).map((part) => ({
      ...part,
      color: DENIED_COLOR,
    })),
  ]
}

function callText(check: BoardCheck): string {
  const tool = escaped(check.tool)
  return check.target === null ? tool : `${tool} ${escaped(check.target)}`
}

function checkLabel(check: BoardCheck, names: ReadonlyMap<string, string>): string | null {
  if (check.agentId === null) return null
  return names.get(check.agentId) ?? escaped(check.agentId.slice(0, 8))
}

function checkRow(
  elements: PaneElements,
  check: BoardCheck,
  index: number,
  names: ReadonlyMap<string, string>,
  room: number,
): RenderElement {
  const { Box, Text } = elements
  const word = VERDICT_WORDS[check.decision]
  const label = checkLabel(check, names)
  const labelWidth = label === null ? 0 : LABEL_GAP + displayWidth(label)
  const hasLabel = label !== null && room - WORD_COLUMNS - labelWidth >= CALL_COLUMNS_AT_LEAST
  const callRoom = room - WORD_COLUMNS - (hasLabel ? labelWidth : 0)
  return Box({
    key: `check:${String(index)}`,
    flexDirection: 'row',
    children: [
      check.decision === 'deny'
        ? Text({ color: DENIED_COLOR, children: word.padEnd(WORD_COLUMNS) })
        : Text({ dimColor: true, children: word.padEnd(WORD_COLUMNS) }),
      Text({ children: fitted(callText(check), callRoom) }),
      hasLabel ? Text({ dimColor: true, children: `${' '.repeat(LABEL_GAP)}${label}` }) : null,
    ],
  })
}

function openLabel(shown: number): string {
  return shown === 1 ? 'last check' : `last ${String(shown)} checks`
}

export function drawChecks(
  elements: PaneElements,
  checks: BoardChecks,
  names: ReadonlyMap<string, string>,
  layout: RowLayout,
  room: number,
): RenderElement[] {
  if (checks.last.length === 0) return []
  const { Box, Button } = elements
  const isOpen = layout.expanded.has(CHECKS_OPEN)
  const shown = checks.last.slice(-CHECKS_SHOWN).reverse()
  return [
    ...drawPartLines(elements, 'checks-summary', summaryParts(checks), room),
    Box({
      flexDirection: 'row',
      children: [
        Button({
          key: CHECKS_OPEN,
          label: isOpen ? 'hide checks' : openLabel(shown.length),
          onPress: () => {
            layout.toggle(CHECKS_OPEN)
          },
        }),
      ],
    }),
    ...(isOpen ? shown.map((check, index) => checkRow(elements, check, index, names, room)) : []),
  ]
}
