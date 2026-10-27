import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, sep } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
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
const TOAST_MODS = ['handily-item-toasts']
const DIRECT_CALL = /\.toast\s*\(/
const BOX_COLUMNS = 40

const KNOWN_DIRECT_CALLS = {
  'mods/handily-board/hooks/board.ts': 'handily-ftx0x.4',
  'mods/handily-board/hooks/pane.tsx': 'handily-ftx0x.4',
  'mods/handily-board/hooks/register.tsx': 'handily-ftx0x.4',
  'mods/handily-reply-view/hooks/register.ts': 'handily-ftx0x.3',
  'mods/handily-simple-view/hooks/register.ts': 'handily-ftx0x.3',
}

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

function toastKeepers(dir) {
  return readdirSync(dir)
    .filter((mod) => existsSync(toastPath(dir, mod)))
    .sort()
}

function differingCopies(dir) {
  const [first, ...rest] = toastKeepers(dir).map((mod) => ({
    mod,
    bytes: readFileSync(toastPath(dir, mod)),
  }))
  return rest
    .filter(({ bytes }) => !bytes.equals(first.bytes))
    .map(
      ({ mod }) =>
        `mods/${first.mod}/hooks/${TOAST_FILE} and mods/${mod}/hooks/${TOAST_FILE} differ; copy one over the other`,
    )
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(entry.parentPath, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

function directToastCalls(dir) {
  return readdirSync(dir)
    .map((mod) => join(dir, mod, 'hooks'))
    .filter((hooks) => existsSync(hooks))
    .flatMap(filesUnder)
    .filter((path) => !path.endsWith(`${sep}${TOAST_FILE}`))
    .filter((path) => DIRECT_CALL.test(readFileSync(path, 'utf8')))
    .map((path) => relative(dirname(dir), path).split(sep).join('/'))
    .sort()
}

function withModsTree(files, body) {
  const tree = mkdtempSync(join(tmpdir(), 'handily-toast-'))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(tree, path)), { recursive: true })
      writeFileSync(join(tree, path), text)
    }
    body(join(tree, 'mods'))
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
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
  test('lists every mod that keeps a hooks/toast.ts', () => {
    assert.deepEqual(
      toastKeepers(modsDir),
      [...TOAST_MODS].sort(),
      'scripts/toast.test.mjs lists the mods that keep hooks/toast.ts; add or remove the mod in TOAST_MODS',
    )
  })

  test('every copy is byte-identical', () => {
    assert.deepEqual(differingCopies(modsDir), [])
  })

  test('names both mods when two copies differ by one byte', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/toast.ts': 'export const TOAST_COLUMNS = 40\n',
        'mods/mod-b/hooks/toast.ts': 'export const TOAST_COLUMNS = 41\n',
      },
      (dir) => {
        assert.deepEqual(differingCopies(dir), [
          'mods/mod-a/hooks/toast.ts and mods/mod-b/hooks/toast.ts differ; copy one over the other',
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
  test('no file under mods/*/hooks calls toast outside hooks/toast.ts, but the known ones', () => {
    const unknown = directToastCalls(modsDir).filter((path) => !(path in KNOWN_DIRECT_CALLS))
    assert.deepEqual(
      unknown,
      [],
      `${unknown.join(', ')} calls .toast( directly; call showToast of the mod's hooks/toast.ts`,
    )
  })

  test('each known direct call is still there, until its record moves it', () => {
    const calls = directToastCalls(modsDir)
    const moved = Object.entries(KNOWN_DIRECT_CALLS).filter(([path]) => !calls.includes(path))
    assert.deepEqual(
      moved,
      [],
      `${moved.map(([path, record]) => `${path} (${record})`).join(', ')} no longer calls .toast( directly; remove it from KNOWN_DIRECT_CALLS`,
    )
  })

  test('names a hooks file that calls toast, and not toast.ts or a test outside hooks', () => {
    withModsTree(
      {
        'mods/mod-a/hooks/register.ts': "$.ui.toast('done')\n",
        'mods/mod-a/hooks/nested/pane.tsx': "ui.toast ('done')\n",
        'mods/mod-a/hooks/quiet.ts': "on('ui.toast', hook)\n",
        'mods/mod-a/hooks/toast.ts': "$.ui.toast('done')\n",
        'mods/mod-a/mod-a.test.ts': "$.ui.toast('done')\n",
      },
      (dir) => {
        assert.deepEqual(directToastCalls(dir), [
          'mods/mod-a/hooks/nested/pane.tsx',
          'mods/mod-a/hooks/register.ts',
        ])
      },
    )
  })
})
