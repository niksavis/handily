import type { TextProps } from 'claude-code'
import { displayWidth, fitted } from './width'

export type Ink = 'plain' | 'line' | 'head' | 'label' | number

export type Looks = { isBold: boolean; isItalic: boolean; isUnderline: boolean }

export const PLAIN_LOOKS: Looks = { isBold: false, isItalic: false, isUnderline: false }

export type LookedRun = { text: string; looks: Looks }

export type Label = { text: string; runs: LookedRun[] }

export type InkRun = { text: string; ink: Ink; looks: Looks }

export type InkedCell = { glyph: string; ink: Ink; looks: Looks }

export const BLANK: InkedCell = { glyph: ' ', ink: 'plain', looks: PLAIN_LOOKS }

type LookFlag = keyof Looks

const LOOK_FLAGS: readonly LookFlag[] = ['isBold', 'isItalic', 'isUnderline']

const LABEL_MARKS: readonly { flag: LookFlag; pattern: RegExp }[] = [
  { flag: 'isUnderline', pattern: /<u>(.+?)<\/u>/dgi },
  { flag: 'isBold', pattern: /(?<!\*)\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*(?!\*)/dg },
  {
    flag: 'isItalic',
    pattern: /(?<=^|[^\p{L}\p{N}_])_([^\s_](?:[^_]*[^\s_])?)_(?![\p{L}\p{N}_])/dgu,
  },
]

export function sameLooks(one: Looks, other: Looks): boolean {
  return LOOK_FLAGS.every((flag) => one[flag] === other[flag])
}

export function textPropsOf(looks: Looks): Pick<TextProps, 'bold' | 'italic' | 'underline'> {
  return {
    ...(looks.isBold ? { bold: true } : {}),
    ...(looks.isItalic ? { italic: true } : {}),
    ...(looks.isUnderline ? { underline: true } : {}),
  }
}

function addLookedRun(runs: LookedRun[], text: string, looks: Looks): void {
  const last = runs.at(-1)
  const joinsLast = last !== undefined && (displayWidth(text) === 0 || sameLooks(last.looks, looks))
  if (joinsLast) last.text += text
  else runs.push({ text, looks })
}

export function plainLabel(text: string): Label {
  return { text, runs: text === '' ? [] : [{ text, looks: PLAIN_LOOKS }] }
}

export function markedLabel(line: string): Label {
  const hidden = new Set<number>()
  const looks = Array.from({ length: line.length }, () => ({ ...PLAIN_LOOKS }))
  for (const { flag, pattern } of LABEL_MARKS) {
    for (const found of line.matchAll(pattern)) {
      const [from, to] = found.indices?.[1] ?? [found.index, found.index]
      const end = found.index + found[0].length
      for (let at = found.index; at < from; at++) hidden.add(at)
      for (let at = to; at < end; at++) hidden.add(at)
      for (let at = from; at < to; at++) {
        const look = looks[at]
        if (look !== undefined) look[flag] = true
      }
    }
  }
  const runs: LookedRun[] = []
  let at = 0
  for (const point of line) {
    if (!hidden.has(at)) addLookedRun(runs, point, looks[at] ?? PLAIN_LOOKS)
    at += point.length
  }
  return { text: runs.map((run) => run.text).join(''), runs }
}

export function relabelled(source: Label, lines: readonly string[]): Label[] {
  const points = source.runs.flatMap((run) =>
    Array.from(run.text, (point) => ({ point, looks: run.looks })),
  )
  let at = 0
  return lines.map((line) => {
    const runs: LookedRun[] = []
    for (const point of line) {
      if (point !== ' ') while (points[at]?.point === ' ') at += 1
      const found = points[at]
      const isFound = found?.point === point
      addLookedRun(runs, point, isFound ? found.looks : PLAIN_LOOKS)
      if (isFound) at += 1
    }
    return { text: line, runs }
  })
}

export function fittedLabel(label: Label, width: number): Label {
  const [cut] = relabelled(label, [fitted(label.text, width)])
  return cut ?? label
}

export function prefixed(prefix: string, label: Label): Label {
  return { text: prefix + label.text, runs: [...plainLabel(prefix).runs, ...label.runs] }
}

export function textsOf(labels: readonly Label[]): string[] {
  return labels.map((label) => label.text)
}

export function inkRunsOf(cells: Iterable<InkedCell>): InkRun[] {
  const runs: InkRun[] = []
  for (const { glyph, ink, looks } of cells) {
    const last = runs.at(-1)
    if (last?.ink === ink && sameLooks(last.looks, looks)) last.text += glyph
    else runs.push({ text: glyph, ink, looks })
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
