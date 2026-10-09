import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { HandilyModState, HandilyReport } from '../types'
import { isAllWell, summaryOf } from './status'

type ReportElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

type Row = { key: string; name: string; version: string; color: ThemeKey; detail: string }

const STATE_COLOR: Record<HandilyModState, ThemeKey> = {
  loaded: 'success',
  disabled: 'error',
  'not installed': 'error',
  'not loaded': 'warning',
}

const OLD_ID_COLOR: ThemeKey = 'warning'

function widest(texts: readonly string[]): number {
  return Math.max(0, ...texts.map((text) => text.length))
}

function rowsOf(report: HandilyReport): Row[] {
  const modRows = report.mods.map((status) => ({
    key: status.name,
    name: status.name,
    version: status.version ?? '',
    color: STATE_COLOR[status.state],
    detail: status.detail,
  }))
  const oldIdRows = report.oldIds.map((oldId) => ({
    key: `${oldId.id} ${oldId.scope}`,
    name: oldId.id,
    version: '',
    color: OLD_ID_COLOR,
    detail: oldId.detail,
  }))
  return [...modRows, ...oldIdRows]
}

export function drawReport({ Box, Text }: ReportElements, report: HandilyReport): RenderElement {
  const rows = rowsOf(report)
  const nameWidth = widest(rows.map((row) => row.name))
  const versionWidth = widest(rows.map((row) => row.version))
  const drawn = rows.map((row) =>
    Box({
      key: row.key,
      flexDirection: 'row',
      gap: 2,
      children: [
        Box({
          flexShrink: 0,
          children: Text({ bold: true, children: row.name.padEnd(nameWidth) }),
        }),
        Box({
          flexShrink: 0,
          children: Text({ dimColor: true, children: row.version.padEnd(versionWidth) }),
        }),
        Box({
          flexShrink: 1,
          children: Text({ color: row.color, children: row.detail }),
        }),
      ],
    }),
  )
  const summary = Box({
    key: 'summary',
    children: Text({
      color: isAllWell(report) ? 'success' : 'warning',
      children: summaryOf(report),
    }),
  })
  return Box({ flexDirection: 'column', children: [...drawn, summary] })
}
