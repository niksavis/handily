import type { Color, RenderElement } from 'claude-code'
import type { ReplyElements } from './draw'

const RULE = '─'
const LABEL = 'you'
const RULE_COLOR: Color = 'suggestion'

export function clockTime(at: number): string {
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')}`
}

function labelOf(submittedAt: number | undefined): string {
  return submittedAt === undefined ? LABEL : `${LABEL} · ${clockTime(submittedAt)}`
}

function promptRule(elements: ReplyElements, columns: number, submittedAt: number | undefined) {
  const { Box, Text } = elements
  return Box({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    flexDirection: 'row',
    children: [
      Box({
        flexShrink: 0,
        children: Text({
          color: RULE_COLOR,
          children: `${RULE.repeat(2)} ${labelOf(submittedAt)} `,
        }),
      }),
      Box({
        flexGrow: 1,
        height: 1,
        overflow: 'hidden',
        children: Text({ color: RULE_COLOR, children: RULE.repeat(columns) }),
      }),
    ],
  })
}

export function framedPrompt(
  elements: ReplyElements,
  engineRow: RenderElement,
  columns: number,
  submittedAt: number | undefined,
): RenderElement {
  const { Box } = elements
  return Box({
    flexDirection: 'column',
    marginTop: 1,
    children: [promptRule(elements, columns, submittedAt), engineRow],
  })
}
