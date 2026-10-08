import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { HandilyModState, HandilyModStatus } from '../types'
import { summaryOf } from './status'

type ReportElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

const STATE_COLOR: Record<HandilyModState, ThemeKey> = {
  loaded: 'success',
  disabled: 'error',
  'not installed': 'error',
  'not loaded': 'warning',
}

function widest(texts: readonly string[]): number {
  return Math.max(0, ...texts.map((text) => text.length))
}

export function drawReport(
  { Box, Text }: ReportElements,
  statuses: readonly HandilyModStatus[],
): RenderElement {
  const nameWidth = widest(statuses.map((status) => status.name))
  const versionWidth = widest(statuses.map((status) => status.version ?? ''))
  const rows = statuses.map((status) =>
    Box({
      key: status.name,
      flexDirection: 'row',
      gap: 2,
      children: [
        Box({
          flexShrink: 0,
          children: Text({ bold: true, children: status.name.padEnd(nameWidth) }),
        }),
        Box({
          flexShrink: 0,
          children: Text({ dimColor: true, children: (status.version ?? '').padEnd(versionWidth) }),
        }),
        Box({
          flexShrink: 1,
          children: Text({ color: STATE_COLOR[status.state], children: status.detail }),
        }),
      ],
    }),
  )
  const isEveryModLoaded = statuses.every((status) => status.state === 'loaded')
  const summary = Box({
    key: 'summary',
    children: Text({
      color: isEveryModLoaded ? 'success' : 'warning',
      children: summaryOf(statuses),
    }),
  })
  return Box({ flexDirection: 'column', children: [...rows, summary] })
}
