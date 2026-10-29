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
