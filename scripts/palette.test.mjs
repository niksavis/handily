import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { differingCopies, listedKeeperProblems, valueImports, withModsTree } from './copies.mjs'
import { PALETTE } from './fixtures/palette.mjs'

const root = join(import.meta.dirname, '..')
const modsDir = join(root, 'mods')
const PALETTE_FILE = 'palette.ts'
const PALETTE_MODS = ['handily', 'handily-board', 'handily-reply-view']
const PALETTE_LIST = 'PALETTE_MODS of scripts/palette.test.mjs'
const TABLE_HEADER =
  '| Role | Mod | Theme key today | catppuccin-mocha | Contrast on #1e1e2e / on white |'
const SETTINGS = ['theme', 'catppuccin-mocha']
const SETTING_TEXT =
  'theme: the colours of your Claude Code theme. catppuccin-mocha: fixed colours from Catppuccin, for dark themes only; a light theme keeps the theme colours. States always keep the theme. /handily palette shows both.'

function palettePath(mod) {
  return join(modsDir, mod, 'hooks', PALETTE_FILE)
}

function cellsOf(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

function splitCell(cell) {
  return cell.split('/').map((part) => part.replaceAll('`', '').trim())
}

function tableLooks(mocks) {
  const lines = mocks.split('\n')
  const start = lines.indexOf(TABLE_HEADER)
  if (start === -1) return null
  const looks = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    const [, , keys, hexes] = cellsOf(line)
    const keyParts = splitCell(keys)
    const hexParts = splitCell(hexes)
    keyParts.forEach((key, index) => looks.push({ key, mocha: hexParts[index] }))
  }
  return looks
}

function fixtureLooks(fixture) {
  return Object.values(fixture).map(({ key, mocha }) => ({ key, mocha }))
}

function looksDifferences(looks, fixture) {
  const roles = Object.keys(fixture)
  const found = Object.keys(looks)
  if (JSON.stringify(found) !== JSON.stringify(roles)) {
    return [`PALETTE_LOOKS has the roles ${found.join(', ')}, not ${roles.join(', ')}`]
  }
  return roles.flatMap((role) => {
    const { label, key, mocha } = looks[role]
    const pinned = fixture[role]
    return [
      label === pinned.label ? null : `the label of ${role} is ${label}, not ${pinned.label}`,
      key === pinned.key ? null : `the theme key of ${role} is ${key}, not ${pinned.key}`,
      mocha === pinned.mocha
        ? null
        : `the catppuccin-mocha hex of ${role} is ${mocha}, not ${pinned.mocha}`,
    ].filter((problem) => problem !== null)
  })
}

describe('the copies of hooks/palette.ts', () => {
  test('lists every mod that keeps a hooks/palette.ts', () => {
    assert.deepEqual(listedKeeperProblems(modsDir, PALETTE_FILE, PALETTE_MODS, PALETTE_LIST), [])
  })

  test('names a keeper that PALETTE_MODS does not list, and a listed mod without the file', () => {
    withModsTree(
      {
        'mods/handily/hooks/palette.ts': 'export const A = 1\n',
        'mods/mod-x/hooks/palette.ts': 'export const A = 1\n',
        'mods/mod-y/hooks/register.ts': 'export const A = 1\n',
      },
      (dir) => {
        assert.deepEqual(
          listedKeeperProblems(dir, PALETTE_FILE, ['handily', 'mod-y'], PALETTE_LIST),
          [
            'mods/mod-x/hooks/palette.ts is not in PALETTE_MODS of scripts/palette.test.mjs; add the mod there',
            'PALETTE_MODS lists mod-y, but mods/mod-y/hooks/palette.ts is missing',
          ],
        )
      },
    )
  })

  test('every copy of hooks/palette.ts is byte-identical', () => {
    assert.deepEqual(differingCopies(modsDir, PALETTE_FILE), [])
  })

  test('names both mods when two copies of hooks/palette.ts differ by one hex', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/palette.ts': "export const RULES = '#585b70'\n",
        'mods/mod-b/hooks/palette.ts': "export const RULES = '#585b71'\n",
      },
      (dir) => {
        assert.deepEqual(differingCopies(dir, PALETTE_FILE), [
          'mods/mod-a/hooks/palette.ts and mods/mod-b/hooks/palette.ts differ; copy one over the other',
        ])
      },
    )
  })

  for (const mod of PALETTE_MODS) {
    test(`mods/${mod}/hooks/palette.ts imports nothing but types`, () => {
      const text = readFileSync(palettePath(mod), 'utf8')
      assert.match(text, /^import type /m)
      assert.deepEqual(valueImports(text), [])
    })
  }
})

describe('the palette roles', () => {
  for (const mod of PALETTE_MODS) {
    test(`${mod} keeps the theme key and the catppuccin-mocha hex that scripts/fixtures/palette.mjs pins for each role`, async () => {
      const { PALETTE_LOOKS } = await import(pathToFileURL(palettePath(mod)).href)
      assert.deepEqual(looksDifferences(PALETTE_LOOKS, PALETTE), [])
    })
  }

  test('names a role, a theme key and a hex that differ from the fixture', () => {
    const changed = {
      ...PALETTE,
      rules: { ...PALETTE.rules, key: 'inactive' },
      link: { ...PALETTE.link, mocha: '#89dceb' },
    }
    assert.deepEqual(looksDifferences(changed, PALETTE), [
      'the theme key of rules is inactive, not subtle',
      'the catppuccin-mocha hex of link is #89dceb, not #89b4fa',
    ])
    const fewer = Object.fromEntries(
      Object.entries(PALETTE).filter(([role]) => role !== 'otherIcon'),
    )
    assert.equal(looksDifferences(fewer, PALETTE).length, 1)
  })

  test('docs/mocks.md 14.4 lists each role with the theme key and the hex of the fixture', () => {
    const looks = tableLooks(readFileSync(join(root, 'docs', 'mocks.md'), 'utf8'))
    assert.ok(looks !== null, `docs/mocks.md has no table that starts with ${TABLE_HEADER}`)
    assert.deepEqual(looks, fixtureLooks(PALETTE))
  })

  test('reads a row of three roles and names a hex that differs from the fixture', () => {
    const table = [
      TABLE_HEADER,
      '| --- | --- | --- | --- | --- |',
      '| Type icon: code / docs / other | filetree | `suggestion`/`merged`/`inactive` | `#89dceb`/`#f5c2e7`/`#9399b2` | ≥5.8 |',
      '',
    ].join('\n')
    const icons = {
      codeIcon: PALETTE.codeIcon,
      docsIcon: PALETTE.docsIcon,
      otherIcon: PALETTE.otherIcon,
    }
    assert.deepEqual(tableLooks(table), fixtureLooks(icons))
    assert.notDeepEqual(tableLooks(table.replace('#f5c2e7', '#f5c2e8')), fixtureLooks(icons))
  })
})

describe('the setting Palette', () => {
  test('the plugin.json of handily declares the userConfig field palette with the options theme and catppuccin-mocha and the default theme', () => {
    const manifest = JSON.parse(
      readFileSync(join(modsDir, 'handily', '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    assert.deepEqual(manifest.userConfig?.palette, {
      type: 'string',
      title: 'Palette',
      description: SETTING_TEXT,
      options: [...SETTINGS],
      default: 'theme',
    })
  })
})
