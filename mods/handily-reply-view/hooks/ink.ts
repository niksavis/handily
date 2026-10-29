export type Ink = 'plain' | 'line' | 'head' | 'label' | number

export type InkRun = { text: string; ink: Ink }

export type InkedCell = { glyph: string; ink: Ink }

export const BLANK: InkedCell = { glyph: ' ', ink: 'plain' }

export function inkRunsOf(cells: Iterable<InkedCell>): InkRun[] {
  const runs: InkRun[] = []
  for (const { glyph, ink } of cells) {
    const last = runs.at(-1)
    if (last?.ink === ink) last.text += glyph
    else runs.push({ text: glyph, ink })
  }
  for (let last = runs.at(-1); last !== undefined; last = runs.at(-1)) {
    last.text = last.text.trimEnd()
    if (last.text !== '') break
    runs.pop()
  }
  return runs
}

export type InkedDrawing = { kind: 'drawing'; lines: string[]; inked: InkRun[][] }

function textOfInkRuns(runs: readonly InkRun[]): string {
  return runs.map((run) => run.text).join('')
}

export function drawingOf(inked: InkRun[][]): InkedDrawing {
  return { kind: 'drawing', lines: inked.map(textOfInkRuns), inked }
}
