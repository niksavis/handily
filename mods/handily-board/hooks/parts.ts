import type { RenderElement, ThemeKey } from 'claude-code'
import type { PaneElements } from './pane'
import { displayWidth, fitted } from './width'

export const PART_LEAD = ' · '

export type Part = { text: string; color?: ThemeKey }

function partsWidth(parts: readonly Part[], lead: string): number {
  return displayWidth(parts.map((part) => part.text).join(lead))
}

function wrappedParts(parts: readonly Part[], room: number, lead: string): Part[][] {
  const lines: Part[][] = []
  for (const part of parts) {
    const current = lines.at(-1)
    if (current !== undefined && partsWidth([...current, part], lead) <= room) current.push(part)
    else lines.push([part])
  }
  return lines
}

function partsLine(
  elements: PaneElements,
  key: string,
  parts: readonly Part[],
  room: number,
  lead: string,
): RenderElement {
  const { Box, Text } = elements
  return Box({
    key,
    flexDirection: 'row',
    children: parts.flatMap((part, at) => [
      at === 0 ? null : Text({ dimColor: true, children: lead }),
      part.color === undefined
        ? Text({ dimColor: true, children: fitted(part.text, room) })
        : Text({ color: part.color, children: fitted(part.text, room) }),
    ]),
  })
}

export function fitParts<T extends { text: string }>(parts: readonly T[], columns: number): T[] {
  let room = columns
  const kept: T[] = []
  for (const part of parts) {
    if (room <= 0) break
    const text = fitted(part.text, room)
    room -= displayWidth(text)
    kept.push({ ...part, text })
  }
  return kept
}

export function drawPartLines(
  elements: PaneElements,
  key: string,
  parts: readonly Part[],
  room: number,
  lead = PART_LEAD,
): RenderElement[] {
  return wrappedParts(parts, room, lead).map((line, index) =>
    partsLine(elements, `${key}:${String(index)}`, line, room, lead),
  )
}

export type FitLine = { key: string; fit: (room: number) => readonly Part[] }

export function spansWidth(parts: readonly Part[]): number {
  return displayWidth(parts.map((part) => part.text).join(''))
}

export function firstFitting(room: number, forms: readonly (readonly Part[])[]): Part[] {
  const fitting = forms.find((form) => spansWidth(form) <= room)
  return fitting === undefined ? fitParts(forms.at(-1) ?? [], room) : [...fitting]
}

export function fitLineText(line: FitLine): string {
  return line
    .fit(Number.POSITIVE_INFINITY)
    .map((part) => part.text)
    .join('')
}

export function drawFitLine(elements: PaneElements, line: FitLine, room: number): RenderElement {
  const { Box, Text } = elements
  return Box({
    key: line.key,
    flexDirection: 'row',
    children: line
      .fit(room)
      .map((part) =>
        part.color === undefined
          ? Text({ dimColor: true, children: part.text })
          : Text({ color: part.color, children: part.text }),
      ),
  })
}
