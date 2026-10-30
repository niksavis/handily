import type {
  BoxProps,
  ButtonProps,
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
  cutFailuresText,
  cutLinesText,
} from './runs'
import { displayWidth, fitted, lastToWidth, padToWidth } from './width'

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
const PLACE_GAP = 2
const CUT_MARK = '…'
const COPY_WIDTH = displayWidth(`[ ${COPY_KEY} ]`)
const DIFF_COLORS: Readonly<Record<string, ThemeKey>> = { '-': 'error', '+': 'success' }

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

export function tailFitted(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  if (width <= 0) return ''
  return `${CUT_MARK}${lastToWidth(text, width - displayWidth(CUT_MARK))}`
}

export type FittedRow = { name: string; place: string }

export function fittedRow(name: string, place: string, room: number): FittedRow {
  if (place === '') return { name: fitted(name, room), place: '' }
  const available = Math.max(room - PLACE_GAP, 0)
  const nameFloor = Math.min(displayWidth(name), Math.floor(available / 2))
  const placeRoom = Math.min(displayWidth(place), available - nameFloor)
  const nameRoom = available - placeRoom
  return {
    name: padToWidth(fitted(name, nameRoom), nameRoom + PLACE_GAP),
    place: tailFitted(place, placeRoom),
  }
}

function diffLines(elements: PaneElements, failure: TestsFailure, room: number): RenderElement[] {
  const { Text } = elements
  const lines = failure.diff.map((line) => {
    const color = DIFF_COLORS[line.charAt(0)]
    const children = fitted(line, room)
    return Text(color === undefined ? { children } : { color, children })
  })
  const cut =
    failure.cutLines > 0
      ? [Text({ dimColor: true, children: fitted(cutLinesText(failure.cutLines), room) })]
      : []
  return [...lines, ...cut]
}

function failureDetail(
  elements: PaneElements,
  failure: TestsFailure,
  actions: PaneActions,
  isWide: boolean,
): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  const room = bodyColumns - DETAIL_INDENT
  const place = isWide ? '' : tailFitted(placeOf(failure, false), room)
  const lines = [place, fitted(failure.message, room)].filter((line) => line !== '')
  return Box({
    flexDirection: 'column',
    paddingLeft: DETAIL_INDENT,
    children: [
      ...lines.map((line) => Text({ children: line })),
      ...diffLines(elements, failure, room),
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
  const lead = `${marks.blocked} `
  const room = bodyColumns - displayWidth(lead)
  const { name, place } = fittedRow(failure.name, isWide ? placeOf(failure, false) : '', room)
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
  const notKept =
    outcome.cutFailures > 0 ? [dimLine(elements, cutFailuresText(outcome.cutFailures))] : []
  const passed =
    outcome.passed > 0 && !outcome.isCut
      ? [Text({ dimColor: true, children: `+${String(outcome.passed)} passed` })]
      : []
  const none = failures.length === 0 && outcome.failed === 0 && !outcome.isCut
  if (none) return [Text({ children: 'No failure.' })]
  return [rule(elements), ...rows, ...more, ...notKept, ...passed]
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
  const lead = `${marks.blocked} `
  const room = bodyColumns - displayWidth(lead) - COPY_WIDTH - PLACE_GAP
  const row = fittedRow(failure.name, placeOf(failure, true), room)
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
        children: [Text({ color: 'error', children: lead }), row.name],
      }),
      Text({
        dimColor: true,
        children: padToWidth(row.place, displayWidth(row.place) + PLACE_GAP),
      }),
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
  const room = bodyColumns - DETAIL_INDENT
  const message = failure.message === '' ? [] : [failure.message]
  const diff = failure.diff.slice(0, Math.max(INLINE_DETAIL_ROWS - message.length, 0))
  const shown = { ...failure, diff, cutLines: 0 }
  const rows = [
    ...message.map((line) => Text({ children: fitted(`    ${line}`, bodyColumns) })),
    ...(diff.length === 0
      ? []
      : [
          Box({
            flexDirection: 'column',
            paddingLeft: DETAIL_INDENT,
            children: diffLines(elements, shown, room),
          }),
        ]),
  ]
  return { rows, hidden: failure.diff.length - diff.length + failure.cutLines }
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
