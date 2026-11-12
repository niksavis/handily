import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { environmentWithoutGit } from './git-env.mjs'
import { createScratchFolder, removeScratchFolder } from './scratch.mjs'

const liveScript = join(import.meta.dirname, 'live.mjs')
const colourStart = '\x1b[1m'
const scrollbackLine = 'a line in the scrollback'

const fakeTmux = `#!/usr/bin/env node
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
const statePath = process.env.FAKE_TMUX_STATE
const steps = JSON.parse(fs.readFileSync(process.env.FAKE_TMUX_SCRIPT, 'utf8'))
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { step: 0, reads: 0, lost: 0, workFolder: '' }
fs.appendFileSync(
  process.env.FAKE_TMUX_LOG,
  JSON.stringify({ args, step: state.step, reads: state.reads }) + '\\n',
)
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
const advance = () => {
  if (state.step < steps.length - 1) {
    state.step += 1
    state.reads = 0
    state.lost = 0
  }
}
if (args.some((arg) => arg.endsWith(';'))) {
  process.stderr.write('an argument ends with a semicolon, which tmux reads as a command separator\\n')
  process.exit(1)
}
let index = 0
while (args[index] === '-f' || args[index] === '-L') index += 2
const command = args[index]
const rest = args.slice(index + 1)
const wrapped = (path) => {
  const parts = []
  for (let start = 0; start < path.length; start += 38) parts.push(path.slice(start, start + 38))
  return parts.join('\\n  ')
}
const screenOf = (step) =>
  step.screen
    .replaceAll('{workFolderWrapped}', wrapped(state.workFolder))
    .replaceAll('{workFolder}', state.workFolder)
if (command === 'new-session') {
  state.workFolder = rest[rest.indexOf('-c') + 1]
  const program = rest.slice(rest.indexOf('--') + 1)
  spawnSync(program[0], program.slice(1), { cwd: state.workFolder, stdio: 'ignore' })
  save()
  process.exit(0)
}
if (command === 'capture-pane') {
  const step = steps[state.step]
  if (step.die) {
    process.stderr.write("can't find pane: live\\n")
    process.exit(1)
  }
  let text = screenOf(step)
  if (rest.includes('-S')) text = '${scrollbackLine}\\n' + text
  else {
    state.reads += 1
    if (step.reads !== undefined && state.reads >= step.reads) advance()
  }
  if (rest.includes('-e')) text = '\\x1b[1m' + text + '\\x1b[0m'
  process.stdout.write(text + '\\n')
  save()
  process.exit(0)
}
if (command === 'send-keys') {
  const step = steps[state.step]
  if (step.key !== undefined && rest.at(-1) === step.key) {
    if (state.lost < (step.lose ?? 0)) state.lost += 1
    else advance()
  }
  save()
  process.exit(0)
}
if (command === 'kill-server') process.exit(0)
process.stderr.write('the fake tmux does not know ' + command + '\\n')
process.exit(1)
`

const fakeClaude = `#!/usr/bin/env node
require('node:fs').writeFileSync(
  process.env.FAKE_CLAUDE_LOG,
  JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    claudeVariables: Object.keys(process.env).filter((name) => name.startsWith('CLAUDE')),
  }),
)
`

const rule = '─'.repeat(40)
const blank = { screen: 'Claude Code is starting', reads: 2 }
const ownTrust = (cursorOnYes = false) => ({
  screen: [
    rule,
    ' Accessing workspace:',
    '',
    ' {workFolder}',
    '',
    ' Quick safety check: Is this a project',
    ' you created or one you trust? (Like',
    ' your own code, a well-known open',
    ' source project, or work from your',
    ' team). If not, take a moment to review',
    " what's in this folder first.",
    '',
    " Claude Code'll be able to read, edit,",
    ' and execute files here.',
    '',
    ' Security guide',
    '',
    ` ${cursorOnYes ? ' ' : '❯'} No, exit`,
    ` ${cursorOnYes ? '❯' : ' '} Yes, I trust this folder`,
    '',
    ' Enter to confirm · Esc to cancel',
  ].join('\n'),
  key: cursorOnYes ? 'Enter' : 'Down',
})
const trusted = ownTrust(true)
const ready = (reads) => ({
  screen: [rule, '❯ ', rule, '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n'),
  ...(reads === undefined ? { key: 'Enter' } : { reads }),
})
const busy = { screen: '✻ Thinking… (esc to interrupt)\n  ⏵⏵ auto mode on', reads: 2 }
const done = {
  screen: [
    '● the reply of the turn',
    '✻ Cooked for 3s · done 6:32 PM',
    rule,
    '❯ ',
    rule,
    '  ⏵⏵ auto mode on',
  ].join('\n'),
}
const permission = {
  screen: [
    'Bash command',
    '  touch file',
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. No',
    'Esc to cancel',
  ].join('\n'),
}

function lane(t, steps) {
  const root = createScratchFolder('live-test-')
  t.after(() => assert.equal(removeScratchFolder(root), undefined))
  const bin = join(root, 'bin')
  const temporary = join(root, 'tmp')
  const mods = join(root, 'my mods')
  for (const folder of [bin, temporary, mods]) mkdirSync(folder)
  writeFileSync(join(bin, 'tmux'), fakeTmux)
  writeFileSync(join(bin, 'claude'), fakeClaude)
  chmodSync(join(bin, 'tmux'), 0o755)
  chmodSync(join(bin, 'claude'), 0o755)
  const scriptPath = join(root, 'script.json')
  writeFileSync(scriptPath, JSON.stringify(steps))
  const paths = {
    log: join(root, 'tmux.log'),
    claudeLog: join(root, 'claude.json'),
    out: join(root, 'screen.txt'),
  }
  const env = {
    ...Object.fromEntries(
      Object.entries(environmentWithoutGit).filter(([name]) => !name.startsWith('CLAUDE')),
    ),
    PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: temporary,
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CONFIG_DIR: join(root, 'config'),
    TMUX: '/tmp/tmux-of-the-person,1,0',
    FAKE_TMUX_LOG: paths.log,
    FAKE_TMUX_STATE: join(root, 'state.json'),
    FAKE_TMUX_SCRIPT: scriptPath,
    FAKE_CLAUDE_LOG: paths.claudeLog,
  }
  const argsWith = (extra) => [
    liveScript,
    '--mods',
    mods,
    '--columns',
    '40',
    '--prompt',
    'hello',
    '--out',
    paths.out,
    '--interval-ms',
    '5',
    '--timeout-s',
    '5',
    ...extra,
  ]
  const calls = () =>
    existsSync(paths.log)
      ? readFileSync(paths.log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
  return {
    mods,
    paths,
    run: (extra = []) =>
      spawnSync(process.execPath, argsWith(extra), { env, encoding: 'utf8', timeout: 20_000 }),
    start: (extra = []) => spawn(process.execPath, argsWith(extra), { env }),
    calls,
    commandOf: (call) => call.args[call.args.indexOf('-L') + 2],
    sentKeys: () =>
      calls()
        .filter((call) => call.args.includes('send-keys'))
        .map((call) => call.args.slice(call.args.indexOf('send-keys') + 1)),
    claude: () => JSON.parse(readFileSync(paths.claudeLog, 'utf8')),
    scratchFolders: () => readdirSync(temporary),
    out: () => readFileSync(paths.out, 'utf8'),
  }
}

function assertOwnServerKilledLast(check) {
  const calls = check.calls()
  assert.ok(calls.length > 0)
  const names = new Set(calls.map((call) => call.args[call.args.indexOf('-L') + 1]))
  assert.equal(names.size, 1)
  const [name] = names
  assert.match(name, /^handily-live-/)
  for (const call of calls) assert.deepEqual(call.args.slice(0, 4), ['-f', '/dev/null', '-L', name])
  assert.equal(check.commandOf(calls.at(-1)), 'kill-server')
  assert.equal(calls.filter((call) => check.commandOf(call) === 'kill-server').length, 1)
  assert.deepEqual(check.scratchFolders(), [])
}

describe('npm run live', () => {
  test('answers the trust prompt of its own folder types the prompt and writes the screen with colour', (t) => {
    const check = lane(t, [blank, ownTrust(), trusted, ready(4), ready(), busy, done])
    const result = check.run(['--settings', '{"a": "it\'s $HOME"}'])
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys(), [
      ['-t', 'live', 'Down'],
      ['-t', 'live', 'Enter'],
      ['-t', 'live', '-l', '--', 'hello'],
      ['-t', 'live', 'Enter'],
    ])
    const claude = check.claude()
    assert.deepEqual(claude.argv, ['--plugin-dir', check.mods, '--settings', '{"a":"it\'s $HOME"}'])
    assert.deepEqual(claude.claudeVariables, ['CLAUDE_CONFIG_DIR'])
    const newSession = check.calls().find((call) => check.commandOf(call) === 'new-session')
    assert.deepEqual(newSession.args.slice(4, 12), [
      'new-session',
      '-d',
      '-s',
      'live',
      '-x',
      '40',
      '-y',
      '50',
    ])
    assert.ok(check.out().startsWith(colourStart))
    assert.ok(check.out().includes(scrollbackLine))
    assert.ok(check.out().includes('Cooked for 3s'))
    assert.ok(!result.stdout.includes(colourStart))
    assert.ok(result.stdout.includes(scrollbackLine))
    assert.ok(result.stdout.includes('Cooked for 3s'))
    assertOwnServerKilledLast(check)
  })

  test('starts claude in a work folder inside its own scratch folder', (t) => {
    const check = lane(t, [blank, trusted, ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    const { cwd } = check.claude()
    assert.match(cwd, /\/handily-live-[^/]+\/work$/)
    assert.deepEqual(check.scratchFolders(), [])
  })

  test('moves the cursor to Yes with one key per call and sends Enter only when the cursor is on Yes', (t) => {
    const notYetRedrawn = { ...ownTrust(), key: undefined, reads: 3 }
    const check = lane(t, [blank, ownTrust(), notYetRedrawn, trusted, ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys(), [
      ['-t', 'live', 'Down'],
      ['-t', 'live', 'Enter'],
      ['-t', 'live', '-l', '--', 'hello'],
      ['-t', 'live', 'Enter'],
    ])
    const keyCalls = check.calls().filter((call) => check.commandOf(call) === 'send-keys')
    assert.deepEqual(
      keyCalls.slice(0, 2).map((call) => call.step),
      [1, 3],
    )
  })

  test('sends the first key to the trust prompt only after it shows on 4 reads in a row', (t) => {
    const check = lane(t, [blank, ownTrust(), trusted, ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    const [first] = check.calls().filter((call) => check.commandOf(call) === 'send-keys')
    assert.deepEqual([first.step, first.reads], [1, 4])
  })

  test('moves the cursor again when the screen does not show the first move', (t) => {
    const check = lane(t, [blank, { ...ownTrust(), lose: 1 }, trusted, ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys().slice(0, 3), [
      ['-t', 'live', 'Down'],
      ['-t', 'live', 'Down'],
      ['-t', 'live', 'Enter'],
    ])
  })

  test('moves the cursor up when the Yes row is above the cursor', (t) => {
    const numbered = (cursorOnYes) => ({
      screen: [
        ' {workFolder}',
        ` ${cursorOnYes ? '❯' : ' '} 1. Yes, I trust this folder`,
        ` ${cursorOnYes ? ' ' : '❯'} 2. No, exit`,
        ' Enter to confirm',
      ].join('\n'),
      key: cursorOnYes ? 'Enter' : 'Up',
    })
    const check = lane(t, [blank, numbered(false), numbered(true), ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys().slice(0, 2), [
      ['-t', 'live', 'Up'],
      ['-t', 'live', 'Enter'],
    ])
  })

  test('answers the trust prompt once when the screen still shows it after Enter', (t) => {
    const lingering = { ...trusted, key: undefined, reads: 6 }
    const check = lane(t, [blank, trusted, lingering, ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys(), [
      ['-t', 'live', 'Enter'],
      ['-t', 'live', '-l', '--', 'hello'],
      ['-t', 'live', 'Enter'],
    ])
  })

  test('finds its own folder in a trust prompt that wraps the path at 40 columns', (t) => {
    const wrapped = {
      ...trusted,
      screen: trusted.screen.replace('{workFolder}', '{workFolderWrapped}'),
    }
    const check = lane(t, [blank, wrapped, ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys()[0], ['-t', 'live', 'Enter'])
  })

  test('sends no key to the trust prompt of another folder and names it', (t) => {
    const other = { screen: trusted.screen.replace('{workFolder}', '/home/someone/other') }
    const check = lane(t, [blank, other])
    const result = check.run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /the folder trust prompt of another folder/)
    assert.deepEqual(check.sentKeys(), [])
    assert.ok(check.out().includes('/home/someone/other'))
    assertOwnServerKilledLast(check)
  })

  test('sends no key to a permission prompt in the turn and names it', (t) => {
    const check = lane(t, [blank, trusted, ready(4), ready(), busy, permission])
    const result = check.run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /a permission prompt/)
    assert.deepEqual(check.sentKeys(), [
      ['-t', 'live', 'Enter'],
      ['-t', 'live', '-l', '--', 'hello'],
      ['-t', 'live', 'Enter'],
    ])
    assert.ok(check.out().includes('Do you want to proceed?'))
    assertOwnServerKilledLast(check)
  })

  test('sends no key to a question at the start and names it', (t) => {
    const question = { screen: 'Choose the text style\n❯ 1. Dark\n  2. Light\nEnter to select' }
    const check = lane(t, [blank, question])
    const result = check.run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /a question/)
    assert.deepEqual(check.sentKeys(), [])
    assertOwnServerKilledLast(check)
  })

  test('sends no key to a permission prompt that names its own folder and the word trust', (t) => {
    const lookalike = {
      screen: [
        'Bash command',
        '  touch {workFolder}/trust.txt',
        'Do you want to proceed?',
        '❯ 1. Yes',
        '  2. No',
        'Enter to confirm · Esc to cancel',
      ].join('\n'),
    }
    const check = lane(t, [blank, lookalike])
    const result = check.run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /a permission prompt/)
    assert.deepEqual(check.sentKeys(), [])
    assertOwnServerKilledLast(check)
  })

  test('sends no key to a question that names its own folder and the word trust', (t) => {
    const lookalike = {
      screen: [
        'Do you trust the hooks in {workFolder}?',
        '❯ 1. Yes',
        '  2. No',
        'Enter to confirm · Enter to select',
      ].join('\n'),
    }
    const check = lane(t, [blank, lookalike])
    const result = check.run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /a question/)
    assert.deepEqual(check.sentKeys(), [])
    assertOwnServerKilledLast(check)
  })

  test('types the prompt only after the input line shows on 4 reads in a row', (t) => {
    const flicker = { screen: 'Claude Code is loading the mods', reads: 1 }
    const check = lane(t, [blank, trusted, ready(3), flicker, ready(4), ready(), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    const typed = check.calls().find((call) => call.args.includes('-l'))
    assert.equal(typed.step, 5)
  })

  test('reads the prompt line between two rules as the input line', (t) => {
    const plain = (step) => ({
      ...step,
      screen: [rule, '❯ ', rule, '  ? for shortcuts'].join('\n'),
    })
    const check = lane(t, [blank, plain(ready(4)), plain(ready()), done])
    const result = check.run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys()[0], ['-t', 'live', '-l', '--', 'hello'])
  })

  test('types a prompt with quotes a dollar sign and a final semicolon unchanged', (t) => {
    const check = lane(t, [blank, ready(4), ready(), done])
    const prompt = `say "it's" $HOME \`x\`;`
    const result = check.run(['--prompt', prompt])
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(check.sentKeys(), [
      ['-t', 'live', '-l', '--', `say "it's" $HOME \`x\``],
      ['-t', 'live', '-H', '3b'],
      ['-t', 'live', 'Enter'],
    ])
  })

  test('sends no key when the wait for the input line passes its limit and names the wait', (t) => {
    const check = lane(t, [{ screen: 'Claude Code is starting' }])
    const result = check.run(['--timeout-s', '0.3'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /the wait for the input line passed 0\.3 seconds/)
    assert.deepEqual(check.sentKeys(), [])
    assert.ok(check.out().includes('Claude Code is starting'))
    assertOwnServerKilledLast(check)
  })

  test('sends no key after the prompt when the wait for the end of the turn passes its limit', (t) => {
    const check = lane(t, [blank, ready(4), ready(), { screen: busy.screen }])
    const result = check.run(['--timeout-s', '0.5'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /the wait for the end of the turn passed 0\.5 seconds/)
    assert.equal(check.sentKeys().length, 2)
    assert.ok(check.out().includes('esc to interrupt'))
    assertOwnServerKilledLast(check)
  })

  test('names the wait when the claude session ends', (t) => {
    const check = lane(t, [blank, { screen: '', die: true }])
    const result = check.run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /the claude session ended during the wait for the input line/)
    assert.ok(check.out().includes('Claude Code is starting'))
    assertOwnServerKilledLast(check)
  })

  test('kills its own server and removes its scratch folder on SIGINT', async (t) => {
    const check = lane(t, [{ screen: 'Claude Code is starting' }])
    const child = check.start(['--timeout-s', '30'])
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
    const started = Date.now()
    while (!check.calls().some((call) => check.commandOf(call) === 'capture-pane')) {
      assert.ok(Date.now() - started < 10_000, 'the script never read the screen')
      await sleep(20)
    }
    child.kill('SIGINT')
    assert.equal(await exited, 130)
    assertOwnServerKilledLast(check)
  })

  test('uses a new server name on each run', (t) => {
    const first = lane(t, [blank, ready(4), ready(), done])
    const second = lane(t, [blank, ready(4), ready(), done])
    assert.equal(first.run().status, 0)
    assert.equal(second.run().status, 0)
    const nameOf = (check) => check.calls()[0].args[3]
    assert.notEqual(nameOf(first), nameOf(second))
  })

  test('refuses a call without a mods folder by name and starts no server', (t) => {
    const check = lane(t, [blank])
    const result = spawnSync(process.execPath, [liveScript, '--columns', '40'], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /--mods/)
    assert.match(result.stderr, /usage: npm run live --/)
    assert.deepEqual(check.calls(), [])
  })

  test('refuses settings that are not a JSON object by name and starts no server', (t) => {
    const check = lane(t, [blank])
    const result = check.run(['--settings', '{not json'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /--settings/)
    assert.deepEqual(check.calls(), [])
  })

  test('refuses a prompt with a line break by name and starts no server', (t) => {
    const check = lane(t, [blank])
    const result = check.run(['--prompt', 'one\ntwo'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /--prompt/)
    assert.deepEqual(check.calls(), [])
  })
})
