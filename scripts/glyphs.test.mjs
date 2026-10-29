import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { differingCopies, filesUnder, keepersOf, withModsTree } from './copies.mjs'
import { GLYPHS } from './fixtures/glyphs.mjs'
import { APPROVED } from './fixtures/signals.mjs'

const root = join(import.meta.dirname, '..')
const modsDir = join(root, 'mods')
const GLYPH_FILE = 'glyphs.ts'
const GLYPH_MODS = [
  'handily',
  'handily-board',
  'handily-filetree',
  'handily-item-toasts',
  'handily-reply-view',
  'handily-simple-view',
]
const LITERAL_FREE_MODS = [
  'handily-board',
  'handily-item-toasts',
  'handily-reply-view',
  'handily-simple-view',
]
const LITERAL_EXCEPTIONS = [
  {
    file: 'mods/handily-board/hooks/checks.ts',
    glyph: '■',
    why: 'the denied cell of the gate strip, a verdict cell beside the allowed and asked cells',
  },
  {
    file: 'mods/handily-reply-view/hooks/flowchart.ts',
    glyph: '▶',
    why: 'the arrow head of a flowchart edge',
  },
  {
    file: 'mods/handily-reply-view/hooks/sequence.ts',
    glyph: '▶',
    why: 'the arrow head of a sequence message',
  },
]
const MARK_ROLES = Object.keys(APPROVED)
const SETS = ['plain', 'nerd']
const NERD_FIRST = 0xe000
const NERD_LAST = 0xf8ff
const INVENTORY_HEADER =
  '| Role | Meaning | Who draws it | Plain | Nerd icon | Code point | Stand-in |'

function glyphPath(dir, mod) {
  return join(dir, mod, 'hooks', GLYPH_FILE)
}

async function glyphModule(mod) {
  return import(pathToFileURL(glyphPath(modsDir, mod)).href)
}

async function widthModules() {
  return Promise.all(
    keepersOf(modsDir, 'width.ts').map(async (mod) => ({
      mod,
      ...(await import(pathToFileURL(join(modsDir, mod, 'hooks', 'width.ts')).href)),
    })),
  )
}

function codePointText(code) {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
}

function glyphText(glyph) {
  return [...glyph].map((character) => codePointText(character.codePointAt(0))).join(' ')
}

function columnsText(columns) {
  return `${String(columns)} ${columns === 1 ? 'column' : 'columns'}`
}

function keeperProblems(dir, listed) {
  const keepers = keepersOf(dir, GLYPH_FILE)
  const unlisted = keepers
    .filter((mod) => !listed.includes(mod))
    .map(
      (mod) =>
        `mods/${mod}/hooks/${GLYPH_FILE} is not in GLYPH_MODS of scripts/glyphs.test.mjs; add the mod there`,
    )
  const missing = listed
    .filter((mod) => !keepers.includes(mod))
    .map((mod) => `GLYPH_MODS lists ${mod}, but mods/${mod}/hooks/${GLYPH_FILE} is missing`)
  return [...unlisted, ...missing]
}

const NAMED = String.raw`\{[^}]*\}`
const NAMESPACE = String.raw`\*(?:\s+as\s+[\w$]+)?`
const SOURCE = String.raw`\s*(?:'[^'\n]*'|"[^"\n]*")`
const MODULE_STATEMENT = new RegExp(
  [
    String.raw`^[ \t]*import\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:${NAMED}|${NAMESPACE})?\s*from${SOURCE}`,
    String.raw`^[ \t]*export\s+(?:type\s+)?(?:${NAMED}|${NAMESPACE})\s*from${SOURCE}`,
    String.raw`^[ \t]*import${SOURCE}`,
  ].join('|'),
  'gm',
)
const TYPE_STATEMENT = /^\s*(?:import|export)\s+type\b/

function valueImports(text) {
  return [...text.matchAll(MODULE_STATEMENT)]
    .map(([statement]) => statement.trim())
    .filter((statement) => !TYPE_STATEMENT.test(statement))
}

function glyphProblems(sets, widths) {
  const problems = []
  for (const [setName, set] of Object.entries(sets)) {
    const owners = new Map()
    for (const [role, glyph] of Object.entries(set)) {
      const where = `the ${setName} glyph of ${role}, ${glyphText(glyph)},`
      const codes = [...glyph].map((character) => character.codePointAt(0))
      if (codes.length !== 1) {
        problems.push(`${where} is ${String(codes.length)} code points; a glyph is one code point`)
      }
      for (const { mod, displayWidth } of widths) {
        const columns = displayWidth(glyph)
        if (columns !== 1) {
          problems.push(
            `mods/${mod}/hooks/width.ts measures ${where} as ${columnsText(columns)}; a glyph is 1 column`,
          )
        }
      }
      if (/\p{Emoji_Presentation}/u.test(glyph)) {
        problems.push(`${where} is an emoji, 2 columns wide in most terminals`)
      }
      if (setName === 'plain' && /\p{Co}/u.test(glyph)) {
        problems.push(`${where} is a private use character; a plain glyph draws in any font`)
      }
      if (setName === 'nerd' && codes.some((code) => code < NERD_FIRST || code > NERD_LAST)) {
        problems.push(
          `${where} is outside U+E000 to U+F8FF; a nerd glyph is a private use icon of the BMP`,
        )
      }
      const owner = owners.get(glyph)
      if (owner !== undefined) {
        problems.push(
          `${where} is also the ${setName} glyph of ${owner}; each role has its own glyph`,
        )
      }
      owners.set(glyph, role)
    }
  }
  return problems
}

function tableOf(sets, names) {
  return Object.keys(sets.plain).map((role) => ({
    role,
    plain: sets.plain[role],
    nerdName: names[role],
    nerd: sets.nerd[role]?.codePointAt(0),
    nerdLength: [...(sets.nerd[role] ?? '')].length,
  }))
}

function fixtureDifferences(sets, names, fixture) {
  const differences = []
  const roles = Object.keys(fixture)
  for (const name of SETS) {
    const found = Object.keys(sets[name] ?? {})
    if (JSON.stringify(found) !== JSON.stringify(roles)) {
      differences.push(`the ${name} set has the roles ${found.join(', ')}, not ${roles.join(', ')}`)
    }
  }
  if (JSON.stringify(Object.keys(names)) !== JSON.stringify(roles)) {
    differences.push(
      `NERD_NAMES has the roles ${Object.keys(names).join(', ')}, not ${roles.join(', ')}`,
    )
  }
  for (const row of tableOf(sets, names)) {
    const pinned = fixture[row.role]
    if (pinned === undefined) continue
    if (row.plain !== pinned.plain) {
      differences.push(
        `the plain glyph of ${row.role} is ${glyphText(row.plain)}, not ${glyphText(pinned.plain)}`,
      )
    }
    if (row.nerd !== pinned.nerd || row.nerdLength !== 1) {
      differences.push(
        `the nerd glyph of ${row.role} is ${glyphText(sets.nerd[row.role] ?? '')}, not ${codePointText(pinned.nerd)}`,
      )
    }
    if (row.nerdName !== pinned.nerdName) {
      differences.push(
        `the nerd name of ${row.role} is ${String(row.nerdName)}, not ${pinned.nerdName}`,
      )
    }
  }
  return differences
}

function inventoryRows(design) {
  const lines = design.split('\n')
  const start = lines.indexOf(INVENTORY_HEADER)
  if (start === -1) return null
  const rows = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    rows.push({ role: cells[0], plain: cells[3], nerdName: cells[4], nerd: cells[5] })
  }
  return rows
}

function fixtureInventory(fixture) {
  return Object.entries(fixture).map(([role, { plain, nerdName, nerd }]) => ({
    role: `\`${role}\``,
    plain: `\`${plain}\``,
    nerdName,
    nerd: `\`${codePointText(nerd)}\``,
  }))
}

function fixtureSets(fixture) {
  const plain = {}
  const nerd = {}
  const names = {}
  for (const [role, pinned] of Object.entries(fixture)) {
    plain[role] = pinned.plain
    nerd[role] = String.fromCodePoint(pinned.nerd)
    names[role] = pinned.nerdName
  }
  return { sets: { plain, nerd }, names }
}

function withGlyph(setName, role, glyph) {
  const { sets } = fixtureSets(GLYPHS)
  return { ...sets, [setName]: { ...sets[setName], [role]: glyph } }
}

const ONE_COLUMN = [{ mod: 'any', displayWidth: () => 1 }]

describe('the copies of hooks/glyphs.ts', () => {
  test('lists every mod that keeps a hooks/glyphs.ts', () => {
    assert.deepEqual(keeperProblems(modsDir, GLYPH_MODS), [])
  })

  test('names a keeper that GLYPH_MODS does not list, and a listed mod without the file', () => {
    withModsTree(
      {
        'mods/handily/hooks/glyphs.ts': 'export const A = 1\n',
        'mods/mod-x/hooks/glyphs.ts': 'export const A = 1\n',
        'mods/mod-y/hooks/register.ts': 'export const A = 1\n',
      },
      (dir) => {
        assert.deepEqual(keeperProblems(dir, ['handily', 'mod-y']), [
          'mods/mod-x/hooks/glyphs.ts is not in GLYPH_MODS of scripts/glyphs.test.mjs; add the mod there',
          'GLYPH_MODS lists mod-y, but mods/mod-y/hooks/glyphs.ts is missing',
        ])
      },
    )
  })

  test('every copy of hooks/glyphs.ts is byte-identical', () => {
    assert.deepEqual(differingCopies(modsDir, GLYPH_FILE), [])
  })

  test('names both mods when two copies of hooks/glyphs.ts differ by one glyph', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/glyphs.ts': "export const DONE = '✓'\n",
        'mods/mod-b/hooks/glyphs.ts': "export const DONE = '✔'\n",
      },
      (dir) => {
        assert.deepEqual(differingCopies(dir, GLYPH_FILE), [
          'mods/mod-a/hooks/glyphs.ts and mods/mod-b/hooks/glyphs.ts differ; copy one over the other',
        ])
      },
    )
  })

  for (const mod of GLYPH_MODS) {
    test(`mods/${mod}/hooks/glyphs.ts imports nothing but types`, () => {
      assert.deepEqual(valueImports(readFileSync(glyphPath(modsDir, mod), 'utf8')), [])
    })
  }

  test('names an import of a value and keeps an import of types', () => {
    const text = [
      "import type { ConfigRow } from 'claude-code'",
      "import { displayWidth } from './width'",
      "import { type Signal } from './signals'",
      "import './side-effect'",
      "export { fitted } from './width'",
      "export type { Signal } from './signals'",
      "const text = 'import { x } from y'",
    ].join('\n')
    assert.deepEqual(valueImports(text), [
      "import { displayWidth } from './width'",
      "import { type Signal } from './signals'",
      "import './side-effect'",
      "export { fitted } from './width'",
    ])
  })

  test('names a value import and a value export that Prettier wrapped over several lines', () => {
    const text = [
      'import type {',
      '  ConfigRow,',
      '  ConfigValue,',
      "} from 'claude-code'",
      'import {',
      '  displayWidth,',
      '  fitted,',
      "} from './width'",
      'import * as width from "./width"',
      'import widthOf, { type Signal } from "./signals"',
      'export {',
      '  padToWidth,',
      "} from './width'",
      'export * from "./signals"',
      'export type {',
      '  Signal,',
      "} from './signals'",
      "export const GLYPH = 'from'",
      'export function glyphOf(role: string) {',
      "  return { role, from: 'x' }",
      '}',
    ].join('\n')
    assert.deepEqual(valueImports(text), [
      "import {\n  displayWidth,\n  fitted,\n} from './width'",
      'import * as width from "./width"',
      'import widthOf, { type Signal } from "./signals"',
      "export {\n  padToWidth,\n} from './width'",
      'export * from "./signals"',
    ])
  })
})

describe('the setting Glyphs', () => {
  test('the plugin.json of handily declares the userConfig field glyphs with the options plain and nerd and the default plain', () => {
    const manifest = JSON.parse(
      readFileSync(join(modsDir, 'handily', '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    const { description, ...field } = manifest.userConfig?.glyphs ?? {}
    assert.deepEqual(field, {
      type: 'string',
      title: 'Glyphs',
      options: [...SETS],
      default: 'plain',
    })
    assert.match(description, /Nerd Font Mono/)
    assert.match(description, /\/handily glyphs/)
  })
})

describe('the glyph sets', () => {
  for (const mod of GLYPH_MODS) {
    test(`${mod} keeps the sets that scripts/fixtures/glyphs.mjs pins`, async () => {
      const { GLYPH_SETS, NERD_NAMES } = await glyphModule(mod)
      assert.deepEqual(fixtureDifferences(GLYPH_SETS, NERD_NAMES, GLYPHS), [])
    })

    test(`each glyph of ${mod} is one code point, one column in every width.ts, no emoji, and its own`, async () => {
      const widths = await widthModules()
      assert.ok(widths.length > 0, 'no mod keeps a hooks/width.ts to measure the glyphs with')
      const { GLYPH_SETS } = await glyphModule(mod)
      assert.deepEqual(glyphProblems(GLYPH_SETS, widths), [])
    })
  }

  test('the fixture passes every glyph rule', async () => {
    const { sets } = fixtureSets(GLYPHS)
    assert.deepEqual(glyphProblems(sets, await widthModules()), [])
  })

  test('names a glyph of more than one code point', () => {
    assert.deepEqual(glyphProblems(withGlyph('plain', 'done', '✓\u{0301}'), ONE_COLUMN), [
      'the plain glyph of done, U+2713 U+0301, is 2 code points; a glyph is one code point',
    ])
  })

  test('names each width.ts that measures a glyph other than 1 column', async () => {
    const zeroForIdeograph = (glyph) => (glyph === '\u{4E2D}' ? 0 : 1)
    const widths = [...(await widthModules()), { mod: 'mod-z', displayWidth: zeroForIdeograph }]
    const problems = glyphProblems(withGlyph('plain', 'done', '\u{4E2D}'), widths)
    assert.ok(
      problems.includes(
        'mods/handily-board/hooks/width.ts measures the plain glyph of done, U+4E2D, as 2 columns; a glyph is 1 column',
      ),
      problems.join('\n'),
    )
    assert.ok(
      problems.includes(
        'mods/mod-z/hooks/width.ts measures the plain glyph of done, U+4E2D, as 0 columns; a glyph is 1 column',
      ),
      problems.join('\n'),
    )
    assert.equal(problems.length, widths.length)
  })

  test('names an emoji glyph', () => {
    assert.deepEqual(glyphProblems(withGlyph('plain', 'doing', '\u{23E9}'), ONE_COLUMN), [
      'the plain glyph of doing, U+23E9, is an emoji, 2 columns wide in most terminals',
    ])
  })

  test('keeps the approved doing mark, which has the emoji property with text presentation', () => {
    assert.match('▶', /\p{Emoji}/u)
    assert.deepEqual(glyphProblems(withGlyph('plain', 'doing', '▶'), ONE_COLUMN), [])
  })

  test('names a private use plain glyph', () => {
    assert.deepEqual(glyphProblems(withGlyph('plain', 'branch', '\u{E000}'), ONE_COLUMN), [
      'the plain glyph of branch, U+E000, is a private use character; a plain glyph draws in any font',
    ])
  })

  test('names a nerd glyph outside U+E000 to U+F8FF, below and above the range', () => {
    assert.deepEqual(glyphProblems(withGlyph('nerd', 'branch', 'x'), ONE_COLUMN), [
      'the nerd glyph of branch, U+0078, is outside U+E000 to U+F8FF; a nerd glyph is a private use icon of the BMP',
    ])
    assert.deepEqual(glyphProblems(withGlyph('nerd', 'branch', '\u{F0001}'), ONE_COLUMN), [
      'the nerd glyph of branch, U+F0001, is outside U+E000 to U+F8FF; a nerd glyph is a private use icon of the BMP',
    ])
    assert.deepEqual(glyphProblems(withGlyph('nerd', 'branch', '\u{F8FF}'), ONE_COLUMN), [])
    assert.deepEqual(glyphProblems(withGlyph('nerd', 'branch', '\u{E000}'), ONE_COLUMN), [])
  })

  test('names two roles of one set that share a glyph', () => {
    assert.deepEqual(glyphProblems(withGlyph('nerd', 'folderOpen', '\u{F07B}'), ONE_COLUMN), [
      'the nerd glyph of folderOpen, U+F07B, is also the nerd glyph of folderClosed; each role has its own glyph',
    ])
  })

  test('names a set, a glyph and a name that differ from the fixture', () => {
    const { sets, names } = fixtureSets(GLYPHS)
    const withoutBranch = Object.fromEntries(
      Object.entries(sets.plain).filter(([role]) => role !== 'branch'),
    )
    assert.deepEqual(
      fixtureDifferences(
        { plain: withoutBranch, nerd: { ...sets.nerd, done: '\u{EAB3}' } },
        { ...names, read: 'nf-cod-eye_closed' },
        GLYPHS,
      ),
      [
        `the plain set has the roles ${Object.keys(withoutBranch).join(', ')}, not ${Object.keys(GLYPHS).join(', ')}`,
        'the nerd glyph of done is U+EAB3, not U+EAB2',
        'the nerd name of read is nf-cod-eye_closed, not nf-cod-eye',
      ],
    )
  })

  test('docs/design.md lists each role with the plain mark, the nerd name and the code point of the fixture', () => {
    const rows = inventoryRows(readFileSync(join(root, 'docs', 'design.md'), 'utf8'))
    assert.ok(rows !== null, `docs/design.md has no table that starts with ${INVENTORY_HEADER}`)
    assert.deepEqual(rows, fixtureInventory(GLYPHS))
  })

  test('names a docs/design.md row whose code point differs from the fixture', () => {
    const design = [
      INVENTORY_HEADER,
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| `doing` | in progress | board | `▶` | nf-cod-play | `U+EB2D` | Ⓟ |',
      '',
    ].join('\n')
    assert.notDeepEqual(inventoryRows(design), fixtureInventory({ doing: GLYPHS.doing }))
    assert.deepEqual(
      inventoryRows(design.replace('U+EB2D', 'U+EB2C')),
      fixtureInventory({ doing: GLYPHS.doing }),
    )
  })
})

function markPatterns() {
  return MARK_ROLES.flatMap((role) =>
    SETS.map((setName) => {
      const { plain, nerd } = GLYPHS[role]
      const code = setName === 'plain' ? plain.codePointAt(0) : nerd
      const hex = code.toString(16)
      return {
        role,
        setName,
        glyph: String.fromCodePoint(code),
        pattern: new RegExp(
          `${String.fromCodePoint(code)}|\\\\u\\{0*${hex}\\}|\\\\u${hex.padStart(4, '0')}`,
          'i',
        ),
      }
    }),
  )
}

function shownPath(dir, path) {
  return relative(join(dir, '..'), path).split(sep).join('/')
}

const CODE_POINT_CALL = /String\.fromC(?:odePoint|harCode)\s*\(([^)]*)\)/g
const NUMBER_ARGUMENT = /^(?:0x[0-9a-f_]+|\d[\d_]*)$/i

function builtCodePoints(line) {
  return new Set(
    [...line.matchAll(CODE_POINT_CALL)].flatMap(([, args]) =>
      args
        .split(',')
        .map((arg) => arg.trim())
        .filter((arg) => NUMBER_ARGUMENT.test(arg))
        .map((arg) => Number(arg.replaceAll('_', ''))),
    ),
  )
}

function marksInFile(dir, path) {
  const file = shownPath(dir, path)
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) => {
      const built = builtCodePoints(line)
      return markPatterns()
        .filter(({ pattern, glyph }) => pattern.test(line) || built.has(glyph.codePointAt(0)))
        .map(({ role, setName, glyph }) => ({ file, line: index + 1, role, setName, glyph }))
    })
}

function missingHooks(dir, mods) {
  return mods
    .filter((mod) => !existsSync(join(dir, mod, 'hooks')))
    .map(
      (mod) =>
        `LITERAL_FREE_MODS lists ${mod}, but mods/${mod}/hooks is missing; fix the name or remove the entry`,
    )
}

function literalMarks(dir, mods, exceptions) {
  const found = mods
    .filter((mod) => existsSync(join(dir, mod, 'hooks')))
    .flatMap((mod) => filesUnder(join(dir, mod, 'hooks')))
    .filter((path) => !path.endsWith(`${sep}${GLYPH_FILE}`))
    .sort()
    .flatMap((path) => marksInFile(dir, path))
  const isExcepted = (mark) =>
    exceptions.some(({ file, glyph }) => file === mark.file && glyph === mark.glyph)
  const unexcepted = found
    .filter((mark) => !isExcepted(mark))
    .map(
      ({ file, line, role, setName, glyph }) =>
        `${file}:${String(line)} writes the ${setName} glyph of ${role}, ${glyphText(glyph)}, as a literal; name the role and draw it from hooks/glyphs.ts`,
    )
  const stale = exceptions
    .filter(({ file, glyph }) => !found.some((mark) => mark.file === file && mark.glyph === glyph))
    .map(
      ({ file, glyph }) =>
        `LITERAL_EXCEPTIONS names ${glyphText(glyph)} in ${file}, which no longer writes it; remove the exception`,
    )
  return [...missingHooks(dir, mods), ...unexcepted, ...stale]
}

describe('the literal free gate', () => {
  test('no mod in LITERAL_FREE_MODS writes a signal mark of either set as a literal outside hooks/glyphs.ts', () => {
    assert.deepEqual(literalMarks(modsDir, LITERAL_FREE_MODS, LITERAL_EXCEPTIONS), [])
  })

  test('each named exception says why the glyph is not a signal mark', () => {
    for (const { file, why } of LITERAL_EXCEPTIONS) {
      assert.ok(
        LITERAL_FREE_MODS.some((mod) => file.startsWith(`mods/${mod}/hooks/`)),
        file,
      )
      assert.match(why, /arrow|cell/)
    }
  })

  test('mods/handily-filetree/hooks/register.ts writes no signal mark as a literal', () => {
    const path = join(modsDir, 'handily-filetree', 'hooks', 'register.ts')
    assert.deepEqual(marksInFile(modsDir, path), [])
  })

  test('names a raw mark, an escaped mark and a nerd icon, and keeps hooks/glyphs.ts, a test and a separator', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/register.ts': "showToast($, ['\u25a0 Tree did not change'])\n",
        'mods/mod-a/hooks/nested/copy.ts': "const DONE = '\\u2713'\nconst BELL = '\\u{EAA2}'\n",
        'mods/mod-a/hooks/upper.ts': "const BLOCKED = '\\u{ea87}'\nconst OPEN = '\\u25CB'\n",
        'mods/mod-a/hooks/glyphs.ts': "export const BLOCKED = '\u25a0'\n",
        'mods/mod-a/hooks/gap.ts': "const GAP = ' \u00b7 '\n",
        'mods/mod-a/mod-a.test.ts': "expect(text).toBe('\u25a0 Not copied')\n",
      },
      (dir) => {
        assert.deepEqual(literalMarks(dir, ['mod-a'], []), [
          'mods/mod-a/hooks/nested/copy.ts:1 writes the plain glyph of done, U+2713, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/nested/copy.ts:2 writes the nerd glyph of waitsForYou, U+EAA2, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/register.ts:1 writes the plain glyph of blocked, U+25A0, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/upper.ts:1 writes the nerd glyph of blocked, U+EA87, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/upper.ts:2 writes the plain glyph of toDo, U+25CB, as a literal; name the role and draw it from hooks/glyphs.ts',
        ])
      },
    )
  })

  test('names a mark that String.fromCodePoint or String.fromCharCode builds from a hex or decimal number', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/numbers.ts': [
          'const A = String.fromCodePoint(0x25a0)',
          'const B = String.fromCharCode(9632)',
          'const C = String.fromCodePoint( 0xEAB2 )',
          'const D = String.fromCharCode(60082)',
          'const E = String.fromCodePoint(0x41, 0x25_cb)',
          'const F = String.fromCodePoint(0x25a1)',
          'const G = String.fromCodePoint(code)',
          'const H = String.fromCharCode(9633)',
          '',
        ].join('\n'),
      },
      (dir) => {
        assert.deepEqual(literalMarks(dir, ['mod-a'], []), [
          'mods/mod-a/hooks/numbers.ts:1 writes the plain glyph of blocked, U+25A0, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/numbers.ts:2 writes the plain glyph of blocked, U+25A0, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/numbers.ts:3 writes the nerd glyph of done, U+EAB2, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/numbers.ts:4 writes the nerd glyph of done, U+EAB2, as a literal; name the role and draw it from hooks/glyphs.ts',
          'mods/mod-a/hooks/numbers.ts:5 writes the plain glyph of toDo, U+25CB, as a literal; name the role and draw it from hooks/glyphs.ts',
        ])
      },
    )
  })

  test('names a listed mod without a hooks folder', () => {
    withModsTree({ 'mods/mod-a/hooks/clean.ts': 'export const A = 1\n' }, (dir) => {
      assert.deepEqual(literalMarks(dir, ['mod-a'], []), [])
      assert.deepEqual(literalMarks(dir, ['mod-a', 'mod-b'], []), [
        'LITERAL_FREE_MODS lists mod-b, but mods/mod-b/hooks is missing; fix the name or remove the entry',
      ])
    })
  })

  test('keeps a named exception only for its glyph in its file, and names a stale exception', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/arrow.ts': "const HEAD = '\u25b6'\nconst FAIL = '\u25a0'\n",
        'mods/mod-a/hooks/other.ts': "const HEAD = '\u25b6'\n",
      },
      (dir) => {
        assert.deepEqual(
          literalMarks(
            dir,
            ['mod-a'],
            [
              { file: 'mods/mod-a/hooks/arrow.ts', glyph: '\u25b6', why: 'an arrow' },
              { file: 'mods/mod-a/hooks/gone.ts', glyph: '\u25b6', why: 'an arrow' },
            ],
          ),
          [
            'mods/mod-a/hooks/arrow.ts:2 writes the plain glyph of blocked, U+25A0, as a literal; name the role and draw it from hooks/glyphs.ts',
            'mods/mod-a/hooks/other.ts:1 writes the plain glyph of doing, U+25B6, as a literal; name the role and draw it from hooks/glyphs.ts',
            'LITERAL_EXCEPTIONS names U+25B6 in mods/mod-a/hooks/gone.ts, which no longer writes it; remove the exception',
          ],
        )
      },
    )
  })
})
