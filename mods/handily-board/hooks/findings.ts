import type { EngineInterface, RenderElement } from 'claude-code'
import type { BoardFinding, BoardFindings } from '../types'
import type { PromptFill } from './board'
import { withoutFinalPeriod } from './commands'
import type { PaneElements } from './pane'
import { refusedParts } from './replies'
import { escaped, titleRefusal } from './tasks'
import { marked, type ToastParts } from './toast'
import { displayWidth, fitted } from './width'

export type FileOutcome = Awaited<ReturnType<EngineInterface['workitems']['create']>>

export type FindingsHost = {
  read: () => Promise<BoardFindings>
  edit: (change: (current: BoardFindings) => BoardFindings) => Promise<void>
  create: (title: string) => Promise<FileOutcome>
  fillPrompt: (text: string) => Promise<PromptFill>
}

export type FindingsPress = {
  file: (id: number) => void
  fix: (id: number) => void
  dismiss: (id: number) => void
}

export const EMPTY_FINDINGS: BoardFindings = { findings: [], nextId: 1 }
export const MAX_FINDINGS = 20
export const FIX_LEAD = 'Fix this finding:'

const UNDER_INDENT = 4
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
const ACTION_LABELS = ['file', 'fix', 'dismiss'] as const
const NOT_FILED = 'Finding not filed'
const NOT_HANDED = 'Finding not handed to Claude'
const filing = new Set<number>()

export function findingRefusal(text: unknown, held: number): string | undefined {
  if (typeof text !== 'string' || text.trim() === '') {
    return 'finding_add needs text: a non-empty string, for example {"text": "The date parser drops the time zone"}.'
  }
  const fault = titleRefusal(text)
  if (fault !== undefined) return `finding_add refused: ${fault.replace('the title', 'the text')}`
  if (text.trimStart().startsWith('-')) {
    return 'finding_add refused: the text starts with -. Start it with a word.'
  }
  if (held >= MAX_FINDINGS) {
    return `finding_add refused: the board holds ${String(MAX_FINDINGS)} findings, the most it keeps. The person files or dismisses them first.`
  }
  return undefined
}

export function withFinding(
  current: BoardFindings,
  text: string,
  at: number,
): { findings: BoardFindings; finding: BoardFinding } {
  const finding = { id: current.nextId, text: text.trim(), at }
  return {
    finding,
    findings: { findings: [...current.findings, finding], nextId: current.nextId + 1 },
  }
}

function withoutFinding(current: BoardFindings, id: number): BoardFindings {
  return { ...current, findings: current.findings.filter((finding) => finding.id !== id) }
}

export function fixPrompt(finding: BoardFinding): string {
  return `${FIX_LEAD} ${finding.text}`
}

async function findingOf(host: FindingsHost, id: number): Promise<BoardFinding | undefined> {
  return (await host.read()).findings.find((finding) => finding.id === id)
}

export async function fileFinding(host: FindingsHost, id: number): Promise<ToastParts | undefined> {
  if (filing.has(id)) return undefined
  filing.add(id)
  try {
    const finding = await findingOf(host, id)
    if (finding === undefined) return undefined
    const made = await host.create(finding.text)
    if (!made.created) {
      return refusedParts(NOT_FILED, withoutFinalPeriod(made.reason), 'fix or dismiss it here')
    }
    await host.edit((current) => withoutFinding(current, id))
    return [marked('done', `Filed as ${made.id}`), { quoted: finding.text }]
  } finally {
    filing.delete(id)
  }
}

export async function fixFinding(host: FindingsHost, id: number): Promise<ToastParts | undefined> {
  const finding = await findingOf(host, id)
  if (finding === undefined) return undefined
  const filled = await host.fillPrompt(fixPrompt(finding))
  if (!filled.isFilled) {
    return refusedParts(
      NOT_HANDED,
      filled.refusal ?? 'the prompt box did not take it',
      'ask Claude in your prompt',
    )
  }
  await host.edit((current) => withoutFinding(current, id))
  return undefined
}

export async function dismissFinding(host: FindingsHost, id: number): Promise<undefined> {
  await host.edit((current) => withoutFinding(current, id))
  return undefined
}

function findingRow(
  elements: PaneElements,
  finding: BoardFinding,
  idWidth: number,
  press: FindingsPress,
): RenderElement {
  const { Box, Text, Button } = elements
  const id = String(finding.id)
  const { mark, color } = elements.signals.waitsForYou
  const lead = `${mark} ${id.padStart(idWidth)} `
  const text = escaped(finding.text)
  const shown = fitted(text, Math.max(elements.bodyColumns - displayWidth(lead), 1))
  const room = elements.bodyColumns - UNDER_INDENT
  const actions = {
    file: press.file,
    fix: press.fix,
    dismiss: press.dismiss,
  }
  const buttonsWidth =
    ACTION_LABELS.reduce((sum, label) => sum + displayWidth(label) + BUTTON_CHROME, 0) +
    (ACTION_LABELS.length - 1) * BUTTON_GAP
  const isOneRow = buttonsWidth <= room
  return Box({
    key: `finding:${id}`,
    flexDirection: 'column',
    children: [
      Box({
        key: `row:finding:${id}`,
        flexDirection: 'row',
        children: [
          Text({ color, children: `${mark} ` }),
          Text({ children: `${id.padStart(idWidth)} ` }),
          Text({ children: shown }),
        ],
      }),
      Box({
        flexDirection: 'column',
        paddingLeft: UNDER_INDENT,
        children: [
          shown === text ? null : Text({ dimColor: true, children: text }),
          Box({
            key: `finding-actions:${id}`,
            flexDirection: isOneRow ? 'row' : 'column',
            children: ACTION_LABELS.map((label, index) =>
              Box({
                flexShrink: 0,
                marginLeft: isOneRow && index > 0 ? BUTTON_GAP : 0,
                children: [
                  Button({
                    key: `finding-${label}:${id}`,
                    label,
                    onPress: () => {
                      actions[label](finding.id)
                    },
                  }),
                ],
              }),
            ),
          }),
        ].filter((element) => element !== null),
      }),
    ],
  })
}

export function drawFindings(
  elements: PaneElements,
  findings: BoardFindings,
  press: FindingsPress,
): RenderElement[] {
  const { Box, Text } = elements
  const shown = findings.findings
  if (shown.length === 0) return []
  const idWidth = Math.max(...shown.map((finding) => String(finding.id).length))
  const { mark, color } = elements.signals.waitsForYou
  return [
    Box({
      key: 'findings-head',
      flexDirection: 'row',
      children: [
        Text({ bold: true, children: 'Findings' }),
        Text({ children: '  ' }),
        Text({ color, children: `${mark} ${String(shown.length)} open` }),
      ],
    }),
    ...shown.map((finding) => findingRow(elements, finding, idWidth, press)),
    Text({ dimColor: true, children: '─'.repeat(elements.bodyColumns) }),
  ]
}
