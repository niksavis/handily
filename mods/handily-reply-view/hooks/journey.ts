import { rightBar } from './charts'
import { shownLabel, tooWide, widestLabel } from './flowchart'
import { plainLabel, type Ink, type InkedDrawing, type InkRun, type Label } from './ink'
import { doesNotParse, lineFault, textLines, type Refusal, type Statement } from './mermaid'
import { drawnOutline, inkedLine, part, titleLines, wrappedLabel, type Part } from './outline'
import { sectionLine } from './timeline'
import { displayWidth } from './width'

export type JourneyTask = { label: string[]; score: number; actors: string[] }

export type JourneySection = { label: string[] | null; tasks: JourneyTask[] }

export type Journey = { kind: 'journey'; title: string | null; sections: JourneySection[] }

const HEADER = /^journey/
const DRAWN_HEADER = 'journey'
const TITLE = /^title\s(.*)$/i
const SECTION = /^section\s(.*)$/i
const ACCESSIBILITY = /^acc(?:Title|Descr)\s*:/i
const ACCESSIBILITY_BLOCK = /^accDescr\s*\{[^}]*\}$/i
const COMMENT = /\s*(?:#|%%).*$/
const TASK = /^([^:;]+):([^;]+)$/
const DATA_MARK = ':'
const ACTOR_MARK = ','
const SCORE = /^(?:\d+(?:\.\d+)?|\.\d+)$/
const LEAST_SCORE = 1
const MOST_SCORE = 5

function scoreOf(line: number, written: string): number {
  const text = written.trim()
  if (!SCORE.test(text)) {
    throw lineFault(line, `line ${String(line)}: ${JSON.stringify(text)} is not a number`)
  }
  const score = Number(text)
  if (score < LEAST_SCORE || score > MOST_SCORE) {
    throw lineFault(
      line,
      `line ${String(line)}: the score ${text} is not from ${String(LEAST_SCORE)} to ${String(MOST_SCORE)}`,
    )
  }
  return score
}

export class JourneyBuilder {
  private title: string | null = null
  private readonly sections: JourneySection[] = [{ label: null, tasks: [] }]

  add({ line, text: written }: Statement): void {
    if (ACCESSIBILITY.test(written) || ACCESSIBILITY_BLOCK.test(written)) return
    const text = written.replace(COMMENT, '')
    if (text === '') return
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = (title[1] ?? '').trim()
      return
    }
    const section = SECTION.exec(text)
    if (section !== null) {
      const name = (section[1] ?? '').trim()
      if (name === '' || name.includes(DATA_MARK)) throw doesNotParse(line)
      this.sections.push({ label: textLines(name), tasks: [] })
      return
    }
    this.task(line, text)
  }

  build(): Journey | Refusal {
    const sections = this.sections.filter(
      (section) => section.label !== null || section.tasks.length > 0,
    )
    if (sections.every((section) => section.tasks.length === 0)) {
      return { kind: 'refused', reason: 'the journey has no tasks', line: null, limit: null }
    }
    return { kind: 'journey', title: this.title, sections }
  }

  private task(line: number, text: string): void {
    const found = TASK.exec(text)
    const name = found?.[1]?.trim() ?? ''
    if (found === null || name === '') throw doesNotParse(line)
    const [score = '', actors = ''] = (found[2] ?? '').split(DATA_MARK)
    this.sections.at(-1)?.tasks.push({
      label: textLines(name),
      score: scoreOf(line, score),
      actors: actors
        .split(ACTOR_MARK)
        .map((actor) => actor.trim())
        .filter((actor) => actor !== ''),
    })
  }
}

export function journeyBuilder(header: Statement): JourneyBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (header.text !== DRAWN_HEADER) throw doesNotParse(header.line)
  return new JourneyBuilder()
}

const FULL = '█'
const EMPTY = '░'
const BAR_GAP = ' '
const COLUMN_GAP = '  '
const ACTOR_GAP = ', '
const LEAST_LABEL_COLUMNS = 10
const LEAST_ACTOR_COLUMNS = 12
const NAME_SHARE = 2
const LINE_INK: Ink = 'line'

type Layout = { width: number; lead: number; scoreWidth: number; nameColumns: number | null }

function scoreText(score: number): string {
  return String(score)
}

function labelsOf(lines: readonly string[]): Label[] {
  return lines.map(shownLabel).filter((line) => line.text.trim() !== '')
}

function scoreParts(layout: Layout, score: number, ink: Ink): Part[] {
  const bar = rightBar(Math.round(score * 8), FULL)
  const empty = EMPTY.repeat(MOST_SCORE - displayWidth(bar))
  const text = scoreText(score).padEnd(layout.scoreWidth)
  return [part(bar, ink), part(empty, LINE_INK), part(`${BAR_GAP}${text}${COLUMN_GAP}`, ink)]
}

function actorLabels(task: JourneyTask, width: number): Label[] {
  if (task.actors.length === 0) return []
  return wrappedLabel(shownLabel(task.actors.join(ACTOR_GAP)), width)
}

function taskLines(layout: Layout, task: JourneyTask, ink: Ink): InkRun[][] {
  const blank = part(' '.repeat(layout.lead), 'plain')
  const columns = layout.nameColumns
  const nameRoom = columns ?? layout.width - layout.lead
  const names = labelsOf(task.label).flatMap((label) => wrappedLabel(label, nameRoom))
  const rows: Part[][] = names.map((name) => [{ label: name, ink: 'plain' }])
  if (columns === null) {
    const actors = actorLabels(task, layout.width - layout.lead)
    rows.push(...actors.map((actor): Part[] => [{ label: actor, ink: LINE_INK }]))
  } else {
    const room = layout.width - layout.lead - columns - displayWidth(COLUMN_GAP)
    actorLabels(task, room).forEach((actor, index) => {
      const name = rows[index]?.[0]?.label ?? plainLabel('')
      const pad = ' '.repeat(columns - displayWidth(name.text) + displayWidth(COLUMN_GAP))
      rows[index] = [
        { label: name, ink: 'plain' },
        part(pad, 'plain'),
        { label: actor, ink: LINE_INK },
      ]
    })
  }
  return rows.map((parts, index) =>
    inkedLine([...(index === 0 ? scoreParts(layout, task.score, ink) : [blank]), ...parts]),
  )
}

function tasksOf(journey: Journey): JourneyTask[] {
  return journey.sections.flatMap((section) => section.tasks)
}

function nameColumnsOf(journey: Journey, width: number, lead: number): number | null {
  const tasks = tasksOf(journey)
  if (tasks.every((task) => task.actors.length === 0)) return null
  const widest = Math.max(0, ...tasks.map((task) => widestLabel(labelsOf(task.label))))
  const room = width - lead - displayWidth(COLUMN_GAP)
  const fits = widest * NAME_SHARE <= width - lead && room - widest >= LEAST_ACTOR_COLUMNS
  return fits ? widest : null
}

function lineWidth(line: readonly InkRun[]): number {
  return displayWidth(line.map((run) => run.text).join(''))
}

export function drawJourney(journey: Journey, width: number): InkedDrawing | Refusal {
  const scoreWidth = Math.max(...tasksOf(journey).map((task) => scoreText(task.score).length))
  const lead = MOST_SCORE + displayWidth(BAR_GAP) + scoreWidth + displayWidth(COLUMN_GAP)
  const needed = lead + LEAST_LABEL_COLUMNS
  if (needed > width) return tooWide(needed, width)
  const layout: Layout = {
    width,
    lead,
    scoreWidth,
    nameColumns: nameColumnsOf(journey, width, lead),
  }
  const blocks = journey.sections.map((section, ink) => ({
    section,
    ink,
    lines: section.tasks.flatMap((task) => taskLines(layout, task, ink)),
  }))
  const rule = Math.max(0, ...blocks.flatMap((block) => block.lines.map(lineWidth)))
  const lines = blocks.flatMap(({ section, ink, lines }) =>
    section.label === null ? lines : [sectionLine(section.label, ink, width, rule), ...lines],
  )
  return drawnOutline([...titleLines(journey.title, width), ...lines])
}
