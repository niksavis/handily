import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const WIDTH_MODS = ['handily-board', 'handily-reply-view', 'handily-simple-view']

const CASES = [
  { name: 'the empty text', text: '', columns: 0 },
  { name: 'an ASCII letter', text: 'a', columns: 1 },
  { name: 'an ASCII word', text: 'width', columns: 5 },
  { name: 'a box drawing rule', text: '\u{2500}', columns: 1 },
  { name: 'a CJK ideograph', text: '\u{4E2D}', columns: 2 },
  { name: 'two CJK ideographs', text: '\u{6F22}\u{5B57}', columns: 4 },
  { name: 'a Hangul syllable', text: '\u{D55C}', columns: 2 },
  { name: 'a fullwidth letter', text: '\u{FF21}', columns: 2 },
  { name: 'a CJK compatibility ideograph', text: '\u{F900}', columns: 2 },
  { name: 'a Latin Extended-D letter', text: '\u{A733}', columns: 1 },
  { name: 'a private use character', text: '\u{E000}', columns: 1 },
  { name: 'a letter with a combining accent', text: 'e\u{301}', columns: 1 },
  { name: 'a combining accent alone', text: '\u{301}', columns: 0 },
  { name: 'a zero-width space', text: '\u{200B}', columns: 0 },
  { name: 'an emoji with emoji presentation', text: '\u{1F525}', columns: 2 },
  { name: 'the high voltage emoji', text: '\u{26A1}', columns: 2 },
  { name: 'the technologist ZWJ sequence', text: '\u{1F469}\u{200D}\u{1F4BB}', columns: 2 },
  {
    name: 'the family ZWJ sequence',
    text: '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
    columns: 2,
  },
  { name: 'the Austrian flag pair', text: '\u{1F1E6}\u{1F1F9}', columns: 2 },
  { name: 'a thumbs up with a skin tone', text: '\u{1F44D}\u{1F3FD}', columns: 2 },
  { name: 'the warning sign with VS16', text: '\u{26A0}\u{FE0F}', columns: 2 },
  { name: 'the hammer and wrench with VS16', text: '\u{1F6E0}\u{FE0F}', columns: 2 },
  { name: 'the keycap one', text: '1\u{FE0F}\u{20E3}', columns: 2 },
  { name: 'the warning sign without VS16', text: '\u{26A0}', columns: 1 },
  { name: 'the thermometer without VS16', text: '\u{1F321}', columns: 1 },
  { name: 'a ZWJ sequence between letters', text: 'a\u{1F469}\u{200D}\u{1F4BB}b', columns: 4 },
]

function columnsText(columns) {
  return `${String(columns)} ${columns === 1 ? 'column' : 'columns'}`
}

function widthPath(mod) {
  return join(root, 'mods', mod, 'hooks', 'width.ts')
}

async function displayWidthOf(mod) {
  const path = widthPath(mod)
  assert.ok(existsSync(path), `mods/${mod}/hooks/width.ts is missing; each mod keeps its copy`)
  const { displayWidth } = await import(pathToFileURL(path).href)
  assert.equal(
    typeof displayWidth,
    'function',
    `mods/${mod}/hooks/width.ts exports no displayWidth function`,
  )
  return displayWidth
}

describe('the width of a grapheme', () => {
  test('lists every mod that keeps a hooks/width.ts', () => {
    const keepers = readdirSync(join(root, 'mods')).filter((mod) => existsSync(widthPath(mod)))
    const unlisted = keepers.filter((mod) => !WIDTH_MODS.includes(mod))
    assert.deepEqual(
      unlisted,
      [],
      `scripts/width.test.mjs does not list ${unlisted.map((mod) => `mods/${mod}/hooks/width.ts`).join(', ')}; add the mod to WIDTH_MODS`,
    )
    assert.deepEqual(keepers.sort(), [...WIDTH_MODS].sort())
  })

  for (const mod of WIDTH_MODS) {
    for (const { name, text, columns } of CASES) {
      test(`${mod} measures ${name} as ${columnsText(columns)}`, async () => {
        const displayWidth = await displayWidthOf(mod)
        assert.equal(
          displayWidth(text),
          columns,
          `${mod} measures ${name} as ${columnsText(displayWidth(text))}, not ${columnsText(columns)}`,
        )
      })
    }
  }
})
