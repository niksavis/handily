import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { environmentWithoutGit } from './git-env.mjs'
import { createScratchFolder, removeScratchFolder } from './scratch.mjs'

const usage =
  'usage: npm run live -- --mods DIR --columns N --prompt TEXT --out FILE [--settings JSON] [--timeout-s N] [--interval-ms N]'
const sessionName = 'live'
const rows = '50'
const readyReadsInARow = 4
const maxTrustMoves = 4
const trustRedrawReads = 8
const defaultTimeoutS = 180
const defaultIntervalMs = 250
const keptClaudeVariables = new Set(['CLAUDE_CONFIG_DIR'])
const tmuxClientVariables = new Set(['TMUX', 'TMUX_PANE'])
const goneServer = /no server running|error connecting to/
const theInputLine = 'the input line'
const theEndOfTheTurn = 'the end of the turn'
const ownTrustPrompt = 'the folder trust prompt of its own folder'

const screenText = {
  confirm: /Enter to confirm/,
  trustRow: /Yes, I trust this folder/,
  permission: /Do you want to/,
  question: /Enter to select/,
  autoMode: /auto mode on/,
  promptMarker: '❯',
  rule: /^\s*─{8,}\s*$/,
  yesRow: /^\s*(❯\s*)?(\d+\.\s+)?Yes\b/,
  turnDone: /^\s*\S\s+\p{Lu}\p{Ll}+ed for \d/mu,
}

class LiveStop extends Error {}

function refuse(message) {
  return { refusal: message }
}

function parseOptions(argv) {
  let values
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      options: {
        mods: { type: 'string' },
        columns: { type: 'string' },
        prompt: { type: 'string' },
        out: { type: 'string' },
        settings: { type: 'string' },
        'timeout-s': { type: 'string' },
        'interval-ms': { type: 'string' },
      },
    }).values
  } catch (error) {
    return refuse(error.message)
  }
  for (const name of ['mods', 'columns', 'prompt', 'out']) {
    if (values[name] === undefined) return refuse(`--${name} is missing`)
  }
  const mods = resolve(values.mods)
  if (!existsSync(mods) || !statSync(mods).isDirectory()) {
    return refuse(`--mods ${mods} is not a folder`)
  }
  if (mods.endsWith(';')) {
    return refuse(`--mods ${mods} ends with a semicolon, which tmux reads as a command separator`)
  }
  const columns = Number(values.columns)
  if (!Number.isInteger(columns) || columns < 20 || columns > 1000) {
    return refuse('--columns takes a whole number from 20 to 1000')
  }
  if (values.prompt === '' || /[\r\n]/.test(values.prompt)) {
    return refuse('--prompt takes one line of text')
  }
  const out = resolve(values.out)
  if (!existsSync(dirname(out)) || !statSync(dirname(out)).isDirectory()) {
    return refuse(`--out ${out} is not in a folder that exists`)
  }
  let settings
  if (values.settings !== undefined) {
    try {
      settings = JSON.parse(values.settings)
    } catch {
      return refuse('--settings takes a JSON object')
    }
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      return refuse('--settings takes a JSON object')
    }
  }
  const timeoutS = Number(values['timeout-s'] ?? defaultTimeoutS)
  if (!Number.isFinite(timeoutS) || timeoutS <= 0) {
    return refuse('--timeout-s takes a number of seconds over 0')
  }
  const intervalMs = Number(values['interval-ms'] ?? defaultIntervalMs)
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    return refuse('--interval-ms takes a whole number of milliseconds over 0')
  }
  return {
    options: {
      mods,
      columns: String(columns),
      prompt: values.prompt,
      out,
      settings: settings === undefined ? undefined : JSON.stringify(settings),
      timeoutS,
      intervalMs,
    },
  }
}

function sessionEnvironment() {
  return Object.fromEntries(
    Object.entries(environmentWithoutGit).filter(
      ([name]) =>
        !tmuxClientVariables.has(name) &&
        (!name.startsWith('CLAUDE') || keptClaudeVariables.has(name)),
    ),
  )
}

function folderForms(folder) {
  const forms = new Set([folder, realpathSync(folder)])
  const home = homedir()
  for (const form of [...forms]) {
    if (form.startsWith(home + sep)) forms.add(`~${form.slice(home.length)}`)
  }
  return [...forms].map((form) => form.replace(/\s+/g, ''))
}

function promptOnScreen(screen, ownFolders) {
  if (screenText.permission.test(screen)) return 'a permission prompt'
  if (screenText.question.test(screen)) return 'a question'
  if (!screenText.confirm.test(screen)) return undefined
  if (!screenText.trustRow.test(screen)) return 'a confirmation prompt'
  const compact = screen.replace(/\s+/g, '')
  return ownFolders.some((folder) => compact.includes(folder))
    ? ownTrustPrompt
    : 'the folder trust prompt of another folder'
}

function showsInputLine(screen) {
  if (screenText.autoMode.test(screen)) return true
  const lines = screen.split('\n')
  return lines.some(
    (line, index) =>
      line.trimStart().startsWith(screenText.promptMarker) &&
      index > 0 &&
      index < lines.length - 1 &&
      screenText.rule.test(lines[index - 1]) &&
      screenText.rule.test(lines[index + 1]),
  )
}

function trustRows(screen) {
  const lines = screen.split('\n')
  return {
    cursor: lines.findIndex((line) => line.includes(screenText.promptMarker)),
    yes: lines.findIndex((line) => screenText.yesRow.test(line)),
  }
}

function createSession(options) {
  const scratch = createScratchFolder('handily-live-')
  const work = join(scratch, 'work')
  mkdirSync(work)
  const server = `handily-live-${process.pid}-${randomBytes(4).toString('hex')}`
  const env = sessionEnvironment()
  const session = {
    options,
    scratch,
    work,
    ownFolders: folderForms(work),
    lastScreen: '',
    serverStarted: false,
    cleaned: false,
    tmux: (args) =>
      spawnSync('tmux', ['-f', '/dev/null', '-L', server, ...args], { env, encoding: 'utf8' }),
  }
  return session
}

function startServer(session) {
  const { options } = session
  const program = ['claude', '--plugin-dir', options.mods]
  if (options.settings !== undefined) program.push('--settings', options.settings)
  session.serverStarted = true
  const result = session.tmux([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-x',
    options.columns,
    '-y',
    rows,
    '-c',
    session.work,
    '--',
    ...program,
  ])
  if (result.error !== undefined) throw new LiveStop(`tmux did not run: ${result.error.message}`)
  if (result.status !== 0) {
    throw new LiveStop(`tmux did not start the session: ${result.stderr.trim()}`)
  }
}

function readScreen(session) {
  const result = session.tmux(['capture-pane', '-p', '-t', sessionName])
  if (result.status !== 0) return undefined
  session.lastScreen = result.stdout
  return result.stdout
}

function send(session, keys) {
  const result = session.tmux(['send-keys', '-t', sessionName, ...keys])
  if (result.status !== 0) throw new LiveStop(`tmux did not send the keys: ${result.stderr.trim()}`)
}

async function waitFor(session, waitName, decide) {
  const { timeoutS, intervalMs } = session.options
  const deadline = performance.now() + timeoutS * 1000
  for (;;) {
    const screen = readScreen(session)
    if (screen === undefined) {
      throw new LiveStop(`the claude session ended during the wait for ${waitName}`)
    }
    if (decide(screen, promptOnScreen(screen, session.ownFolders))) return
    if (performance.now() >= deadline) {
      throw new LiveStop(`the wait for ${waitName} passed ${timeoutS} seconds`)
    }
    await sleep(intervalMs)
  }
}

function stopAtPrompt(prompt) {
  return new LiveStop(`it stopped at ${prompt} and sent no key to it`)
}

function inputLineDecider(session) {
  let readyReads = 0
  let trustReads = 0
  let trustAnswered = false
  let movedFrom
  let readsSinceMove = 0
  let moves = 0
  return (screen, prompt) => {
    if (prompt !== ownTrustPrompt) {
      if (prompt !== undefined) throw stopAtPrompt(prompt)
      trustReads = 0
      readyReads = showsInputLine(screen) ? readyReads + 1 : 0
      return readyReads >= readyReadsInARow
    }
    readyReads = 0
    trustReads += 1
    if (trustAnswered || trustReads < readyReadsInARow) return false
    const { cursor, yes } = trustRows(screen)
    if (cursor < 0 || yes < 0) throw stopAtPrompt('a folder trust prompt with no Yes row')
    if (cursor === movedFrom && readsSinceMove < trustRedrawReads) {
      readsSinceMove += 1
      return false
    }
    movedFrom = undefined
    if (cursor === yes) {
      send(session, ['Enter'])
      trustAnswered = true
      return false
    }
    if (moves >= maxTrustMoves) {
      throw new LiveStop('the cursor did not reach Yes in the folder trust prompt')
    }
    moves += 1
    movedFrom = cursor
    readsSinceMove = 0
    send(session, [yes > cursor ? 'Down' : 'Up'])
    return false
  }
}

function endOfTurnDecider() {
  return (screen, prompt) => {
    if (prompt === ownTrustPrompt) throw stopAtPrompt('the folder trust prompt in the turn')
    if (prompt !== undefined) throw stopAtPrompt(prompt)
    return screenText.turnDone.test(screen)
  }
}

function typePrompt(session, prompt) {
  const body = prompt.replace(/;+$/, '')
  if (body !== '') send(session, ['-l', '--', body])
  const semicolons = prompt.length - body.length
  if (semicolons > 0) send(session, ['-H', ...Array(semicolons).fill('3b')])
  send(session, ['Enter'])
}

function writeScreen(session) {
  const coloured = session.tmux(['capture-pane', '-e', '-p', '-S', '-', '-t', sessionName])
  writeFileSync(session.options.out, coloured.status === 0 ? coloured.stdout : session.lastScreen)
  const plain = session.tmux(['capture-pane', '-p', '-S', '-', '-t', sessionName])
  process.stdout.write(plain.status === 0 ? plain.stdout : session.lastScreen)
}

function cleanup(session) {
  if (session.cleaned) return []
  session.cleaned = true
  const problems = []
  if (session.serverStarted) {
    const killed = session.tmux(['kill-server'])
    if (killed.status !== 0 && !goneServer.test(killed.stderr ?? '')) {
      problems.push(`tmux did not kill the server: ${(killed.stderr ?? '').trim()}`)
    }
  }
  const refusal = removeScratchFolder(session.scratch)
  if (refusal !== undefined) problems.push(refusal)
  return problems
}

function reportProblems(problems) {
  for (const problem of problems) console.error(`live: ${problem}`)
}

async function runCheck(session) {
  startServer(session)
  await waitFor(session, theInputLine, inputLineDecider(session))
  typePrompt(session, session.options.prompt)
  await waitFor(session, theEndOfTheTurn, endOfTurnDecider())
}

async function main(argv) {
  const parsed = parseOptions(argv)
  if (parsed.refusal !== undefined) {
    console.error(`live: ${parsed.refusal}\n${usage}`)
    return 2
  }
  const session = createSession(parsed.options)
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.on(signal, () => {
      reportProblems(cleanup(session))
      console.error(`live: stopped by ${signal}`)
      process.exit(code)
    })
  }
  let status = 0
  try {
    await runCheck(session)
    writeScreen(session)
  } catch (error) {
    if (!(error instanceof LiveStop)) throw error
    if (session.serverStarted) writeScreen(session)
    console.error(`live: ${error.message}. The screen is in ${session.options.out}`)
    status = 1
  } finally {
    const problems = cleanup(session)
    reportProblems(problems)
    if (problems.length > 0) status = 1
  }
  return status
}

process.exitCode = await main(process.argv.slice(2))
