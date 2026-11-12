import type { Color, RenderElement } from 'claude-code'
import type { ReplyElements } from './draw'

export const REPLY_STYLES = ['off', 'frame'] as const

export type ReplyStyle = (typeof REPLY_STYLES)[number]

export const DEFAULT_REPLY_STYLE: ReplyStyle = 'off'

export const FRAME_COLUMNS = '│  │'.length

export type FrameLook = { color: Color | undefined; isFirstOfReply: boolean }

const FRAME_COLUMNS_AT_LEAST = 40
const FRAME_BORDER = 'round'
const FRAME_PADDING = 1
const LABEL = ' ● Claude '
const LABEL_LEFT = '╭─'.length

export function isReplyStyle(value: unknown): value is ReplyStyle {
  return REPLY_STYLES.some((style) => style === value)
}

export function shownReplyStyle(style: ReplyStyle, columns: number): ReplyStyle {
  return style === 'frame' && columns < FRAME_COLUMNS_AT_LEAST ? 'off' : style
}

function frameLabel(elements: Pick<ReplyElements, 'Box' | 'Text'>, color: Color | undefined) {
  const { Box, Text } = elements
  return Box({
    position: 'absolute',
    top: 0,
    left: LABEL_LEFT,
    children: Text({ ...(color === undefined ? {} : { color }), children: LABEL }),
  })
}

export function framedReply(
  elements: Pick<ReplyElements, 'Box' | 'Text'>,
  look: FrameLook,
  body: RenderElement,
): RenderElement {
  const { Box } = elements
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'column',
        borderStyle: FRAME_BORDER,
        ...(look.color === undefined ? {} : { borderColor: look.color }),
        paddingX: FRAME_PADDING,
        children: body,
      }),
      look.isFirstOfReply ? frameLabel(elements, look.color) : null,
    ],
  })
}
