import { shown, tooWide } from './flowchart'
import {
  BLANK,
  inkRunsOf,
  PLAIN_LOOKS,
  type Ink,
  type InkedCell,
  type InkedDrawing,
  type InkRun,
  type Label,
  type LookedRun,
} from './ink'
import { doesNotParse, lineFault, notDrawnYet, type Refusal, type Statement } from './mermaid'
import { drawnOutline, titleLines, wrappedLabel } from './outline'
import { displayWidth, fitted, graphemesOf } from './width'

export type CommitType = 'normal' | 'reverse' | 'highlight'

export type CommitKind = 'commit' | 'merge' | 'cherry-pick'

export type GitCommit = {
  kind: CommitKind
  id: string | null
  message: string | null
  tags: string[]
  type: CommitType | null
  branch: number
  parents: number[]
  merged: number | null
  picked: string | null
}

export type GitBranch = { name: string; order: number | null }

export type GitStep =
  { kind: 'branch'; branch: number; from: number | null } | { kind: 'commit'; commit: number }

export type GitGraph = {
  kind: 'gitgraph'
  title: string | null
  branches: GitBranch[]
  commits: GitCommit[]
  steps: GitStep[]
}

type Token = { kind: 'key' | 'string' | 'word'; text: string }

type Attributes = {
  id: string | null
  message: string | null
  tags: string[]
  type: CommitType | null
  order: number | null
  parent: string | null
}

const MAIN_BRANCH = 'main'
const HEADER = /^gitGraph\b/
const DRAWN_HEADER = /^gitGraph(?:\s*:|\s+(LR|TB|BT)\s*:)?$/
const REFUSED_DIRECTION = 'BT'
const TITLE = /^title(?:[\t ](.*))?$/
const ACCESSIBILITY = /^acc(?:Title|Descr)\s*:/
const ACCESSIBILITY_BLOCK = /^accDescr\s*\{[^}]*\}$/
const TOKEN =
  /\s*(?:(id|msg|tag|type|order|parent):|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([^\s"':]+))/y
const ESCAPE = /\\(.)/g
const REFERENCE = /^\w(?:[-./\w]*[-\w])?$/
const ORDER = /^(?:0|[1-9]\d*)$/
const COMMIT_TYPES: Readonly<Record<string, CommitType>> = {
  NORMAL: 'normal',
  REVERSE: 'reverse',
  HIGHLIGHT: 'highlight',
}
const NAME_COLUMNS = 24
const MAIN_ORDER = 0
const UNDER_PARENT = 0.5

function tokensOf({ line, text }: Statement): Token[] {
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < text.length) {
    const found = TOKEN.exec(text)
    if (found === null) throw doesNotParse(line)
    const [, key, quoted, word] = found
    if (key !== undefined) tokens.push({ kind: 'key', text: key })
    else if (quoted !== undefined) {
      tokens.push({ kind: 'string', text: quoted.slice(1, -1).replace(ESCAPE, '$1') })
    } else if (word !== undefined) tokens.push({ kind: 'word', text: word })
  }
  return tokens
}

function named(name: string): string {
  return fitted(shown(name), NAME_COLUMNS)
}

export class GitGraphBuilder {
  private readonly branches: GitBranch[] = [{ name: MAIN_BRANCH, order: null }]
  private readonly heads: (number | null)[] = [null]
  private readonly commits: GitCommit[] = []
  private readonly steps: GitStep[] = [{ kind: 'branch', branch: 0, from: null }]
  private readonly ids = new Set<string>()
  private current = 0
  private title: string | null = null

  add(statement: Statement): void {
    const { line, text } = statement
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = (title[1] ?? '').trim()
      return
    }
    if (ACCESSIBILITY.test(text) || ACCESSIBILITY_BLOCK.test(text)) return
    const [command, ...rest] = tokensOf(statement)
    if (command?.kind !== 'word') throw doesNotParse(line)
    switch (command.text) {
      case 'commit':
        this.commit(line, rest)
        return
      case 'branch':
        this.branch(line, rest)
        return
      case 'checkout':
      case 'switch':
        this.checkout(line, rest)
        return
      case 'merge':
        this.merge(line, rest)
        return
      case 'cherry-pick':
        this.cherryPick(line, rest)
        return
      default:
        throw doesNotParse(line)
    }
  }

  build(): GitGraph {
    return {
      kind: 'gitgraph',
      title: this.title,
      branches: this.branches,
      commits: this.commits,
      steps: this.steps,
    }
  }

  private commit(line: number, tokens: Token[]): void {
    const { id, message, tags, type } = this.attributes(line, tokens, ['id', 'msg', 'tag', 'type'])
    this.claimId(line, id)
    this.addCommit({ kind: 'commit', id, message, tags, type, merged: null, picked: null })
  }

  private claimId(line: number, id: string | null): void {
    if (id === null) return
    if (this.ids.has(id)) {
      throw lineFault(line, `line ${String(line)}: the commit id ${named(id)} exists already`)
    }
    this.ids.add(id)
  }

  private branch(line: number, tokens: Token[]): void {
    const [name, ...rest] = tokens
    const branch = this.branchName(line, name)
    if (this.branchIndex(branch) !== undefined) {
      throw lineFault(line, `line ${String(line)}: the branch ${named(branch)} exists already`)
    }
    const { order } = this.attributes(line, rest, ['order'])
    this.branches.push({ name: branch, order })
    const index = this.branches.length - 1
    const from = this.heads[this.current] ?? null
    this.heads.push(from)
    this.steps.push({ kind: 'branch', branch: index, from })
    this.current = index
  }

  private checkout(line: number, tokens: Token[]): void {
    const [name, ...rest] = tokens
    if (rest.length > 0) throw doesNotParse(line)
    this.current = this.existing(line, this.branchName(line, name))
  }

  private merge(line: number, tokens: Token[]): void {
    const [name, ...rest] = tokens
    const branch = this.existing(line, this.branchName(line, name))
    const { id, tags, type } = this.attributes(line, rest, ['id', 'tag', 'type'])
    const headBranch = this.commits[this.heads[this.current] ?? -1]?.branch
    if (headBranch === branch && this.heads[branch] !== null) {
      throw lineFault(
        line,
        `line ${String(line)}: the branch ${named(this.branches[branch]?.name ?? '')} cannot merge into itself`,
      )
    }
    if (branch === this.current) {
      throw lineFault(line, `line ${String(line)}: a branch cannot merge itself`)
    }
    const head = this.headOf(line, this.current)
    const other = this.headOf(line, branch)
    if (head === other) {
      throw lineFault(line, `line ${String(line)}: both branches have the same head`)
    }
    this.claimId(line, id)
    this.addCommit(
      { kind: 'merge', id, message: null, tags, type, merged: branch, picked: null },
      other,
    )
  }

  private cherryPick(line: number, tokens: Token[]): void {
    const { id, tags, parent } = this.attributes(line, tokens, ['id', 'tag', 'parent'])
    if (id === null) throw doesNotParse(line)
    const picked = this.commits.findLast((commit) => commit.id === id)
    if (picked === undefined) {
      throw lineFault(line, `line ${String(line)}: no commit has the id ${named(id)}`)
    }
    const parents = picked.parents.map((at) => this.commits[at]?.id)
    if (parent !== null && !parents.includes(parent)) {
      throw lineFault(
        line,
        `line ${String(line)}: the commit ${named(id)} has no parent ${named(parent)}`,
      )
    }
    if (picked.kind === 'merge' && parent === null) {
      throw lineFault(
        line,
        `line ${String(line)}: the merge commit ${named(id)} needs the id of a parent`,
      )
    }
    if (picked.branch === this.current) {
      throw lineFault(line, `line ${String(line)}: the commit ${named(id)} is on this branch`)
    }
    this.headOf(line, this.current)
    this.addCommit({
      kind: 'cherry-pick',
      id: null,
      message: null,
      tags,
      type: null,
      merged: null,
      picked: id,
    })
  }

  private addCommit(
    commit: Omit<GitCommit, 'branch' | 'parents'>,
    other: number | null = null,
  ): void {
    const head = this.heads[this.current] ?? null
    const parents = [head, other].filter((at): at is number => at !== null)
    this.commits.push({ ...commit, branch: this.current, parents })
    this.heads[this.current] = this.commits.length - 1
    this.steps.push({ kind: 'commit', commit: this.commits.length - 1 })
  }

  private headOf(line: number, branch: number): number {
    const head = this.heads[branch] ?? null
    if (head === null) {
      const name = named(this.branches[branch]?.name ?? '')
      throw lineFault(line, `line ${String(line)}: the branch ${name} has no commits`)
    }
    return head
  }

  private branchIndex(name: string): number | undefined {
    const index = this.branches.findIndex((branch) => branch.name === name)
    return index < 0 ? undefined : index
  }

  private existing(line: number, name: string): number {
    const index = this.branchIndex(name)
    if (index === undefined) {
      throw lineFault(line, `line ${String(line)}: the branch ${named(name)} does not exist`)
    }
    return index
  }

  private branchName(line: number, token: Token | undefined): string {
    if (token?.kind === 'string') return token.text
    if (token?.kind === 'word' && REFERENCE.test(token.text)) return token.text
    throw doesNotParse(line)
  }

  private attributes(line: number, tokens: Token[], keys: readonly string[]): Attributes {
    const found: Attributes = {
      id: null,
      message: null,
      tags: [],
      type: null,
      order: null,
      parent: null,
    }
    for (let at = 0; at < tokens.length; at++) {
      const token = tokens[at]
      if (token?.kind === 'string' && keys.includes('msg')) {
        found.message = token.text
        continue
      }
      const value = tokens[at + 1]
      if (token?.kind !== 'key' || !keys.includes(token.text) || value === undefined) {
        throw doesNotParse(line)
      }
      at += 1
      this.attribute(line, found, token.text, value)
    }
    return found
  }

  private attribute(line: number, found: Attributes, key: string, value: Token): void {
    if (key === 'type' || key === 'order') {
      if (value.kind !== 'word') throw doesNotParse(line)
      if (key === 'order') {
        if (!ORDER.test(value.text)) throw doesNotParse(line)
        found.order = Number(value.text)
        return
      }
      const type = COMMIT_TYPES[value.text]
      if (type === undefined) throw doesNotParse(line)
      found.type = type
      return
    }
    if (value.kind !== 'string') throw doesNotParse(line)
    if (key === 'tag') found.tags.push(value.text)
    else if (key === 'msg') found.message = value.text
    else if (key === 'parent') found.parent = value.text
    else found.id = value.text
  }
}

export function gitGraphBuilder(header: Statement): GitGraphBuilder | null {
  if (!HEADER.test(header.text)) return null
  const found = DRAWN_HEADER.exec(header.text)
  if (found === null) throw doesNotParse(header.line)
  if (found[1] === REFUSED_DIRECTION)
    throw notDrawnYet(header.line, `gitGraph ${REFUSED_DIRECTION}`)
  return new GitGraphBuilder()
}

const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8
const LANE_COLUMNS = 2
const LABEL_GAP = 2
const LEAST_LABEL_COLUMNS = 10
const ACROSS = '─'
const DOWNWARD = '│'
const START = '╷'
const GLYPHS: Readonly<Record<number, string>> = {
  [UP | DOWN]: DOWNWARD,
  [DOWN]: START,
  [UP]: DOWNWARD,
  [LEFT]: ACROSS,
  [RIGHT]: ACROSS,
  [LEFT | RIGHT]: ACROSS,
  [DOWN | RIGHT]: '╭',
  [DOWN | LEFT]: '╮',
  [UP | RIGHT]: '╰',
  [UP | LEFT]: '╯',
  [UP | DOWN | RIGHT]: '├',
  [UP | DOWN | LEFT]: '┤',
  [DOWN | LEFT | RIGHT]: '┬',
  [UP | LEFT | RIGHT]: '┴',
  [UP | DOWN | LEFT | RIGHT]: '┼',
}
const COMMIT_GLYPHS: Readonly<Record<CommitType, string>> = {
  normal: '●',
  reverse: '⊗',
  highlight: '▮',
}
const MERGE_GLYPH = '◉'
const BOLD = { ...PLAIN_LOOKS, isBold: true }
const ITALIC = { ...PLAIN_LOOKS, isItalic: true }

type Join = { from: number; to: number }

type Row = {
  lane: number
  starts: boolean
  glyph: string | null
  join: Join | null
  label: Label
  ink: Ink
}

type Spans = { start: number[]; end: number[] }

function laneRank(branch: GitBranch, index: number): number {
  if (index === 0) return MAIN_ORDER
  return branch.order ?? Number.parseFloat(`0.${String(index)}`)
}

function laneOrder(branches: readonly GitBranch[]): number[] {
  const ranked = branches.map((branch, index) => ({ index, rank: laneRank(branch, index) }))
  ranked.sort((one, other) => one.rank - other.rank)
  const lanes = Array.from(branches, () => 0)
  ranked.forEach(({ index }, lane) => {
    lanes[index] = lane
  })
  return lanes
}

function runOf(text: string, looks = PLAIN_LOOKS): LookedRun {
  return { text, looks }
}

function joinedLabel(parts: readonly LookedRun[]): Label {
  const runs = parts.filter((part) => part.text !== '')
  const spaced = runs.flatMap((run, at) => (at === 0 ? [run] : [runOf(' '), run]))
  return { text: spaced.map((run) => run.text).join(''), runs: spaced }
}

function commitLabel(graph: GitGraph, commit: GitCommit): Label {
  const merged = commit.merged === null ? undefined : graph.branches[commit.merged]
  const tags = commit.tags.map((tag) => `tag: ${shown(tag)}`).join(', ')
  return joinedLabel([
    runOf(shown(commit.id ?? '')),
    runOf(shown(commit.message ?? '')),
    runOf(merged === undefined ? '' : `merge ${shown(merged.name)}`, ITALIC),
    runOf(commit.picked === null ? '' : `cherry-pick of ${shown(commit.picked)}`, ITALIC),
    runOf(tags === '' ? '' : `(${tags})`, BOLD),
  ])
}

function commitGlyph(commit: GitCommit): string {
  if (commit.type !== null) return COMMIT_GLYPHS[commit.type]
  return commit.kind === 'merge' ? MERGE_GLYPH : COMMIT_GLYPHS.normal
}

function stepsInRowOrder(graph: GitGraph): GitStep[] {
  const commitStep = new Map<number, number>()
  graph.steps.forEach((step, at) => {
    if (step.kind === 'commit') commitStep.set(step.commit, at)
  })
  const placeOf = (step: GitStep, at: number) =>
    step.kind === 'branch' && step.from !== null
      ? (commitStep.get(step.from) ?? at) + UNDER_PARENT
      : at
  return graph.steps
    .map((step, at) => ({ step, place: placeOf(step, at) }))
    .sort((one, other) => one.place - other.place)
    .map(({ step }) => step)
}

function rowsOf(graph: GitGraph, lanes: readonly number[]): Row[] {
  const laneOfCommit = (at: number) => lanes[graph.commits[at]?.branch ?? 0] ?? 0
  return stepsInRowOrder(graph).flatMap((step): Row[] => {
    if (step.kind === 'branch') {
      const lane = lanes[step.branch] ?? 0
      const name = shown(graph.branches[step.branch]?.name ?? '')
      return [
        {
          lane,
          starts: true,
          glyph: null,
          join: step.from === null ? null : { from: laneOfCommit(step.from), to: lane },
          label: { text: name, runs: [runOf(name, BOLD)] },
          ink: lane,
        },
      ]
    }
    const commit = graph.commits[step.commit]
    if (commit === undefined) return []
    const lane = laneOfCommit(step.commit)
    const from = commit.merged === null ? lane : (lanes[commit.merged] ?? lane)
    return [
      {
        lane,
        starts: false,
        glyph: commitGlyph(commit),
        join: from === lane ? null : { from, to: lane },
        label: commitLabel(graph, commit),
        ink: 'plain',
      },
    ]
  })
}

function spansOf(rows: readonly Row[], laneCount: number): Spans {
  const start = Array.from({ length: laneCount }, () => -1)
  const end = Array.from({ length: laneCount }, () => -1)
  rows.forEach((row, at) => {
    if (row.starts) start[row.lane] = at
    const touched = row.join === null ? [row.lane] : [row.join.from, row.join.to]
    for (const lane of touched) end[lane] = Math.max(end[lane] ?? -1, at)
  })
  return { start, end }
}

function isLive(spans: Spans, lane: number, row: number): boolean {
  const start = spans.start[lane] ?? -1
  return start >= 0 && start <= row && row <= (spans.end[lane] ?? -1)
}

function continues(spans: Spans, lane: number, row: number): boolean {
  return isLive(spans, lane, row) && row < (spans.end[lane] ?? -1)
}

function laneMask(spans: Spans, lane: number, row: number): number {
  const start = spans.start[lane] ?? -1
  return (row > start ? UP : 0) | (continues(spans, lane, row) ? DOWN : 0)
}

type Cells = Map<number, InkedCell>

function cell(glyph: string, ink: Ink, looks = PLAIN_LOOKS): InkedCell {
  return { glyph, ink, looks }
}

function graphCells(rows: readonly Row[], spans: Spans, at: number, laneCount: number): Cells {
  const row = rows[at]
  const masks = new Map<number, number>()
  for (let lane = 0; lane < laneCount; lane++) {
    if (isLive(spans, lane, at)) masks.set(lane * LANE_COLUMNS, laneMask(spans, lane, at))
  }
  const cells: Cells = new Map()
  const join = row?.join ?? null
  if (join !== null) {
    const low = Math.min(join.from, join.to) * LANE_COLUMNS
    const high = Math.max(join.from, join.to) * LANE_COLUMNS
    masks.set(low, (masks.get(low) ?? 0) | RIGHT)
    masks.set(high, (masks.get(high) ?? 0) | LEFT)
    for (let col = low + 1; col < high; col++) {
      if (!masks.has(col)) cells.set(col, cell(ACROSS, row?.starts === true ? join.to : join.from))
    }
  }
  for (const [col, mask] of masks) {
    cells.set(col, cell(GLYPHS[mask] ?? START, col / LANE_COLUMNS))
  }
  const glyph = row?.glyph ?? null
  if (row !== undefined && glyph !== null) cells.set(row.lane * LANE_COLUMNS, cell(glyph, row.lane))
  return cells
}

function continuedCells(spans: Spans, at: number, laneCount: number): Cells {
  const cells: Cells = new Map()
  for (let lane = 0; lane < laneCount; lane++) {
    if (continues(spans, lane, at)) cells.set(lane * LANE_COLUMNS, cell(DOWNWARD, lane))
  }
  return cells
}

function rightmost(cells: Cells): number {
  return Math.max(-1, ...cells.keys())
}

function lineOf(cells: Cells, labelColumn: number, label: Label | undefined, ink: Ink): InkRun[] {
  const inked: InkedCell[] = []
  const end = label === undefined ? rightmost(cells) + 1 : labelColumn
  for (let col = 0; col < end; col++) inked.push(cells.get(col) ?? BLANK)
  for (const run of label?.runs ?? []) {
    for (const glyph of graphemesOf(run.text)) inked.push(cell(glyph, ink, run.looks))
  }
  return inkRunsOf(inked)
}

export function drawGitGraph(graph: GitGraph, width: number): InkedDrawing | Refusal {
  const lanes = laneOrder(graph.branches)
  const rows = rowsOf(graph, lanes)
  const spans = spansOf(rows, graph.branches.length)
  const laneCount = graph.branches.length
  const lines = titleLines(graph.title, width)
  let needed = 0
  const drawn: InkRun[][] = []
  rows.forEach((row, at) => {
    const cells = graphCells(rows, spans, at, laneCount)
    const below = continuedCells(spans, at, laneCount)
    const labelColumn = Math.max(rightmost(cells), rightmost(below)) + LABEL_GAP
    const labelWidth = displayWidth(row.label.text)
    if (labelWidth === 0) {
      needed = Math.max(needed, rightmost(cells) + 1)
      drawn.push(lineOf(cells, labelColumn, undefined, row.ink))
      return
    }
    needed = Math.max(needed, labelColumn + Math.min(labelWidth, LEAST_LABEL_COLUMNS))
    const room = Math.max(width - labelColumn, 1)
    const wrapped = wrappedLabel(row.label, room)
    wrapped.forEach((line, index) => {
      drawn.push(lineOf(index === 0 ? cells : below, labelColumn, line, row.ink))
    })
  })
  if (needed > width) return tooWide(needed, width)
  const all = [...lines, ...drawn]
  return drawnOutline(all)
}
