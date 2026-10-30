import type {
  BoxProps,
  ButtonProps,
  CodeProps,
  ElementConstructor,
  RenderElement,
  RenderSurface,
  TextProps,
  ThemeKey,
} from 'claude-code'
import type { TestsFailure, TestsRun, TestsRuns } from '../types'
import type { GlyphSet } from './glyphs'
import {
  FAILURES_SHOWN,
  type HeadRole,
  type Headline,
  type Running,
  ageText,
  countsText,
  failuresOf,
  headlineOf,
  headlineText,
  metaLines,
  placeOf,
  runRole,
  runnerText,
  runningHeadline,
  shownCommand,
} from './runs'
import { displayWidth, fitted, padToWidth } from './width'

export const TESTS_PANE = { id: 'tests', title: 'tests' } as const

export const COPY_KEY = 'copy'

export const COPY_HOTKEY = 'y'

export const RUNS_SHOWN = 5

export const WIDE_BODY = 41

export const INLINE_ROWS = 8

const INLINE_DETAIL_ROWS = INLINE_ROWS - 4

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Code: ElementConstructor<CodeProps>
  bodyColumns: number
  marks: GlyphSet
}

export type PaneView = {
  runs: TestsRuns
  running: Running | undefined
  now: number
  opened: number | null
  isAllFailures: boolean
  isAllRuns: boolean
}

export type PaneActions = {
  open: (index: number) => void
  more: () => void
  older: () => void
  copy: (failure: TestsFailure, surface: RenderSurface) => void
}

const TITLE = 'Tests'
const TITLE_GAP = '  '
const DETAIL_INDENT = 4
const RUN_COUNTS = 7
const RUN_RUNNER = 8
const RUN_AGE = 3
const NO_RUN_LINES = [
  'A Bash call that runs vitest, jest,',
  'node --test or pytest fills this tab.',
  'Other output is not read.',
]
const NO_RUN_TEXT = 'A Bash call that runs vitest, jest, node --test or pytest fills this tab.'
const DOCK_NOTE = 'a dock (fullscreen, 110 columns) shows every run'

const ROLE_COLORS: Readonly<Record<HeadRole, ThemeKey | undefined>> = {
  blocked: 'error',
  done: 'success',
  doing: 'claude',
  toDo: undefined,
}

function rule(elements: PaneElements): RenderElement {
  return elements.Text({ color: 'subtle', children: '─'.repeat(elements.bodyColumns) })
}

function headRow(elements: PaneElements, headline: Headline): RenderElement {
  const { Box, Text, marks, bodyColumns } = elements
  const room = bodyColumns - displayWidth(`${TITLE}${TITLE_GAP}`)
  const marked = fitted(`${marks[headline.role]} ${headline.text}`, room)
  const tail = fitted(headline.tail, Math.max(room - displayWidth(marked), 0))
  const color = ROLE_COLORS[headline.role]
  return Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: `${TITLE}${TITLE_GAP}` }),
      Text(color === undefined ? { children: marked } : { color, children: marked }),
      Text({ children: tail }),
    ],
  })
}

function dimLine(elements: PaneElements, text: string): RenderElement {
  return elements.Text({ dimColor: true, children: fitted(text, elements.bodyColumns) })
}

export function hunkOf(lines: readonly string[]): string {
  const old = lines.filter((line) => !line.startsWith('+')).length
  const added = lines.filter((line) => !line.startsWith('-')).length
  return [`@@ -1,${String(old)} +1,${String(added)} @@`, ...lines].join('\n')
}

function diffCode(elements: PaneElements, diff: readonly string[]): RenderElement[] {
  if (diff.length === 0) return []
  return [elements.Code({ source: hunkOf(diff), format: 'diff', wrap: 'truncate-end' })]
}

function failureDetail(
  elements: PaneElements,
  failure: TestsFailure,
  actions: PaneActions,
  isWide: boolean,
): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  const room = bodyColumns - DETAIL_INDENT
  const place = isWide ? '' : placeOf(failure, false)
  const lines = [...(place === '' ? [] : [place]), failure.message].filter((line) => line !== '')
  return Box({
    flexDirection: 'column',
    paddingLeft: DETAIL_INDENT,
    children: [
      ...lines.map((line) => Text({ children: fitted(line, room) })),
      ...diffCode(elements, failure.diff),
      Button({
        key: COPY_KEY,
        label: COPY_KEY,
        hotkey: COPY_HOTKEY,
        onPress: (press) => {
          actions.copy(failure, press.surface)
        },
      }),
    ],
  })
}

function failureRow(
  elements: PaneElements,
  failure: TestsFailure,
  index: number,
  actions: PaneActions,
): RenderElement {
  const { Text, Button, marks, bodyColumns } = elements
  const isWide = bodyColumns >= WIDE_BODY
  const place = isWide ? placeOf(failure, false) : ''
  const lead = `${marks.blocked} `
  const nameRoom = bodyColumns - displayWidth(lead) - (place === '' ? 0 : displayWidth(place) + 2)
  const name =
    place === ''
      ? fitted(failure.name, nameRoom)
      : padToWidth(fitted(failure.name, nameRoom), nameRoom + 2)
  return Button({
    key: `failure:${String(index)}`,
    label: failure.name,
    plain: true,
    onPress: () => {
      actions.open(index)
    },
    children: [
      Text({ color: 'error', children: lead }),
      name,
      ...(place === '' ? [] : [Text({ dimColor: true, children: place })]),
    ],
  })
}

function failureRows(
  elements: PaneElements,
  run: TestsRun,
  view: PaneView,
  actions: PaneActions,
): RenderElement[] {
  const { outcome } = run
  if (outcome.kind !== 'tests') return []
  const { Button, Text } = elements
  const failures = failuresOf(run)
  const shown = view.isAllFailures ? failures : failures.slice(0, FAILURES_SHOWN)
  const isWide = elements.bodyColumns >= WIDE_BODY
  const rows = shown.flatMap((failure, index) => [
    failureRow(elements, failure, index, actions),
    ...(view.opened === index ? [failureDetail(elements, failure, actions, isWide)] : []),
  ])
  const hidden = failures.length - shown.length
  const more =
    hidden > 0
      ? [Button({ key: 'more', label: `+${String(hidden)} more failed`, onPress: actions.more })]
      : []
  const passed =
    outcome.passed > 0 && !outcome.isCut
      ? [Text({ dimColor: true, children: `+${String(outcome.passed)} passed` })]
      : []
  const none = failures.length === 0 && outcome.failed === 0 && !outcome.isCut
  return none ? [Text({ children: 'No failure.' })] : [rule(elements), ...rows, ...more, ...passed]
}

function runLine(elements: PaneElements, run: TestsRun, now: number): RenderElement {
  const { Box, Text, marks, bodyColumns } = elements
  const role = runRole(run.outcome)
  const color = ROLE_COLORS[role]
  const counts = padToWidth(countsText(run.outcome), RUN_COUNTS)
  const runner = padToWidth(runnerText(run.outcome), RUN_RUNNER)
  const age = ageText(now - run.endedAt).padStart(RUN_AGE)
  const lead = `${marks[role]} `
  const room = bodyColumns - displayWidth(`${lead}${counts}${runner}`) - RUN_AGE - 1
  const command = padToWidth(
    fitted(shownCommand(run.command), Math.max(room, 0)),
    Math.max(room, 0),
  )
  return Box({
    flexDirection: 'row',
    children: [
      Text(color === undefined ? { children: lead } : { color, children: lead }),
      Text({ children: `${counts}${runner}${command} ` }),
      Text({ dimColor: true, children: age }),
    ],
  })
}

function runRows(elements: PaneElements, view: PaneView, actions: PaneActions): RenderElement[] {
  const { runs, now } = view
  if (runs.length < 2) return []
  const { Box, Text, Button } = elements
  const shown = view.isAllRuns ? runs : runs.slice(0, RUNS_SHOWN)
  const older = runs.length - shown.length
  const rows = shown.flatMap((run) => [
    runLine(elements, run, now),
    ...(run.agent === null
      ? []
      : [Text({ dimColor: true, children: fitted(`    by ${run.agent}`, elements.bodyColumns) })]),
  ])
  return [
    rule(elements),
    Box({
      flexDirection: 'row',
      children: [
        Text({ bold: true, children: 'Runs' }),
        Text({
          dimColor: true,
          children: `  last ${String(shown.length)} of ${String(runs.length)}`,
        }),
      ],
    }),
    ...rows,
    ...(older > 0
      ? [Button({ key: 'older', label: `+${String(older)} older runs`, onPress: actions.older })]
      : []),
  ]
}

function lastRunLines(elements: PaneElements, run: TestsRun, view: PaneView): RenderElement[] {
  return [
    headRow(elements, headlineOf(run)),
    ...metaLines(run, view.now).map((line) => dimLine(elements, line)),
  ]
}

function runningLines(elements: PaneElements, running: Running, view: PaneView): RenderElement[] {
  const [last] = view.runs
  const lastLine =
    last === undefined
      ? []
      : [dimLine(elements, `last run: ${headlineText(headlineOf(last), elements.marks)}`)]
  return [headRow(elements, runningHeadline(running, view.now)), ...lastLine]
}

function noRunLines(elements: PaneElements): RenderElement[] {
  const headline: Headline = { role: 'toDo', text: 'no run yet', tail: '' }
  const { Box, Text, bodyColumns } = elements
  const lines = bodyColumns >= WIDE_BODY ? NO_RUN_LINES : [NO_RUN_TEXT]
  return [
    Box({
      flexDirection: 'row',
      children: [
        Text({ bold: true, children: `${TITLE}${TITLE_GAP}` }),
        Text({ dimColor: true, children: headline.text }),
      ],
    }),
    ...lines.map((line) => Text({ dimColor: true, children: line })),
  ]
}

export function drawDock(
  elements: PaneElements,
  view: PaneView,
  actions: PaneActions,
): RenderElement {
  const [last] = view.runs
  const top = view.running === undefined ? [] : runningLines(elements, view.running, view)
  if (last === undefined) {
    return elements.Box({
      flexDirection: 'column',
      children: [...top, ...(top.length > 0 ? [] : noRunLines(elements))],
    })
  }
  const head = view.running === undefined ? lastRunLines(elements, last, view) : []
  return elements.Box({
    flexDirection: 'column',
    children: [
      ...top,
      ...head,
      ...failureRows(elements, last, view, actions),
      ...runRows(elements, view, actions),
    ],
  })
}

function inlineRunsText(view: PaneView, marks: GlyphSet): string {
  if (view.runs.length < 2) return ''
  const runs = view.runs
    .slice(0, RUNS_SHOWN)
    .map(
      (run) =>
        `${marks[runRole(run.outcome)]} ${countsText(run.outcome)} ${ageText(view.now - run.endedAt)}`,
    )
  return `Runs: ${runs.join(' · ')}`
}

function inlineFailureRow(
  elements: PaneElements,
  failure: TestsFailure,
  index: number,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button, marks, bodyColumns } = elements
  const place = placeOf(failure, true)
  const copy = `[ ${COPY_KEY} ]`
  const room = bodyColumns - displayWidth(copy) - displayWidth(place) - 4
  return Box({
    flexDirection: 'row',
    children: [
      Button({
        key: `failure:${String(index)}`,
        label: failure.name,
        plain: true,
        onPress: () => {
          actions.open(index)
        },
        children: [
          Text({ color: 'error', children: `${marks.blocked} ` }),
          padToWidth(fitted(failure.name, Math.max(room - 2, 1)), Math.max(room - 2, 1) + 2),
        ],
      }),
      Text({ dimColor: true, children: `${place}  ` }),
      Button({
        key: COPY_KEY,
        label: COPY_KEY,
        hotkey: COPY_HOTKEY,
        onPress: (press) => {
          actions.copy(failure, press.surface)
        },
      }),
    ],
  })
}

function inlineHeadline(view: PaneView, last: TestsRun): Headline {
  if (view.running !== undefined) return runningHeadline(view.running, view.now)
  const headline = headlineOf(last)
  return { ...headline, tail: [headline.tail, ...metaLines(last, view.now)].join(' · ') }
}

function inlineDetails(
  elements: PaneElements,
  failure: TestsFailure,
): { rows: RenderElement[]; hidden: number } {
  const { Box, Text, bodyColumns } = elements
  const message = failure.message === '' ? [] : [failure.message]
  const diff = failure.diff.slice(0, Math.max(INLINE_DETAIL_ROWS - message.length, 0))
  const rows = [
    ...message.map((line) => Text({ children: fitted(`    ${line}`, bodyColumns) })),
    ...(diff.length === 0
      ? []
      : [Box({ paddingLeft: DETAIL_INDENT, children: diffCode(elements, diff) })]),
  ]
  return { rows, hidden: failure.diff.length - diff.length }
}

function passedText(run: TestsRun): string {
  const { outcome } = run
  if (outcome.kind !== 'tests' || outcome.passed === 0 || outcome.isCut) return ''
  return `+${String(outcome.passed)} passed   `
}

export function drawInline(
  elements: PaneElements,
  view: PaneView,
  actions: PaneActions,
): RenderElement {
  const { Box, marks } = elements
  const [last] = view.runs
  if (last === undefined) {
    const top =
      view.running === undefined ? [] : [headRow(elements, runningHeadline(view.running, view.now))]
    const empty = dimLine(elements, `${TITLE}${TITLE_GAP}no run yet · ${NO_RUN_TEXT}`)
    return Box({ flexDirection: 'column', children: top.length > 0 ? top : [empty] })
  }
  const failures = failuresOf(last)
  const index = view.opened ?? 0
  const failure = failures[index]
  const details = failure === undefined ? { rows: [], hidden: 0 } : inlineDetails(elements, failure)
  const hidden = Math.max(failures.length - 1, 0) + details.hidden
  const bottom = `${passedText(last)}${inlineRunsText(view, marks)}`.trimEnd()
  return Box({
    flexDirection: 'column',
    children: [
      headRow(elements, inlineHeadline(view, last)),
      ...(failure === undefined ? [] : [inlineFailureRow(elements, failure, index, actions)]),
      ...details.rows,
      ...(bottom === '' ? [] : [dimLine(elements, bottom)]),
      ...(hidden > 0 ? [dimLine(elements, `+${String(hidden)} more rows: ${DOCK_NOTE}`)] : []),
    ],
  })
}
