import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')

const WIDTH_EXPORTS = {
  'handily-board': ['cutToWidth', 'displayWidth', 'fitted', 'lastToWidth', 'padToWidth'],
  'handily-reply-view': ['cutToWidth', 'displayWidth', 'graphemesOf', 'isEmoji', 'padToWidth'],
  'handily-simple-view': ['displayWidth', 'graphemesOf', 'isEmoji'],
}
const WIDTH_MODS = Object.keys(WIDTH_EXPORTS)

const TECHNOLOGIST = '\u{1F469}\u{200D}\u{1F4BB}'
const FLAG = '\u{1F1E6}\u{1F1F9}'
const KEYCAP = '1\u{FE0F}\u{20E3}'
const ACCENTED = 'e\u{301}'
const CUT_MARK = '\u{2026}'

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
  { name: 'an ambiguous circled number on a black square', text: '\u{3248}', columns: 1 },
  { name: 'a letter with a combining accent', text: ACCENTED, columns: 1 },
  { name: 'a combining accent alone', text: '\u{301}', columns: 0 },
  { name: 'a zero-width space', text: '\u{200B}', columns: 0 },
  { name: 'an emoji with emoji presentation', text: '\u{1F525}', columns: 2 },
  { name: 'the high voltage emoji', text: '\u{26A1}', columns: 2 },
  { name: 'the technologist ZWJ sequence', text: TECHNOLOGIST, columns: 2 },
  {
    name: 'the family ZWJ sequence',
    text: '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
    columns: 2,
  },
  { name: 'the Austrian flag pair', text: FLAG, columns: 2 },
  { name: 'a lone regional indicator', text: '\u{1F1E6}', columns: 2 },
  { name: 'a thumbs up with a skin tone', text: '\u{1F44D}\u{1F3FD}', columns: 2 },
  { name: 'the warning sign with VS16', text: '\u{26A0}\u{FE0F}', columns: 2 },
  { name: 'the hammer and wrench with VS16', text: '\u{1F6E0}\u{FE0F}', columns: 2 },
  { name: 'the keycap one', text: KEYCAP, columns: 2 },
  { name: 'the warning sign without VS16', text: '\u{26A0}', columns: 1 },
  { name: 'the thermometer without VS16', text: '\u{1F321}', columns: 1 },
  { name: 'a ZWJ sequence between letters', text: `a${TECHNOLOGIST}b`, columns: 4 },
]

const WIDE_RANGES = [
  { name: 'Hangul Jamo leading consonants', first: 0x1100, last: 0x115f },
  { name: 'the angle brackets', first: 0x2329, last: 0x232a },
  { name: 'the trigrams', first: 0x2630, last: 0x2637 },
  { name: 'the digrams and monograms', first: 0x268a, last: 0x268f },
  { name: 'the CJK radicals to CJK punctuation', first: 0x2e80, last: 0x303e },
  { name: 'Hiragana to the enclosed CJK letters', first: 0x3041, last: 0x3247 },
  { name: 'the enclosed CJK letters to CJK compatibility', first: 0x3250, last: 0x33ff },
  { name: 'CJK Extension A to the unified ideographs', first: 0x3400, last: 0x9fff },
  { name: 'Yi', first: 0xa000, last: 0xa4cf },
  { name: 'Hangul Jamo Extended-A', first: 0xa960, last: 0xa97f },
  { name: 'the Hangul syllables', first: 0xac00, last: 0xd7a3 },
  { name: 'the CJK compatibility ideographs', first: 0xf900, last: 0xfaff },
  { name: 'the vertical forms', first: 0xfe10, last: 0xfe19 },
  { name: 'the CJK compatibility and small forms', first: 0xfe30, last: 0xfe6f },
  { name: 'the fullwidth forms', first: 0xff00, last: 0xff60 },
  { name: 'the fullwidth signs', first: 0xffe0, last: 0xffe6 },
  { name: 'the ideographic symbols to the Tangut supplement', first: 0x16fe0, last: 0x18d08 },
  { name: 'Kana Extended-B', first: 0x1aff0, last: 0x1affe },
  { name: 'the Kana supplements', first: 0x1b000, last: 0x1b2ff },
  { name: 'the Tai Xuan Jing symbols', first: 0x1d300, last: 0x1d356 },
  { name: 'the counting rod numerals', first: 0x1d360, last: 0x1d376 },
  { name: 'the enclosed ideographic supplement', first: 0x1f200, last: 0x1f2ff },
  { name: 'the supplementary ideographic plane', first: 0x20000, last: 0x2fffd },
  { name: 'the tertiary ideographic plane', first: 0x30000, last: 0x3fffd },
]

const CUT_CASES = {
  cutToWidth: [
    { name: 'keeps the letters that fit', args: ['abc', 2], result: 'ab' },
    {
      name: 'stops before a ZWJ sequence that does not fit',
      args: [`a${TECHNOLOGIST}b`, 2],
      result: 'a',
    },
    {
      name: 'keeps a whole ZWJ sequence',
      args: [`a${TECHNOLOGIST}b`, 3],
      result: `a${TECHNOLOGIST}`,
    },
    { name: 'never splits a keycap', args: [`${KEYCAP}x`, 1], result: '' },
    {
      name: 'keeps a combining accent with its letter',
      args: [`${ACCENTED}x`, 1],
      result: ACCENTED,
    },
    { name: 'stops before a wide ideograph', args: ['\u{4E2D}\u{6587}', 3], result: '\u{4E2D}' },
    { name: 'never splits a flag pair', args: [`${FLAG}${FLAG}`, 3], result: FLAG },
  ],
  lastToWidth: [
    { name: 'keeps the last letters that fit', args: ['abc', 2], result: 'bc' },
    { name: 'never keeps half of a keycap', args: [`ab${KEYCAP}`, 1], result: '' },
    { name: 'keeps a whole keycap', args: [`ab${KEYCAP}`, 2], result: KEYCAP },
    {
      name: 'keeps a whole ZWJ sequence',
      args: [`a${TECHNOLOGIST}b`, 3],
      result: `${TECHNOLOGIST}b`,
    },
    {
      name: 'keeps a combining accent with its letter',
      args: [`ab${ACCENTED}`, 1],
      result: ACCENTED,
    },
  ],
  padToWidth: [
    {
      name: 'pads a ZWJ sequence by its two columns',
      args: [TECHNOLOGIST, 4],
      result: `${TECHNOLOGIST}  `,
    },
    {
      name: 'pads a wide ideograph by its two columns',
      args: ['\u{4E2D}', 3],
      result: '\u{4E2D} ',
    },
    { name: 'leaves a text that is already wider', args: ['abc', 2], result: 'abc' },
  ],
  fitted: [
    { name: 'leaves a text that fits', args: ['abc', 3], result: 'abc' },
    { name: 'cuts a long text with the cut mark', args: ['abcdef', 4], result: `abc${CUT_MARK}` },
    {
      name: 'cuts between ZWJ sequences',
      args: [TECHNOLOGIST.repeat(3), 5],
      result: `${TECHNOLOGIST.repeat(2)}${CUT_MARK}`,
    },
  ],
  isEmoji: [
    { name: 'a ZWJ sequence is an emoji', args: [TECHNOLOGIST], result: true },
    { name: 'a keycap is an emoji', args: [KEYCAP], result: true },
    { name: 'a flag pair is an emoji', args: [FLAG], result: true },
    { name: 'the warning sign with VS16 is an emoji', args: ['\u{26A0}\u{FE0F}'], result: true },
    { name: 'the warning sign without VS16 is not an emoji', args: ['\u{26A0}'], result: false },
    { name: 'a digit is not an emoji', args: ['1'], result: false },
  ],
}

const GRAPHEME_CASES = [
  {
    name: 'a mixed text',
    text: `a${TECHNOLOGIST}${ACCENTED}${FLAG}${KEYCAP}\u{4E2D}`,
    parts: [
      ['a', 1],
      [TECHNOLOGIST, 2],
      [ACCENTED, 1],
      [FLAG, 2],
      [KEYCAP, 2],
      ['\u{4E2D}', 2],
    ],
  },
  { name: 'the empty text', text: '', parts: [] },
]

const SWEEP_LAST = 0x10ffff
const SWEEP_BLOCK = 256
const SURROGATES = { first: 0xd800, last: 0xdfff }
const ISOLATING_SEPARATOR = '\n'

function columnsText(columns) {
  return `${String(columns)} ${columns === 1 ? 'column' : 'columns'}`
}

function codePointText(code) {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
}

function widthPath(mod) {
  return join(root, 'mods', mod, 'hooks', 'width.ts')
}

async function widthModule(mod) {
  const path = widthPath(mod)
  assert.ok(existsSync(path), `mods/${mod}/hooks/width.ts is missing; each mod keeps its copy`)
  return import(pathToFileURL(path).href)
}

function codePointsOf(first, last) {
  const codes = []
  for (let code = first; code <= last; code += 1) {
    if (code < SURROGATES.first || code > SURROGATES.last) codes.push(code)
  }
  return codes
}

function blockText(codes) {
  return codes.map((code) => String.fromCodePoint(code)).join(ISOLATING_SEPARATOR)
}

function partsOf(graphemes) {
  return graphemes.map((part) => (typeof part === 'string' ? part : [part.grapheme, part.cells]))
}

describe('the width of a grapheme', () => {
  test('lists every mod that keeps a hooks/width.ts', () => {
    const keepers = readdirSync(join(root, 'mods')).filter((mod) => existsSync(widthPath(mod)))
    const unlisted = keepers.filter((mod) => !WIDTH_MODS.includes(mod))
    assert.deepEqual(
      unlisted,
      [],
      `scripts/width.test.mjs does not list ${unlisted.map((mod) => `mods/${mod}/hooks/width.ts`).join(', ')}; add the mod to WIDTH_EXPORTS`,
    )
    assert.deepEqual(keepers.sort(), [...WIDTH_MODS].sort())
  })

  for (const mod of WIDTH_MODS) {
    test(`${mod} exports exactly the width functions that the test compares`, async () => {
      const exported = Object.keys(await widthModule(mod)).sort()
      assert.deepEqual(
        exported,
        [...WIDTH_EXPORTS[mod]].sort(),
        `mods/${mod}/hooks/width.ts exports ${exported.join(', ')}; list each export in WIDTH_EXPORTS and give it cases`,
      )
    })

    for (const { name, text, columns } of CASES) {
      test(`${mod} measures ${name} as ${columnsText(columns)}`, async () => {
        const { displayWidth } = await widthModule(mod)
        assert.equal(
          displayWidth(text),
          columns,
          `${mod} measures ${name} as ${columnsText(displayWidth(text))}, not ${columnsText(columns)}`,
        )
      })
    }

    for (const { name, first, last } of WIDE_RANGES) {
      test(`${mod} measures the first and the last character of ${name} as 2 columns`, async () => {
        const { displayWidth } = await widthModule(mod)
        for (const code of [first, last]) {
          const columns = displayWidth(String.fromCodePoint(code))
          assert.equal(
            columns,
            2,
            `${mod} measures ${codePointText(code)} of ${name} as ${columnsText(columns)}, not 2 columns`,
          )
        }
      })
    }

    for (const exportName of WIDTH_EXPORTS[mod]) {
      for (const { name, args, result } of CUT_CASES[exportName] ?? []) {
        test(`${mod} ${exportName} ${name}`, async () => {
          const answer = (await widthModule(mod))[exportName](...args)
          assert.equal(
            answer,
            result,
            `${mod} ${exportName}(${JSON.stringify(args)}) gives ${JSON.stringify(answer)}, not ${JSON.stringify(result)}`,
          )
        })
      }
    }

    if (WIDTH_EXPORTS[mod].includes('graphemesOf')) {
      for (const { name, text, parts } of GRAPHEME_CASES) {
        test(`${mod} graphemesOf splits ${name} into whole graphemes`, async () => {
          const found = partsOf((await widthModule(mod)).graphemesOf(text))
          const expected = found.every((part) => typeof part === 'string')
            ? parts.map(([grapheme]) => grapheme)
            : parts
          assert.deepEqual(found, expected, `${mod} graphemesOf splits ${name} differently`)
        })
      }
    }
  }

  test('every copy measures every code point the same', async () => {
    const [first, ...rest] = await Promise.all(
      WIDTH_MODS.map(async (mod) => ({ mod, ...(await widthModule(mod)) })),
    )
    let examined = 0
    for (let start = 0; start <= SWEEP_LAST; start += SWEEP_BLOCK) {
      const codes = codePointsOf(start, Math.min(start + SWEEP_BLOCK - 1, SWEEP_LAST))
      if (codes.length === 0) continue
      examined += codes.length
      const text = blockText(codes)
      const expected = first.displayWidth(text)
      for (const other of rest) {
        if (other.displayWidth(text) === expected) continue
        const differing = codes.filter((code) => {
          const character = String.fromCodePoint(code)
          return other.displayWidth(character) !== first.displayWidth(character)
        })
        assert.fail(
          `${other.mod} and ${first.mod} measure ${differing.map(codePointText).join(', ')} differently`,
        )
      }
    }
    assert.equal(examined, SWEEP_LAST + 1 - (SURROGATES.last - SURROGATES.first + 1))
  })
})
