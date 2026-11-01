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
  lastByFamily: { file: [], shell: [], other: [] },
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
const FAMILY_GAP = 2
const HOTKEY_CHROME = 3
const COUNT_AT_MOST = 999
const ASKED_WORDS = 'asked (the classifier or you)'
const FAMILY_HOTKEYS: Readonly<Record<BoardCheckFamily, string>> = {
  file: 'f',
  shell: 's',
  other: 'o',
}

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
    lastByFamily: {
      ...checks.lastByFamily,
      [family]: [...checks.lastByFamily[family], check].slice(-CHECKS_SHOWN),
    },
  }
}

export function groupedCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
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

export function gateAtoms(checks: BoardChecks, room: number): Atom[] {
  if (checks.last.length === 0) return [{ parts: [{ text: `${GATE_TITLE} ${NO_CHECKS}` }] }]
  const head = `${GATE_TITLE} ${groupedCount(checksTotal(checks))}`
  const kept = checks.last.slice(-Math.max(room - displayWidth(head) - 1, 1))
  return [{ parts: [{ text: head }] }, { parts: stripParts(kept) }]
}

export function verdictParts(checks: BoardChecks): Part[] {
  if (checks.last.length === 0) return []
  return [
    { text: `${groupedCount(checks.allowed)} ${VERDICT_WORDS.allow}` },
    { text: `${groupedCount(checks.asked)} ${VERDICT_WORDS.ask}` },
    checks.denied > 0
      ? { text: `${groupedCount(checks.denied)} ${VERDICT_WORDS.deny}`, color: DENIED_COLOR }
      : { text: `0 ${VERDICT_WORDS.deny}` },
  ]
}

export function verdictWords(checks: BoardChecks): string | undefined {
  if (checks.last.length === 0) return undefined
  const total = groupedCount(checksTotal(checks))
  const allowed = `${groupedCount(checks.allowed)} ${VERDICT_WORDS.allow}`
  const asked = `${groupedCount(checks.asked)} ${ASKED_WORDS}`
  const denied = `${groupedCount(checks.denied)} ${VERDICT_WORDS.deny}`
  return `Checks ${total}: ${allowed}, ${asked}, ${denied}.`
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

function familyKey(family: BoardCheckFamily): string {
  return `checks:${family}`
}

const FAMILY_KEYS: readonly string[] = FAMILIES.map(familyKey)

function shownCount(count: number): string {
  return count > COUNT_AT_MOST ? `${String(COUNT_AT_MOST)}+` : String(count)
}

function familyLabel(checks: BoardChecks, family: BoardCheckFamily, hasWords: boolean): string {
  const count = shownCount(checks.families[family])
  return hasWords ? `${family} ${count}` : count
}

function familiesWidth(checks: BoardChecks, hasWords: boolean): number {
  return FAMILIES.reduce(
    (sum, family, index) =>
      sum +
      (index === 0 ? 0 : FAMILY_GAP) +
      HOTKEY_CHROME +
      displayWidth(familyLabel(checks, family, hasWords)),
    0,
  )
}

function openFamily(layout: RowLayout): BoardCheckFamily | undefined {
  return FAMILIES.find((family) => layout.expanded.has(familyKey(family)))
}

function familyButtons(
  elements: PaneElements,
  checks: BoardChecks,
  layout: RowLayout,
  room: number,
): RenderElement {
  const { Box, Button, Text } = elements
  const hasWords = familiesWidth(checks, true) <= room
  const open = openFamily(layout)
  return Box({
    key: 'checks-families-row',
    flexDirection: 'row',
    children: FAMILIES.map((family, index) =>
      Box({
        flexShrink: 0,
        marginLeft: index === 0 ? 0 : FAMILY_GAP,
        children: [
          Button({
            key: familyKey(family),
            hotkey: FAMILY_HOTKEYS[family],
            plain: true,
            onPress: () => {
              layout.toggleAmong(familyKey(family), FAMILY_KEYS)
            },
            children: [
              Text({
                bold: family === open,
                dimColor: family !== open,
                children: familyLabel(checks, family, hasWords),
              }),
            ],
          }),
        ],
      }),
    ),
  })
}

function familyRows(
  elements: PaneElements,
  checks: BoardChecks,
  family: BoardCheckFamily,
  names: ReadonlyMap<string, string>,
  layout: RowLayout,
  room: number,
): RenderElement[] {
  const { Text, Button } = elements
  const shown = [...checks.lastByFamily[family]].reverse()
  const head = `${family}: last ${String(shown.length)} of ${groupedCount(checks.families[family])}`
  return [
    Text({ dimColor: true, children: fitted(head, room) }),
    ...shown.map((check, index) => checkRow(elements, check, index, names, room)),
    Button({
      key: `hide:${familyKey(family)}`,
      label: `hide ${family}`,
      onPress: () => {
        layout.toggleAmong(familyKey(family), FAMILY_KEYS)
      },
    }),
  ]
}

export function drawFamilies(
  elements: PaneElements,
  checks: BoardChecks,
  names: ReadonlyMap<string, string>,
  layout: RowLayout,
  room: number,
): RenderElement[] {
  if (checks.last.length === 0) return []
  const open = openFamily(layout)
  return [
    familyButtons(elements, checks, layout, room),
    ...(open === undefined ? [] : familyRows(elements, checks, open, names, layout, room)),
  ]
}
