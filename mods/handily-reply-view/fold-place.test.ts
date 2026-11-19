import { describe, expect, test, type Engine } from 'claude-code/testing'
import { fenced, mountReply, scenesAt, started, together, type Surface } from './fixtures/layout'
import { sketchOf } from './fixtures/sketch'

const SURFACES: readonly Surface[] = ['terminal', 'desktop']
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'

function token(index: number): string {
  return `q${LETTERS.charAt(Math.floor(index / LETTERS.length))}${LETTERS.charAt(index % LETTERS.length)}`
}

function tokens(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => token(from + index))
}

function proseOf(words: readonly string[]): string {
  return words.map((word) => `- ${word}`).join('\n')
}

function tableOf(words: readonly string[]): string {
  return ['| Name |', '| --- |', ...words.map((word) => `| ${word} |`)].join('\n')
}

function flowOf(count: number): string {
  return [
    'flowchart TD',
    ...Array.from(
      { length: count - 1 },
      (_, index) =>
        `  N${String(index)}[${token(index)}] --> N${String(index + 1)}[${token(index + 1)}]`,
    ),
  ].join('\n')
}

type Fold = { folded: string[]; opened: string[]; at: number; buttonKeys: string[] }

async function foldOf($: Engine, text: string, surface: Surface, columns: number): Promise<Fold> {
  const ui = await mountReply($, text, surface, columns)
  const folded = sketchOf(await ui.drawn(), columns)
  await ui.press({ key: 'fold' })
  const opened = sketchOf(await ui.drawn(), columns)
  const buttonKeys = (await ui.findAll({ type: 'Button' })).map((button) => button.key ?? '')
  await ui.unmount()
  return { folded, opened, at: folded.findIndex((line) => line.includes('▸ ')), buttonKeys }
}

function expectSamePlace(fold: Fold): void {
  expect(fold.at).toBeGreaterThan(0)
  expect(fold.opened.findIndex((line) => line.includes('▾ '))).toBe(fold.at)
  expect(fold.opened.slice(0, fold.at)).toEqual(fold.folded.slice(0, fold.at))
  const more = fold.folded.findIndex((line) => line.includes('[ more ]'))
  const less = fold.opened.findIndex((line) => line.includes('[ less ]'))
  expect(less).toBe(more)
  expect(new Set(fold.buttonKeys).size).toBe(fold.buttonKeys.length)
}

function countOf(lines: readonly string[], word: string): number {
  return lines
    .join(' ')
    .split(/[^a-z]+/)
    .filter((part) => part === word).length
}

function expectEachOnce(lines: readonly string[], words: readonly string[]): void {
  expect(words.filter((word) => countOf(lines, word) !== 1)).toEqual([])
}

function belowCount(fold: Fold): number {
  const row = fold.opened[fold.at] ?? ''
  return Number(/▾ (\d+) more lines?/.exec(row)?.[1] ?? NaN)
}

describe('the reply fold keeps the pressed button at its line', () => {
  for (const surface of SURFACES) {
    for (const columns of [80, 18]) {
      const scene = `at ${String(columns)} columns on ${surface}`

      test(`a fold inside prose draws every hidden line once under the fold row ${scene}`, async ($, on) => {
        await started($, on, { surface })
        const words = tokens(0, 45)
        const fold = await foldOf($, proseOf(words), surface, columns)
        expectSamePlace(fold)
        expectEachOnce(fold.opened, words)
      })

      test(`a fold inside one long paragraph goes on with the next word under the fold row ${scene}`, async ($, on) => {
        await started($, on, { surface })
        const head = tokens(0, 28)
        const paragraph = tokens(100, 120)
        const text = `${proseOf(head)}\n\n${paragraph.join(' ')}`
        const fold = await foldOf($, text, surface, columns)
        expectSamePlace(fold)
        expectEachOnce(fold.opened, [...head, ...paragraph])
      })

      test(`a fold inside a table draws the hidden rows once under the fold row ${scene}`, async ($, on) => {
        await started($, on, { surface })
        const intro = tokens(0, 10)
        const rows = tokens(200, 40)
        const fold = await foldOf($, together(proseOf(intro), tableOf(rows)), surface, columns)
        expectSamePlace(fold)
        expectEachOnce(fold.opened, [...intro, ...rows])
      })

      test(`a fold inside a code block goes on with the next code line ${scene}`, async ($, on) => {
        await started($, on, { surface })
        const intro = tokens(0, 20)
        const code = tokens(300, 12)
        const source = code.map((word) => `echo ${word}`).join('\n')
        const fold = await foldOf(
          $,
          together(proseOf(intro), fenced('sh', source)),
          surface,
          columns,
        )
        expectSamePlace(fold)
        expectEachOnce(fold.opened, [...intro, ...code])
      })

      test(`a fold inside a diagram draws its other rows under the fold row with no second title ${scene}`, async ($, on) => {
        await started($, on, { surface })
        const intro = tokens(400, 5)
        const text = together(proseOf(intro), fenced('mermaid', flowOf(24)))
        const fold = await foldOf($, text, surface, columns)
        expectSamePlace(fold)
        expectEachOnce(fold.opened, intro)
        if (columns >= 80) expect(fold.folded[fold.at]).toContain('▸ flowchart, ')
        expect(fold.opened.length).toBeGreaterThan(fold.folded.length)
      })
    }

    test(`the count of lines below matches the lines under the fold row in prose on ${surface}`, async ($, on) => {
      await started($, on, { surface })
      const fold = await foldOf($, proseOf(tokens(0, 45)), surface, 80)
      expect(fold.opened.length - fold.at - 1).toBe(belowCount(fold))
    })
  }

  for (const scene of scenesAt(130)) {
    test(
      `a fold inside a shared row keeps the row above the fold row and draws its rest under it, ${scene.name}`,
      { options: { ...scene.options, sideBySide: 'on' } },
      async ($, on) => {
        await started($, on)
        const rows = tokens(500, 40)
        const text = together(tableOf(rows), fenced('mermaid', flowOf(24)))
        const fold = await foldOf($, text, 'terminal', scene.columns)
        expectSamePlace(fold)
        expectEachOnce(fold.opened, rows)
      },
    )
  }
})
