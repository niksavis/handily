import type { RenderElement } from 'claude-code'
import type { ReplyElements } from './draw'

const RULE = '─'
const LABEL = 'you'
const MARKER = '❯'
const MARKER_COLUMNS = 2

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
    key: 'prompt-rule',
    flexDirection: 'row',
    children: [
      Box({
        flexShrink: 0,
        children: Text({
          dimColor: true,
          children: `${RULE.repeat(2)} ${labelOf(submittedAt)} `,
        }),
      }),
      Box({
        flexGrow: 1,
        height: 1,
        overflow: 'hidden',
        children: Text({ dimColor: true, children: RULE.repeat(columns) }),
      }),
    ],
  })
}

export function promptTree(
  elements: ReplyElements,
  text: string,
  columns: number,
  submittedAt: number | undefined,
): RenderElement {
  const { Box, Text } = elements
  return Box({
    flexDirection: 'column',
    children: [
      promptRule(elements, columns, submittedAt),
      Box({
        key: 'prompt-text',
        flexDirection: 'row',
        children: [
          Box({
            width: MARKER_COLUMNS,
            flexShrink: 0,
            children: Text({ dimColor: true, children: MARKER }),
          }),
          Box({ flexGrow: 1, flexShrink: 1, children: Text({ bold: true, children: text }) }),
        ],
      }),
    ],
  })
}
