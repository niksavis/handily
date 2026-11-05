import { shownLabel, tooWide, widestLabel } from './flowchart'
import {
  fittedLabel,
  plainLabel,
  type Ink,
  type InkedDrawing,
  type InkRun,
  type Label,
} from './ink'
import { doesNotParse, textLines, type Refusal, type Statement } from './mermaid'
import {
  drawnOutline,
  inkedLine,
  part,
  titleLines,
  withLooks,
  wrappedLabel,
  type Part,
} from './outline'
import { displayWidth } from './width'

export type TimelinePeriod = { label: string[]; events: string[][] }

export type TimelineSection = { label: string[] | null; periods: TimelinePeriod[] }

export type Timeline = { kind: 'timeline'; title: string | null; sections: TimelineSection[] }

const HEADER = /^timeline\b/
const DRAWN_HEADER = /^timeline(?:[ \t]+(?:LR|TD))?$/
const TITLE = /^title\s(.*)$/i
const SECTION = /^section\s(.*)$/i
const ACCESSIBILITY = /^acc(?:Title|Descr)\s*:/i
const ACCESSIBILITY_BLOCK = /^accDescr\s*\{[^}]*\}$/i
const EVENT_MARK = ':'
const COMMENT_MARK = '#'
const EVENT_SPLIT = /:(?=\s)/

export class TimelineBuilder {
  private title: string | null = null
  private readonly sections: TimelineSection[] = [{ label: null, periods: [] }]

  add({ line, text }: Statement): void {
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = (title[1] ?? '').trim()
      return
    }
    if (ACCESSIBILITY.test(text) || ACCESSIBILITY_BLOCK.test(text)) return
    const section = SECTION.exec(text)
    if (section !== null) {
      const name = section[1] ?? ''
      if (name.includes(EVENT_MARK) || name.trim() === '') throw doesNotParse(line)
      this.sections.push({ label: textLines(name.trim()), periods: [] })
      return
    }
    this.period(line, text)
  }

  build(): Timeline | Refusal {
    const sections = this.sections.filter(
      (section) => section.label !== null || section.periods.length > 0,
    )
    if (sections.every((section) => section.periods.length === 0)) {
      return {
        kind: 'refused',
        reason: 'the timeline has no time periods',
        line: null,
        limit: null,
      }
    }
    return { kind: 'timeline', title: this.title, sections }
  }

  private period(line: number, text: string): void {
    const colon = text.indexOf(EVENT_MARK)
    const comment = text.indexOf(COMMENT_MARK)
    const isComment = comment >= 0 && (colon < 0 || comment < colon)
    const name = text.slice(0, isComment ? comment : colon < 0 ? text.length : colon).trim()
    const events = isComment || colon < 0 ? [] : this.events(line, text.slice(colon))
    const periods = this.sections.at(-1)?.periods ?? []
    if (name !== '') {
      periods.push({ label: textLines(name), events })
      return
    }
    const last = periods.at(-1)
    if (events.length === 0) return
    if (last === undefined) throw doesNotParse(line)
    last.events.push(...events)
  }

  private events(line: number, text: string): string[][] {
    const [before, ...events] = text.split(EVENT_SPLIT)
    if (before !== '' || events.some((event) => event.trim() === '')) throw doesNotParse(line)
    return events.map((event) => textLines(event.trim()))
  }
}

export function timelineBuilder(header: Statement): TimelineBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (!DRAWN_HEADER.test(header.text)) throw doesNotParse(header.line)
  return new TimelineBuilder()
}

const POINT = '● '
const AXIS = '│ '
const NO_AXIS = '  '
const BULLET = '• '
const BULLET_ROOM = '  '
const COLUMN_GAP = '  '
const RULE_HEAD = '┄┄ '
const RULE_FILL = '┄'
const RULE_TAIL_AT_LEAST = 2
const LEAST_LABEL_COLUMNS = 10
const PERIOD_SHARE = 3
const LEAST_BESIDE_COLUMNS = 20
const LINE_INK: Ink = 'line'

type Layout = { width: number; periodColumns: number | null; needed: number }

type Entry = { period: TimelinePeriod; ink: Ink; hasNext: boolean }

function labelsOf(lines: readonly string[]): Label[] {
  return lines.map(shownLabel).filter((line) => line.text.trim() !== '')
}

function eventLines(layout: Layout, period: TimelinePeriod, width: number): Part[][] {
  const room = width - displayWidth(BULLET)
  return period.events.flatMap((event) => {
    const labels = labelsOf(event)
    const least = Math.min(widestLabel(labels), LEAST_LABEL_COLUMNS)
    layout.needed = Math.max(layout.needed, layout.width - room + least)
    return labels
      .flatMap((label) => wrappedLabel(label, room))
      .map((label, index): Part[] => [
        part(index === 0 ? BULLET : BULLET_ROOM, LINE_INK),
        { label, ink: 'plain' },
      ])
  })
}

function periodLabels(layout: Layout, period: TimelinePeriod, width: number): Label[] {
  const labels = labelsOf(period.label).map((label) => withLooks(label, { isBold: true }))
  const least = Math.min(widestLabel(labels), LEAST_LABEL_COLUMNS)
  layout.needed = Math.max(layout.needed, layout.width - width + least)
  return labels.flatMap((label) => wrappedLabel(label, width))
}

function axisPart(index: number, hasNext: boolean, ink: Ink): Part {
  if (index === 0) return part(POINT, ink)
  return part(hasNext ? AXIS : NO_AXIS, LINE_INK)
}

function stackedLines(layout: Layout, entry: Entry): InkRun[][] {
  const { period, ink, hasNext } = entry
  const room = layout.width - displayWidth(POINT)
  const names = periodLabels(layout, period, room).map((label): Part[] => [{ label, ink }])
  const events = eventLines(layout, period, room)
  return [...names, ...events].map((parts, index) =>
    inkedLine([axisPart(index, hasNext, ink), ...parts]),
  )
}

function besideLines(layout: Layout, entry: Entry, columns: number): InkRun[][] {
  const { period, ink, hasNext } = entry
  const names = periodLabels(layout, period, columns)
  const room = layout.width - displayWidth(POINT) - columns - displayWidth(COLUMN_GAP)
  const events = eventLines(layout, period, room)
  const rows = Math.max(names.length, events.length, 1)
  return Array.from({ length: rows }, (_, index) => {
    const name = names[index] ?? plainLabel('')
    const pad = ' '.repeat(columns - displayWidth(name.text))
    return inkedLine([
      axisPart(index, hasNext, ink),
      { label: name, ink },
      part(pad + COLUMN_GAP, 'plain'),
      ...(events[index] ?? []),
    ])
  })
}

function periodLines(layout: Layout, entry: Entry): InkRun[][] {
  const columns = layout.periodColumns
  return columns === null ? stackedLines(layout, entry) : besideLines(layout, entry, columns)
}

function lineWidth(line: readonly InkRun[]): number {
  return displayWidth(line.map((run) => run.text).join(''))
}

export function sectionLine(
  label: readonly string[],
  ink: Ink,
  width: number,
  rule: number,
): InkRun[] {
  const name = withLooks(shownLabel(label.join(' ').trim()), { isBold: true })
  const room = width - displayWidth(RULE_HEAD) - 1 - RULE_TAIL_AT_LEAST
  const cut = fittedLabel(name, Math.max(room, 1))
  const used = displayWidth(RULE_HEAD) + displayWidth(cut.text) + 1
  const fill = RULE_FILL.repeat(Math.max(Math.min(rule, width) - used, RULE_TAIL_AT_LEAST))
  return inkedLine([part(RULE_HEAD, LINE_INK), { label: cut, ink }, part(` ${fill}`, LINE_INK)])
}

function periodColumnsOf(timeline: Timeline, width: number): number | null {
  const periods = timeline.sections.flatMap((section) => section.periods)
  const widest = Math.max(0, ...periods.map((period) => widestLabel(labelsOf(period.label))))
  const room = width - displayWidth(POINT) - displayWidth(COLUMN_GAP) - displayWidth(BULLET)
  const fits = widest * PERIOD_SHARE <= width && room - widest >= LEAST_BESIDE_COLUMNS
  return fits ? widest : null
}

export function drawTimeline(timeline: Timeline, width: number): InkedDrawing | Refusal {
  const layout: Layout = { width, periodColumns: periodColumnsOf(timeline, width), needed: 0 }
  const isNamed = timeline.sections.some((section) => section.label !== null)
  let count = 0
  const blocks = timeline.sections.map((section, at) => {
    const lines = section.periods.flatMap((period, index) => {
      const ink = isNamed ? at : count
      count += 1
      const hasNext = index < section.periods.length - 1
      return periodLines(layout, { period, ink, hasNext })
    })
    return { section, ink: at, lines }
  })
  if (layout.needed > width) return tooWide(layout.needed, width)
  const rule = Math.max(0, ...blocks.flatMap((block) => block.lines.map(lineWidth)))
  const lines = blocks.flatMap(({ section, ink, lines }) =>
    section.label === null ? lines : [sectionLine(section.label, ink, width, rule), ...lines],
  )
  return drawnOutline([...titleLines(timeline.title, width), ...lines])
}
