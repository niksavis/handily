import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, test } from 'node:test'
import { environmentWithoutGit } from './git-env.mjs'
import { changedMods, changedTests } from './staged.mjs'

const repoRoot = join(import.meta.dirname, '..')

function copyGateScripts(root) {
  for (const script of ['mods.mjs', 'scratch.mjs', 'staged.mjs']) {
    cpSync(join(repoRoot, 'scripts', script), join(root, 'scripts', script))
  }
}

function makeRepoWithUntypedMod() {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-test-'))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  const mod = join(root, 'mods', 'untyped')
  mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
  mkdirSync(join(mod, 'hooks'))
  writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'untyped' }))
  writeFileSync(
    join(mod, 'tsconfig.json'),
    JSON.stringify({ extends: './.claude-plugin/types/tsconfig.json', include: ['hooks'] }),
  )
  writeFileSync(join(mod, 'hooks', 'register.ts'), 'export const answer: number = 42\n')
  return root
}

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

const root = makeRepoWithUntypedMod()
after(() => rmSync(root, { recursive: true, force: true }))

const emptyBin = mkdtempSync(join(tmpdir(), 'handily-no-claude-'))
after(() => rmSync(emptyBin, { recursive: true, force: true }))

const result = spawnSync(process.execPath, [join(root, 'scripts', 'mods.mjs'), 'typecheck'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, PATH: emptyBin },
})

test('typecheck fails and names the lay command when a mod has no laid types', () => {
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /untyped: no laid types; tsc did not run/)
  assert.match(result.stderr, /claude --plugin-dir mods\/untyped/)
})

test('typecheck writes no .js file into mods/ when the types are missing', () => {
  const emitted = listFiles(join(root, 'mods')).filter((path) => path.endsWith('.js'))
  assert.deepEqual(emitted, [])
})

const engineCompilerOptions = { strict: true, noEmit: true, typeRoots: ['.'] }
const installedVersion = '2.1.299'
const staleVersion = '2.1.296'

function engineHeader(version) {
  return `// Written by Claude Code ${version}.\nexport {}\n`
}

function engineTsconfig(types) {
  return JSON.stringify({ compilerOptions: { ...engineCompilerOptions, types } })
}

function makeRepoWithUnlaidContract({ listsDependency, engineVersion = installedVersion }) {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-contract-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  const layMod = (name, manifest, laidTypes) => {
    const mod = join(root, 'mods', name)
    mkdirSync(join(mod, '.claude-plugin', 'types'), { recursive: true })
    mkdirSync(join(mod, 'hooks'))
    writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
    writeFileSync(join(mod, '.claude-plugin', 'types', 'tsconfig.json'), engineTsconfig(laidTypes))
    mkdirSync(join(mod, '.claude-plugin', 'types', 'claude-code'))
    writeFileSync(
      join(mod, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'),
      engineHeader(engineVersion),
    )
    writeFileSync(
      join(mod, 'tsconfig.json'),
      JSON.stringify({ extends: './.claude-plugin/types/tsconfig.json', include: ['hooks'] }),
    )
    writeFileSync(join(mod, 'hooks', 'register.ts'), 'export const answer: number = 42\n')
    return mod
  }
  const base = layMod('base', { name: 'base', types: './types/index.d.ts' }, [])
  mkdirSync(join(base, 'types'))
  writeFileSync(join(base, 'types', 'index.d.ts'), 'export type BaseValue = number\n')
  const dependent = layMod(
    'dependent',
    { name: 'dependent', dependencies: ['base'] },
    listsDependency ? ['base'] : [],
  )
  const laidTypes = join(dependent, '.claude-plugin', 'types')
  return {
    root,
    laid: join(laidTypes, 'base', 'index.d.ts'),
    laidTsconfig: join(laidTypes, 'tsconfig.json'),
    laidEngineTypes: join(laidTypes, 'claude-code', 'index.d.ts'),
  }
}

function makeFakeClaude(body) {
  const bin = mkdtempSync(join(tmpdir(), 'handily-fake-claude-'))
  after(() => rmSync(bin, { recursive: true, force: true }))
  const path = join(bin, 'claude')
  writeFileSync(path, `#!${process.execPath}\n${body}\n`)
  chmodSync(path, 0o755)
  return bin
}

const notLoggedIn = "console.log('Not logged in')\nprocess.exit(1)"
const answersVersion = `if (process.argv[2] === '--version') {
  console.log('${installedVersion} (Claude Code)')
  process.exit(0)
}`
const headlessClaude = makeFakeClaude(`${answersVersion}\n${notLoggedIn}`)
const versionlessClaude = makeFakeClaude(notLoggedIn)
const refusingClaude = makeFakeClaude(`console.error('claude ran with', process.argv.slice(2))
process.exit(3)`)
const layingClaude = makeFakeClaude(`const { writeFileSync } = require('node:fs')
const { basename, join } = require('node:path')
const args = process.argv.slice(2)
const pluginDirs = args.filter((_, index) => args[index - 1] === '--plugin-dir')
const [mod, ...dependencies] = pluginDirs
writeFileSync(
  join(mod, '.claude-plugin', 'types', 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { ...${JSON.stringify(engineCompilerOptions)}, types: dependencies.map((dir) => basename(dir)) } }),
)
${notLoggedIn}`)

function runMods(repo, task, bin) {
  return spawnSync(process.execPath, [join(repo.root, 'scripts', 'mods.mjs'), task], {
    cwd: repo.root,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin },
  })
}

const contractRepo = makeRepoWithUnlaidContract({ listsDependency: true })
const contractResult = runMods(contractRepo, 'typecheck', refusingClaude)

test('typecheck lays a missing dependency contract as a regular file and passes without an engine load', () => {
  assert.equal(contractResult.status, 0, contractResult.stdout + contractResult.stderr)
  assert.equal(lstatSync(contractRepo.laid).isSymbolicLink(), false)
  assert.equal(readFileSync(contractRepo.laid, 'utf8'), 'export type BaseValue = number\n')
})

const typesRepo = makeRepoWithUnlaidContract({ listsDependency: true })
const typesResult = runMods(typesRepo, 'types', headlessClaude)

test('types lays the dependency contracts and passes when every laid header names the installed version', () => {
  assert.equal(typesResult.status, 0, typesResult.stdout + typesResult.stderr)
  assert.equal(readFileSync(typesRepo.laid, 'utf8'), 'export type BaseValue = number\n')
})

const outdatedRepo = makeRepoWithUnlaidContract({
  listsDependency: true,
  engineVersion: staleVersion,
})
const outdatedResult = runMods(outdatedRepo, 'types', headlessClaude)

test('types fails by name with the lay command when a laid header names another version after the run', () => {
  assert.equal(outdatedResult.status, 1, outdatedResult.stdout + outdatedResult.stderr)
  const failures = outdatedResult.stderr.split('\n').filter((line) => line.startsWith('FAIL '))
  assert.equal(failures.length, 2, outdatedResult.stderr)
  for (const name of ['base', 'dependent']) {
    assert.match(
      outdatedResult.stderr,
      new RegExp(
        `FAIL ${name}: the header of \\S+claude-code/index\\.d\\.ts names Claude Code ${staleVersion}, and the installed Claude Code is ${installedVersion};`,
      ),
    )
  }
  assert.match(outdatedResult.stderr, /claude --plugin-dir mods\/dependent --plugin-dir mods\/base/)
})

const versionlessRepo = makeRepoWithUnlaidContract({ listsDependency: true })
const versionlessResult = runMods(versionlessRepo, 'types', versionlessClaude)

test('types fails by name when claude --version cannot be read', () => {
  assert.equal(versionlessResult.status, 1, versionlessResult.stdout + versionlessResult.stderr)
  assert.match(
    versionlessResult.stderr,
    /FAIL claude --version: cannot read the installed Claude Code version \(exit 1: Not logged in\)/,
  )
})

const staleRepo = makeRepoWithUnlaidContract({ listsDependency: false })
const staleResult = runMods(staleRepo, 'typecheck', layingClaude)

test('typecheck lays the types again when the laid tsconfig does not list a dependency', () => {
  assert.equal(staleResult.status, 0, staleResult.stdout + staleResult.stderr)
  const laid = JSON.parse(readFileSync(staleRepo.laidTsconfig, 'utf8'))
  assert.deepEqual(laid.compilerOptions.types, ['base'])
})

const outdatedTypecheckRepo = makeRepoWithUnlaidContract({
  listsDependency: true,
  engineVersion: staleVersion,
})
const outdatedTypecheckResult = runMods(outdatedTypecheckRepo, 'typecheck', refusingClaude)

test('typecheck neither runs claude nor fails when a laid header names another version', () => {
  assert.equal(
    outdatedTypecheckResult.status,
    0,
    outdatedTypecheckResult.stdout + outdatedTypecheckResult.stderr,
  )
  assert.equal(
    readFileSync(outdatedTypecheckRepo.laidEngineTypes, 'utf8'),
    engineHeader(staleVersion),
  )
})

const unlistedRepo = makeRepoWithUnlaidContract({ listsDependency: false })
const unlistedResult = runMods(unlistedRepo, 'types', headlessClaude)

test('types fails by name with the lay command when the engine leaves a dependency unlisted', () => {
  assert.equal(unlistedResult.status, 1, unlistedResult.stdout + unlistedResult.stderr)
  assert.match(
    unlistedResult.stderr,
    /dependent: the laid \S+tsconfig\.json does not list the types of its dependencies base;/,
  )
  assert.match(unlistedResult.stderr, /claude --plugin-dir mods\/dependent --plugin-dir mods\/base/)
})

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: environmentWithoutGit })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
}

const engineSnapshot = {
  '.gitignore': '*\n',
  'tsconfig.json': engineTsconfig(['claude-code']),
  'claude-code/index.d.ts': 'export {}\n',
  'claude-code-mcp/index.d.ts': 'export {}\n',
  'claude-code-tools/index.d.ts': 'export {}\n',
}
const untrackedSnapshotFile = 'mods/snapshot/.claude-plugin/types/claude-code-tools/index.d.ts'

function makeGitRepoWithLaidSnapshot() {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-snapshot-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  mkdirSync(join(root, '.agents', 'plugins'), { recursive: true })
  writeFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), '{ "plugins": [] }\n')
  mkdirSync(join(root, '.claude-plugin'))
  const mod = join(root, 'mods', 'snapshot')
  mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(mod, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'snapshot', version: '0.1.0', description: 'A laid engine snapshot.' }),
  )
  for (const [file, text] of Object.entries(engineSnapshot)) {
    const path = join(mod, '.claude-plugin', 'types', file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
  git(root, 'init', '--quiet')
  const tracked = Object.keys(engineSnapshot)
    .map((file) => `mods/snapshot/.claude-plugin/types/${file}`)
    .filter((path) => path !== untrackedSnapshotFile)
  git(root, 'add', '-f', '--', ...tracked)
  return { root }
}

const passingClaude = makeFakeClaude('process.exit(0)')
const snapshotRepo = makeGitRepoWithLaidSnapshot()
const runWithGit = (task) =>
  spawnSync(process.execPath, [join(snapshotRepo.root, 'scripts', 'mods.mjs'), task], {
    cwd: snapshotRepo.root,
    encoding: 'utf8',
    env: { ...environmentWithoutGit, PATH: `${passingClaude}${delimiter}${process.env.PATH}` },
  })
const marketplaceResult = runWithGit('marketplace')
const untrackedResult = runWithGit('validate')
git(snapshotRepo.root, 'add', '-f', '--', untrackedSnapshotFile)
const trackedResult = runWithGit('validate')

test('validate fails and names the mod and the file when an engine types file is not tracked', () => {
  assert.equal(marketplaceResult.status, 0, marketplaceResult.stdout + marketplaceResult.stderr)
  assert.equal(untrackedResult.status, 1, untrackedResult.stdout + untrackedResult.stderr)
  const failures = untrackedResult.stderr.split('\n').filter((line) => line.startsWith('FAIL '))
  assert.deepEqual(failures, [
    `FAIL snapshot: ${untrackedSnapshotFile} of the engine types is not tracked by git, so a fresh clone and CI miss it; run \`git add -f ${untrackedSnapshotFile}\` and commit it`,
  ])
})

test('validate passes when every laid engine types file is tracked', () => {
  assert.equal(trackedResult.status, 0, trackedResult.stdout + trackedResult.stderr)
})

function writePlugin(dir, manifest) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
}

function makeRepoWithProbes() {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-probes-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  mkdirSync(join(root, '.claude-plugin'))
  mkdirSync(join(root, 'probes', 'stray', 'hooks'), { recursive: true })
  writeFileSync(join(root, 'probes', 'stray', 'hooks', 'register.ts'), 'export {}\n')
  const probe = join(root, 'probes', 'untyped')
  writePlugin(probe, { name: 'untyped-probe', version: '0.1.0', description: 'A probe.' })
  writeFileSync(
    join(probe, 'tsconfig.json'),
    JSON.stringify({ extends: './.claude-plugin/types/tsconfig.json', include: ['hooks'] }),
  )
  writePlugin(join(root, 'mods', 'listed'), {
    name: 'listed',
    version: '0.1.0',
    description: 'A mod.',
  })
  return { root }
}

const probesRepo = makeRepoWithProbes()
const probesTypecheck = runMods(probesRepo, 'typecheck', emptyBin)

test('typecheck fails and names a folder under probes/ that has no plugin.json', () => {
  assert.equal(probesTypecheck.status, 1, probesTypecheck.stdout + probesTypecheck.stderr)
  assert.ok(
    failLines(probesTypecheck).includes(
      'FAIL probes/stray: no .claude-plugin/plugin.json; a folder under probes/ is a mod',
    ),
    probesTypecheck.stderr,
  )
})

test('typecheck names a probe by its folder under probes/ and gives the lay command with that folder', () => {
  assert.match(probesTypecheck.stderr, /FAIL probes\/untyped: no laid types; tsc did not run/)
  assert.match(probesTypecheck.stderr, /claude --plugin-dir probes\/untyped\b/)
})

const criterionTitle = 'When the tab draws 30 agents, the draw reads the state 5 times'
const timedTestSource = `import { describe, test } from 'claude-code/testing'
const CRITERION = '${criterionTitle}'
const ROOM_TO_FILL_MS = 30_000
const withRoomToFill = { ...withWorkitems, timeoutMs: ROOM_TO_FILL_MS }
describe(CRITERION, () => {
  for (const agents of [1, 30]) {
    test(\`a draw with \${String(agents)} agents\`, withRoomToFill, async () => {})
  }
  test('a short draw', { timeoutMs: 600 }, async () => {})
  test('a default draw', async () => {})
})
`

function testOutput(lines) {
  return `\ntimed.test.ts:\n${lines.join('\n')}\n\n ${lines.length} pass\n 0 fail\nRan ${lines.length} tests across 1 file. [3.21s]\n`
}

const otherTestFiles = ['other.test.ts', 'hooks/inner.test.ts']

function makeTimedRepo(source = timedTestSource, { withGit = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-times-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  writeFileSync(
    join(root, 'scripts', 'passing.test.mjs'),
    "import { test } from 'node:test'\ntest('passes', () => {})\n",
  )
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  const mod = join(root, 'mods', 'timed')
  mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
  mkdirSync(join(mod, 'hooks'))
  writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'timed' }))
  writeFileSync(join(mod, 'timed.test.ts'), source)
  for (const file of otherTestFiles) {
    writeFileSync(
      join(mod, file),
      "import { test } from 'claude-code/testing'\ntest('another file', async () => {})\n",
    )
  }
  if (withGit) git(root, 'init', '--quiet')
  return { root, withGit }
}

function makeTimedClaude(outputs) {
  return makeFakeClaude(String.raw`const { appendFileSync, existsSync, readdirSync, readFileSync } = require('node:fs')
const { join, sep } = require('node:path')
const outputs = ${JSON.stringify(outputs)}
const callsPath = join(__dirname, 'calls.jsonl')
const made = existsSync(callsPath) ? readFileSync(callsPath, 'utf8').split('\n').filter(Boolean).length : 0
const dir = process.argv[4]
const testFiles = readdirSync(dir, { recursive: true })
  .filter((path) => /\.test\.tsx?$/.test(path))
  .map((path) => path.split(sep).join('/'))
  .sort()
appendFileSync(callsPath, JSON.stringify({ dir, testFiles }) + '\n')
process.stdout.write(outputs[Math.min(made, outputs.length - 1)])`)
}

function readCalls(bin) {
  const path = join(bin, 'calls.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function runTimedGate(repo, outputs, { runnerEnv = {} } = {}) {
  const bin = makeTimedClaude(Array.isArray(outputs) ? outputs : [outputs])
  const path = repo.withGit ? `${bin}${delimiter}${process.env.PATH}` : bin
  const env = { ...environmentWithoutGit, PATH: path }
  delete env.GITHUB_ACTIONS
  const result = spawnSync(process.execPath, [join(repo.root, 'scripts', 'mods.mjs'), 'test'], {
    cwd: repo.root,
    encoding: 'utf8',
    env: { ...env, ...runnerEnv },
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: readCalls(bin),
  }
}

function runTimedTests(output, { runnerEnv = {}, source = timedTestSource } = {}) {
  return runTimedGate(makeTimedRepo(source), output, { runnerEnv })
}

const loadPattern = /a load average of \d+\.\d{2} on \d+ CPUs/g
const shownLoad = 'a load average of LOAD on CPUS CPUs'

function prefixedLines(text, prefix) {
  return text
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.replace(loadPattern, shownLoad))
}

function failLines(result) {
  return prefixedLines(result.stderr, 'FAIL ')
}

const overBoth = (title, limitMs, firstMs, aloneMs, atLeastMs, machine = '') =>
  `FAIL timed: timed.test.ts test "${title}" took ${String(firstMs)} ms of its ${String(limitMs)} ms limit in the suite run and ${String(aloneMs)} ms when it ran again alone, more than a third both times${machine}, at ${shownLoad}, so a slower CI runner can time it out; make it faster, or set timeoutMs in its TestOptions to at least ${String(atLeastMs)} ms`
const passedAlone = (title, limitMs, firstMs, aloneMs) =>
  `NOTE timed: timed.test.ts test "${title}" took ${String(firstMs)} ms of its ${String(limitMs)} ms limit in the suite run, more than a third, and ${String(aloneMs)} ms when it ran again alone, at most a third, at ${shownLoad}, so the gate passes it`

function assertRanAgainAlone(result, calls) {
  assert.equal(result.calls.length, calls, JSON.stringify(result.calls))
  const [suite, ...again] = result.calls
  assert.deepEqual(suite.testFiles, ['hooks/inner.test.ts', 'other.test.ts', 'timed.test.ts'])
  for (const call of again) {
    assert.notEqual(call.dir, suite.dir)
    assert.equal(existsSync(call.dir), false, `${call.dir} is left after the gate`)
    assert.deepEqual(call.testFiles, ['timed.test.ts'])
  }
}

const shortDraw = `${criterionTitle} > a short draw`
const defaultDraw = `${criterionTitle} > a default draw`
const overShareOutput = testOutput([
  `(pass) ${criterionTitle} > a draw with 1 agents [1667.01ms]`,
  `(pass) ${criterionTitle} > a draw with 30 agents [9999.00ms]`,
  `(pass) ${shortDraw} [200.01ms]`,
  `(pass) ${defaultDraw} [1667.67ms]`,
])
const overShareResult = runTimedTests(overShareOutput)

test('test fails and names the mod, the test, both times, the load and its limit when a test takes more than a third of its limit in the suite run and again alone', () => {
  assert.equal(overShareResult.status, 1, overShareResult.stdout + overShareResult.stderr)
  assert.deepEqual(failLines(overShareResult), [
    overBoth(shortDraw, 600, 200.01, 200.01, 601),
    overBoth(defaultDraw, 5000, 1667.67, 1667.67, 5004),
  ])
  assert.match(overShareResult.stdout, /^\(pass\) .+ > a default draw \[1667\.67ms\]$/m)
  assertRanAgainAlone(overShareResult, 2)
})

const passedAloneResult = runTimedTests([
  overShareOutput,
  testOutput([`(pass) ${shortDraw} [200.00ms]`, `(pass) ${defaultDraw} [1666.66ms]`]),
])

test('test passes a test over a third of its limit in the suite run that takes at most a third when it runs again alone, and notes both times and the load', () => {
  assert.equal(passedAloneResult.status, 0, passedAloneResult.stdout + passedAloneResult.stderr)
  assert.deepEqual(failLines(passedAloneResult), [])
  assert.deepEqual(prefixedLines(passedAloneResult.stdout, 'NOTE timed: '), [
    passedAlone(shortDraw, 600, 200.01, 200),
    passedAlone(defaultDraw, 5000, 1667.67, 1666.66),
  ])
  assert.match(passedAloneResult.stdout, /^test: passed$/m)
  assertRanAgainAlone(passedAloneResult, 2)
})

test('test notes by name that it keeps no count of the runs alone when git does not answer', () => {
  assert.match(
    passedAloneResult.stdout,
    /^NOTE test: git rev-parse --git-common-dir did not answer, so the gate keeps no count of the tests that ran again alone$/m,
  )
})

const justOverAloneResult = runTimedTests([
  overShareOutput,
  testOutput([`(pass) ${shortDraw} [200.01ms]`, `(pass) ${defaultDraw} [1666.67ms]`]),
])

test('test keeps the limit of 5000 ms, the declared limit and the share of a third for a test that runs again alone', () => {
  assert.equal(
    justOverAloneResult.status,
    1,
    justOverAloneResult.stdout + justOverAloneResult.stderr,
  )
  assert.deepEqual(failLines(justOverAloneResult), [
    overBoth(shortDraw, 600, 200.01, 200.01, 601),
    overBoth(defaultDraw, 5000, 1667.67, 1666.67, 5004),
  ])
})

const referenceTimes = [
  ['a draw with 30 agents of 20 tasks reads the state 5 times', 1856],
  [
    'a session from a version that kept no agentPlans draws every plan on the first draw and reads the state 5 times from the second',
    1130,
  ],
  ['ignores a call that completes after its session ended', 865],
  ['closes a background call after 30 minutes without a notification', 572],
  [
    'the this session tab draws each Button once, under its own key, in the order a person reads the tab, before the Add input',
    418,
  ],
]
const twiceSlower = ' on a machine 2.00 times slower than the reference times'
const scaledReferenceResults = referenceTimes.map(([title, ms]) =>
  runTimedTests([
    testOutput([
      `(pass) Reference > ${title} [${(ms * 2).toFixed(2)}ms]`,
      `(pass) ${shortDraw} [400.01ms]`,
      `(pass) ${defaultDraw} [3400.00ms]`,
    ]),
    testOutput([
      `(pass) Reference > ${title} [1.00ms]`,
      `(pass) ${shortDraw} [400.00ms]`,
      `(pass) ${defaultDraw} [3333.34ms]`,
    ]),
  ]),
)

test('test keeps each of the five reference times when a test runs again alone on a machine twice as slow', () => {
  for (const result of scaledReferenceResults) {
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(
      result.stdout,
      /^test: the reference tests ran 2\.00 times slower than their reference times, so the time share scales by that factor$/m,
    )
    assert.deepEqual(failLines(result), [
      overBoth(defaultDraw, 5000, 3400, 3333.34, 5100, twiceSlower),
    ])
  }
})

const missingAloneResult = runTimedTests([
  overShareOutput,
  testOutput([`(pass) ${shortDraw} [200.00ms]`]),
])

test('test fails by name a test over a third of its limit when its run alone prints no time for it', () => {
  assert.equal(missingAloneResult.status, 1, missingAloneResult.stdout + missingAloneResult.stderr)
  assert.deepEqual(failLines(missingAloneResult), [
    `FAIL timed: timed.test.ts test "${defaultDraw}" took 1667.67 ms of its 5000 ms limit in the suite run, more than a third, and its run again alone printed no time for it, at ${shownLoad}, so the gate cannot pass it; make it faster, or set timeoutMs in its TestOptions to at least 5004 ms`,
  ])
})

const overOnceOutputs = (aloneMs) => [
  testOutput([`(pass) ${defaultDraw} [1667.67ms]`]),
  testOutput([`(pass) ${defaultDraw} [${aloneMs}ms]`]),
]
const quietOutput = testOutput([`(pass) ${defaultDraw} [1000.00ms]`])
const warnLines = (result) => prefixedLines(result.stdout, 'WARN ')
const creepWarning = (lastRuns, inAll, aloneMs, percent) =>
  `WARN timed: timed.test.ts test "${defaultDraw}" ran again alone ${lastRuns}, ${inAll}, and took ${String(aloneMs)} ms alone, ${String(percent)} percent of its 5000 ms limit; a test that runs again alone in 3 of 5 gate runs, or takes more than a quarter of its limit alone, comes near its limit, so make it faster or set timeoutMs in its TestOptions`

const creepRepo = makeTimedRepo(timedTestSource, { withGit: true })
const creepRuns = [true, false, true, false, false, true, true].map((ranAgain) =>
  runTimedGate(creepRepo, ranAgain ? overOnceOutputs('1000.00') : quietOutput),
)

test('test warns by name with the count and the share when a test ran again alone in 3 of its last 5 gate runs', () => {
  for (const result of creepRuns) assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(creepRuns.map(warnLines), [
    [],
    [],
    [],
    [],
    [],
    [],
    [creepWarning('in 3 of its last 5 gate runs', '4 times in all', 1000, 20)],
  ])
})

test('test keeps the count of runs alone under the git common directory and adds no file to the work tree', () => {
  assert.ok(existsSync(join(creepRepo.root, '.git', 'handily-test-reruns.json')))
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: creepRepo.root,
    encoding: 'utf8',
    env: environmentWithoutGit,
  })
  assert.equal(status.status, 0, status.stderr)
  assert.match(status.stdout, /mods\/timed\/timed\.test\.ts/)
  assert.doesNotMatch(status.stdout, /rerun/)
})

const quarterRepo = makeTimedRepo(timedTestSource, { withGit: true })
const quarterRuns = ['1250.00', '1250.01'].map((aloneMs) =>
  runTimedGate(quarterRepo, overOnceOutputs(aloneMs)),
)

test('test warns by name with the count and the share when a test that ran again alone took more than a quarter of its limit alone', () => {
  for (const result of quarterRuns) assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(quarterRuns.map(warnLines), [
    [],
    [creepWarning('in each of its last 2 gate runs', '2 times in all', 1250.01, 25)],
  ])
})

const fewRunsRepo = makeTimedRepo(timedTestSource, { withGit: true })
const fewRuns = [overOnceOutputs('1250.01'), quietOutput, overOnceOutputs('1250.01')].map(
  (outputs) => runTimedGate(fewRunsRepo, outputs),
)

test('test words the warning for fewer than 5 gate runs and says once for one run alone', () => {
  for (const result of fewRuns) assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(fewRuns.map(warnLines), [
    [creepWarning('in its last gate run', 'once in all', 1250.01, 25)],
    [],
    [creepWarning('in 2 of its last 3 gate runs', '2 times in all', 1250.01, 25)],
  ])
})

const longFailingOutput = testOutput([
  ...Array.from(
    { length: 3000 },
    (_, at) => `(pass) ${criterionTitle} > a draw with 1 agents and row ${String(at)} [1.00ms]`,
  ),
  `(pass) ${criterionTitle} > a default draw [1667.67ms]`,
])
const longFailingResult = runTimedTests(longFailingOutput)

test('test prints the whole output of a failing mod on a pipe, up to its last line', () => {
  assert.equal(longFailingResult.status, 1, longFailingResult.stderr)
  assert.ok(longFailingOutput.length > 4 * 65_536)
  assert.match(longFailingResult.stdout, /^Ran 3001 tests across 1 file\. \[3\.21s\]$/m)
})

const underShareResult = runTimedTests(
  testOutput([
    `(pass) ${criterionTitle} > a draw with 1 agents [12.50ms]`,
    `(pass) ${criterionTitle} > a draw with 30 agents [10000.00ms]`,
    `(pass) ${criterionTitle} > a short draw [200.00ms]`,
    `(pass) ${criterionTitle} > a default draw [1666.66ms]`,
  ]),
)

test('test passes when every test takes at most a third of its default or declared limit', () => {
  assert.equal(underShareResult.status, 0, underShareResult.stdout + underShareResult.stderr)
  assert.deepEqual(failLines(underShareResult), [])
  assert.match(underShareResult.stdout, /^test: passed$/m)
  assert.equal(underShareResult.calls.length, 1)
})

const ciRunnerResult = runTimedTests(overShareOutput, {
  runnerEnv: { GITHUB_ACTIONS: 'true' },
})

test('test on a GitHub Actions runner names a test over a third of its limit in a note and passes', () => {
  assert.equal(ciRunnerResult.status, 0, ciRunnerResult.stdout + ciRunnerResult.stderr)
  assert.deepEqual(failLines(ciRunnerResult), [])
  assert.match(
    ciRunnerResult.stdout,
    /^NOTE timed: timed\.test\.ts test ".+ > a default draw" took 1667\.67 ms of its 5000 ms limit, more than a third,/m,
  )
})

test('test on a GitHub Actions runner runs no test again alone', () => {
  assert.equal(ciRunnerResult.calls.length, 1)
})

const referenceLines = (factor) =>
  referenceTimes
    .slice(2)
    .map(([title, ms]) => `(pass) Reference > ${title} [${(ms * factor).toFixed(2)}ms]`)

const slowMachineResult = runTimedTests(
  testOutput([
    ...referenceLines(4),
    `(pass) ${criterionTitle} > a short draw [800.00ms]`,
    `(pass) ${criterionTitle} > a default draw [6667.00ms]`,
  ]),
)

test('test scales the share by the median ratio of the reference tests on a slower machine', () => {
  assert.equal(slowMachineResult.status, 1, slowMachineResult.stdout + slowMachineResult.stderr)
  assert.match(
    slowMachineResult.stdout,
    /^test: the reference tests ran 4\.00 times slower than their reference times, so the time share scales by that factor$/m,
  )
  assert.deepEqual(failLines(slowMachineResult), [
    overBoth(
      defaultDraw,
      5000,
      6667,
      6667,
      5001,
      ' on a machine 4.00 times slower than the reference times',
    ),
  ])
})

const fastMachineResult = runTimedTests(
  testOutput([...referenceLines(0.5), `(pass) ${criterionTitle} > a default draw [1667.67ms]`]),
)

test('test keeps the share of a third when the reference tests run at or below their reference times', () => {
  assert.equal(fastMachineResult.status, 1, fastMachineResult.stdout + fastMachineResult.stderr)
  assert.doesNotMatch(fastMachineResult.stdout, /times slower than their reference times/)
  assert.deepEqual(failLines(fastMachineResult), [
    overBoth(defaultDraw, 5000, 1667.67, 1667.67, 5004),
  ])
})

const sharedTitleSource = `import { describe, test } from 'claude-code/testing'
const nextTitle = (): string => 'a draw with lots of agents'
describe('D', () => {
  for (const agents of [1, 30]) {
    test(\`a draw with \${String(agents)} agents\`, { timeoutMs: 30000 }, async () => {})
  }
  test('a draw with many agents', async () => {})
  describe('a draw with', () => {
    test('no agents', async () => {})
  })
  test('the same draw', { timeoutMs: 30000 }, async () => {})
  test('the same draw', async () => {})
})
describe('E', () => {
  test(\`a draw with \${String(2)} agents\`, { timeoutMs: 30000 }, async () => {})
  test(nextTitle(), async () => {})
})
`
const sharedTitleResult = runTimedTests(
  testOutput([
    '(pass) D > a draw with 1 agents [12.00ms]',
    '(pass) D > a draw with 30 agents [9000.00ms]',
    '(pass) D > a draw with many agents [4000.00ms]',
    '(pass) D > a draw with > no agents [4000.00ms]',
    '(pass) D > the same draw [100.00ms]',
    '(pass) D > the same draw [4000.00ms]',
    '(pass) E > a draw with 2 agents [100.00ms]',
    '(pass) E > a draw with lots of agents [4000.00ms]',
  ]),
  { source: sharedTitleSource },
)

test('test keeps the 5000 ms limit of a test without timeoutMs whose title a declared title also matches', () => {
  assert.equal(sharedTitleResult.status, 1, sharedTitleResult.stdout + sharedTitleResult.stderr)
  const refused = (title) => overBoth(title, 5000, 4000, 4000, 12000)
  const unhonoured = (title, declaredLine, pattern, line) =>
    `FAIL timed: timed.test.ts test "${title}" matches the timeoutMs of 30000 ms at line ${String(declaredLine)} and also ${pattern} of the test at line ${String(line)} with a limit of 5000 ms, so the gate cannot honour the 30000 ms; give each test a title that no other test in the file matches, or move the test with timeoutMs to a file where every title is a string literal`
  assert.deepEqual(failLines(sharedTitleResult), [
    refused('D > a draw with many agents'),
    refused('D > a draw with > no agents'),
    unhonoured('D > the same draw', 11, '/^D > the same draw$/', 12),
    refused('D > the same draw'),
    unhonoured('E > a draw with 2 agents', 15, '/^E > .*$/', 16),
    unhonoured('E > a draw with lots of agents', 15, '/^E > .*$/', 16),
    refused('E > a draw with lots of agents'),
  ])
})

const helperTitleSource = `import { describe, test } from 'claude-code/testing'
const GENERATED_TIMEOUT_MS = 10000
const drawn = (title: string): void => {
  test(title, async () => {})
}
describe('flowchart drawings', () => {
  drawn('a small chart')
  test('500 generated charts draw', { timeoutMs: GENERATED_TIMEOUT_MS }, async () => {})
})
`
const helperTitleResult = runTimedTests(
  testOutput([
    '(pass) flowchart drawings > a small chart [1.00ms]',
    '(pass) flowchart drawings > 500 generated charts draw [100.00ms]',
  ]),
  { source: helperTitleSource },
)

test('test fails by name when a declared timeoutMs cannot count because a test title that the gate cannot read also matches', () => {
  assert.equal(helperTitleResult.status, 1, helperTitleResult.stdout + helperTitleResult.stderr)
  assert.deepEqual(failLines(helperTitleResult), [
    'FAIL timed: timed.test.ts test "flowchart drawings > 500 generated charts draw" matches the timeoutMs of 10000 ms at line 8 and also /^.*$/ of the test at line 4 with a limit of 5000 ms, so the gate cannot honour the 10000 ms; give each test a title that no other test in the file matches, or move the test with timeoutMs to a file where every title is a string literal',
  ])
})

const keptOnOneTitleSource = `import { test } from 'claude-code/testing'
for (const n of [500]) {
  test(\`draws \${String(n)} charts\`, { timeoutMs: 30000 }, async () => {})
}
for (const n of [5]) {
  test(\`draws \${String(n)} big charts\`, async () => {})
}
`
const keptOnOneTitleResult = runTimedTests(
  testOutput(['(pass) draws 500 charts [9000.00ms]', '(pass) draws 5 big charts [100.00ms]']),
  { source: keptOnOneTitleSource },
)

test('test passes when a declared timeoutMs keeps its limit on one title it matches and a lower pattern also matches another', () => {
  assert.equal(
    keptOnOneTitleResult.status,
    0,
    keptOnOneTitleResult.stdout + keptOnOneTitleResult.stderr,
  )
  assert.deepEqual(failLines(keptOnOneTitleResult), [])
})

const lostOnEveryTitleSource = `import { test } from 'claude-code/testing'
const named = (title: string): void => {
  test(title, async () => {})
}
for (const n of [500, 600]) {
  test(\`draws \${String(n)} charts\`, { timeoutMs: 30000 }, async () => {})
}
named('a chart')
`
const lostOnEveryTitleResult = runTimedTests(
  testOutput([
    '(pass) a chart [1.00ms]',
    '(pass) draws 500 charts [100.00ms]',
    '(pass) draws 600 charts [100.00ms]',
  ]),
  { source: lostOnEveryTitleSource },
)

test('test fails by name on each title of a declared timeoutMs that a lower pattern overrides on every title it matches', () => {
  assert.equal(
    lostOnEveryTitleResult.status,
    1,
    lostOnEveryTitleResult.stdout + lostOnEveryTitleResult.stderr,
  )
  const lost = (title) =>
    `FAIL timed: timed.test.ts test "${title}" matches the timeoutMs of 30000 ms at line 6 and also /^.*$/ of the test at line 3 with a limit of 5000 ms, so the gate cannot honour the 30000 ms; give each test a title that no other test in the file matches, or move the test with timeoutMs to a file where every title is a string literal`
  assert.deepEqual(failLines(lostOnEveryTitleResult), [
    lost('draws 500 charts'),
    lost('draws 600 charts'),
  ])
})

const untimedResult = runTimedTests('\ntimed.test.ts:\n\n 4 pass\n 0 fail\n')

test('test fails by name when claude plugin test prints no test time', () => {
  assert.equal(untimedResult.status, 1, untimedResult.stdout + untimedResult.stderr)
  assert.deepEqual(failLines(untimedResult), [
    'FAIL timed: claude plugin test printed no test time such as "(pass) name [12.34ms]", so the test time gate read no test',
  ])
})

const quickOutput = '\n(pass) quick [1.00ms]\n'
const shardCount = 3

function makeShardedRepo(options = {}) {
  const repo = makeTimedRepo(timedTestSource, options)
  const second = join(repo.root, 'mods', 'second')
  mkdirSync(join(second, '.claude-plugin'), { recursive: true })
  writeFileSync(join(second, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'second' }))
  writeFileSync(
    join(second, 'second.test.ts'),
    `import { test } from 'claude-code/testing'\ntest('${'a long title '.repeat(400)}', async () => {})\n`,
  )
  return repo
}

function runShardGate(repo, bin, args) {
  const env = { ...environmentWithoutGit, PATH: bin }
  delete env.GITHUB_ACTIONS
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, [join(repo.root, 'scripts', 'mods.mjs'), ...args], {
    cwd: repo.root,
    encoding: 'utf8',
    env,
  })
}

const shardedRepo = makeShardedRepo()
const shardRuns = Array.from({ length: shardCount }, (_, index) => {
  const bin = makeTimedClaude([quickOutput])
  const result = runShardGate(shardedRepo, bin, ['test', '--shard', `${String(index + 1)}/3`])
  return { result, calls: readCalls(bin) }
})

function callKeys(call) {
  const mod = call.dir.split(/[\\/]/).at(-1)
  return call.testFiles.map((file) => `${mod}/${file}`)
}

test('test --shard runs every test file of every mod in exactly one shard', () => {
  for (const { result } of shardRuns) assert.equal(result.status, 0, result.stdout + result.stderr)
  const keys = shardRuns.flatMap(({ calls }) => calls.flatMap(callKeys))
  assert.deepEqual(keys.toSorted(), [
    'second/second.test.ts',
    'timed/hooks/inner.test.ts',
    'timed/other.test.ts',
    'timed/timed.test.ts',
  ])
})

test('test --shard runs a mod in its own folder when the shard holds all its test files', () => {
  assert.deepEqual(
    shardRuns[0].calls.map((call) => call.dir),
    [join(shardedRepo.root, 'mods', 'second')],
  )
})

test('test --shard runs the part of a split mod in a copy that it removes afterwards', () => {
  const split = shardRuns.slice(1).flatMap(({ calls }) => calls)
  assert.equal(split.length, 2)
  for (const call of split) {
    assert.notEqual(call.dir, join(shardedRepo.root, 'mods', 'timed'))
    assert.equal(existsSync(call.dir), false, `${call.dir} is left after the gate`)
  }
})

test('test --shard names its shard and file count and leaves the scripts tests to test-scripts', () => {
  assert.match(
    shardRuns[2].result.stdout,
    /^test: shard 3 of 3 runs 2 test file\(s\) of 1 mod\(s\); node scripts\/mods\.mjs test-scripts runs the scripts tests$/m,
  )
  for (const { result } of shardRuns) assert.doesNotMatch(result.stdout, /passes/)
})

test('test-scripts runs the scripts tests and no mod test', () => {
  const bin = makeTimedClaude([quickOutput])
  const result = runShardGate(shardedRepo, bin, ['test-scripts'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /passes/)
  assert.deepEqual(readCalls(bin), [])
})

test('test refuses a shard that is not one of its count and names the form', () => {
  for (const shard of ['4/3', '0/3', 'two', '1/0']) {
    const bin = makeTimedClaude([quickOutput])
    const result = runShardGate(shardedRepo, bin, ['test', '--shard', shard])
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.ok(
      result.stderr.includes(
        `test: --shard ${shard} is not one shard of a count, such as --shard 2/4`,
      ),
      result.stderr,
    )
    assert.deepEqual(readCalls(bin), [])
  }
})

test('test --file runs only the named test files in a copy of the mod that it removes afterwards', () => {
  const bin = makeTimedClaude([quickOutput])
  const result = runShardGate(shardedRepo, bin, ['test', '--file', 'mods/timed/other.test.ts'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const calls = readCalls(bin)
  assert.deepEqual(calls.flatMap(callKeys), ['timed/other.test.ts'])
  for (const call of calls) {
    assert.notEqual(call.dir, join(shardedRepo.root, 'mods', 'timed'))
    assert.equal(existsSync(call.dir), false, `${call.dir} is left after the gate`)
  }
  assert.match(
    result.stdout,
    /^test: --file runs 1 test file\(s\) of 1 mod\(s\); npm test runs every test file$/m,
  )
  assert.doesNotMatch(result.stdout, /passes/)
})

test('test --file takes files of two mods and runs a mod whose every test file it names in its own folder', () => {
  const bin = makeTimedClaude([quickOutput])
  const result = runShardGate(shardedRepo, bin, [
    'test',
    '--file',
    './mods/timed/hooks/inner.test.ts',
    '--file',
    'mods/second/second.test.ts',
  ])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const calls = readCalls(bin)
  assert.deepEqual(calls.flatMap(callKeys).toSorted(), [
    'second/second.test.ts',
    'timed/hooks/inner.test.ts',
  ])
  assert.ok(calls.some((call) => call.dir === join(shardedRepo.root, 'mods', 'second')))
})

test('test --file refuses a path that is no test file of a mod and names the form', () => {
  const refusals = [
    ['scripts/mods.mjs', 'is not in the folder of a mod'],
    ['mods/timed/hooks/register.ts', 'is not a *.test.ts or *.test.tsx file'],
    ['mods/timed/missing.test.ts', 'names no test file of timed'],
  ]
  for (const [path, problem] of refusals) {
    const bin = makeTimedClaude([quickOutput])
    const result = runShardGate(shardedRepo, bin, ['test', '--file', path])
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.ok(
      result.stderr.includes(
        `test: --file ${path} ${problem}; give a test file of a mod, such as --file mods/handily-board/board.test.ts`,
      ),
      result.stderr,
    )
    assert.deepEqual(readCalls(bin), [])
  }
})

test('test refuses --file together with --shard and names both commands', () => {
  const bin = makeTimedClaude([quickOutput])
  const result = runShardGate(shardedRepo, bin, [
    'test',
    '--shard',
    '1/3',
    '--file',
    'mods/timed/other.test.ts',
  ])
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.ok(
    result.stderr.includes(
      'test: --file and --shard do not go together; run node scripts/mods.mjs test --file <path> alone, or node scripts/mods.mjs test --shard <index>/<count>',
    ),
    result.stderr,
  )
  assert.deepEqual(readCalls(bin), [])
})

test('test with no --file runs every test file of every mod', () => {
  const bin = makeTimedClaude([quickOutput])
  const result = runShardGate(shardedRepo, bin, ['test'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(readCalls(bin).flatMap(callKeys).toSorted(), [
    'second/second.test.ts',
    'timed/hooks/inner.test.ts',
    'timed/other.test.ts',
    'timed/timed.test.ts',
  ])
})

function makeStagedTree(files) {
  const tree = mkdtempSync(join(tmpdir(), 'handily-staged-'))
  after(() => rmSync(tree, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(tree, path, '..'), { recursive: true })
    writeFileSync(join(tree, path), text)
  }
  return tree
}

const stagedTreeFiles = {
  'scripts/shared.mjs': 'export const shared = 1\n',
  'scripts/importer.test.mjs': "import { shared } from './shared.mjs'\n",
  'scripts/tool.mjs': 'export const tool = 1\n',
  'scripts/tool.test.mjs': "const tool = join(root, 'scripts', 'tool.mjs')\n",
  'scripts/alone.test.mjs': "import { test } from 'node:test'\n",
  'mods/alpha/hooks/register.ts': 'export const alpha = 1\n',
  'mods/alpha/alpha.test.ts': "import { alpha } from './hooks/register'\n",
  'mods/alpha/hooks/inner.test.ts': "import { alpha } from './register'\n",
  'mods/beta/hooks/register.ts': "import { shared } from '../../../scripts/shared.mjs'\n",
  'mods/beta/beta.test.ts': "import { beta } from './hooks/register'\n",
  'mods/gamma/hooks/register.ts': 'export const gamma = 1\n',
  'mods/gamma/gamma.test.ts': "import { gamma } from './hooks/register'\n",
}

function selectStaged(paths) {
  const tree = makeStagedTree(stagedTreeFiles)
  const mods = ['alpha', 'beta', 'gamma'].map((name) => ({ name, dir: join(tree, 'mods', name) }))
  const testFiles = {
    alpha: ['alpha.test.ts', 'hooks/inner.test.ts'],
    beta: ['beta.test.ts'],
    gamma: ['gamma.test.ts'],
  }
  const { filesByMod, scriptTests } = changedTests({
    root: tree,
    mods,
    paths,
    testFilesOf: (mod) => testFiles[mod.name],
  })
  return {
    mods: Object.fromEntries([...filesByMod].map(([name, files]) => [name, [...files].sort()])),
    scriptTests,
  }
}

test('changedTests maps a staged file of one mod to every test file of that mod and no other test', () => {
  assert.deepEqual(selectStaged(['mods/alpha/hooks/register.ts']), {
    mods: { alpha: ['alpha.test.ts', 'hooks/inner.test.ts'] },
    scriptTests: [],
  })
})

test('changedTests maps a staged shared module under scripts to the scripts tests and the mods that import it', () => {
  assert.deepEqual(selectStaged(['scripts/shared.mjs']), {
    mods: { beta: ['beta.test.ts'] },
    scriptTests: ['scripts/importer.test.mjs'],
  })
})

test('changedTests maps a staged script to the scripts test that names its file and to the staged scripts test itself', () => {
  assert.deepEqual(selectStaged(['scripts/tool.mjs', 'scripts/alone.test.mjs']), {
    mods: {},
    scriptTests: ['scripts/alone.test.mjs', 'scripts/tool.test.mjs'],
  })
})

test('changedTests maps a docs-only commit to no test', () => {
  assert.deepEqual(
    selectStaged(['mods/alpha/README.md', 'changelog.d/handily-x1.added.md', 'docs/design.md']),
    { mods: {}, scriptTests: [] },
  )
})

test('changedTests maps a staged generated types path to no test', () => {
  assert.deepEqual(selectStaged(['mods/alpha/.claude-plugin/types/claude-code/index.d.ts']), {
    mods: {},
    scriptTests: [],
  })
})

test('changedTests maps a staged root config path or a path of no mod to no mod test', () => {
  assert.deepEqual(selectStaged(['package.json']).mods, {})
  assert.deepEqual(
    selectStaged(['.claude-plugin/marketplace.json', '.github/workflows/x.yml']).mods,
    {},
  )
})

const stagedModNames = ['alpha', 'beta', 'gamma']

function reachStaged(paths, dependencies = {}, files = stagedTreeFiles) {
  const tree = makeStagedTree(files)
  const mods = stagedModNames.map((name) => ({ name, dir: join(tree, 'mods', name) }))
  const { all, names } = changedMods({
    root: tree,
    mods,
    paths,
    dependenciesOf: (mod) => dependencies[mod.name] ?? [],
  })
  return { all, names: [...names].sort() }
}

const reachedEveryMod = { all: true, names: stagedModNames }

test('changedMods maps a path in the folder of one mod to that mod alone', () => {
  assert.deepEqual(reachStaged(['mods/alpha/hooks/register.ts']), { all: false, names: ['alpha'] })
})

test('changedMods maps a shared module outside the mod folders to the mods that import it, and another script to no mod', () => {
  assert.deepEqual(reachStaged(['scripts/shared.mjs']), { all: false, names: ['beta'] })
  assert.deepEqual(reachStaged(['scripts/tool.mjs', 'scripts/alone.test.mjs']), {
    all: false,
    names: [],
  })
})

test('changedMods maps a docs-only change to no mod', () => {
  assert.deepEqual(
    reachStaged(['mods/alpha/README.md', 'changelog.d/handily-x1.added.md', 'docs/design.md']),
    { all: false, names: [] },
  )
})

test('changedMods maps a dependency mod to its dependants and to their dependants', () => {
  const dependencies = { gamma: ['alpha'], beta: ['gamma'] }
  assert.deepEqual(reachStaged(['mods/alpha/hooks/register.ts'], dependencies), {
    all: false,
    names: ['alpha', 'beta', 'gamma'],
  })
  assert.deepEqual(reachStaged(['mods/gamma/hooks/register.ts'], dependencies), {
    all: false,
    names: ['beta', 'gamma'],
  })
})

test('changedMods maps each root config path and each file of the gate runner to every mod', () => {
  const files = {
    ...stagedTreeFiles,
    'scripts/mods.mjs': "import { scratch } from './scratch.mjs'\n",
    'scripts/scratch.mjs': 'export const scratch = 1\n',
  }
  for (const path of [
    'package.json',
    'package-lock.json',
    'eslint.config.mjs',
    '.prettierrc.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'scripts/mods.mjs',
    'scripts/staged.mjs',
    'scripts/scratch.mjs',
  ]) {
    assert.deepEqual(
      reachStaged(['mods/alpha/hooks/register.ts', path], {}, files),
      reachedEveryMod,
      path,
    )
  }
})

test('changedMods maps a path that maps to no mod to every mod', () => {
  for (const path of [
    'probes/x.ts',
    'basicly.toml',
    '.claude-plugin/marketplace.json',
    'mods/removed/hooks/register.ts',
  ]) {
    assert.deepEqual(reachStaged([path]), reachedEveryMod, path)
  }
})

test('changedMods maps a generated types path to its mod, so the type check keeps it', () => {
  assert.deepEqual(reachStaged(['mods/alpha/.claude-plugin/types/claude-code/index.d.ts']), {
    all: false,
    names: ['alpha'],
  })
})

const changedScriptTest =
  "import { test } from 'node:test'\ntest('the changed scripts test runs', () => {})\n"
const zeroCommit = '0'.repeat(40)

function makeChangedRepo() {
  const repo = makeShardedRepo({ withGit: true })
  writeFileSync(join(repo.root, 'scripts', 'changed-only.test.mjs'), changedScriptTest)
  return repo
}

function writeFiles(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

function makePushedRepo(changes) {
  const repo = makeChangedRepo()
  pinGit(repo.root, 'add', 'mods', 'scripts')
  pinGit(repo.root, 'commit', '--quiet', '-m', 'base')
  const base = pinGit(repo.root, 'rev-parse', 'HEAD')
  pinGit(repo.root, 'update-ref', 'refs/remotes/origin/main', base)
  writeFiles(repo.root, changes)
  pinGit(repo.root, 'add', ...Object.keys(changes))
  pinGit(repo.root, 'commit', '--quiet', '-m', 'lane work')
  return { ...repo, base, head: pinGit(repo.root, 'rev-parse', 'HEAD') }
}

function runChangedGate(repo, { args = [], pushRefs } = {}) {
  const bin = makeTimedClaude([quickOutput])
  const env = { ...environmentWithoutGit, PATH: `${bin}${delimiter}${process.env.PATH}` }
  delete env.GITHUB_ACTIONS
  delete env.NODE_TEST_CONTEXT
  delete env.BASICLY_PUSH_REFS
  if (pushRefs !== undefined) env.BASICLY_PUSH_REFS = pushRefs
  const result = spawnSync(
    process.execPath,
    [join(repo.root, 'scripts', 'mods.mjs'), 'test', '--changed', ...args],
    { cwd: repo.root, encoding: 'utf8', env },
  )
  return { result, calls: readCalls(bin) }
}

function selectionLine(files, mods, scripts, paths, kind) {
  return `test: --changed runs ${files} test file(s) of ${mods} mod(s) and ${scripts} scripts test file(s) for ${paths} ${kind} path(s); npm test runs every test file`
}

test('test --changed runs only the test files of the mod whose file is staged and no scripts test', () => {
  const repo = makeChangedRepo()
  writeFileSync(join(repo.root, 'mods', 'second', 'helper.ts'), 'export const helper = 1\n')
  git(repo.root, 'add', 'mods/second/helper.ts')
  const { result, calls } = runChangedGate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(calls.flatMap(callKeys), ['second/second.test.ts'])
  assert.ok(result.stdout.split('\n').includes(selectionLine(1, 1, 0, 1, 'staged')), result.stdout)
  assert.doesNotMatch(result.stdout, /passes|the changed scripts test runs/)
})

test('test --changed runs a staged scripts test and no mod test', () => {
  const repo = makeChangedRepo()
  git(repo.root, 'add', 'scripts/changed-only.test.mjs')
  const { result, calls } = runChangedGate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(calls, [])
  assert.match(result.stdout, /the changed scripts test runs/)
  assert.doesNotMatch(result.stdout, /passes/)
})

test('test --changed runs no test when only documentation files are staged', () => {
  const repo = makeChangedRepo()
  writeFiles(repo.root, {
    'mods/timed/README.md': '# timed\n',
    'changelog.d/handily-x1.added.md': '- x\n',
  })
  git(repo.root, 'add', 'mods/timed/README.md', 'changelog.d/handily-x1.added.md')
  const { result, calls } = runChangedGate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(calls, [])
  assert.ok(result.stdout.split('\n').includes(selectionLine(0, 0, 0, 2, 'staged')), result.stdout)
  assert.doesNotMatch(result.stdout, /passes|the changed scripts test runs/)
})

test('test --changed runs no test when nothing is staged and says so', () => {
  const repo = makeChangedRepo()
  const { result, calls } = runChangedGate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(calls, [])
  assert.match(
    result.stdout,
    /^test: --changed finds no staged path, so it runs no test; npm test runs every test file$/m,
  )
  assert.doesNotMatch(result.stdout, /passes|the changed scripts test runs/)
})

test('test --changed fails by name when git cannot read the staged paths', () => {
  const repo = makeShardedRepo()
  const { result, calls } = runChangedGate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(calls, [])
  assert.match(
    result.stderr,
    /^FAIL test: --changed cannot read the staged paths with git diff --cached --name-only --no-renames \(.+\); run it in a git work tree with origin\/main fetched, or run node scripts\/mods\.mjs test$/m,
  )
})

test('test --changed in a pre-push hook runs only the test files of the mod changed against origin/main and ignores the index', () => {
  const repo = makePushedRepo({ 'mods/second/helper.ts': 'export const helper = 1\n' })
  writeFileSync(join(repo.root, 'mods', 'timed', 'unpushed.ts'), 'export const unpushed = 1\n')
  git(repo.root, 'add', 'mods/timed/unpushed.ts')
  for (const pushRefs of [
    `refs/heads/lane ${repo.head} refs/heads/lane ${zeroCommit}\n`,
    `refs/heads/lane ${repo.head} refs/heads/lane ${repo.base}\n`,
    '',
  ]) {
    const { result, calls } = runChangedGate(repo, { pushRefs })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(calls.flatMap(callKeys), ['second/second.test.ts'], pushRefs)
    assert.ok(
      result.stdout.split('\n').includes(selectionLine(1, 1, 0, 1, 'pushed')),
      result.stdout,
    )
    assert.doesNotMatch(result.stdout, /passes|the changed scripts test runs/)
  }
})

test('test --changed in a pre-push hook runs no test for a push of documentation files only', () => {
  const repo = makePushedRepo({
    'mods/timed/README.md': '# timed\n',
    'changelog.d/handily-x1.added.md': '- x\n',
  })
  const { result, calls } = runChangedGate(repo, {
    pushRefs: `refs/heads/lane ${repo.head} refs/heads/lane ${zeroCommit}\n`,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(calls, [])
  assert.ok(result.stdout.split('\n').includes(selectionLine(0, 0, 0, 2, 'pushed')), result.stdout)
  assert.doesNotMatch(result.stdout, /passes|the changed scripts test runs/)
})

test('test --changed in a pre-push hook runs no test for a push that only deletes a ref', () => {
  const repo = makePushedRepo({ 'mods/second/helper.ts': 'export const helper = 1\n' })
  const { result, calls } = runChangedGate(repo, {
    pushRefs: `(delete) ${zeroCommit} refs/heads/old ${repo.base}\n`,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(calls, [])
  assert.match(
    result.stdout,
    /^test: --changed finds no pushed path, so it runs no test; npm test runs every test file$/m,
  )
})

test('test --changed in a pre-push hook refuses a pushed ref line that names no commit and runs no test', () => {
  const repo = makePushedRepo({ 'mods/second/helper.ts': 'export const helper = 1\n' })
  const line = `refs/heads/lane --output=x refs/heads/lane ${zeroCommit}`
  const { result, calls } = runChangedGate(repo, { pushRefs: `${line}\n` })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(calls, [])
  assert.ok(
    result.stderr.includes(
      `FAIL test: --changed reads the pushed refs of BASICLY_PUSH_REFS, and the line "${line}" is not "<local ref> <local commit> <remote ref> <remote commit>"; push again, or run node scripts/mods.mjs test`,
    ),
    result.stderr,
  )
})

test('test refuses --changed together with --file or --shard and names the commands', () => {
  const repo = makeChangedRepo()
  for (const args of [
    ['--file', 'mods/timed/other.test.ts'],
    ['--shard', '1/3'],
  ]) {
    const { result, calls } = runChangedGate(repo, { args })
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.ok(
      result.stderr.includes(
        'test: --changed goes with no --file or --shard; run node scripts/mods.mjs test --changed alone',
      ),
      result.stderr,
    )
    assert.deepEqual(calls, [])
  }
})

const scopedSources = {
  clean: 'export const answer = 42\n',
  broken: "export const answer = Math.max('a')\ndebugger\nexport const spaced  =  1\n",
}
const scopedEslintConfig = `export default [
  { ignores: ['**/.claude-plugin/types/**', 'node_modules/**'] },
  { files: ['**/*.ts', '**/*.mjs'], rules: { 'no-debugger': 'error' } },
]
`
const cleanChange = { 'mods/clean/hooks/extra.ts': 'export const extra = 1\n' }
const brokenChange = { 'mods/broken/hooks/more.ts': 'export const more = 1\n' }
const docsChange = {
  'mods/clean/README.md': '# clean\n',
  'changelog.d/handily-x1.added.md': '- x\n',
}

function makeScopedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-scoped-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  for (const name of ['.prettierrc.json', '.prettierignore']) {
    cpSync(join(repoRoot, name), join(root, name))
  }
  writeFiles(root, {
    'eslint.config.mjs': scopedEslintConfig,
    '.agents/plugins/marketplace.json': '{ "plugins": [] }\n',
  })
  for (const [name, source] of Object.entries(scopedSources)) {
    writeFiles(root, {
      [`mods/${name}/.claude-plugin/plugin.json`]: `{\n  "name": "${name}"\n}\n`,
      [`mods/${name}/.claude-plugin/types/tsconfig.json`]: engineTsconfig([]),
      [`mods/${name}/tsconfig.json`]:
        '{\n  "extends": "./.claude-plugin/types/tsconfig.json",\n  "include": ["hooks"]\n}\n',
      [`mods/${name}/hooks/register.ts`]: source,
    })
  }
  git(root, 'init', '--quiet')
  mkdirSync(join(root, '.claude-plugin'))
  const marketplace = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'mods.mjs'), 'marketplace'],
    {
      cwd: root,
      encoding: 'utf8',
      env: environmentWithoutGit,
    },
  )
  assert.equal(marketplace.status, 0, marketplace.stdout + marketplace.stderr)
  pinGit(root, 'add', 'mods', 'scripts', 'eslint.config.mjs', '.claude-plugin', '.agents')
  pinGit(root, 'commit', '--quiet', '-m', 'base')
  return { root }
}

function stageScoped(repo, changes) {
  writeFiles(repo.root, changes)
  git(repo.root, 'add', ...Object.keys(changes))
}

function pushScoped(repo, changes) {
  pinGit(
    repo.root,
    'update-ref',
    'refs/remotes/origin/main',
    pinGit(repo.root, 'rev-parse', 'HEAD'),
  )
  writeFiles(repo.root, changes)
  pinGit(repo.root, 'add', ...Object.keys(changes))
  pinGit(repo.root, 'commit', '--quiet', '-m', 'lane work')
  stageScoped(repo, brokenChange)
  return `refs/heads/lane ${pinGit(repo.root, 'rev-parse', 'HEAD')} refs/heads/lane ${zeroCommit}\n`
}

function makeRecordingClaude() {
  return makeFakeClaude(String.raw`const { appendFileSync } = require('node:fs')
const { join } = require('node:path')
appendFileSync(join(__dirname, 'calls.jsonl'), JSON.stringify({ args: process.argv.slice(2) }) + '\n')`)
}

function runScopedGate(repo, task, { pushRefs } = {}) {
  const bin = makeRecordingClaude()
  const env = { ...environmentWithoutGit, PATH: `${bin}${delimiter}${process.env.PATH}` }
  delete env.GITHUB_ACTIONS
  delete env.NODE_TEST_CONTEXT
  delete env.BASICLY_PUSH_REFS
  if (pushRefs !== undefined) env.BASICLY_PUSH_REFS = pushRefs
  const result = spawnSync(
    process.execPath,
    [join(repo.root, 'scripts', 'mods.mjs'), task, '--changed'],
    { cwd: repo.root, encoding: 'utf8', env },
  )
  const validated = readCalls(bin).map(
    ({ args }) => relative(repo.root, args.at(-1)).split(sep).join('/') || '.',
  )
  return { result, validated, output: result.stdout + result.stderr }
}

function outputLines(result) {
  return result.stdout.split('\n')
}

const everyModLine = (task, command) =>
  `${task}: --changed finds a staged path that reaches every mod, so it runs as ${command}`

test('validate --changed validates only the mod whose file is staged and not the marketplace', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, cleanChange)
  const { result, validated, output } = runScopedGate(repo, 'validate')
  assert.equal(result.status, 0, output)
  assert.deepEqual(validated, ['mods/clean'])
  assert.ok(
    outputLines(result).includes(
      'validate: --changed validates 1 mod(s) (clean) for 1 staged path(s); npm run validate validates every mod and the marketplace',
    ),
    output,
  )
})

test('validate --changed checks the marketplace when a plugin.json of a mod is staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, {
    'mods/clean/.claude-plugin/plugin.json': '{\n  "name": "clean",\n  "version": "0.1.0"\n}\n',
  })
  const { result, validated, output } = runScopedGate(repo, 'validate')
  assert.equal(result.status, 0, output)
  assert.deepEqual(validated, ['.', 'mods/clean'])
})

test('validate --changed validates nothing when only documentation files are staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, docsChange)
  const { result, validated, output } = runScopedGate(repo, 'validate')
  assert.equal(result.status, 0, output)
  assert.deepEqual(validated, [])
  assert.ok(
    outputLines(result).includes(
      'validate: --changed reaches nothing in 2 staged path(s), so it validates no mod; npm run validate validates every mod and the marketplace',
    ),
    output,
  )
})

test('validate --changed validates the marketplace and every mod when a root config path is staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, { ...cleanChange, 'package.json': '{}\n' })
  const { result, validated, output } = runScopedGate(repo, 'validate')
  assert.equal(result.status, 0, output)
  assert.deepEqual(validated, ['.', 'mods/broken', 'mods/clean'])
  assert.ok(outputLines(result).includes(everyModLine('validate', 'npm run validate')), output)
})

test('validate --changed in a pre-push hook validates only the mod changed against origin/main and ignores the index', () => {
  const repo = makeScopedRepo()
  const pushRefs = pushScoped(repo, cleanChange)
  const { result, validated, output } = runScopedGate(repo, 'validate', { pushRefs })
  assert.equal(result.status, 0, output)
  assert.deepEqual(validated, ['mods/clean'])
})

test('typecheck --changed type checks only the mod whose file is staged, so a type error in another mod passes', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, cleanChange)
  const { result, output } = runScopedGate(repo, 'typecheck')
  assert.equal(result.status, 0, output)
  assert.ok(
    outputLines(result).includes(
      'typecheck: --changed type checks 1 mod(s) (clean) for 1 staged path(s); npm run typecheck type checks every mod',
    ),
    output,
  )
})

test('typecheck --changed type checks no mod when only documentation files are staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, docsChange)
  const { result, output } = runScopedGate(repo, 'typecheck')
  assert.equal(result.status, 0, output)
  assert.ok(
    outputLines(result).includes(
      'typecheck: --changed reaches nothing in 2 staged path(s), so it type checks no mod; npm run typecheck type checks every mod',
    ),
    output,
  )
})

test('typecheck --changed type checks every mod when a path that maps to no mod is staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, { ...cleanChange, 'probes/x.ts': 'export const probe = 1\n' })
  const { result, output } = runScopedGate(repo, 'typecheck')
  assert.equal(result.status, 1, output)
  assert.ok(outputLines(result).includes(everyModLine('typecheck', 'npm run typecheck')), output)
  assert.deepEqual(failLines(result), ['FAIL broken: tsc: exit 2'])
})

test('typecheck --changed in a pre-push hook type checks only the mod changed against origin/main', () => {
  const repo = makeScopedRepo()
  const pushRefs = pushScoped(repo, cleanChange)
  const { result, output } = runScopedGate(repo, 'typecheck', { pushRefs })
  assert.equal(result.status, 0, output)
  assert.match(
    result.stdout,
    /^typecheck: --changed type checks 1 mod\(s\) \(clean\) for 1 pushed path\(s\);/m,
  )
})

test('lint --changed lints only the mod whose file is staged, so a lint error in another mod passes', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, cleanChange)
  const { result, output } = runScopedGate(repo, 'lint')
  assert.equal(result.status, 0, output)
  assert.ok(
    outputLines(result).includes(
      'lint: --changed lints 1 mod(s) (clean) and 0 scripts file(s) for 1 staged path(s); npm run lint lints every mod and script',
    ),
    output,
  )
})

test('lint --changed lints a staged scripts file and no mod', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, { 'scripts/extra.mjs': 'debugger\n' })
  const { result, output } = runScopedGate(repo, 'lint')
  assert.equal(result.status, 1, output)
  assert.match(output, /scripts\/extra\.mjs/)
  assert.doesNotMatch(output, /mods\/broken/)
  assert.deepEqual(failLines(result), ['FAIL eslint: exit 1'])
})

test('lint --changed lints no file when only documentation files are staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, docsChange)
  const { result, output } = runScopedGate(repo, 'lint')
  assert.equal(result.status, 0, output)
  assert.ok(
    outputLines(result).includes(
      'lint: --changed reaches nothing in 2 staged path(s), so it lints no file; npm run lint lints every mod and script',
    ),
    output,
  )
})

test('lint --changed lints every mod and script when a root config path is staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, { ...cleanChange, 'package-lock.json': '{}\n' })
  const { result, output } = runScopedGate(repo, 'lint')
  assert.equal(result.status, 1, output)
  assert.ok(outputLines(result).includes(everyModLine('lint', 'npm run lint')), output)
  assert.match(output, /mods\/broken\/hooks\/register\.ts/)
  assert.deepEqual(failLines(result), ['FAIL eslint: exit 1'])
})

test('lint --changed in a pre-push hook lints only the mod changed against origin/main', () => {
  const repo = makeScopedRepo()
  const pushRefs = pushScoped(repo, cleanChange)
  const { result, output } = runScopedGate(repo, 'lint', { pushRefs })
  assert.equal(result.status, 0, output)
  assert.match(
    result.stdout,
    /^lint: --changed lints 1 mod\(s\) \(clean\) and 0 scripts file\(s\) for 1 pushed path\(s\);/m,
  )
})

test('format-check --changed checks only the staged files, so an unformatted file of another mod passes', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, cleanChange)
  const { result, output } = runScopedGate(repo, 'format-check')
  assert.equal(result.status, 0, output)
  assert.ok(
    outputLines(result).includes(
      'format-check: --changed checks the format of 1 file(s) for 1 staged path(s); npm run format:check checks the format of every file',
    ),
    output,
  )
})

test('format-check --changed checks no file when only documentation files outside the code folders are staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, { 'docs/notes.md': '# notes\n', 'changelog.d/handily-x1.added.md': '- x\n' })
  const { result, output } = runScopedGate(repo, 'format-check')
  assert.equal(result.status, 0, output)
  assert.ok(
    outputLines(result).includes(
      'format-check: --changed reaches nothing in 2 staged path(s), so it checks the format of no file; npm run format:check checks the format of every file',
    ),
    output,
  )
})

test('format-check --changed checks every file when a root config path is staged', () => {
  const repo = makeScopedRepo()
  stageScoped(repo, {
    ...cleanChange,
    '.prettierrc.json': readFileSync(join(repoRoot, '.prettierrc.json'), 'utf8'),
  })
  const { result, output } = runScopedGate(repo, 'format-check')
  assert.equal(result.status, 1, output)
  assert.ok(
    outputLines(result).includes(everyModLine('format-check', 'npm run format:check')),
    output,
  )
  assert.deepEqual(
    output
      .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
      .split('\n')
      .filter((line) => line.startsWith('[warn] mods/') || line.startsWith('[warn] scripts/')),
    ['[warn] mods/broken/hooks/register.ts'],
  )
  assert.deepEqual(failLines(result), ['FAIL prettier: exit 1'])
})

test('format-check --changed in a pre-push hook checks only the files changed against origin/main', () => {
  const repo = makeScopedRepo()
  const pushRefs = pushScoped(repo, cleanChange)
  stageScoped(repo, { 'mods/broken/hooks/more.ts': 'export const more  =  1\n' })
  const { result, output } = runScopedGate(repo, 'format-check', { pushRefs })
  assert.equal(result.status, 0, output)
  assert.match(
    result.stdout,
    /^format-check: --changed checks the format of 1 file\(s\) for 1 pushed path\(s\);/m,
  )
})

test('validate, typecheck, lint and format-check refuse a pushed ref line that names no commit and name their own command', () => {
  const repo = makeScopedRepo()
  const line = `refs/heads/lane --output=x refs/heads/lane ${zeroCommit}`
  for (const task of ['validate', 'typecheck', 'lint', 'format-check']) {
    const { result, validated, output } = runScopedGate(repo, task, { pushRefs: `${line}\n` })
    assert.equal(result.status, 1, output)
    assert.deepEqual(validated, [])
    assert.ok(
      result.stderr.includes(
        `FAIL ${task}: --changed reads the pushed refs of BASICLY_PUSH_REFS, and the line "${line}" is not "<local ref> <local commit> <remote ref> <remote commit>"; push again, or run node scripts/mods.mjs ${task}`,
      ),
      output,
    )
  }
})

const testTimesFix = 'node scripts/mods.mjs test-times <log>...'

function writeStoredTimes(repo, text) {
  writeFileSync(join(repo.root, 'scripts', 'test-times.json'), text)
}

test('test --shard balances by the stored test times and times a file with no stored time by its bytes', () => {
  const repo = makeShardedRepo()
  writeStoredTimes(
    repo,
    JSON.stringify({
      'timed/timed.test.ts': 900_000,
      'timed/other.test.ts': 100,
      'second/second.test.ts': 100,
    }),
  )
  const runs = Array.from({ length: shardCount }, (_, index) => {
    const bin = makeTimedClaude([quickOutput])
    const result = runShardGate(repo, bin, ['test', '--shard', `${String(index + 1)}/3`])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return readCalls(bin).flatMap(callKeys).toSorted()
  })
  assert.deepEqual(runs, [
    ['timed/timed.test.ts'],
    ['timed/hooks/inner.test.ts'],
    ['second/second.test.ts', 'timed/other.test.ts'],
  ])
})

test('test --shard refuses stored test times that hold no time in ms and names the command that writes them', () => {
  const repo = makeShardedRepo()
  writeStoredTimes(repo, JSON.stringify({ 'timed/timed.test.ts': 'slow' }))
  const bin = makeTimedClaude([quickOutput])
  const result = runShardGate(repo, bin, ['test', '--shard', '1/3'])
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.ok(
    result.stderr.includes(
      `test: scripts/test-times.json holds no time in ms for timed/timed.test.ts; write it again with ${testTimesFix}`,
    ),
    result.stderr,
  )
  assert.deepEqual(readCalls(bin), [])
})

test('test-times writes the mean time of each test file from CI logs and writes nothing for a log that names an unknown file', () => {
  const repo = makeShardedRepo()
  writeStoredTimes(repo, JSON.stringify({ 'second/second.test.ts': 42, 'gone/gone.test.ts': 9 }))
  const prefix = 'mod tests 1 of 4 on newest Claude Code\tRun the mod tests of this shard\t'
  const byteOrderMark = String.fromCodePoint(0xfeff)
  const ciLog = join(repo.root, 'ci.log')
  writeFileSync(
    ciLog,
    [
      'timed.test.ts:',
      '(pass) a draw [5.00ms]',
      '(pass) a short draw [7.00ms]',
      'inner.test.ts:',
      '(pass) another file [3.00ms]',
    ]
      .map((line) => `${prefix}${byteOrderMark}2026-11-18T20:12:44.5733423Z ${line}`)
      .join('\n'),
  )
  const plainLog = join(repo.root, 'plain.log')
  writeFileSync(plainLog, 'timed.test.ts:\n(pass) a draw [16.00ms]\n')
  const unknownLog = join(repo.root, 'unknown.log')
  writeFileSync(unknownLog, 'unknown.test.ts:\n(pass) a draw [1.00ms]\n')
  const storePath = join(repo.root, 'scripts', 'test-times.json')
  const bin = makeTimedClaude([quickOutput])

  const refused = runShardGate(repo, bin, ['test-times', ciLog, unknownLog])
  assert.equal(refused.status, 1, refused.stdout + refused.stderr)
  assert.deepEqual(failLines(refused), [
    `FAIL test-times: ${unknownLog} times the test file unknown.test.ts, which is no test file of a mod`,
  ])
  assert.deepEqual(JSON.parse(readFileSync(storePath, 'utf8')), {
    'second/second.test.ts': 42,
    'gone/gone.test.ts': 9,
  })

  const written = runShardGate(repo, bin, ['test-times', ciLog, plainLog])
  assert.equal(written.status, 0, written.stdout + written.stderr)
  assert.equal(
    readFileSync(storePath, 'utf8'),
    `${JSON.stringify(
      {
        'second/second.test.ts': 42,
        'timed/hooks/inner.test.ts': 3,
        'timed/timed.test.ts': 14,
      },
      null,
      2,
    )}\n`,
  )
  assert.match(
    written.stdout,
    /^test-times: 1 test file\(s\) have no time and shard by their bytes: timed\/other\.test\.ts$/m,
  )
  assert.deepEqual(readCalls(bin), [])
})

const pinFixtureDate = '2026-01-01T00:00:00Z'
const pinFixtureConfig = [
  ['user.name', 'Fixture Author'],
  ['user.email', 'author@example.invalid'],
  ['commit.gpgsign', 'false'],
  ['tag.gpgsign', 'false'],
].flatMap(([name, value]) => ['-c', `${name}=${value}`])

function pinGit(root, ...args) {
  const result = spawnSync(
    'git',
    [...pinFixtureConfig, '-c', `core.hooksPath=${join(root, '.no-hooks')}`, ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...environmentWithoutGit, GIT_COMMITTER_DATE: pinFixtureDate },
    },
  )
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function writeManifest(root, name, manifest) {
  const dir = join(root, 'mods', name, '.claude-plugin')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
}

const boardAtTag = { version: '0.2.0', description: 'The board at its release tag.' }
const boardTag = 'board--v0.2.0'

function makeRepoWithTaggedMod() {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-pin-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  mkdirSync(join(root, '.claude-plugin'))
  writeManifest(root, 'board', boardAtTag)
  writeManifest(root, 'items', { version: '0.1.0', description: 'Items with no release tag.' })
  pinGit(root, 'init', '--quiet', '--initial-branch=main')
  pinGit(root, 'add', '--', 'mods')
  pinGit(root, 'commit', '--quiet', `--date=${pinFixtureDate}`, '-m', 'release board')
  pinGit(root, 'tag', '-a', boardTag, '-m', 'board 0.2.0')
  writeManifest(root, 'board', { ...boardAtTag, description: 'The board on main after its tag.' })
  pinGit(root, 'add', '--', 'mods')
  pinGit(root, 'commit', '--quiet', `--date=${pinFixtureDate}`, '-m', 'work after the tag')
  return {
    root,
    marketplace: join(root, '.claude-plugin', 'marketplace.json'),
    tagCommit: pinGit(root, 'rev-parse', `${boardTag}^{commit}`),
    tagObject: pinGit(root, 'rev-parse', `refs/tags/${boardTag}`),
    head: pinGit(root, 'rev-parse', 'HEAD'),
  }
}

function runMarketplace(repo, ...args) {
  return spawnSync(
    process.execPath,
    [join(repo.root, 'scripts', 'mods.mjs'), 'marketplace', ...args],
    {
      cwd: repo.root,
      encoding: 'utf8',
      env: environmentWithoutGit,
    },
  )
}

function listedEntry(text, name) {
  return JSON.parse(text).plugins.find((plugin) => plugin.name === name)
}

function pinnedBoard(sha) {
  return {
    name: 'board',
    source: {
      source: 'git-subdir',
      url: 'https://github.com/niksavis/handily.git',
      path: 'mods/board',
      ref: boardTag,
      sha,
    },
    description: boardAtTag.description,
  }
}

const untaggedItemsNote = /^NOTE items: no release tag items--v\* exists yet/m

test('marketplace --pin writes a git-subdir source at the release tag with the peeled commit of an annotated tag and no version', () => {
  const repo = makeRepoWithTaggedMod()
  const result = runMarketplace(repo, '--pin', 'board')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.notEqual(repo.tagCommit, repo.tagObject)
  assert.notEqual(repo.tagCommit, repo.head)
  const text = readFileSync(repo.marketplace, 'utf8')
  const board = listedEntry(text, 'board')
  assert.deepEqual(board, pinnedBoard(repo.tagCommit))
  assert.equal(Object.hasOwn(board, 'version'), false)
  assert.equal(listedEntry(text, 'items'), undefined)
})

test('marketplace --pin lists the pinned mod and no probe, and names no probe in its output', () => {
  const repo = makeRepoWithTaggedMod()
  writePlugin(join(repo.root, 'probes', 'desktop'), {
    name: 'desktop-probe',
    version: '0.1.0',
    description: 'A probe.',
  })
  const result = runMarketplace(repo, '--pin', 'board')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const text = readFileSync(repo.marketplace, 'utf8')
  assert.deepEqual(
    JSON.parse(text).plugins.map((plugin) => plugin.name),
    ['board'],
  )
  assert.doesNotMatch(result.stdout + result.stderr, /desktop-probe|probes\/desktop: /)
})

test('marketplace refuses a mod that has a release tag and no pinned entry, names the mod and the pin command, and writes nothing', () => {
  const repo = makeRepoWithTaggedMod()
  const result = runMarketplace(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(
    result.stderr,
    /^FAIL board: it has the release tag board--v0\.2\.0, and \.claude-plugin\/marketplace\.json does not list it; run `npm run marketplace -- --pin board`$/m,
  )
  assert.equal(existsSync(repo.marketplace), false)
})

test('marketplace refuses a relative entry of a mod that has a release tag and writes nothing', () => {
  const repo = makeRepoWithTaggedMod()
  const relative = { name: 'board', source: './mods/board', version: '0.2.0', description: 'x' }
  const before = `${JSON.stringify({ name: 'niksavis', plugins: [relative] }, null, 2)}\n`
  writeFileSync(repo.marketplace, before)
  const result = runMarketplace(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /^FAIL board: it has the release tag board--v0\.2\.0/m)
  assert.equal(readFileSync(repo.marketplace, 'utf8'), before)
})

test('marketplace leaves out a mod with no release tag and notes it', () => {
  const repo = makeRepoWithTaggedMod()
  const result = runMarketplace(repo, '--pin', 'board')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, untaggedItemsNote)
  const text = readFileSync(repo.marketplace, 'utf8')
  assert.deepEqual(
    JSON.parse(text).plugins.map((plugin) => plugin.name),
    ['board'],
  )
  assert.equal(text.includes('./mods/'), false)
})

test('marketplace --pin refuses a mod whose release tag does not exist, names the tag and the claude plugin tag command, and writes nothing', () => {
  const repo = makeRepoWithTaggedMod()
  assert.equal(runMarketplace(repo, '--pin', 'board').status, 0)
  const before = readFileSync(repo.marketplace, 'utf8')
  const result = runMarketplace(repo, '--pin', 'items')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /FAIL items: the release tag items--v0\.1\.0 does not exist/)
  assert.match(result.stderr, /claude plugin tag mods\/items/)
  assert.equal(readFileSync(repo.marketplace, 'utf8'), before)
})

test('marketplace keeps a pinned entry as written when the plugin.json version on main moved on', () => {
  const repo = makeRepoWithTaggedMod()
  const written = { ...pinnedBoard('0123456789abcdef0123456789abcdef01234567'), extra: 'kept' }
  writeFileSync(
    repo.marketplace,
    `${JSON.stringify({ name: 'niksavis', plugins: [written] }, null, 2)}\n`,
  )
  writeManifest(repo.root, 'board', { version: '0.3.0', description: 'An unreleased board.' })
  const result = runMarketplace(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const text = readFileSync(repo.marketplace, 'utf8')
  assert.deepEqual(listedEntry(text, 'board'), written)
  assert.equal(listedEntry(text, 'items'), undefined)
})

test('marketplace --pin --dry-run prints the pinned file and writes nothing', () => {
  const repo = makeRepoWithTaggedMod()
  const stale = pinnedBoard('0123456789abcdef0123456789abcdef01234567')
  const before = `${JSON.stringify({ name: 'niksavis', plugins: [stale] }, null, 2)}\n`
  writeFileSync(repo.marketplace, before)
  const result = runMarketplace(repo, '--pin', 'board', '--dry-run')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, new RegExp(`"ref": "${boardTag}",\\n\\s+"sha": "${repo.tagCommit}"`))
  assert.equal(readFileSync(repo.marketplace, 'utf8'), before)
})

test('a second marketplace --pin of the same tag leaves the file byte for byte unchanged', () => {
  const repo = makeRepoWithTaggedMod()
  assert.equal(runMarketplace(repo, '--pin', 'board').status, 0)
  const first = readFileSync(repo.marketplace, 'utf8')
  const result = runMarketplace(repo, '--pin', 'board')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(readFileSync(repo.marketplace, 'utf8'), first)
  assert.deepEqual(listedEntry(first, 'board'), pinnedBoard(repo.tagCommit))
})

test('marketplace refuses a pin of a name that is not a mod and an unknown argument, and writes nothing', () => {
  const repo = makeRepoWithTaggedMod()
  assert.equal(runMarketplace(repo, '--pin', 'board').status, 0)
  const before = readFileSync(repo.marketplace, 'utf8')
  const missing = runMarketplace(repo, '--pin', 'nothing')
  assert.equal(missing.status, 1, missing.stdout + missing.stderr)
  assert.match(missing.stderr, /--pin nothing: mods\/nothing is not a mod/)
  const unknown = runMarketplace(repo, '--pinn', 'board')
  assert.notEqual(unknown.status, 0, unknown.stdout + unknown.stderr)
  assert.match(unknown.stderr, /--pinn/)
  assert.equal(readFileSync(repo.marketplace, 'utf8'), before)
})

const pinCommand = (name) => `npm run marketplace -- --pin ${name}`

function makeValidateRepo({ boardDependsOnItems = false, tagItems = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-pinned-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  mkdirSync(join(root, '.agents', 'plugins'), { recursive: true })
  writeFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), '{ "plugins": [] }\n')
  mkdirSync(join(root, '.claude-plugin'))
  const boardDependencies = boardDependsOnItems ? { dependencies: ['items'] } : {}
  writeManifest(root, 'board', { ...boardAtTag, ...boardDependencies })
  writeManifest(root, 'items', { version: '0.1.0', description: 'Items with no release tag.' })
  pinGit(root, 'init', '--quiet', '--initial-branch=main')
  pinGit(root, 'add', '--', 'mods')
  pinGit(root, 'commit', '--quiet', `--date=${pinFixtureDate}`, '-m', 'release board')
  pinGit(root, 'tag', '-a', boardTag, '-m', 'board 0.2.0')
  if (tagItems) pinGit(root, 'tag', '-a', 'items--v0.1.0', '-m', 'items 0.1.0')
  writeManifest(root, 'board', { ...boardAtTag, description: 'The board on main after its tag.' })
  pinGit(root, 'add', '--', 'mods')
  pinGit(root, 'commit', '--quiet', `--date=${pinFixtureDate}`, '-m', 'work after the tag')
  return {
    root,
    marketplace: join(root, '.claude-plugin', 'marketplace.json'),
    tagCommit: pinGit(root, 'rev-parse', `${boardTag}^{commit}`),
    tagObject: pinGit(root, 'rev-parse', `refs/tags/${boardTag}`),
    head: pinGit(root, 'rev-parse', 'HEAD'),
  }
}

function runValidate(repo) {
  return spawnSync(process.execPath, [join(repo.root, 'scripts', 'mods.mjs'), 'validate'], {
    cwd: repo.root,
    encoding: 'utf8',
    env: { ...environmentWithoutGit, PATH: `${passingClaude}${delimiter}${process.env.PATH}` },
  })
}

function editEntry(repo, name, edit) {
  const marketplace = JSON.parse(readFileSync(repo.marketplace, 'utf8'))
  marketplace.plugins = marketplace.plugins.flatMap((plugin) => {
    if (plugin.name !== name) return [plugin]
    const edited = edit(plugin)
    return edited === undefined ? [] : [edited]
  })
  writeFileSync(repo.marketplace, `${JSON.stringify(marketplace, null, 2)}\n`)
}

function pinnedRepo(options) {
  const repo = makeValidateRepo(options)
  const pins = options?.tagItems ? ['--pin', 'board', '--pin', 'items'] : ['--pin', 'board']
  const pinned = runMarketplace(repo, ...pins)
  assert.equal(pinned.status, 0, pinned.stdout + pinned.stderr)
  return repo
}

test('validate passes the pinned marketplace that the generator writes, and a plain run keeps it byte for byte', () => {
  const repo = pinnedRepo({ boardDependsOnItems: true, tagItems: true })
  const pinned = readFileSync(repo.marketplace, 'utf8')
  assert.equal(pinned.includes('./mods/'), false)
  assert.equal(runMarketplace(repo).status, 0)
  assert.equal(readFileSync(repo.marketplace, 'utf8'), pinned)
  const result = runValidate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [])
})

test('validate refuses a relative source and names the pin command', () => {
  const repo = pinnedRepo()
  editEntry(repo, 'board', (entry) => ({ ...entry, source: './mods/board' }))
  const result = runValidate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(
    failLines(result).includes(
      `FAIL board: marketplace source is "./mods/board"; it must be a git-subdir source at a release tag, which \`${pinCommand('board')}\` writes`,
    ),
    result.stderr,
  )
})

test('validate passes a pinned entry at its release tag and notes a mod with no release tag yet', () => {
  const repo = pinnedRepo()
  const result = runValidate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [])
  assert.match(result.stdout, /^NOTE items: no release tag items--v\* exists yet/m)
  assert.doesNotMatch(result.stdout, /^NOTE board:/m)
})

test('validate refuses a pinned entry whose release tag does not exist and names the tag', () => {
  const repo = pinnedRepo()
  editEntry(repo, 'board', (entry) => ({
    ...entry,
    source: { ...entry.source, ref: 'board--v0.9.0' },
  }))
  const result = runValidate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [
    `FAIL board: the release tag board--v0.9.0 does not exist; create it with \`claude plugin tag mods/board\`, then run \`${pinCommand('board')}\``,
  ])
})

test('validate refuses a pinned sha that is not the commit of its tag and names both commits', () => {
  const repo = pinnedRepo()
  editEntry(repo, 'board', (entry) => ({
    ...entry,
    source: { ...entry.source, sha: repo.tagObject },
  }))
  const result = runValidate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [
    `FAIL board: the marketplace pins sha ${repo.tagObject}, which is not ${repo.tagCommit}, the commit of its tag ${boardTag}; run \`${pinCommand('board')}\``,
  ])
  editEntry(repo, 'board', (entry) => ({ ...entry, source: { ...entry.source, sha: repo.head } }))
  assert.match(
    runValidate(repo).stderr,
    new RegExp(`pins sha ${repo.head}, which is not ${repo.tagCommit},`),
  )
})

test('validate refuses a mod that has a release tag and no marketplace entry and names the mod', () => {
  const repo = pinnedRepo()
  editEntry(repo, 'board', () => undefined)
  const result = runValidate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(
    failLines(result).includes(
      `FAIL board: it has the release tag ${boardTag}, and .claude-plugin/marketplace.json does not list it; run \`${pinCommand('board')}\``,
    ),
    result.stderr,
  )
})

test('validate notes and does not refuse a mod with no release tag and no marketplace entry', () => {
  const repo = pinnedRepo()
  editEntry(repo, 'items', () => undefined)
  const result = runValidate(repo)
  assert.match(result.stdout, untaggedItemsNote)
  assert.deepEqual(
    failLines(result).filter((line) => line.startsWith('FAIL items:')),
    [],
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('validate refuses a dependency named by the manifest at its tag that the marketplace does not list at a tag', () => {
  const repo = pinnedRepo({ boardDependsOnItems: true })
  const result = runValidate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [
    `FAIL board: plugin.json at ${boardTag} names the dependency items, which .claude-plugin/marketplace.json does not list at a release tag, so an install says that the dependency was not installed; run \`${pinCommand('items')}\``,
  ])
  editEntry(repo, 'items', () => undefined)
  assert.match(
    runValidate(repo).stderr,
    /names the dependency items, .+ dependency was not installed/,
  )
})

test('validate passes a dependency that the marketplace lists at its own release tag', () => {
  const repo = pinnedRepo({ boardDependsOnItems: true, tagItems: true })
  const result = runValidate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [])
})

test('validate refuses a pinned entry with a version because claude plugin tag refuses a version mismatch', () => {
  const repo = pinnedRepo()
  editEntry(repo, 'board', (entry) => ({ ...entry, version: boardAtTag.version }))
  const result = runValidate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [
    `FAIL board: a pinned marketplace entry carries no version, because \`claude plugin tag\` refuses a release with Version mismatch when the entry version differs from plugin.json; run \`${pinCommand('board')}\``,
  ])
})

test('validate refuses a pinned entry with another url, path, source kind or ref and names the expected value', () => {
  const cases = [
    [
      'url',
      'niksavis/handily',
      '"url" is "niksavis/handily"; it must be "https://github.com/niksavis/handily.git"',
    ],
    [
      'url',
      'someone/fork',
      '"url" is "someone/fork"; it must be "https://github.com/niksavis/handily.git"',
    ],
    ['path', 'mods/items', '"path" is "mods/items"; it must be "mods/board"'],
    ['source', 'github', '"source" is "github"; it must be "git-subdir"'],
    ['ref', 'main', '"ref" is "main"; it must be a release tag board--vVERSION'],
    ['ref', 'items--v0.1.0', '"ref" is "items--v0.1.0"; it must be a release tag board--vVERSION'],
  ]
  for (const [field, value, expected] of cases) {
    const repo = pinnedRepo()
    editEntry(repo, 'board', (entry) => ({ ...entry, source: { ...entry.source, [field]: value } }))
    const result = runValidate(repo)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.deepEqual(failLines(result), [
      `FAIL board: the marketplace source ${expected}; run \`${pinCommand('board')}\``,
    ])
  }
})

test('validate in a shallow clone with no tags says to run git fetch --tags for a pinned entry and passes after the fetch', () => {
  const repo = pinnedRepo()
  pinGit(repo.root, 'rm', '-r', '--quiet', '--', 'mods/items')
  pinGit(repo.root, 'add', '--', '.claude-plugin', 'scripts', '.agents')
  pinGit(repo.root, 'commit', '--quiet', `--date=${pinFixtureDate}`, '-m', 'pin board')
  const parent = mkdtempSync(join(tmpdir(), 'handily-mods-shallow-'))
  after(() => rmSync(parent, { recursive: true, force: true }))
  const clone = { root: join(parent, 'clone') }
  pinGit(
    parent,
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--no-tags',
    pathToFileURL(repo.root).href,
    clone.root,
  )
  assert.equal(pinGit(clone.root, 'rev-parse', '--is-shallow-repository'), 'true')
  assert.equal(pinGit(clone.root, 'tag', '--list'), '')
  const result = runValidate(clone)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [
    `FAIL board: the release tag ${boardTag} is not in this shallow clone; run \`git fetch --tags\`, then run the command again`,
  ])
  pinGit(clone.root, 'fetch', '--quiet', '--tags')
  const fetched = runValidate(clone)
  assert.equal(fetched.status, 0, fetched.stdout + fetched.stderr)
})

function makeReleaseCommitRepo({ earlierTag }) {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-first-release-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyGateScripts(root)
  mkdirSync(join(root, '.agents', 'plugins'), { recursive: true })
  writeFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), '{ "plugins": [] }\n')
  mkdirSync(join(root, '.claude-plugin'))
  const repo = { root, marketplace: join(root, '.claude-plugin', 'marketplace.json') }
  writeManifest(root, 'board', earlierTag ? { ...boardAtTag, version: '0.1.0' } : boardAtTag)
  writeManifest(root, 'items', { version: '0.1.0', description: 'Items with no release tag.' })
  pinGit(root, 'init', '--quiet', '--initial-branch=main')
  const unpinned = runMarketplace(repo)
  assert.equal(unpinned.status, 0, unpinned.stdout + unpinned.stderr)
  pinGit(root, 'add', '--', 'mods', 'scripts', '.agents', '.claude-plugin')
  pinGit(root, 'commit', '--quiet', `--date=${pinFixtureDate}`, '-m', 'add board')
  if (earlierTag) {
    pinGit(root, 'tag', '-a', 'board--v0.1.0', '-m', 'board 0.1.0')
    writeManifest(root, 'board', boardAtTag)
    pinGit(root, 'add', '--', 'mods')
    pinGit(root, 'commit', '--quiet', `--date=${pinFixtureDate}`, '-m', 'release board again')
  }
  pinGit(root, 'tag', '-a', boardTag, '-m', 'board 0.2.0')
  return { ...repo, written: readFileSync(repo.marketplace, 'utf8') }
}

const firstReleaseNote = `NOTE board: its only release tag ${boardTag} points at this commit, and .claude-plugin/marketplace.json does not list it yet; after the tag, run \`${pinCommand('board')}\` and commit the file in the pin commit`

test('marketplace and validate pass at the commit of the first release tag of a mod with no entry and note the pin command', () => {
  const repo = makeReleaseCommitRepo({ earlierTag: false })
  const generated = runMarketplace(repo)
  assert.equal(generated.status, 0, generated.stdout + generated.stderr)
  assert.ok(generated.stdout.split('\n').includes(firstReleaseNote), generated.stdout)
  assert.equal(readFileSync(repo.marketplace, 'utf8'), repo.written)
  pinGit(repo.root, 'diff', '--exit-code')
  const result = runValidate(repo)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(failLines(result), [])
  assert.ok(result.stdout.split('\n').includes(firstReleaseNote), result.stdout)
})

test('validate refuses a mod with no entry whose newest release tag points at this commit when an earlier release tag exists', () => {
  const repo = makeReleaseCommitRepo({ earlierTag: true })
  const result = runValidate(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(
    failLines(result).includes(
      `FAIL board: it has the release tag ${boardTag}, and .claude-plugin/marketplace.json does not list it; run \`${pinCommand('board')}\``,
    ),
    result.stderr,
  )
})
