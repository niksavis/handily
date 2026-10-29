import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, extname, join, relative, sep } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { differingCopies, keepersOf, withModsTree } from './copies.mjs'
import { APPROVED } from './fixtures/signals.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isFromTypeScript = context.parentURL?.endsWith('.ts') ?? false
    if (isFromTypeScript && specifier.startsWith('./') && extname(specifier) === '') {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const root = join(import.meta.dirname, '..')
const modsDir = join(root, 'mods')
const TOAST_FILE = 'toast.ts'
const TOAST_MODS = [
  'handily-board',
  'handily-filetree',
  'handily-item-toasts',
  'handily-reply-view',
  'handily-simple-view',
]
const COPY_TOAST_FILE = 'copy-toast.ts'
const COPY_TOAST_MODS = ['handily-reply-view', 'handily-simple-view']
const SHARED_FILES = [
  { file: TOAST_FILE, mods: TOAST_MODS, list: 'TOAST_MODS' },
  { file: COPY_TOAST_FILE, mods: COPY_TOAST_MODS, list: 'COPY_TOAST_MODS' },
]
const TOAST_USES = [
  /(?<!['"`]ui)\.toast\b/,
  /\[\s*(['"`])toast\1\s*\]/,
  /\{[^{}]*\btoast\b[^{}]*\}\s*(?:=(?![=>])|:|\))/,
]
const BOX_COLUMNS = 40

const TOAST_CASES = [
  {
    name: 'a closed item',
    parts: ['✓ handily-ab12 closed', { quoted: 'Draw text mocks for the mods' }],
    lines: ['✓ handily-ab12 closed', '"Draw text mocks for the mods"'],
    timeoutMs: 6080,
  },
  {
    name: 'a short created item, held for the shortest time',
    parts: ['○ a-1 created', { quoted: 'x' }],
    lines: ['○ a-1 created', '"x"'],
    timeoutMs: 6000,
  },
  {
    name: 'a blocked item, held for the time to act',
    parts: ['■ handily-cd34 open → blocked', { quoted: 'Write the beads reader' }],
    lines: ['■ handily-cd34 open → blocked', '"Write the beads reader"'],
    timeoutMs: 10000,
  },
  {
    name: 'a wait for the person, held for the time to act',
    parts: ['◆ a-1 waits for you', { quoted: 'x' }],
    lines: ['◆ a-1 waits for you', '"x"'],
    timeoutMs: 10000,
  },
  {
    name: 'a mark inside a quoted title, which does not raise the time',
    parts: ['○ a-1 created', { quoted: '◆' }],
    lines: ['○ a-1 created', '"◆"'],
    timeoutMs: 6000,
  },
  {
    name: 'a merged toast',
    parts: ['3 items changed', '✓ 2 closed  ○ 1 created', 'handily-ab12 handily-cd34 +1'],
    lines: ['3 items changed', '✓ 2 closed  ○ 1 created', 'handily-ab12 handily-cd34 +1'],
    timeoutMs: 7280,
  },
  {
    name: 'three parts longer than a line, each cut with an ellipsis',
    parts: [`■ ${'x'.repeat(60)}`, 'y'.repeat(60), 'z'.repeat(60)],
    lines: [`■ ${'x'.repeat(36)}…`, `${'y'.repeat(38)}…`, `${'z'.repeat(39)}…`],
    timeoutMs: 11440,
  },
]

function toastPath(dir, mod) {
  return join(dir, mod, 'hooks', TOAST_FILE)
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(entry.parentPath, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

function usesToast(path) {
  const text = readFileSync(path, 'utf8')
  return TOAST_USES.some((use) => use.test(text))
}

function directToastCalls(dir) {
  return readdirSync(dir)
    .filter((mod) => existsSync(join(dir, mod, 'hooks')))
    .flatMap((mod) =>
      filesUnder(join(dir, mod, 'hooks')).filter((path) => path !== toastPath(dir, mod)),
    )
    .filter(usesToast)
    .map((path) => relative(dirname(dir), path).split(sep).join('/'))
    .sort()
}

async function toastModule(mod) {
  return import(pathToFileURL(toastPath(modsDir, mod)).href)
}

async function widthModule(mod) {
  return import(pathToFileURL(join(modsDir, mod, 'hooks', 'width.ts')).href)
}

function boxLines(text, displayWidth) {
  const lines = []
  let line = ''
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    text,
  )) {
    if (displayWidth(line + segment) > BOX_COLUMNS) {
      lines.push(line.trimEnd())
      line = ''
    }
    line += segment
  }
  return [...lines, line.trimEnd()]
}

describe('the copies of hooks/toast.ts', () => {
  for (const { file, mods, list } of SHARED_FILES) {
    test(`lists every mod that keeps a hooks/${file}`, () => {
      assert.deepEqual(
        keepersOf(modsDir, file),
        [...mods].sort(),
        `scripts/toast.test.mjs lists the mods that keep hooks/${file}; add or remove the mod in ${list}`,
      )
    })

    test(`every copy of hooks/${file} is byte-identical`, () => {
      assert.deepEqual(differingCopies(modsDir, file), [])
    })
  }

  test('names both mods when two copies differ by one byte', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/toast.ts': 'export const TOAST_COLUMNS = 40\n',
        'mods/mod-b/hooks/toast.ts': 'export const TOAST_COLUMNS = 41\n',
      },
      (dir) => {
        assert.deepEqual(differingCopies(dir, TOAST_FILE), [
          'mods/mod-a/hooks/toast.ts and mods/mod-b/hooks/toast.ts differ; copy one over the other',
        ])
      },
    )
  })

  test('names both mods when two copy toast texts differ by one word', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/copy-toast.ts': "const REASON = 'another plugin refused the copy'\n",
        'mods/mod-b/hooks/copy-toast.ts': "const REASON = 'another plugin blocked the copy'\n",
      },
      (dir) => {
        assert.deepEqual(differingCopies(dir, COPY_TOAST_FILE), [
          'mods/mod-a/hooks/copy-toast.ts and mods/mod-b/hooks/copy-toast.ts differ; copy one over the other',
        ])
      },
    )
  })

  for (const mod of TOAST_MODS) {
    test(`${mod} draws each toast mark with the approved signal mark`, async () => {
      const { TOAST_MARKS } = await toastModule(mod)
      const approved = Object.fromEntries(
        Object.entries(APPROVED).map(([state, { mark }]) => [state, mark]),
      )
      assert.deepEqual({ ...TOAST_MARKS }, approved)
    })

    for (const { name, parts, lines, timeoutMs } of TOAST_CASES) {
      test(`${mod} lays out ${name} and keeps it ${String(timeoutMs)} ms`, async () => {
        const { toastText, toastMs } = await toastModule(mod)
        const { displayWidth } = await widthModule(mod)
        assert.deepEqual(boxLines(toastText(parts), displayWidth), lines)
        assert.equal(toastMs(parts), timeoutMs)
      })
    }
  }
})

describe('a toast outside hooks/toast.ts', () => {
  test('no file under mods/*/hooks uses toast outside hooks/toast.ts', () => {
    const direct = directToastCalls(modsDir)
    assert.deepEqual(
      direct,
      [],
      `${direct.join(', ')} uses the toast of ui directly; call showToast of the mod's hooks/toast.ts`,
    )
  })

  test('names a hooks file that calls, binds, reads or destructures toast, and not hooks/toast.ts or a test', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/register.ts': "$.ui.toast('done')\n",
        'mods/mod-a/hooks/nested/pane.tsx': "ui.toast ('done')\n",
        'mods/mod-a/hooks/destructured.ts': "const { toast } = $.ui\ntoast('done')\n",
        'mods/mod-a/hooks/renamed.ts': "const { log, toast: show } = $.ui\nshow('done')\n",
        'mods/mod-a/hooks/parameter.ts': "export const tell = ({ toast }: Ui) => toast('done')\n",
        'mods/mod-a/hooks/bound.ts': 'const show = $.ui.toast.bind($.ui)\n',
        'mods/mod-a/hooks/bracket.ts': '$.ui["toast"]("done")\n',
        'mods/mod-a/hooks/read.ts': 'const show = $.ui.toast\n',
        'mods/mod-a/hooks/ui/toast.ts': "$.ui.toast('done')\n",
        'mods/mod-a/hooks/quiet.ts':
          "on('ui.toast', hook)\nimport { showToast } from './toast'\nconst toasts = 1\n",
        'mods/mod-a/hooks/toast.ts': "$.ui.toast('done')\n",
        'mods/mod-a/mod-a.test.ts': "$.ui.toast('done')\n",
      },
      (dir) => {
        assert.deepEqual(directToastCalls(dir), [
          'mods/mod-a/hooks/bound.ts',
          'mods/mod-a/hooks/bracket.ts',
          'mods/mod-a/hooks/destructured.ts',
          'mods/mod-a/hooks/nested/pane.tsx',
          'mods/mod-a/hooks/parameter.ts',
          'mods/mod-a/hooks/read.ts',
          'mods/mod-a/hooks/register.ts',
          'mods/mod-a/hooks/renamed.ts',
          'mods/mod-a/hooks/ui/toast.ts',
        ])
      },
    )
  })
})
