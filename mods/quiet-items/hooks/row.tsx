import type { Elements, EngineInterface, RenderElement, RenderSurface } from 'claude-code'
import type { QuietItemsItemRow, QuietItemsRow, QuietItemsVerb } from '../types'

type Diff = Awaited<ReturnType<EngineInterface['workitems']['refresh']>>
type Parsed = Awaited<ReturnType<EngineInterface['workitems']['classify']>>
type TrackerWrite = Exclude<Parsed, { kind: 'none' }>['writes'][number]
type Item = Diff['created'][number]
type RowElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

const COMMENT_VERBS = new Set(['comments add', 'comment'])
const VERB_COLUMN = 'work item commented'.length
const STATUS_COLUMN = 'in_progress'.length
const RAW_EDIT_NOTE = 'not through the tracker CLI'

function itemRow(verb: QuietItemsVerb, item: Item): QuietItemsItemRow {
  return {
    kind: 'item',
    verb,
    id: item.id,
    title: item.title,
    status: item.rawStatus,
    priority: item.priority,
  }
}

export function rowsFromDiff(diff: Diff, writes: readonly TrackerWrite[]): QuietItemsItemRow[] {
  const isComment = writes.length > 0 && writes.every((write) => COMMENT_VERBS.has(write.verb))
  return [
    ...diff.created.map((item) => itemRow('created', item)),
    ...diff.updated.map((item) => itemRow(isComment ? 'commented' : 'updated', item)),
    ...diff.closed.map((item) => itemRow('closed', item)),
  ]
}

export function cutTitle(title: string, length: number): string {
  const graphemes = Array.from(new Intl.Segmenter().segment(title), (part) => part.segment)
  if (graphemes.length <= length) return title
  return `${graphemes.slice(0, length).join('').trimEnd()}…`
}

type CellStyle = Omit<Parameters<RowElements['Text']>[0], 'children'>

function cell(
  { Box, Text }: RowElements,
  text: string,
  style: CellStyle = {},
  canShrink = false,
): RenderElement {
  return Box({ flexShrink: canShrink ? 1 : 0, children: Text({ ...style, children: text }) })
}

export type RowLook = { elements: RowElements; hasToolMarker: boolean }

function line({ elements, hasToolMarker }: RowLook, key: string, cells: RenderElement[]) {
  const columns = elements.Box({ flexDirection: 'row', gap: 2, children: cells })
  if (!hasToolMarker) return elements.Box({ key, children: columns })
  const marker = elements.Box({
    flexShrink: 0,
    marginRight: 1,
    children: elements.Text({ color: 'success', children: '●' }),
  })
  return elements.Box({ key, flexDirection: 'row', children: [marker, columns] })
}

function drawItem(
  look: RowLook,
  row: QuietItemsItemRow,
  titleLength: number,
  key: string,
): RenderElement {
  const { elements } = look
  const title = cutTitle(row.title, titleLength).padEnd(titleLength + 1)
  return line(look, key, [
    cell(elements, `work item ${row.verb}`.padEnd(VERB_COLUMN)),
    cell(elements, row.id, { bold: true }),
    cell(elements, title, { wrap: 'truncate-end' }, true),
    cell(elements, row.status.padEnd(STATUS_COLUMN), { dimColor: true }),
    cell(elements, row.priority === null ? '' : `P${String(row.priority)}`, { dimColor: true }),
  ])
}

function drawRawEdit(look: RowLook, path: string, tool: string, key: string): RenderElement {
  const { elements } = look
  return line(look, key, [
    cell(elements, 'raw tracker edit'.padEnd(VERB_COLUMN), { color: 'warning' }),
    cell(elements, path),
    cell(elements, `${tool}, ${RAW_EDIT_NOTE}`, { dimColor: true, wrap: 'truncate-end' }, true),
  ])
}

export function drawRows(
  look: RowLook,
  rows: readonly QuietItemsRow[],
  titleLength: number,
): RenderElement {
  return look.elements.Box({
    flexDirection: 'column',
    children: rows.map((row, index) =>
      row.kind === 'item'
        ? drawItem(look, row, titleLength, `row-${String(index)}`)
        : drawRawEdit(look, row.path, row.tool, `row-${String(index)}`),
    ),
  })
}

export function drawEmpty({ Box }: RowElements): RenderElement {
  return Box({})
}
