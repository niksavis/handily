import { ChartGrid, cutLabel, putHead, putLegendRows, type LegendItem } from './charts'
import {
  added,
  axisFormatOf,
  DAY,
  dateFormatOf,
  durationOf,
  formattedTime,
  HOUR,
  MINUTE,
  parsedDate,
  stepLength,
  TICK_STEPS,
  tickStepOf,
  ticksOf,
  weekdayIndex,
  type AxisFormat,
  type DateFormat,
  type TickStep,
} from './dates'
import { MOST_ROWS, shown, tooWide } from './flowchart'
import { PLAIN_LOOKS, type Ink, type InkedDrawing, type Looks } from './ink'
import {
  DiagramFault,
  doesNotParse,
  lineFault,
  notDrawnYet,
  type Refusal,
  type Statement,
} from './mermaid'
import { displayWidth } from './width'

export type GanttTask = {
  label: string
  section: number | null
  start: number
  end: number
  isDone: boolean
  isActive: boolean
  isCrit: boolean
  isMilestone: boolean
}

export type GanttDiagram = {
  kind: 'gantt'
  title: string | null
  sections: string[]
  tasks: GanttTask[]
  axisFormat: AxisFormat | null
  tickStep: TickStep | null
  weekStart: number
  hasDate: boolean
}

type Tag = 'done' | 'active' | 'crit' | 'milestone'

type RawTask = {
  label: string
  line: number
  section: number | null
  tags: ReadonlySet<Tag>
  id: string | null
  start: string | null
  end: string
}

type Span = { start: number; end: number }

type Axis = { ticks: { col: number; text: string }[] }

const MOST_TASKS = 60
const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD'
const TAGS: ReadonlySet<string> = new Set(['done', 'active', 'crit', 'milestone'])
const VERT_TAG = 'vert'
const DATE_FORMAT = /^dateFormat\s+([^#;]+)$/i
const AXIS_FORMAT = /^axisFormat\s+([^#;]+)$/i
const TICK_INTERVAL = /^tickInterval\s+([^#;]+)$/i
const EXCLUDES = /^excludes\s/i
const INCLUSIVE_END_DATES = /^inclusiveEndDates$/i
const WEEKDAY = /^weekday\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i
const IGNORED_STATEMENT =
  /^(?:includes\s|topAxis$|todayMarker\s|weekend\s+(?:friday|saturday)$|click\s|accDescription\s|acc(?:Title|Descr)\s*:)/i
const TITLE = /^title\s+(.+)$/i
const SECTION = /^section\s+(.+)$/i
const TASK = /^([^:]+):(.*)$/
const DATA_COMMENT = /#.*$/
const AFTER = /^after\s+([\w -]+)$/
const UNTIL = /^until\s+([\w -]+)$/
const WIDE_LABELS = 0.4
const MIN_LABEL = 4
const MIN_CHART = 10
const SECTION_INDENT = '  '
const NAMED_DEFAULT_WEEK_START = 'sunday'
const TASK_FILL = '█'
const ACTIVE_FILL = '▓'
const DONE_FILL = '░'
const MILESTONE = '◇'
const GRID = '┊'
const AXIS_ACROSS = '─'
const AXIS_TICK = '┴'
const AXIS_INK: Ink = 'line'
const VALUE_INK: Ink = 1
const CRIT_INK: Ink = 'head'
const BOLD: Looks = { ...PLAIN_LOOKS, isBold: true }
const SHORT_SPAN = DAY

function ganttFault(reason: string): DiagramFault {
  return new DiagramFault({ kind: 'refused', reason, line: null, limit: null })
}

function linePrefix(line: number): string {
  return `line ${String(line)}`
}

function isTag(item: string): item is Tag {
  return TAGS.has(item)
}

export class GanttBuilder {
  private title: string | null = null
  private dateFormat: DateFormat | null = null
  private axisFormat: AxisFormat | null = null
  private tickStep: TickStep | null = null
  private weekStart = weekdayIndex(NAMED_DEFAULT_WEEK_START)
  private isInclusive = false
  private readonly sections: string[] = []
  private readonly tasks: RawTask[] = []

  add(statement: Statement): void {
    const { line, text } = statement
    if (IGNORED_STATEMENT.test(text)) return
    if (EXCLUDES.test(text)) throw notDrawnYet(line, 'excludes')
    if (INCLUSIVE_END_DATES.test(text)) {
      this.isInclusive = true
      return
    }
    const handled =
      this.setting(text, line) || this.heading(text) || this.weekday(text) || this.task(text, line)
    if (!handled) throw doesNotParse(line)
  }

  build(): GanttDiagram {
    if (this.tasks.length === 0) throw ganttFault('the gantt diagram has no tasks')
    if (this.tasks.length > MOST_TASKS) {
      throw ganttFault(`${String(this.tasks.length)} tasks, at most ${String(MOST_TASKS)} draw`)
    }
    const format = this.dateFormat ?? dateFormatOf(DEFAULT_DATE_FORMAT)
    if (format === null) throw ganttFault(`dateFormat ${DEFAULT_DATE_FORMAT} does not draw`)
    const spans = new Resolver(this.tasks, format, this.isInclusive).spans()
    return {
      kind: 'gantt',
      title: this.title,
      sections: this.sections,
      tasks: this.tasks.map((task, at) => ({
        label: task.label,
        section: task.section,
        start: spans[at]?.start ?? 0,
        end: spans[at]?.end ?? 0,
        isDone: task.tags.has('done'),
        isActive: task.tags.has('active'),
        isCrit: task.tags.has('crit'),
        isMilestone: task.tags.has('milestone'),
      })),
      axisFormat: this.axisFormat,
      tickStep: this.tickStep,
      weekStart: this.weekStart,
      hasDate: format.hasDate,
    }
  }

  private setting(text: string, line: number): boolean {
    const dateFormat = DATE_FORMAT.exec(text)?.[1]?.trim()
    if (dateFormat !== undefined) {
      this.dateFormat = dateFormatOf(dateFormat)
      if (this.dateFormat === null) throw notDrawnYet(line, `dateFormat ${dateFormat}`)
      return true
    }
    const axisFormat = AXIS_FORMAT.exec(text)?.[1]?.trim()
    if (axisFormat !== undefined) {
      const format = axisFormatOf(axisFormat)
      if (typeof format === 'string') throw notDrawnYet(line, `axisFormat ${format}`)
      this.axisFormat = format
      return true
    }
    const tickInterval = TICK_INTERVAL.exec(text)?.[1]?.trim()
    if (tickInterval === undefined) return false
    this.tickStep = tickStepOf(tickInterval)
    if (this.tickStep === null) throw doesNotParse(line)
    return true
  }

  private heading(text: string): boolean {
    const title = TITLE.exec(text)?.[1]
    if (title !== undefined) {
      this.title = shown(title.trim())
      return true
    }
    const section = SECTION.exec(text)?.[1]
    if (section === undefined) return false
    this.sections.push(shown(section.trim()))
    return true
  }

  private weekday(text: string): boolean {
    const day = WEEKDAY.exec(text)?.[1]
    if (day === undefined) return false
    this.weekStart = weekdayIndex(day)
    return true
  }

  private task(text: string, line: number): boolean {
    const found = TASK.exec(text)
    if (found === null) return false
    const items = (found[2] ?? '')
      .replace(DATA_COMMENT, '')
      .split(',')
      .map((item) => item.trim())
    const tags = new Set<Tag>()
    for (let first = items[0]; first !== undefined; first = items[0]) {
      if (first === VERT_TAG) throw notDrawnYet(line, 'vert')
      if (!isTag(first)) break
      tags.add(first)
      items.shift()
    }
    if (items.length === 0 || items.length > 3 || items.some((item) => item === '')) {
      throw doesNotParse(line)
    }
    const [end = '', start = null, id = null] = [...items].reverse()
    this.tasks.push({
      label: shown((found[1] ?? '').trim()),
      line,
      section: this.sections.length === 0 ? null : this.sections.length - 1,
      tags,
      id,
      start,
      end,
    })
    return true
  }
}

class Resolver {
  private readonly spansOf = new Map<number, Span>()
  private readonly visiting = new Set<number>()
  private readonly ids = new Map<string, number>()

  constructor(
    private readonly tasks: readonly RawTask[],
    private readonly format: DateFormat,
    private readonly isInclusive: boolean,
  ) {
    tasks.forEach((task, at) => {
      if (task.id !== null) this.ids.set(task.id, at)
    })
  }

  spans(): Span[] {
    return this.tasks.map((_, at) => this.span(at))
  }

  private span(at: number): Span {
    const known = this.spansOf.get(at)
    if (known !== undefined) return known
    const task = this.tasks[at]
    if (task === undefined) throw ganttFault('a task is missing')
    if (this.visiting.has(at)) {
      throw lineFault(task.line, `${linePrefix(task.line)}: the after and until references loop`)
    }
    this.visiting.add(at)
    const start = this.startOf(task, at)
    const end = this.endOf(task, start)
    if (end < start) {
      throw lineFault(task.line, `${linePrefix(task.line)}: the task ends before it starts`)
    }
    this.visiting.delete(at)
    const span = { start, end }
    this.spansOf.set(at, span)
    return span
  }

  private referenced(task: RawTask, list: string): Span[] {
    return list
      .split(' ')
      .filter((id) => id !== '')
      .map((id) => {
        const at = this.ids.get(id)
        if (at === undefined) {
          throw lineFault(task.line, `${linePrefix(task.line)}: no task has the id ${id}`)
        }
        return this.span(at)
      })
  }

  private startOf(task: RawTask, at: number): number {
    if (task.start === null) {
      if (at === 0) {
        throw lineFault(task.line, `${linePrefix(task.line)}: the first task has no start date`)
      }
      return this.span(at - 1).end
    }
    const after = AFTER.exec(task.start)?.[1]
    if (after !== undefined) {
      return Math.max(...this.referenced(task, after).map((span) => span.end))
    }
    const date = parsedDate(task.start, this.format)
    if (date === null) {
      throw lineFault(
        task.line,
        `${linePrefix(task.line)}: ${JSON.stringify(task.start)} does not match the dateFormat ${this.format.source}`,
      )
    }
    return date
  }

  private endOf(task: RawTask, start: number): number {
    const until = UNTIL.exec(task.end)?.[1]
    if (until !== undefined) {
      return Math.min(...this.referenced(task, until).map((span) => span.start))
    }
    const date = parsedDate(task.end, this.format)
    if (date !== null) return this.isInclusive ? date + DAY : date
    const duration = durationOf(task.end)
    if (duration === null) {
      throw lineFault(
        task.line,
        `${linePrefix(task.line)}: ${JSON.stringify(task.end)} is not a date or a duration`,
      )
    }
    const end = added(start, duration)
    if (end === null) throw notDrawnYet(task.line, `the duration ${task.end}`)
    return end
  }
}

function fillOf(task: GanttTask): string {
  if (task.isMilestone) return MILESTONE
  if (task.isDone) return DONE_FILL
  return task.isActive ? ACTIVE_FILL : TASK_FILL
}

function inkOf(task: GanttTask): Ink {
  if (task.isCrit) return CRIT_INK
  if (task.isDone && !task.isMilestone) return AXIS_INK
  return task.section ?? 0
}

function labelOf(diagram: GanttDiagram, task: GanttTask): string {
  return diagram.sections.length > 0 && task.section !== null
    ? `${SECTION_INDENT}${task.label}`
    : task.label
}

function rangeOf(diagram: GanttDiagram): Span {
  const start = Math.min(...diagram.tasks.map((task) => task.start))
  const end = Math.max(...diagram.tasks.map((task) => task.end))
  if (end > start) return { start, end }
  return { start, end: start + (diagram.hasDate ? DAY : HOUR) }
}

function defaultFormat(diagram: GanttDiagram, step: TickStep, range: Span): AxisFormat | string {
  const length = stepLength(step)
  const sameYear = new Date(range.start).getUTCFullYear() === new Date(range.end).getUTCFullYear()
  if (!diagram.hasDate) return axisFormatOf(length < MINUTE ? '%H:%M:%S' : '%H:%M')
  if (length < DAY) {
    return axisFormatOf(range.end - range.start <= SHORT_SPAN ? '%H:%M' : '%m-%d %H:%M')
  }
  if (step.unit === 'month') return axisFormatOf(step.size % 12 === 0 ? '%Y' : '%Y-%m')
  return axisFormatOf(sameYear ? '%m-%d' : '%Y-%m-%d')
}

function columnOf(time: number, range: Span, columns: number): number {
  return ((time - range.start) / (range.end - range.start)) * columns
}

function axisWith(
  diagram: GanttDiagram,
  step: TickStep,
  range: Span,
  columns: number,
): Axis | null {
  const format = diagram.axisFormat ?? defaultFormat(diagram, step, range)
  if (typeof format === 'string') return null
  const ticks = ticksOf(range.start, range.end, step, diagram.weekStart).map((time) => ({
    col: Math.min(Math.floor(columnOf(time, range, columns)), columns - 1),
    text: formattedTime(time, format),
  }))
  const room = Math.max(0, ...ticks.map((tick) => displayWidth(tick.text))) + 1
  const isSpaced = ticks.every(
    (tick, at) => at === 0 || tick.col - (ticks[at - 1]?.col ?? 0) >= room,
  )
  return isSpaced
    ? { ticks: ticks.filter((tick) => tick.col + displayWidth(tick.text) <= columns) }
    : null
}

function axisOf(diagram: GanttDiagram, range: Span, columns: number): Axis {
  const steps = diagram.tickStep === null ? TICK_STEPS : [diagram.tickStep, ...TICK_STEPS]
  for (const step of steps) {
    const axis = axisWith(diagram, step, range, columns)
    if (axis !== null && axis.ticks.length > 0) return axis
  }
  return { ticks: [] }
}

function legendOf(diagram: GanttDiagram): LegendItem[] {
  const tasks = diagram.tasks
  const kinds: [boolean, LegendItem][] = [
    [
      tasks.some((task) => !task.isMilestone && !task.isDone && !task.isActive),
      { glyph: TASK_FILL, ink: 0, name: 'task', looks: PLAIN_LOOKS },
    ],
    [
      tasks.some((task) => !task.isMilestone && !task.isDone && task.isActive),
      { glyph: ACTIVE_FILL, ink: 0, name: 'active', looks: PLAIN_LOOKS },
    ],
    [
      tasks.some((task) => !task.isMilestone && task.isDone),
      { glyph: DONE_FILL, ink: AXIS_INK, name: 'done', looks: PLAIN_LOOKS },
    ],
    [
      tasks.some((task) => task.isMilestone),
      { glyph: MILESTONE, ink: 0, name: 'milestone', looks: PLAIN_LOOKS },
    ],
    [
      tasks.some((task) => task.isCrit),
      { glyph: TASK_FILL, ink: CRIT_INK, name: 'crit', looks: BOLD },
    ],
  ]
  const shown = kinds.filter(([isShown]) => isShown).map(([, item]) => item)
  return shown.length > 1 || tasks.some((task) => task.isCrit || task.isMilestone) ? shown : []
}

function labelWidthOf(diagram: GanttDiagram, width: number): number | null {
  const widest = Math.max(...diagram.tasks.map((task) => displayWidth(labelOf(diagram, task))))
  const most = Math.min(
    Math.max(MIN_LABEL * 2, Math.floor(width * WIDE_LABELS)),
    width - 1 - MIN_CHART,
  )
  const labelWidth = Math.min(widest, most)
  return labelWidth < MIN_LABEL ? null : labelWidth
}

function putTask(
  sheet: ChartGrid,
  row: number,
  task: GanttTask,
  left: number,
  range: Span,
  columns: number,
) {
  const ink = inkOf(task)
  if (task.isMilestone) {
    const middle = task.start + (task.end - task.start) / 2
    const col = Math.min(Math.floor(columnOf(middle, range, columns)), columns - 1)
    sheet.put(row, left + col, MILESTONE, ink)
    return
  }
  const from = Math.min(Math.floor(columnOf(task.start, range, columns)), columns - 1)
  const to = Math.min(
    Math.max(Math.ceil(columnOf(task.end, range, columns)) - 1, from),
    columns - 1,
  )
  sheet.put(row, left + from, fillOf(task).repeat(to - from + 1), ink)
}

export function drawGantt(diagram: GanttDiagram, width: number): InkedDrawing | Refusal {
  const labelWidth = labelWidthOf(diagram, width)
  if (labelWidth === null) return tooWide(MIN_LABEL + 1 + MIN_CHART, width)
  const columns = width - labelWidth - 1
  const left = labelWidth + 1
  const range = rangeOf(diagram)
  const axis = axisOf(diagram, range, columns)
  const sheet = new ChartGrid()
  let row = putHead(sheet, diagram.title, [], width)
  let section: number | null = null
  for (const task of diagram.tasks) {
    if (task.section !== null && task.section !== section) {
      section = task.section
      sheet.put(row, 0, cutLabel(diagram.sections[section] ?? '', width), section, BOLD)
      row += 1
    }
    sheet.put(
      row,
      0,
      cutLabel(labelOf(diagram, task), labelWidth),
      'plain',
      task.isCrit ? BOLD : PLAIN_LOOKS,
    )
    for (const tick of axis.ticks) sheet.put(row, left + tick.col, GRID, AXIS_INK)
    putTask(sheet, row, task, left, range, columns)
    row += 1
  }
  sheet.put(row, left, AXIS_ACROSS.repeat(columns), AXIS_INK)
  for (const tick of axis.ticks) {
    sheet.put(row, left + tick.col, AXIS_TICK, AXIS_INK)
    sheet.put(row + 1, left + tick.col, tick.text, VALUE_INK)
  }
  row += axis.ticks.length > 0 ? 2 : 1
  row = putLegendRows(sheet, row, legendOf(diagram), width)
  if (row > MOST_ROWS) {
    return ganttRefusal(`${String(row)} rows, at most ${String(MOST_ROWS)} draw`)
  }
  const drawing = sheet.drawing(width)
  const widest = Math.max(0, ...drawing.lines.map(displayWidth))
  return widest > width ? tooWide(widest, width) : drawing
}

function ganttRefusal(reason: string): Refusal {
  return { kind: 'refused', reason, line: null, limit: null }
}
