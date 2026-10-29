import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { GLYPHS } from './fixtures/glyphs.mjs'
import { APPROVED } from './fixtures/signals.mjs'

const root = join(import.meta.dirname, '..')
const SIGNAL_MODS = ['handily-board']
const SIGNALS_HEADER = '| Signal | Kanban meaning | Mark | Nerd | Colour | When the pane shows it |'

function codePointText(code) {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
}

function nerdCells(design) {
  const lines = design.split('\n')
  const start = lines.indexOf(SIGNALS_HEADER)
  if (start === -1) return null
  const column = SIGNALS_HEADER.split('|')
    .map((cell) => cell.trim())
    .indexOf('Nerd')
  const cells = {}
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    const row = line.split('|').map((cell) => cell.trim())
    cells[row[1]] = row[column]
  }
  return cells
}

function approvedNerdCells() {
  return Object.fromEntries(
    Object.entries(APPROVED).map(([state, { name }]) => [
      name,
      `\`${codePointText(GLYPHS[state].nerd)}\` ${GLYPHS[state].nerdName}`,
    ]),
  )
}

function signalsOnly(cells) {
  return Object.fromEntries(Object.keys(approvedNerdCells()).map((name) => [name, cells[name]]))
}

function signalsPath(mod) {
  return join(root, 'mods', mod, 'hooks', 'signals.ts')
}

async function tableOf(mod) {
  const path = signalsPath(mod)
  assert.ok(existsSync(path), `mods/${mod}/hooks/signals.ts is missing; each mod keeps the table`)
  const { SIGNALS } = await import(pathToFileURL(path).href)
  return SIGNALS
}

const { displayWidth } = await import(
  pathToFileURL(join(root, 'mods', 'handily-board', 'hooks', 'width.ts')).href
)

describe('the table of signals', () => {
  test('compares the signals table of every mod that keeps one, which is handily-board only', () => {
    const keepers = readdirSync(join(root, 'mods')).filter((mod) => existsSync(signalsPath(mod)))
    assert.deepEqual(keepers.sort(), [...SIGNAL_MODS].sort())
  })

  for (const mod of SIGNAL_MODS) {
    test(`${mod} draws each state with the approved mark and theme colour`, async () => {
      const table = await tableOf(mod)
      const approved = Object.fromEntries(
        Object.entries(APPROVED).map(([state, { mark, color }]) => [state, { mark, color }]),
      )
      assert.deepEqual(table, approved)
    })
  }

  test('no two mods draw the same state with a different mark or colour', async () => {
    const tables = await Promise.all(SIGNAL_MODS.map(async (mod) => [mod, await tableOf(mod)]))
    const [first, ...rest] = tables
    for (const [mod, table] of rest) {
      for (const state of Object.keys({ ...first[1], ...table })) {
        assert.deepEqual(
          table[state],
          first[1][state],
          `${mod} draws ${state} as ${JSON.stringify(table[state])}, ${first[0]} as ${JSON.stringify(first[1][state])}`,
        )
      }
    }
  })

  test('docs/design.md names the approved mark of each state', () => {
    const design = readFileSync(join(root, 'docs', 'design.md'), 'utf8').split('\n')
    for (const { name, mark } of Object.values(APPROVED)) {
      const rows = design.filter((line) => line.startsWith(`| ${name} |`))
      assert.ok(rows.length > 0, `docs/design.md has no table row for ${name}`)
      assert.ok(
        rows.some((row) => row.includes(`\`${mark}\``)),
        `no docs/design.md row of ${name} shows ${mark}`,
      )
    }
  })

  test('the plain glyph of each signal is its approved mark', () => {
    for (const [state, { mark }] of Object.entries(APPROVED)) {
      assert.equal(
        GLYPHS[state]?.plain,
        mark,
        `scripts/fixtures/glyphs.mjs pins ${state} plain as ${GLYPHS[state]?.plain}, not ${mark}`,
      )
    }
  })

  test('the Nerd column of the signals table in docs/design.md gives the pinned icon of each signal', () => {
    const cells = nerdCells(readFileSync(join(root, 'docs', 'design.md'), 'utf8'))
    assert.ok(
      cells !== null,
      `docs/design.md has no signals table with the header ${SIGNALS_HEADER}`,
    )
    assert.deepEqual(signalsOnly(cells), approvedNerdCells())
  })

  test('names a Nerd cell that differs from the pinned icon', () => {
    const design = [
      SIGNALS_HEADER,
      '| --- | --- | --- | --- | --- | --- |',
      '| Doing | in progress | `▶` | `U+EB2C` nf-cod-play | orange | a running agent |',
      '| Done | finished | `✓` | `U+EAB3` nf-cod-check | green | done tasks |',
      '',
    ].join('\n')
    const cells = signalsOnly(nerdCells(design))
    assert.equal(cells.Doing, approvedNerdCells().Doing)
    assert.notEqual(cells.Done, approvedNerdCells().Done)
    assert.equal(cells['To do'], undefined)
  })
})

describe('the width of each mark', () => {
  for (const mod of SIGNAL_MODS) {
    test(`each mark of ${mod} is one column wide`, async () => {
      for (const [state, { mark }] of Object.entries(await tableOf(mod))) {
        assert.equal([...mark].length, 1, `${state} mark ${mark} is more than one character`)
        assert.equal(displayWidth(mark), 1, `${state} mark ${mark} is not one column wide`)
        assert.doesNotMatch(
          mark,
          /\p{Emoji_Presentation}/u,
          `${state} mark ${mark} draws as an emoji, two columns wide in most terminals`,
        )
      }
    })
  }

  test('the width rule counts an emoji as two columns', () => {
    assert.equal(displayWidth('🔥'), 2)
    assert.equal(displayWidth('\u26A1'), 2)
    assert.match('🔥', /\p{Emoji_Presentation}/u)
  })
})
