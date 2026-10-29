import type { RenderElement, ThemeKey } from 'claude-code'
import type { BoardCheck, BoardCheckDecision, BoardCheckFamily, BoardChecks } from '../types'
import type { PaneElements, RowLayout } from './pane'
import { type Atom, type Part, PART_LEAD, drawPartLines } from './parts'
import { escaped } from './tasks'
import { displayWidth, fitted } from './width'

export const CHECKS_KEPT = 20
export const CHECKS_SHOWN = 5

const CHECKS_OPEN = 'session:checks'
const WORD_COLUMNS = 9
const LABEL_GAP = 3
const CALL_COLUMNS_AT_LEAST = 10
const DENIED_COLOR: ThemeKey = 'error'

export const EMPTY_CHECKS: BoardChecks = {
  allowed: 0,
  asked: 0,
  denied: 0,
  families: { file: 0, shell: 0, other: 0 },
  last: [],
}

const FILE_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Edit',
  'Write',
  'NotebookEdit',
  'Glob',
  'Grep',
])
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])
const FAMILIES: readonly BoardCheckFamily[] = ['file', 'shell', 'other']
const GATE_TITLE = 'gate'
const NO_CHECKS = 'no checks yet'
const COUNTS_RANK = 3

type CellLook = { mark: string; color: ThemeKey }

const CELL_LOOKS: Readonly<Record<BoardCheckDecision, CellLook>> = {
  allow: { mark: '▮', color: 'success' },
  ask: { mark: '▯', color: 'permission' },
  deny: { mark: '■', color: DENIED_COLOR },
}

const VERDICT_WORDS = {
  allow: 'allowed',
  ask: 'asked',
  deny: 'denied',
} as const satisfies Record<BoardCheckDecision, keyof BoardChecks>

function familyOf(tool: string): BoardCheckFamily {
  if (FILE_TOOLS.has(tool)) return 'file'
  return SHELL_TOOLS.has(tool) ? 'shell' : 'other'
}

export function withCheck(checks: BoardChecks, check: BoardCheck): BoardChecks {
  const counted = VERDICT_WORDS[check.decision]
  const family = familyOf(check.tool)
  return {
    ...checks,
    [counted]: checks[counted] + 1,
    families: { ...checks.families, [family]: checks.families[family] + 1 },
    last: [...checks.last, check].slice(-CHECKS_KEPT),
  }
}

function stripParts(last: readonly BoardCheck[]): Part[] {
  const parts: Part[] = []
  for (const check of last) {
    const { mark, color } = CELL_LOOKS[check.decision]
    const previous = parts.at(-1)
    if (previous?.color === color)
      parts[parts.length - 1] = { ...previous, text: previous.text + mark }
    else parts.push({ text: mark, color })
  }
  return parts
}

function deniedAmong(last: readonly BoardCheck[]): number {
  return last.filter((check) => check.decision === 'deny').length
}

function familyLetters(checks: BoardChecks): string {
  return FAMILIES.filter((family) => checks.families[family] > 0)
    .map((family) => `${family.slice(0, 1)}${String(checks.families[family])}`)
    .join(' ')
}

function gateTail(checks: BoardChecks): Atom | undefined {
  const denied = deniedAmong(checks.last)
  if (denied > 0) return { parts: [{ text: `${String(denied)} denied`, color: DENIED_COLOR }] }
  const letters = familyLetters(checks)
  return letters === '' ? undefined : { parts: [{ text: letters }], dropRank: COUNTS_RANK }
}

function fixedWidth(tail: Atom | undefined): number {
  const title = displayWidth(GATE_TITLE) + 1
  if (tail === undefined || tail.dropRank !== undefined) return title
  return title + 1 + displayWidth(tail.parts.map((part) => part.text).join(''))
}

export function gateAtoms(checks: BoardChecks, room: number): Atom[] {
  if (checks.last.length === 0) return [{ parts: [{ text: `${GATE_TITLE} ${NO_CHECKS}` }] }]
  const tail = gateTail(checks)
  const kept = checks.last.slice(-Math.max(room - fixedWidth(tail), 1))
  return [
    { parts: [{ text: GATE_TITLE }] },
    { parts: stripParts(kept) },
    ...(tail === undefined ? [] : [tail]),
  ]
}

function familyParts(checks: BoardChecks): Part[] {
  return FAMILIES.map((family) => ({ text: `${family} ${String(checks.families[family])}` }))
}

export function familiesText(checks: BoardChecks): string {
  return familyParts(checks)
    .map((part) => part.text)
    .join(PART_LEAD)
}

function runWords(last: readonly BoardCheck[]): string[] {
  const runs: { decision: BoardCheckDecision; count: number }[] = []
  for (const check of last) {
    const run = runs.at(-1)
    if (run?.decision === check.decision) run.count += 1
    else runs.push({ decision: check.decision, count: 1 })
  }
  return runs.map((run) => `${String(run.count)} ${VERDICT_WORDS[run.decision]}`)
}

export function verdictsText(checks: BoardChecks): string | undefined {
  if (checks.last.length === 0) return undefined
  const count = String(checks.last.length)
  return `last ${count} checks, oldest first: ${runWords(checks.last).join(', ')}`
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

export function checksText(checks: BoardChecks): string | undefined {
  if (checks.last.length === 0) return undefined
  return summaryParts(checks)
    .map((part) => part.text)
    .join(PART_LEAD)
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
    ...drawPartLines(elements, 'checks-families', familyParts(checks), room),
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
