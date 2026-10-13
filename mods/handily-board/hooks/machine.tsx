import type { BoxProps, ElementConstructor, RenderElement, TextProps, ThemeKey } from 'claude-code'
import { elapsedText } from './activity'
import { POLL_INTERVAL_MS, type AgentsFailure, type SessionKind } from './agents-json'
import type {
  AgentCounts,
  Attention,
  CardTask,
  CardTime,
  CardsView,
  MachineView,
  SessionCard,
} from './cards'
import { SIGNALS, type SignalLook } from './signals'
import { escaped, statusLook } from './tasks'
import { cutToWidth, displayWidth, fitted, lastToWidth, padToWidth } from './width'

export type MachineElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  bodyColumns: number
  isInline: boolean
}

type Layout = { columns: number; isNarrow: boolean; isRow: boolean }

type Part = { text: string; color?: ThemeKey; dimColor?: boolean; bold?: boolean }

const TITLE = 'Sessions'
const CARD_INDENT = 2
const ROW_INDENT = 4
const NARROW_BELOW = 36
const ROW_LAYOUT_FROM = 60
const BAR_CELLS_AT_MOST = 8
const BAR_DONE = '▰'
const BAR_TO_DO = '▱'
const CARD_RULE = '─'
const GAP = '  '
const SEPARATOR = ' · '
const OWN_BADGE = 'this'
const ROW_NAME_WIDTH = 11
const ROW_NAME_AT_MOST = 9
const NAME_KEEP = 4
const ROW_BADGE_WIDTH = 6
const ROW_TIME_WIDTH = 3
const NO_TIME = '—'
const STALE_MARK = ' (stale)'
const RETRY_TEXT = `retry in ${elapsedText(POLL_INTERVAL_MS)}`
const NOT_LISTED = 'not listed (stale)'
const DESKTOP_LINE = 'Other sessions are listed only in a terminal session.'

const ATTENTION_LOOKS: Record<Attention, SignalLook> = {
  needsYou: SIGNALS.waitsForYou,
  failed: SIGNALS.blocked,
  working: SIGNALS.doing,
  idle: SIGNALS.toDo,
  ended: SIGNALS.done,
}

const BADGES: Record<SessionKind, string> = { interactive: 'interactive', background: 'background' }
const ROW_BADGES: Record<SessionKind, string> = { interactive: 'inter', background: 'bg' }

export function progressBar(done: number, total: number): string {
  const cells = Math.min(total, BAR_CELLS_AT_MOST)
  const filled = Math.floor((done * cells) / total)
  return BAR_DONE.repeat(filled) + BAR_TO_DO.repeat(cells - filled)
}

function shortName(name: string): string {
  if (displayWidth(name) <= ROW_NAME_AT_MOST) return name
  return `${cutToWidth(name, NAME_KEEP)}…${lastToWidth(name, NAME_KEEP)}`
}

function needsYouText(count: number): string {
  return count === 1 ? '1 needs you' : `${String(count)} need you`
}

function fitParts(parts: readonly Part[], columns: number): Part[] {
  let room = columns
  const kept: Part[] = []
  for (const part of parts) {
    if (room <= 0) break
    const text = fitted(part.text, room)
    room -= displayWidth(text)
    kept.push({ ...part, text })
  }
  return kept
}

function drawParts(
  elements: MachineElements,
  key: string,
  parts: readonly Part[],
  columns: number,
  indent = 0,
): RenderElement {
  const { Box, Text } = elements
  return Box({
    key,
    flexDirection: 'row',
    paddingLeft: indent,
    children: fitParts(parts, Math.max(columns - indent, 0)).map(({ text, ...style }) =>
      Text({ ...style, children: text }),
    ),
  })
}

function keyedText(
  elements: MachineElements,
  key: string,
  style: Omit<TextProps, 'children'>,
  text: string,
): RenderElement {
  return elements.Box({ key, children: [elements.Text({ ...style, children: text })] })
}

function dimLine(elements: MachineElements, key: string, text: string, layout: Layout) {
  return drawParts(elements, key, [{ text, dimColor: true }], layout.columns)
}

function joined(parts: readonly Part[]): Part[] {
  return parts.flatMap((part, index) =>
    index === 0 ? [part] : [{ text: SEPARATOR, dimColor: true }, part],
  )
}

function countParts(cards: readonly SessionCard[]): Part[] {
  const needsYou = cards.filter((card) => card.attention === 'needsYou').length
  const failed = cards.filter((card) => card.attention === 'failed').length
  return [
    { text: String(cards.length), dimColor: true },
    ...(needsYou > 0 ? [{ text: needsYouText(needsYou), color: SIGNALS.waitsForYou.color }] : []),
    ...(failed > 0 ? [{ text: `${String(failed)} failed`, color: SIGNALS.blocked.color }] : []),
  ]
}

function ageText(view: CardsView, now: number, layout: Layout): string | null {
  if (layout.isNarrow) return null
  const age = `${elapsedText(now - view.dataAt)} ago`
  return layout.isRow ? `polled ${age}` : age
}

function isOnlyThisSession(view: CardsView): boolean {
  const [only] = view.cards
  return view.hidden === 0 && view.cards.length === 1 && only?.isUnlisted === false
}

function headerParts(view: CardsView, now: number, layout: Layout): Part[] {
  const title: Part = { text: TITLE, bold: true }
  if (view.isEmpty) return [title]
  if (isOnlyThisSession(view)) return [title, { text: `${GAP}1`, dimColor: true }]
  const age = ageText(view, now, layout)
  const facts = joined([
    ...countParts(view.cards),
    ...(age === null ? [] : [{ text: age, dimColor: true }]),
  ])
  return [title, { text: GAP }, ...facts]
}

function timeText(time: CardTime, isNarrow: boolean): string | null {
  if (time === null) return null
  if (time.kind === 'ended') return 'ended'
  const amount = elapsedText(time.ms)
  return isNarrow ? amount : `${amount} ${time.kind}`
}

function placeText(card: SessionCard, layout: Layout): string {
  const time = timeText(card.time, layout.isNarrow)
  const est = card.estMs === null ? null : `est. ${elapsedText(card.estMs)} left`
  return [card.place, time, est].filter((part) => part !== null && part !== '').join(SEPARATOR)
}

function taskLook(task: Extract<CardTask, { kind: 'task' }>): SignalLook {
  return task.status === null ? SIGNALS.done : statusLook(task.status)
}

function taskParts(task: CardTask, columns: number): Part[] {
  if (task.kind === 'none') return []
  if (task.kind === 'empty') return [{ text: 'no tasks', dimColor: true }]
  const look = taskLook(task)
  const title = task.title === null ? `all ${String(task.total)} done` : escaped(task.title)
  const progress = ` ${progressBar(task.done, task.total)} ${String(task.done)}/${String(task.total)}`
  const lead = `${look.mark} `
  const stale = task.isStale ? STALE_MARK : ''
  const room = columns - displayWidth(lead) - displayWidth(stale) - displayWidth(progress)
  return [
    { text: lead, color: look.color },
    { text: fitted(title, Math.max(room, 0)) },
    ...(stale === '' ? [] : [{ text: stale, dimColor: true }]),
    { text: progress, dimColor: true },
  ]
}

function agentParts(agents: AgentCounts): Part[] {
  return joined([
    { text: `agents ${String(agents.count)}`, dimColor: true },
    ...(agents.failed > 0
      ? [{ text: `${String(agents.failed)} failed`, color: SIGNALS.blocked.color }]
      : []),
  ])
}

function waitParts(reason: string): Part[] {
  return [{ text: 'waits for: ', dimColor: true }, { text: escaped(reason) }]
}

function cardHeadParts(card: SessionCard, layout: Layout): Part[] {
  const look = ATTENTION_LOOKS[card.attention]
  const badges: Part[] = [
    ...(card.kind === null || layout.isNarrow
      ? []
      : [{ text: `${GAP}${BADGES[card.kind]}`, dimColor: true }]),
    ...(card.isOwn ? [{ text: `${GAP}${OWN_BADGE}`, color: 'suggestion' as const }] : []),
  ]
  const state: Part = { text: `${GAP}${card.state}`, color: look.color }
  const lead = `${look.mark} `
  const rest = [lead, ...badges.map((part) => part.text), state.text]
  const room = layout.columns - rest.reduce((sum, text) => sum + displayWidth(text), 0)
  return [
    { text: lead, color: look.color },
    { text: fitted(escaped(card.name), Math.max(room, 1)), bold: true },
    ...badges,
    state,
  ]
}

function detailLines(
  elements: MachineElements,
  card: SessionCard,
  layout: Layout,
  indent: number,
): RenderElement[] {
  const key = `card:${card.key}`
  const { columns } = layout
  const lines: RenderElement[] = []
  if (card.waitsFor !== null) {
    lines.push(drawParts(elements, `${key}:waits`, waitParts(card.waitsFor), columns, indent))
  }
  if (card.isUnlisted) {
    lines.push(
      drawParts(
        elements,
        `${key}:unlisted`,
        [{ text: NOT_LISTED, dimColor: true }],
        columns,
        indent,
      ),
    )
  }
  return lines
}

function cardLines(elements: MachineElements, card: SessionCard, layout: Layout): RenderElement {
  const key = `card:${card.key}`
  const { columns } = layout
  const detail = columns - CARD_INDENT
  const task = taskParts(card.task, detail)
  return elements.Box({
    key,
    flexDirection: 'column',
    children: [
      drawParts(elements, `${key}:head`, cardHeadParts(card, layout), columns),
      ...detailLines(elements, card, layout, CARD_INDENT),
      ...(task.length === 0
        ? []
        : [drawParts(elements, `${key}:task`, task, columns, CARD_INDENT)]),
      drawParts(
        elements,
        `${key}:place`,
        [{ text: placeText(card, layout), dimColor: true }],
        columns,
        CARD_INDENT,
      ),
      ...(card.agents === null
        ? []
        : [drawParts(elements, `${key}:agents`, agentParts(card.agents), columns, CARD_INDENT)]),
    ],
  })
}

function rowCount(task: CardTask): string {
  return task.kind === 'task' ? `${String(task.done)}/${String(task.total)}` : ''
}

function rowTime(time: CardTime): string {
  if (time === null) return ''
  return time.kind === 'ended' ? NO_TIME : elapsedText(time.ms)
}

function rowState(card: SessionCard): string {
  return card.isOwn ? `${OWN_BADGE}${SEPARATOR}${card.state}` : card.state
}

type RowWidths = { state: number; count: number }

function rowWidths(cards: readonly SessionCard[]): RowWidths {
  return {
    state: Math.max(...cards.map((card) => displayWidth(rowState(card)))) + 1,
    count: Math.max(...cards.map((card) => displayWidth(rowCount(card.task)))),
  }
}

function rowParts(card: SessionCard, widths: RowWidths, columns: number): Part[] {
  const look = ATTENTION_LOOKS[card.attention]
  const badge = card.kind === null ? '' : ROW_BADGES[card.kind]
  const tail = ` ${rowCount(card.task).padStart(widths.count)} ${rowTime(card.time).padStart(ROW_TIME_WIDTH)}`
  const mark = `${look.mark} `
  const lead = displayWidth(mark) + ROW_NAME_WIDTH + ROW_BADGE_WIDTH + widths.state
  const room = Math.max(columns - lead - displayWidth(tail), 0)
  return [
    { text: mark, color: look.color },
    { text: padToWidth(shortName(escaped(card.name)), ROW_NAME_WIDTH), bold: true },
    { text: padToWidth(badge, ROW_BADGE_WIDTH), dimColor: true },
    { text: padToWidth(rowState(card), widths.state), color: look.color },
    { text: padToWidth(fitted(card.place, room), room), dimColor: true },
    { text: tail, dimColor: true },
  ]
}

function rowLines(
  elements: MachineElements,
  card: SessionCard,
  widths: RowWidths,
  layout: Layout,
): RenderElement {
  const key = `card:${card.key}`
  return elements.Box({
    key,
    flexDirection: 'column',
    children: [
      drawParts(elements, `${key}:head`, rowParts(card, widths, layout.columns), layout.columns),
      ...detailLines(elements, card, layout, ROW_INDENT),
      ...(card.agents === null
        ? []
        : [
            drawParts(
              elements,
              `${key}:agents`,
              agentParts(card.agents),
              layout.columns,
              ROW_INDENT,
            ),
          ]),
    ],
  })
}

function sessionLines(elements: MachineElements, view: CardsView, layout: Layout): RenderElement[] {
  if (layout.isRow) {
    const widths = rowWidths(view.cards)
    return view.cards.map((card) => rowLines(elements, card, widths, layout))
  }
  const rule = (index: number) =>
    keyedText(
      elements,
      `rule:${String(index)}`,
      { dimColor: true },
      CARD_RULE.repeat(layout.columns),
    )
  return view.cards.flatMap((card, index) =>
    index === 0
      ? [cardLines(elements, card, layout)]
      : [rule(index), cardLines(elements, card, layout)],
  )
}

function hiddenText(hidden: number): string {
  const jobs = hidden === 1 ? 'job' : 'jobs'
  return `${String(hidden)} older background ${jobs} hidden`
}

function noteLines(
  elements: MachineElements,
  view: CardsView,
  now: number,
  layout: Layout,
): RenderElement[] {
  if (view.isEmpty) return [dimLine(elements, 'note', 'No local sessions are listed.', layout)]
  if (isOnlyThisSession(view))
    return [dimLine(elements, 'note', 'Only this session is running.', layout)]
  if (!view.isStale) return []
  const age = elapsedText(now - view.dataAt)
  return [
    drawParts(
      elements,
      'note',
      [{ text: `Last poll failed; showing ${age} old data.`, color: SIGNALS.waitsForYou.color }],
      layout.columns,
    ),
    drawParts(
      elements,
      'retry',
      [{ text: RETRY_TEXT, dimColor: true }],
      layout.columns,
      CARD_INDENT,
    ),
  ]
}

function drawCards(elements: MachineElements, view: CardsView, now: number, layout: Layout) {
  return [
    drawParts(elements, 'header', headerParts(view, now, layout), layout.columns),
    ...noteLines(elements, view, now, layout),
    ...sessionLines(elements, view, layout),
    ...(view.hidden > 0 ? [dimLine(elements, 'hidden', hiddenText(view.hidden), layout)] : []),
  ]
}

function failureLines(failure: AgentsFailure): string[] {
  switch (failure.kind) {
    case 'not-on-path':
      return ['claude is not on PATH, so other sessions cannot be listed.']
    case 'exit':
      return [
        `claude agents --json failed: exit ${String(failure.exitCode)}.`,
        'Run it in a shell to see why.',
      ]
    case 'not-a-list':
      return ['claude agents --json failed: the output is not a JSON list.']
    case 'did-not-run':
      return ['claude agents --json could not run.', 'Run it in a shell to see why.']
    case 'cut':
      return ['claude agents --json failed: the output is over 4 MiB and was cut.']
  }
}

function isRetried(failure: AgentsFailure): boolean {
  return failure.kind === 'exit' || failure.kind === 'did-not-run'
}

function drawFailure(elements: MachineElements, failure: AgentsFailure): RenderElement[] {
  return [
    ...failureLines(failure).map((line, index) =>
      keyedText(elements, `failure:${String(index)}`, { color: SIGNALS.blocked.color }, line),
    ),
    ...(isRetried(failure) ? [keyedText(elements, 'retry', { dimColor: true }, RETRY_TEXT)] : []),
  ]
}

function layoutOf(elements: MachineElements): Layout {
  const columns = elements.bodyColumns
  return {
    columns,
    isNarrow: columns < NARROW_BELOW,
    isRow: elements.isInline && columns >= ROW_LAYOUT_FROM,
  }
}

function bodyOf(elements: MachineElements, view: MachineView, now: number): RenderElement[] {
  const layout = layoutOf(elements)
  const title = () => keyedText(elements, 'header', { bold: true }, TITLE)
  switch (view.kind) {
    case 'loading':
      return [title(), dimLine(elements, 'note', 'Listing the local sessions…', layout)]
    case 'failed':
      return [title(), ...drawFailure(elements, view.failure)]
    case 'desktop':
      return [
        title(),
        keyedText(elements, 'note', { dimColor: true }, DESKTOP_LINE),
        cardLines(elements, view.own, { ...layout, isRow: false }),
      ]
    case 'cards':
      return drawCards(elements, view, now, layout)
  }
}

export function drawMachine(
  elements: MachineElements,
  view: MachineView,
  now: number,
): RenderElement {
  return elements.Box({ flexDirection: 'column', children: bodyOf(elements, view, now) })
}
