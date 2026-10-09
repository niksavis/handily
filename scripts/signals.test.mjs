import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const SIGNAL_MODS = ['handily-task-pane', 'handily-agent-board', 'handily-session-board']

const APPROVED = {
  doing: { name: 'Doing', mark: '▶', color: 'claude' },
  done: { name: 'Done', mark: '✓', color: 'success' },
  toDo: { name: 'To do', mark: '○', color: 'subtle' },
  blocked: { name: 'Blocked', mark: '■', color: 'error' },
  waitsForYou: { name: 'Waits for you', mark: '◆', color: 'warning' },
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
  pathToFileURL(join(root, 'mods', 'handily-task-pane', 'hooks', 'width.ts')).href
)

describe('the table of signals', () => {
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
