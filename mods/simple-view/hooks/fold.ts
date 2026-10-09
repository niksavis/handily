import type { RenderElement, RenderSurface } from 'claude-code'
import type { SimpleViewFold } from '../types'
import { EXIT_PREFIX, isRecord } from './output'
import type { RowLook } from './row'

export const OPEN_LINES = 20
export const DRAWN_CHARACTERS_AT_MOST = 60_000
const TAB_STOP = 8
const RESULT_INDENT = 2
// eslint-disable-next-line no-control-regex -- an ANSI colour code starts with the escape character
const COLOR_CODE = /\u001b\[[0-9;:]*m/g
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)+/

const COPY_REFUSALS: Readonly<Record<'no-surface' | 'no-clipboard' | 'refused', string>> = {
  'no-surface': 'no screen is attached to this session',
  'no-clipboard': 'the clipboard took nothing. The text may be too long for this terminal',
  refused: 'another plugin refused the copy',
}

export function copyRefusalText(reason: keyof typeof COPY_REFUSALS): string {
  return `Not copied: ${COPY_REFUSALS[reason]}.`
}

export type CallOutput = { text: string; lines: string[]; savedTo: string | null }

export type FoldActions = {
  fold: (next: SimpleViewFold) => void
  copy?: (surface: RenderSurface) => void
}

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

function expandedTabs(line: string): string {
  let shown = ''
  for (const character of line) {
    shown += character === '\t' ? ' '.repeat(TAB_STOP - (shown.length % TAB_STOP)) : character
  }
  return shown
}

export function lineCountOf(text: string): number {
  return text === '' ? 0 : text.split(/\r?\n/).length
}

export function shownLine(line: string): string {
  const overwritten = line.replace(COLOR_CODE, '').split('\r').at(-1) ?? ''
  return expandedTabs(overwritten).replace(HIDDEN_CHARACTER, escapedUnits)
}

function outputOf(text: string, savedTo: string | null): CallOutput | null {
  const kept = text.trimEnd()
  if (kept === '' && savedTo === null) return null
  return { text: kept, lines: kept === '' ? [] : kept.split(/\r?\n/), savedTo }
}

export function callOutput(output: unknown, isErrored: boolean): CallOutput | null {
  if (isErrored) {
    if (typeof output !== 'string') return null
    const found = EXIT_PREFIX.exec(output)
    if (found === null) return null
    return outputOf(output.slice(found[0].length).replace(LEADING_BLANK_LINES, ''), null)
  }
  if (!isRecord(output) || typeof output.stdout !== 'string') return null
  const stderr = typeof output.stderr === 'string' ? output.stderr.trimEnd() : ''
  const text = [output.stdout.trimEnd(), stderr].filter((part) => part !== '').join('\n')
  const savedTo = typeof output.persistedOutputPath === 'string' ? output.persistedOutputPath : null
  return outputOf(text, savedTo)
}

export function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`
}

export function foldButtons(
  look: RowLook,
  fold: SimpleViewFold,
  actions: FoldActions,
): RenderElement {
  const { Box, Button } = look.elements
  return Box({
    flexDirection: 'row',
    gap: 1,
    children: [
      Button({
        key: 'fold',
        label: fold === 'folded' ? 'more' : 'less',
        dimColor: true,
        onPress: () => {
          actions.fold(fold === 'folded' ? 'open' : 'folded')
        },
      }),
      actions.copy === undefined
        ? null
        : Button({
            key: 'copy',
            label: 'copy',
            dimColor: true,
            onPress: (press) => {
              actions.copy?.(press.surface)
            },
          }),
    ],
  })
}

function drawnLines(lines: readonly string[], fold: 'open' | 'all'): string[] {
  if (fold === 'open') return lines.slice(0, OPEN_LINES).map(shownLine)
  const drawn: string[] = []
  let characters = 0
  for (const line of lines) {
    const shown = shownLine(line)
    characters += shown.length + 1
    if (characters > DRAWN_CHARACTERS_AT_MOST) break
    drawn.push(shown)
  }
  return drawn
}

function noteLines(output: CallOutput, fold: 'open' | 'all', drawn: number): string[] {
  const left = output.lines.length - drawn
  const notes: string[] = []
  if (fold === 'open' && left > 0) notes.push('…')
  if (fold === 'all' && left > 0) {
    notes.push(`… ${plural(left, 'more line')} not drawn. Copy takes all of them.`)
  }
  if (output.savedTo !== null) {
    notes.push(`The full output is in ${shownLine(output.savedTo)}. Copy takes all of it.`)
  }
  return notes
}

export function outputBlock(
  look: RowLook,
  output: CallOutput,
  fold: 'open' | 'all',
  actions: FoldActions,
): RenderElement {
  const { Box, Text, Button } = look.elements
  const drawn = drawnLines(output.lines, fold)
  const textLine = (text: string, index: number, key: string) =>
    Box({
      key: `${key}-${String(index)}`,
      children: Text({ dimColor: true, wrap: 'truncate-end', children: text === '' ? ' ' : text }),
    })
  const hasAllButton = fold === 'open' && output.lines.length > OPEN_LINES
  return Box({
    flexDirection: 'column',
    paddingLeft: look.hasToolMarker ? RESULT_INDENT : 0,
    children: [
      ...drawn.map((text, index) => textLine(text, index, 'line')),
      ...noteLines(output, fold, drawn.length).map((text, index) => textLine(text, index, 'note')),
      hasAllButton
        ? Box({
            key: 'all-lines',
            children: Button({
              key: 'all',
              label: `all ${String(output.lines.length)} lines`,
              dimColor: true,
              onPress: () => {
                actions.fold('all')
              },
            }),
          })
        : null,
    ],
  })
}
