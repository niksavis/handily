import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  PromptFilled,
  RenderElement,
  TextProps,
  ThemeKey,
} from 'claude-code'
import { elapsedText } from './activity'
import { wrappedText } from './frame'
import type { FillShown, MachineView } from './sessions'
import { needsYouText, type SignalLook, type SignalLooks } from './signals'
import {
  POLL_INTERVAL_MS,
  type AskLook,
  type AskRow,
  type BadFile,
  type DerivedState,
  type SessionRow,
  type Snapshot,
  type StoreRow,
  ASK_FILES_AT_MOST,
  SESSION_FILES_AT_MOST,
} from './store'
import { escaped } from './tasks'
import { displayWidth, fitted, padToWidth } from './width'

export type MachineElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  bodyColumns: number
  isInline: boolean
  expanded: ReadonlySet<string>
  toggle: (key: string) => void
  signals: SignalLooks
  fills: ReadonlyMap<string, FillShown>
  fill: (record: string, text: string) => void
}

type Layout = { columns: number; isRow: boolean; isDim: boolean; canAnswer: boolean }

type Part = { text: string; color?: ThemeKey; dimColor?: boolean; bold?: boolean }

type RowsView = Extract<MachineView, { kind: 'rows' }>

type RowWidths = { name: number; state: number; project: number; age: number; detail: number }

const TITLE = 'Sessions'
const GAP = '  '
const SEPARATOR = ' · '
const CARD_INDENT = 2
const ROW_INDENT = 4
const ROW_LAYOUT_FROM = 60
const NARROW_BELOW = 36
const NEXT_FROM = 30
const SHORT_HINT_BELOW = 40
const AGE_WIDTH = 3
const PROJECT_COLUMN_AT_MOST = 12
const DETAIL_AT_LEAST = 10
const FOLD_KEY = 'machine:more'
const FOLD_FROM = 12
const FOLDED_ROWS = 6
const SHORT_ID = 8
const CARD_RULE = '─'
const OWN_BADGE = 'this'
const NOW_MARK = '▸'
const CODE_COLOR: ThemeKey = 'permission'
const RECORD_ID = /\b[a-z][a-z0-9]*-(?=[a-z0-9]*\d)[a-z0-9]{4,7}(?:\.\d+)*\b/
const DEAD_KEPT_MS = 2 * 60 * 60 * 1000
const ERROR_COLOR: ThemeKey = 'error'
const WARNING_COLOR: ThemeKey = 'warning'
const OWN_COLOR: ThemeKey = 'suggestion'
const STALE_LOOK: SignalLook = { mark: '?', color: 'inactive' }
const RETRY_TEXT = `retry in ${elapsedText(POLL_INTERVAL_MS)}`
const ANSWER_ELSEWHERE = 'answer in the Orchestrator window'
const NOT_COUNTED = ' (open, not counted)'
const NO_PROCESS_CHECK = 'No process check on this system; a session that ended shows as stale.'
const DESKTOP_TEXT = 'The store is read only in a terminal session.'
const UNSET_TEXT =
  'No store folder is set. Set the handily-board option store in /config to the folder that holds sessions/ and asks/.'
const LOADING_TEXT = 'Reading the store…'
const NO_SESSION_TEXT = 'No session has written to the store.'
const NO_ASK_TEXT = 'No ask is open.'

const STATE_WORDS: Readonly<Record<DerivedState, string>> = {
  dead: 'dead',
  stale: 'stale',
  needsYou: 'needs you',
  working: 'working',
  quiet: 'quiet',
}

const ASK_WORDS: Readonly<Record<AskLook, string>> = {
  decide: 'decide',
  oldAsk: 'old ask',
  approved: 'approved',
  withdrawn: 'withdrawn',
}

type FillRefusal = NonNullable<PromptFilled['refusal']>

const REFUSALS: Readonly<Record<string, string>> = {
  dialog: 'a dialog holds the keys',
  no_composer: 'this session has no prompt box',
  unanswered: 'no app answered; the text may still be in the prompt box',
} satisfies Readonly<Record<FillRefusal, string>>

function stateLook(state: DerivedState, signals: SignalLooks): SignalLook {
  switch (state) {
    case 'dead':
      return signals.blocked
    case 'stale':
      return STALE_LOOK
    case 'needsYou':
      return signals.waitsForYou
    case 'working':
      return signals.doing
    case 'quiet':
      return signals.toDo
  }
}

function askLook(look: AskLook, signals: SignalLooks): SignalLook {
  switch (look) {
    case 'decide':
      return signals.waitsForYou
    case 'oldAsk':
      return STALE_LOOK
    case 'approved':
      return signals.done
    case 'withdrawn':
      return signals.toDo
  }
}

function isRowDim(row: StoreRow): boolean {
  return row.kind === 'ask' && row.look !== 'decide'
}

function isMarkDim(row: StoreRow, layout: Layout): boolean {
  return layout.isDim || (row.kind === 'ask' && (row.look === 'oldAsk' || row.look === 'withdrawn'))
}

function looked(text: string, color: ThemeKey, isDim: boolean): Part {
  return isDim ? { text, dimColor: true } : { text, color }
}

function rowLook(row: StoreRow, signals: SignalLooks): SignalLook {
  return row.kind === 'ask' ? askLook(row.look, signals) : stateLook(row.state, signals)
}

function sessionName(row: SessionRow): string {
  const { name, id } = row.session
  return escaped(
    name === null || name.trim() === '' ? Array.from(id).slice(0, SHORT_ID).join('') : name,
  )
}

function stateText(row: SessionRow): string {
  return row.isOwn ? `${OWN_BADGE}${SEPARATOR}${STATE_WORDS[row.state]}` : STATE_WORDS[row.state]
}

function partsWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, part) => sum + displayWidth(part.text), 0)
}

function drawParts(
  elements: MachineElements,
  key: string,
  parts: readonly Part[],
  indent = 0,
): RenderElement {
  const { Box, Text } = elements
  return Box({
    key,
    flexDirection: 'row',
    paddingLeft: indent,
    children: parts.map(({ text, ...style }) => Text({ ...style, children: text })),
  })
}

function fittedParts(parts: readonly Part[], room: number): Part[] {
  let left = Math.max(room, 0)
  const kept: Part[] = []
  for (const part of parts) {
    if (left <= 0) break
    const text = fitted(part.text, left)
    left -= displayWidth(text)
    kept.push({ ...part, text })
  }
  return kept
}

function lineOf(
  elements: MachineElements,
  key: string,
  parts: readonly Part[],
  columns: number,
  indent = 0,
): RenderElement {
  return drawParts(elements, key, fittedParts(parts, columns - indent), indent)
}

function wrappedLines(
  elements: MachineElements,
  key: string,
  text: string,
  style: Omit<Part, 'text'>,
  columns: number,
  indent = 0,
): RenderElement[] {
  return wrappedText(text, Math.max(columns - indent, 1)).map((line, index) =>
    drawParts(elements, `${key}:${String(index)}`, [{ ...style, text: line }], indent),
  )
}

function joined(parts: readonly Part[]): Part[] {
  return parts.flatMap((part, index) =>
    index === 0 ? [part] : [{ text: SEPARATOR, dimColor: true }, part],
  )
}

function ageOf(ms: number): string {
  return elapsedText(ms)
}

function title(elements: MachineElements): RenderElement {
  return drawParts(elements, 'header', [{ text: TITLE, bold: true }])
}

function needYouCount(rows: readonly StoreRow[]): number {
  return rows.filter(
    (row) =>
      (row.kind === 'ask' && row.look === 'decide') ||
      (row.kind === 'session' && row.state === 'needsYou'),
  ).length
}

function deadCount(rows: readonly StoreRow[]): number {
  return rows.filter((row) => row.kind === 'session' && row.state === 'dead').length
}

function readAge(view: RowsView, now: number, layout: Layout): string {
  const age = ageOf(now - view.snapshot.at)
  return layout.isRow && view.failure === null ? `read ${age} ago` : age
}

function countFacts(view: RowsView): Part[] {
  const count: Part = { text: String(view.snapshot.sessions.length), dimColor: true }
  if (view.failure !== null) return [count]
  const needYou = needYouCount(view.rows)
  const dead = deadCount(view.rows)
  return [
    count,
    ...(needYou > 0 ? [{ text: needsYouText(needYou), color: WARNING_COLOR }] : []),
    ...(dead > 0 ? [{ text: `${String(dead)} dead`, color: ERROR_COLOR }] : []),
  ]
}

function headerParts(view: RowsView, now: number, layout: Layout): Part[] {
  const lead: Part[] = [{ text: TITLE, bold: true }, { text: GAP }]
  const facts = countFacts(view)
  const withAge = [
    ...lead,
    ...joined([...facts, { text: readAge(view, now, layout), dimColor: true }]),
  ]
  if (layout.columns >= NARROW_BELOW && partsWidth(withAge) <= layout.columns) return withAge
  return [...lead, ...joined(facts)]
}

function sessionLead(row: SessionRow, layout: Layout, signals: SignalLooks): Part[] {
  const look = stateLook(row.state, signals)
  const isDim = isMarkDim(row, layout)
  return [
    looked(`${look.mark} `, look.color, isDim),
    { text: sessionName(row), bold: true },
    ...(row.isOwn ? [{ text: `${GAP}${OWN_BADGE}`, color: OWN_COLOR }] : []),
    looked(`${GAP}${STATE_WORDS[row.state]}`, look.color, isDim),
  ]
}

function askLead(row: AskRow, layout: Layout, signals: SignalLooks): Part[] {
  const look = askLook(row.look, signals)
  const isDim = isMarkDim(row, layout)
  const rest = isRowDim(row) ? { dimColor: true } : { bold: true }
  return [
    looked(`${look.mark} `, look.color, isDim),
    looked(ASK_WORDS[row.look], look.color, isDim),
    { text: `${GAP}${escaped(row.ask.record)}`, ...rest },
  ]
}

function leadOf(row: StoreRow, layout: Layout, signals: SignalLooks): Part[] {
  return row.kind === 'ask' ? askLead(row, layout, signals) : sessionLead(row, layout, signals)
}

function headLines(
  elements: MachineElements,
  key: string,
  row: StoreRow,
  layout: Layout,
): RenderElement[] {
  const lead = leadOf(row, layout, elements.signals)
  const age = ageOf(row.ageMs).padStart(AGE_WIDTH)
  const room = layout.columns - partsWidth(lead) - displayWidth(age) - 1
  if (room >= 0) {
    return [
      drawParts(elements, key, [
        ...lead,
        { text: ' '.repeat(room + 1) },
        { text: age, dimColor: true },
      ]),
    ]
  }
  const [mark, name, ...rest] = lead
  const words = rest.map((part) => ({ ...part, text: part.text.trimStart() }))
  return [
    ...nameLines(elements, `${key}:name`, mark, name, layout.columns),
    drawParts(
      elements,
      `${key}:state`,
      [...joinedWords(words), { text: GAP }, { text: ageOf(row.ageMs), dimColor: true }],
      CARD_INDENT,
    ),
  ]
}

function nameLines(
  elements: MachineElements,
  key: string,
  mark: Part | undefined,
  name: Part | undefined,
  columns: number,
): RenderElement[] {
  const lead = mark ?? { text: '' }
  const room = Math.max(columns - displayWidth(lead.text), 1)
  return wrappedText(name?.text ?? '', room).map((line, index) =>
    drawParts(elements, `${key}:${String(index)}`, [
      index === 0 ? lead : { text: ' '.repeat(displayWidth(lead.text)) },
      { ...name, text: line },
    ]),
  )
}

function joinedWords(parts: readonly Part[]): Part[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [{ text: GAP }, part]))
}

function noteText(row: SessionRow): string | null {
  if (row.state === 'dead') return 'process gone'
  if (row.state !== 'stale') return null
  return row.isClockAhead ? 'clock ahead' : `last write ${ageOf(row.ageMs)} ago`
}

function factParts(row: SessionRow, withVendor: boolean): Part[] {
  const { project, vendor } = row.session
  const facts = [
    project === null ? null : escaped(project),
    withVendor ? vendor : null,
    noteText(row),
  ].filter((fact) => fact !== null)
  return facts.length === 0 ? [] : [{ text: facts.join(SEPARATOR), dimColor: true }]
}

function factsFor(row: SessionRow, room: number): Part[] {
  const full = factParts(row, true)
  if (room >= NARROW_BELOW || partsWidth(full) <= room) return full
  return factParts(row, false)
}

function nowParts(row: SessionRow, room: number, isDim: boolean): Part[] {
  const { now } = row.session
  if (now === null) return []
  const age = row.nowAgeMs === null ? '' : `${SEPARATOR}${ageOf(row.nowAgeMs)} old`
  const lead = `${NOW_MARK} `
  const text = fitted(escaped(now), Math.max(room - displayWidth(lead) - displayWidth(age), 1))
  return [
    { text: lead, dimColor: true },
    isDim ? { text, dimColor: true } : { text },
    ...(age === '' ? [] : [{ text: age, dimColor: true }]),
  ]
}

function itemOf(row: SessionRow): string | null {
  const { item, now } = row.session
  if (item !== null) return item
  return now === null ? null : (RECORD_ID.exec(now)?.[0] ?? null)
}

function itemParts(row: SessionRow, room: number): Part[] {
  const item = itemOf(row)
  return item === null
    ? []
    : [{ text: fitted(escaped(item), Math.max(room, 1)), color: CODE_COLOR }]
}

function lastParts(row: SessionRow, room: number, signals: SignalLooks): Part[] {
  const { last, lastOk } = row.session
  if (last === null) return []
  const look = lastOk === false ? signals.blocked : lastOk === true ? signals.done : null
  const mark: Part =
    look === null ? { text: '· ', dimColor: true } : { text: `${look.mark} `, color: look.color }
  const age = row.lastAgeMs === null ? '' : `${SEPARATOR}${ageOf(row.lastAgeMs)} ago`
  const text = fitted(
    escaped(last),
    Math.max(room - displayWidth(mark.text) - displayWidth(age), 1),
  )
  return [mark, { text }, ...(age === '' ? [] : [{ text: age, dimColor: true }])]
}

function waitsParts(row: SessionRow): Part[] {
  const { waitingOn } = row.session
  if (row.state !== 'needsYou' || waitingOn === null) return []
  return [{ text: 'waits on: ', dimColor: true }, { text: escaped(waitingOn) }]
}

function nextParts(row: SessionRow): Part[] {
  const { next } = row.session
  return next === null ? [] : [{ text: 'next: ', dimColor: true }, { text: escaped(next) }]
}

function sessionCard(elements: MachineElements, row: SessionRow, layout: Layout): RenderElement[] {
  const key = `card:${row.key}`
  const room = layout.columns - CARD_INDENT
  const lines: [string, Part[]][] = [
    ['facts', factsFor(row, room)],
    ['item', itemParts(row, room)],
    ['waits', waitsParts(row)],
    ['now', nowParts(row, room, layout.isDim)],
    ['last', lastParts(row, room, elements.signals)],
    ['next', layout.columns >= NEXT_FROM ? nextParts(row) : []],
  ]
  return [
    ...headLines(elements, `${key}:head`, row, layout),
    ...lines
      .filter(([, parts]) => parts.length > 0)
      .map(([name, parts]) =>
        lineOf(elements, `${key}:${name}`, parts, layout.columns, CARD_INDENT),
      ),
  ]
}

function fillText(record: string, label: string | null): string {
  return label === null ? `${record}: ` : `${record}: ${label}`
}

function hintText(row: AskRow, columns: number, isRow: boolean): string {
  const [first] = row.ask.options
  if (first === undefined)
    return `a press fills "${fillText(row.ask.record, null)}" and you type the rest`
  if (columns < SHORT_HINT_BELOW) return 'a press fills the prompt box; Enter sends it'
  const text = escaped(fillText(row.ask.record, first))
  return isRow
    ? `a press fills "${text}"; Enter sends it`
    : `a press fills the prompt box with "${text}"; Enter sends it`
}

export function refusalText(refusal: string): string {
  return REFUSALS[refusal] ?? refusal
}

function fillLines(
  elements: MachineElements,
  key: string,
  row: AskRow,
  layout: Layout,
  indent: number,
): RenderElement[] {
  const shown = elements.fills.get(row.ask.record)
  if (shown === undefined) {
    return wrappedLines(
      elements,
      `${key}:hint`,
      hintText(row, layout.columns, false),
      { dimColor: true },
      layout.columns,
      indent,
    )
  }
  if (shown.refusal === null) {
    return [
      ...wrappedLines(
        elements,
        `${key}:filled`,
        'in your prompt box, not sent:',
        { dimColor: true },
        layout.columns,
        indent,
      ),
      ...wrappedLines(elements, `${key}:text`, escaped(shown.text), {}, layout.columns, indent),
    ]
  }
  return [
    ...wrappedLines(
      elements,
      `${key}:refused`,
      `${elements.signals.blocked.mark} not filled: ${refusalText(shown.refusal)}.`,
      { color: ERROR_COLOR },
      layout.columns,
      indent,
    ),
    ...wrappedLines(
      elements,
      `${key}:type`,
      `Type it: ${escaped(shown.text)}`,
      {},
      layout.columns,
      indent,
    ),
  ]
}

function inlineFillPart(elements: MachineElements, row: AskRow, columns: number): Part[] {
  const shown = elements.fills.get(row.ask.record)
  if (shown === undefined) return [{ text: hintText(row, columns, true), dimColor: true }]
  if (shown.refusal === null) {
    return [
      { text: 'in your prompt box, not sent: ', dimColor: true },
      { text: escaped(shown.text) },
    ]
  }
  return [
    {
      text: `${elements.signals.blocked.mark} not filled: ${refusalText(shown.refusal)}. `,
      color: ERROR_COLOR,
    },
    { text: `Type it: ${escaped(shown.text)}` },
  ]
}

function answerButtons(elements: MachineElements, row: AskRow): RenderElement[] {
  const { record, options } = row.ask
  const labels: (string | null)[] = options.length === 0 ? [null] : [...options]
  return labels.flatMap((label, index) => {
    const button = elements.Button({
      key: `machine:ask:${record}:${label === null ? 'answer' : String(index)}`,
      label: label === null ? 'answer' : escaped(label),
      onPress: () => {
        elements.fill(record, fillText(record, label))
      },
    })
    return index === 0 ? [button] : [elements.Text({ children: GAP }), button]
  })
}

function buttonsLine(
  elements: MachineElements,
  key: string,
  row: AskRow,
  tail: readonly Part[],
  indent: number,
): RenderElement {
  return elements.Box({
    key,
    flexDirection: 'row',
    paddingLeft: indent,
    children: [
      ...answerButtons(elements, row),
      ...(tail.length === 0 ? [] : [elements.Text({ children: GAP })]),
      ...tail.map(({ text, ...style }) => elements.Text({ ...style, children: text })),
    ],
  })
}

function optionsText(row: AskRow): string {
  return `options: ${row.ask.options.map(escaped).join(' | ')}`
}

function questionText(row: AskRow): string {
  const question = row.ask.question === null ? '' : escaped(row.ask.question)
  return row.look === 'oldAsk' ? `${question}${NOT_COUNTED}`.trim() : question
}

function askCard(elements: MachineElements, row: AskRow, layout: Layout): RenderElement[] {
  const key = `card:${row.key}`
  const question = questionText(row)
  const style = isRowDim(row) || layout.isDim ? { dimColor: true } : {}
  const lines = [
    ...headLines(elements, `${key}:head`, row, layout),
    ...(question === ''
      ? []
      : wrappedLines(elements, `${key}:question`, question, style, layout.columns, CARD_INDENT)),
  ]
  if (row.look !== 'decide') return lines
  if (layout.canAnswer) {
    return [
      ...lines,
      buttonsLine(elements, `${key}:buttons`, row, [], CARD_INDENT),
      ...fillLines(elements, key, row, layout, CARD_INDENT),
    ]
  }
  return [
    ...lines,
    ...(row.ask.options.length === 0
      ? []
      : wrappedLines(
          elements,
          `${key}:options`,
          optionsText(row),
          { dimColor: true },
          layout.columns,
          CARD_INDENT,
        )),
    ...wrappedLines(
      elements,
      `${key}:elsewhere`,
      ANSWER_ELSEWHERE,
      { dimColor: true },
      layout.columns,
      CARD_INDENT,
    ),
  ]
}

function cardOf(elements: MachineElements, row: StoreRow, layout: Layout): RenderElement {
  return elements.Box({
    key: `card:${row.key}`,
    flexDirection: 'column',
    children:
      row.kind === 'ask' ? askCard(elements, row, layout) : sessionCard(elements, row, layout),
  })
}

function rule(elements: MachineElements, key: string, columns: number): RenderElement {
  return drawParts(elements, key, [{ text: CARD_RULE.repeat(columns), dimColor: true }])
}

function cardLines(elements: MachineElements, rows: readonly StoreRow[], layout: Layout) {
  return rows.flatMap((row, index) =>
    index === 0
      ? [cardOf(elements, row, layout)]
      : [rule(elements, `rule:${row.key}`, layout.columns), cardOf(elements, row, layout)],
  )
}

function rowName(row: StoreRow): string {
  return row.kind === 'ask' ? ASK_WORDS[row.look] : sessionName(row)
}

function widest(texts: readonly string[]): number {
  return Math.max(0, ...texts.map(displayWidth))
}

function rowWidths(rows: readonly StoreRow[], columns: number): RowWidths {
  const sessions = rows.filter((row) => row.kind === 'session')
  const asks = rows.filter((row) => row.kind === 'ask')
  const name = widest(rows.map(rowName)) + GAP.length
  const state = sessions.length === 0 ? 0 : widest(sessions.map(stateText)) + GAP.length
  const projects = sessions.map((row) => escaped(row.session.project ?? ''))
  const projectText = Math.min(widest(projects), PROJECT_COLUMN_AT_MOST)
  let project = projectText === 0 ? 0 : projectText + GAP.length
  const record =
    asks.length === 0 ? 0 : widest(asks.map((row) => escaped(row.ask.record))) + GAP.length
  project += Math.max(record - state - project, 0)
  const age = 1 + Math.max(AGE_WIDTH, ...rows.map((row) => displayWidth(ageOf(row.ageMs))))
  const detail = columns - 2 - name - state - project - age
  return { name, state, project, age, detail }
}

function sessionDetail(row: SessionRow): string {
  const { now, vendor, waitingOn } = row.session
  const nowText =
    now === null
      ? null
      : `${NOW_MARK} ${escaped(now)}${row.nowAgeMs === null ? '' : `${SEPARATOR}${ageOf(row.nowAgeMs)} old`}`
  return [
    noteText(row),
    row.state === 'needsYou' && waitingOn !== null ? `waits on: ${escaped(waitingOn)}` : null,
    nowText,
    vendor !== null && vendor !== 'claude' ? vendor : null,
  ]
    .filter((part) => part !== null)
    .join(SEPARATOR)
}

function rowParts(row: StoreRow, widths: RowWidths, layout: Layout, signals: SignalLooks): Part[] {
  const look = rowLook(row, signals)
  const isDim = isMarkDim(row, layout)
  const dim = isRowDim(row) || layout.isDim
  const age = { text: ageOf(row.ageMs).padStart(widths.age), dimColor: true }
  const mark = looked(`${look.mark} `, look.color, isDim)
  if (row.kind === 'ask') {
    const middle = widths.state + widths.project
    return [
      mark,
      looked(padToWidth(ASK_WORDS[row.look], widths.name), look.color, isDim),
      {
        text: padToWidth(escaped(row.ask.record), middle),
        ...(dim ? { dimColor: true } : { bold: true }),
      },
      { text: padToWidth(fitted(questionText(row), widths.detail), widths.detail), dimColor: dim },
      age,
    ]
  }
  const project = escaped(row.session.project ?? '')
  return [
    mark,
    { text: padToWidth(sessionName(row), widths.name), bold: true },
    looked(padToWidth(stateText(row), widths.state), look.color, isDim),
    {
      text: padToWidth(fitted(project, Math.max(widths.project - GAP.length, 0)), widths.project),
      dimColor: true,
    },
    { text: padToWidth(fitted(sessionDetail(row), widths.detail), widths.detail), dimColor: dim },
    age,
  ]
}

function rowBelow(elements: MachineElements, row: StoreRow, layout: Layout): RenderElement[] {
  const key = `card:${row.key}`
  if (row.kind === 'session') {
    const next = nextParts(row)
    return next.length === 0
      ? []
      : [lineOf(elements, `${key}:next`, next, layout.columns, ROW_INDENT)]
  }
  if (row.look !== 'decide') return []
  if (layout.canAnswer) {
    return [
      buttonsLine(
        elements,
        `${key}:buttons`,
        row,
        inlineFillPart(elements, row, layout.columns),
        ROW_INDENT,
      ),
    ]
  }
  const text =
    row.ask.options.length === 0
      ? ANSWER_ELSEWHERE
      : `${optionsText(row)}${SEPARATOR}${ANSWER_ELSEWHERE}`
  return [
    lineOf(elements, `${key}:options`, [{ text, dimColor: true }], layout.columns, ROW_INDENT),
  ]
}

function inlineLines(
  elements: MachineElements,
  rows: readonly StoreRow[],
  widths: RowWidths,
  layout: Layout,
): RenderElement[] {
  return rows.map((row) =>
    elements.Box({
      key: `card:${row.key}`,
      flexDirection: 'column',
      children: [
        drawParts(
          elements,
          `card:${row.key}:head`,
          rowParts(row, widths, layout, elements.signals),
        ),
        ...rowBelow(elements, row, layout),
      ],
    }),
  )
}

function isKept(row: StoreRow): boolean {
  if (row.kind === 'ask') return true
  return row.isOwn || row.state === 'needsYou' || row.state === 'dead'
}

type Folded = { shown: readonly StoreRow[]; hidden: readonly StoreRow[] }

export function foldedRows(rows: readonly StoreRow[], isOpen: boolean): Folded {
  if (rows.length <= FOLD_FROM) return { shown: rows, hidden: [] }
  const room = Math.max(FOLDED_ROWS - rows.filter(isKept).length, 0)
  const others = new Set(rows.filter((row) => !isKept(row)).slice(0, room))
  const isShown = (row: StoreRow) => isKept(row) || others.has(row)
  const hidden = rows.filter((row) => !isShown(row))
  return { shown: isOpen ? rows : rows.filter(isShown), hidden }
}

function foldText(hidden: readonly StoreRow[], isOpen: boolean, isRow: boolean): string {
  const count = String(hidden.length)
  if (isOpen) return `hide ${count}`
  const states: DerivedState[] = ['working', 'quiet', 'stale']
  const counts = states.flatMap((state) => {
    const many = hidden.filter((row) => row.kind === 'session' && row.state === state).length
    return many === 0 ? [] : [`${String(many)} ${STATE_WORDS[state]}`]
  })
  return [isRow ? `+${count} more` : `+${count}`, ...counts].join(SEPARATOR)
}

function foldLines(elements: MachineElements, folded: Folded, layout: Layout): RenderElement[] {
  if (folded.hidden.length === 0) return []
  const isOpen = elements.expanded.has(FOLD_KEY)
  return [
    elements.Box({
      key: `${FOLD_KEY}:box`,
      children: [
        elements.Button({
          key: FOLD_KEY,
          label: fitted(
            foldText(folded.hidden, isOpen, layout.isRow),
            Math.max(layout.columns - 4, 1),
          ),
          onPress: () => {
            elements.toggle(FOLD_KEY)
          },
        }),
      ],
    }),
  ]
}

function filesWord(count: number): string {
  return count === 1 ? '1 file' : `${String(count)} files`
}

function badLines(
  elements: MachineElements,
  bad: readonly BadFile[],
  layout: Layout,
): RenderElement[] {
  if (bad.length === 0) return []
  const mark = elements.signals.blocked.mark
  if (layout.isRow) {
    const list = bad.map((file) => `${escaped(file.name)} ${escaped(file.reason)}`).join(SEPARATOR)
    return [
      lineOf(
        elements,
        'bad',
        [
          { text: `${mark} ${filesWord(bad.length)} not read: `, color: ERROR_COLOR },
          { text: list, dimColor: true },
        ],
        layout.columns,
      ),
    ]
  }
  const head = wrappedText(
    `${filesWord(bad.length)} not read; the debug log has each reason`,
    Math.max(layout.columns - 2, 1),
  ).map((line, index) =>
    drawParts(elements, `bad:head:${String(index)}`, [
      { text: index === 0 ? `${mark} ` : GAP, color: ERROR_COLOR },
      { text: line, color: ERROR_COLOR },
    ]),
  )
  return [
    ...head,
    ...bad.map((file, index) =>
      lineOf(
        elements,
        `bad:${String(index)}`,
        [{ text: `${escaped(file.name)}: ${escaped(file.reason)}`, dimColor: true }],
        layout.columns,
        CARD_INDENT,
      ),
    ),
  ]
}

function overLines(elements: MachineElements, snapshot: Snapshot, layout: Layout): RenderElement[] {
  const lines: string[] = []
  if (snapshot.overSessions > 0) {
    lines.push(
      `${filesWord(snapshot.overSessions)} over the limit of ${String(SESSION_FILES_AT_MOST)} not read`,
    )
  }
  if (snapshot.overAsks > 0) {
    lines.push(
      `${String(snapshot.overAsks)} ask ${snapshot.overAsks === 1 ? 'file' : 'files'} over the limit of ${String(ASK_FILES_AT_MOST)} not read`,
    )
  }
  return lines.flatMap((line, index) =>
    wrappedLines(elements, `over:${String(index)}`, line, { dimColor: true }, layout.columns),
  )
}

function retryLine(elements: MachineElements, layout: Layout): RenderElement {
  return lineOf(
    elements,
    'retry',
    [{ text: RETRY_TEXT, dimColor: true }],
    layout.columns,
    CARD_INDENT,
  )
}

function failureLines(
  elements: MachineElements,
  view: RowsView,
  now: number,
  layout: Layout,
): RenderElement[] {
  if (view.failure === null) return []
  return [
    ...wrappedLines(
      elements,
      'failure',
      `The store was not read: ${view.failure}. The debug log names the file.`,
      {},
      layout.columns,
    ),
    retryLine(elements, layout),
    ...wrappedLines(
      elements,
      'kept',
      `Showing the read of ${ageOf(now - view.snapshot.at)} ago.`,
      { color: WARNING_COLOR },
      layout.columns,
    ),
  ]
}

function emptyLines(elements: MachineElements, layout: Layout): RenderElement[] {
  if (layout.isRow) {
    return wrappedLines(
      elements,
      'empty',
      `${NO_SESSION_TEXT} ${NO_ASK_TEXT}`,
      { dimColor: true },
      layout.columns,
    )
  }
  return [
    ...wrappedLines(elements, 'empty', NO_SESSION_TEXT, { dimColor: true }, layout.columns),
    ...wrappedLines(elements, 'no-ask', NO_ASK_TEXT, { dimColor: true }, layout.columns),
  ]
}

function isOldDead(row: StoreRow): boolean {
  return row.kind === 'session' && row.state === 'dead' && row.ageMs >= DEAD_KEPT_MS
}

function rowLines(
  elements: MachineElements,
  allRows: readonly StoreRow[],
  layout: Layout,
): RenderElement[] {
  const rows = allRows.filter((row) => !isOldDead(row))
  const folded = allRows.length - rows.length
  const foldLine =
    folded === 0
      ? []
      : [
          drawParts(elements, 'old-dead', [
            { text: `+${String(folded)} dead for 2 hours or more`, dimColor: true },
          ]),
        ]
  return [...rowLinesOf(elements, rows, layout), ...foldLine]
}

function rowLinesOf(
  elements: MachineElements,
  rows: readonly StoreRow[],
  layout: Layout,
): RenderElement[] {
  if (layout.isRow) {
    const widths = rowWidths(rows, layout.columns)
    if (widths.detail >= DETAIL_AT_LEAST) return inlineLines(elements, rows, widths, layout)
  }
  return cardLines(elements, rows, { ...layout, isRow: false })
}

function drawRows(
  elements: MachineElements,
  view: RowsView,
  now: number,
  layout: Layout,
): RenderElement[] {
  const folded = foldedRows(view.rows, elements.expanded.has(FOLD_KEY))
  const rows = rowLines(elements, folded.shown, layout)
  const bad = badLines(elements, view.snapshot.bad, layout)
  const needsRule = !layout.isRow && rows.length > 0 && bad.length > 0 && folded.hidden.length === 0
  return [
    drawParts(elements, 'header', fittedParts(headerParts(view, now, layout), layout.columns)),
    ...failureLines(elements, view, now, layout),
    ...(view.snapshot.canCheck
      ? []
      : wrappedLines(elements, 'no-check', NO_PROCESS_CHECK, { dimColor: true }, layout.columns)),
    ...(view.rows.length === 0 ? emptyLines(elements, layout) : []),
    ...rows,
    ...foldLines(elements, folded, layout),
    ...(needsRule ? [rule(elements, 'rule:bad', layout.columns)] : []),
    ...bad,
    ...overLines(elements, view.snapshot, layout),
  ]
}

function layoutOf(elements: MachineElements, view: MachineView): Layout {
  const columns = elements.bodyColumns
  return {
    columns,
    isRow: elements.isInline && columns >= ROW_LAYOUT_FROM,
    isDim: view.kind === 'rows' && view.failure !== null,
    canAnswer: view.kind === 'rows' && view.canAnswer,
  }
}

function messageLines(
  elements: MachineElements,
  key: string,
  texts: readonly string[],
  layout: Layout,
  style: Omit<Part, 'text'> = {},
): RenderElement[] {
  return texts.flatMap((text, index) =>
    wrappedLines(elements, `${key}:${String(index)}`, text, style, layout.columns),
  )
}

function missingLines(elements: MachineElements, shown: string, layout: Layout): RenderElement[] {
  const check = 'Check the option store in /config.'
  const path = escaped(shown)
  if (layout.isRow) {
    return [
      ...messageLines(elements, 'missing', [`The store folder is missing: ${path}`], layout),
      lineOf(
        elements,
        'retry',
        [{ text: check }, { text: `${GAP}${RETRY_TEXT}`, dimColor: true }],
        layout.columns,
      ),
    ]
  }
  return [
    ...messageLines(elements, 'missing', ['The store folder is missing:', path, check], layout),
    retryLine(elements, layout),
  ]
}

function bodyOf(elements: MachineElements, view: MachineView, now: number): RenderElement[] {
  const layout = layoutOf(elements, view)
  switch (view.kind) {
    case 'desktop':
      return [title(elements), ...messageLines(elements, 'note', [DESKTOP_TEXT], layout)]
    case 'unset':
      return [title(elements), ...messageLines(elements, 'note', [UNSET_TEXT], layout)]
    case 'refused':
      return [
        title(elements),
        ...messageLines(
          elements,
          'note',
          [
            `The handily-board option store in /config is not usable: ${view.reason}.`,
            'Set it to the absolute path of the folder that holds sessions/ and asks/.',
          ],
          layout,
          { color: ERROR_COLOR },
        ),
      ]
    case 'loading':
      return [
        title(elements),
        ...messageLines(elements, 'note', [LOADING_TEXT], layout, { dimColor: true }),
      ]
    case 'missing':
      return [title(elements), ...missingLines(elements, view.shown, layout)]
    case 'failed':
      return [
        title(elements),
        ...messageLines(
          elements,
          'failure',
          [`The store was not read: ${view.reason}. The debug log names the file.`],
          layout,
        ),
        retryLine(elements, layout),
      ]
    case 'rows':
      return drawRows(elements, view, now, layout)
  }
}

export function drawMachineGlance(
  elements: MachineElements,
  view: MachineView,
  now: number,
): RenderElement {
  const layout = layoutOf(elements, view)
  return elements.Box({
    flexDirection: 'column',
    children: [
      view.kind === 'rows'
        ? drawParts(elements, 'header', fittedParts(headerParts(view, now, layout), layout.columns))
        : title(elements),
    ],
  })
}

export function drawMachine(
  elements: MachineElements,
  view: MachineView,
  now: number,
): RenderElement {
  return elements.Box({ flexDirection: 'column', children: bodyOf(elements, view, now) })
}
