import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  RenderElement,
  TextProps,
  UiPressArgument,
} from 'claude-code'
import { displayWidth, fitted } from './width'

export const BUTTON_CHROME = 4
export const BUTTON_GAP = 1

export type ButtonSpec = { key: string; label: string; onPress: (e: UiPressArgument) => void }

type RowElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

function widthOf(spec: ButtonSpec): number {
  return displayWidth(spec.label) + BUTTON_CHROME
}

function packed(specs: readonly ButtonSpec[], room: number): ButtonSpec[][] {
  const rows: ButtonSpec[][] = []
  let row: ButtonSpec[] = []
  let used = 0
  for (const spec of specs) {
    const width = widthOf(spec)
    if (row.length > 0 && used + BUTTON_GAP + width > room) {
      rows.push(row)
      row = []
      used = 0
    }
    used += (row.length === 0 ? 0 : BUTTON_GAP) + width
    row.push(spec)
  }
  if (row.length > 0) rows.push(row)
  return rows
}

export function buttonRows(
  elements: RowElements,
  specs: readonly ButtonSpec[],
  layout: { room: number; indent: number; key: string },
): RenderElement[] {
  const { Box, Text, Button } = elements
  const labelRoom = Math.max(layout.room - BUTTON_CHROME, 1)
  return packed(specs, layout.room).map((row, index) =>
    Box({
      key: `${layout.key}:${String(index)}`,
      flexDirection: 'row',
      paddingLeft: layout.indent,
      children: row.flatMap((spec, at) => [
        ...(at === 0 ? [] : [Text({ children: ' ' })]),
        Button({ key: spec.key, label: fitted(spec.label, labelRoom), onPress: spec.onPress }),
      ]),
    }),
  )
}
