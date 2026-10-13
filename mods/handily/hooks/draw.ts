import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { HandilyModState, HandilyReport } from '../types'
import { actionLine, isAllWell, modRowsOf, oldRowsOf, summaryOf } from './status'

type ReportElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

const STATE_COLOR: Record<HandilyModState, ThemeKey> = {
  loaded: 'success',
  disabled: 'error',
  'not installed': 'error',
  'not loaded': 'warning',
}

const OLD_ID_COLOR: ThemeKey = 'warning'

const COLUMN_GAP = 2

export function drawReport({ Box, Text }: ReportElements, report: HandilyReport): RenderElement {
  const cell = (
    children: string,
    props: { bold?: boolean; dimColor?: boolean; color?: ThemeKey },
  ) => Box({ flexShrink: 0, children: Text({ ...props, children }) })
  const line = (key: string, children: RenderElement[]) =>
    Box({ key, flexDirection: 'row', gap: COLUMN_GAP, children })
  const action = (key: string, text: string, color: ThemeKey) =>
    Box({ key, children: Text({ color, children: actionLine(text) }) })
  const modLines = modRowsOf(report).flatMap((row) => {
    const color = STATE_COLOR[row.state]
    const main = line(row.key, [
      cell(row.name, { bold: true }),
      cell(row.version, { dimColor: true }),
      cell(row.stateText, { color }),
      cell(row.mode, {}),
      Box({ flexShrink: 1, children: Text({ dimColor: true, children: row.about }) }),
    ])
    return row.action === null ? [main] : [main, action(`${row.key} action`, row.action, color)]
  })
  const oldLines = oldRowsOf(report).flatMap((row) => [
    line(row.key, [
      cell(row.name, { bold: true }),
      Box({ flexShrink: 1, children: Text({ color: OLD_ID_COLOR, children: row.detail }) }),
    ]),
    action(`${row.key} action`, row.action, OLD_ID_COLOR),
  ])
  const summaryColor: ThemeKey = isAllWell(report) ? 'success' : 'warning'
  const summary = summaryOf(report).map((text, index) =>
    Box({
      key: `summary ${String(index)}`,
      children: Text({ color: summaryColor, children: text }),
    }),
  )
  return Box({ flexDirection: 'column', children: [...modLines, ...oldLines, ...summary] })
}
