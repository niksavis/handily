import { MOST_ROWS, shown } from './flowchart'
import {
  drawingOf,
  inkRunsOf,
  plainLabel,
  relabelled,
  type Ink,
  type InkedCell,
  type InkedDrawing,
  type InkRun,
  type Label,
  type Looks,
} from './ink'
import type { Refusal } from './mermaid'
import { wrapCell } from './table'
import { graphemesOf } from './width'

export type Part = { label: Label; ink: Ink }

export function part(text: string, ink: Ink): Part {
  return { label: plainLabel(text), ink }
}

export function wrappedLabel(label: Label, width: number): Label[] {
  return relabelled(label, wrapCell(label.text, Math.max(width, 1)))
}

export function withLooks(label: Label, looks: Partial<Looks>): Label {
  return {
    text: label.text,
    runs: label.runs.map((run) => ({ ...run, looks: { ...run.looks, ...looks } })),
  }
}

export function inkedLine(parts: readonly Part[]): InkRun[] {
  const cells: InkedCell[] = parts.flatMap(({ label, ink }) =>
    label.runs.flatMap((run) =>
      graphemesOf(run.text).map((glyph) => ({ glyph, ink, looks: run.looks })),
    ),
  )
  return inkRunsOf(cells)
}

export function titleLines(title: string | null, width: number): InkRun[][] {
  const text = shown(title ?? '').trim()
  if (text === '') return []
  return wrappedLabel(withLooks(plainLabel(text), { isBold: true }), width).map((line) =>
    inkedLine([{ label: line, ink: 'plain' }]),
  )
}

export function drawnOutline(lines: InkRun[][]): InkedDrawing | Refusal {
  if (lines.length <= MOST_ROWS) return drawingOf(lines)
  return {
    kind: 'refused',
    reason: `${String(lines.length)} rows, at most ${String(MOST_ROWS)} draw`,
    line: null,
    limit: null,
  }
}
