import type { RenderElement, RenderSurface } from 'claude-code'
import { erroredOutput, isRecord } from './output'
import type { RowLook } from './row'

export const DRAWN_CHARACTERS_AT_MOST = 60_000
const RESULT_INDENT = 2
const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)+/
export const FOLD_LABELS = { folded: 'more', shown: 'shown' } as const
const COPY_LABEL = 'copy'
const BUTTON_FRAME_CELLS = 4
const BUTTON_GAP = 1

export type FoldLabel = keyof typeof FOLD_LABELS

export const FOLD_BUTTON_CELLS =
  Math.max(...Object.values(FOLD_LABELS).map((label) => label.length)) + BUTTON_FRAME_CELLS

export const FOLD_BUTTONS_CELLS =
  FOLD_BUTTON_CELLS + COPY_LABEL.length + BUTTON_FRAME_CELLS + BUTTON_GAP

export type CallOutput = { text: string; lines: string[]; savedTo: string | null }

export type FoldActions = {
  press: () => void
  copy?: (surface: RenderSurface) => void
}

function outputOf(copied: string, drawn: string, savedTo: string | null): CallOutput | null {
  const kept = drawn.trimEnd()
  if (kept === '' && savedTo === null) return null
  return { text: copied, lines: kept === '' ? [] : kept.split(/\r?\n/), savedTo }
}

function stdoutThenStderr(stdout: string, stderr: string): string {
  const isBreakNeeded = stdout !== '' && stderr !== '' && !stdout.endsWith('\n')
  return `${stdout}${isBreakNeeded ? '\n' : ''}${stderr}`
}

export function erroredCallOutput(text: string): CallOutput | null {
  const errored = erroredOutput(text)
  const body = (errored === null ? text : errored.body).replace(LEADING_BLANK_LINES, '')
  return outputOf(body, body, null)
}

export function callOutput(output: unknown, isErrored: boolean): CallOutput | null {
  if (isErrored) return typeof output === 'string' ? erroredCallOutput(output) : null
  if (!isRecord(output) || typeof output.stdout !== 'string') return null
  const stderr = typeof output.stderr === 'string' ? output.stderr : ''
  const drawn = [output.stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== '').join('\n')
  const savedTo = typeof output.persistedOutputPath === 'string' ? output.persistedOutputPath : null
  return outputOf(stdoutThenStderr(output.stdout, stderr), drawn, savedTo)
}

export function commandOutput(command: string): CallOutput {
  return { text: command, lines: command.split(/\r?\n/), savedTo: null }
}

export function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`
}

export function foldButtons(look: RowLook, label: FoldLabel, actions: FoldActions): RenderElement {
  const { Box, Button } = look.elements
  return Box({
    flexDirection: 'row',
    gap: BUTTON_GAP,
    children: [
      Button({
        key: 'fold',
        label: FOLD_LABELS[label],
        dimColor: label === 'folded',
        onPress: () => {
          actions.press()
        },
      }),
      actions.copy === undefined
        ? null
        : Button({
            key: 'copy',
            label: COPY_LABEL,
            dimColor: true,
            onPress: (press) => {
              actions.copy?.(press.surface)
            },
          }),
    ],
  })
}

export function hintLine(look: RowLook, text: string): RenderElement {
  const { Box, Text } = look.elements
  return Box({
    key: 'hint',
    paddingLeft: look.hasToolMarker ? RESULT_INDENT : 0,
    children: Text({ dimColor: true, wrap: 'truncate-end', children: text }),
  })
}
