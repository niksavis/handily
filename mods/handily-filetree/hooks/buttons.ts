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

export type ButtonSpec = {
  key: string
  label: string
  hotkey?: string
  autoFocus?: true
  onPress: (e: UiPressArgument) => void
}

export type RowTail = { children: readonly RenderElement[]; width: number }

type RowElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

function widthOf(spec: ButtonSpec): number {
  return displayWidth(spec.label) + BUTTON_CHROME
}

export function rowWidth(specs: readonly ButtonSpec[]): number {
  return specs.reduce((sum, spec, at) => sum + (at === 0 ? 0 : BUTTON_GAP) + widthOf(spec), 0)
}

export function buttonOf(
  Button: RowElements['Button'],
  spec: ButtonSpec,
  labelRoom: number,
): RenderElement {
  const hotkey = spec.hotkey === undefined ? {} : { hotkey: spec.hotkey }
  const focus = spec.autoFocus === undefined ? {} : { autoFocus: spec.autoFocus }
  return Button({
    key: spec.key,
    label: fitted(spec.label, labelRoom),
    ...hotkey,
    ...focus,
    onPress: spec.onPress,
  })
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

function isBeside(row: readonly ButtonSpec[] | undefined, tail: RowTail, room: number): boolean {
  return row !== undefined && rowWidth(row) + BUTTON_GAP + tail.width <= room
}

export function buttonRows(
  elements: RowElements,
  specs: readonly ButtonSpec[],
  layout: { room: number; indent: number; key: string; tail?: RowTail },
): RenderElement[] {
  const { Box, Text, Button } = elements
  const { room, tail } = layout
  const labelRoom = Math.max(room - BUTTON_CHROME, 1)
  const rows = packed(specs, room)
  const drawn = rows.map((row) =>
    row.flatMap((spec, at) => [
      ...(at === 0 ? [] : [Text({ children: ' ' })]),
      buttonOf(Button, spec, labelRoom),
    ]),
  )
  if (tail !== undefined) {
    const last = drawn.at(-1)
    if (last !== undefined && isBeside(rows.at(-1), tail, room)) {
      last.push(Text({ children: ' ' }), ...tail.children)
    } else {
      drawn.push([...tail.children])
    }
  }
  return drawn.map((children, index) =>
    Box({
      key: `${layout.key}:${String(index)}`,
      flexDirection: 'row',
      paddingLeft: layout.indent,
      children,
    }),
  )
}
