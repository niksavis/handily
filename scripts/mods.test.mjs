import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
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
import { delimiter, join } from 'node:path'
import { after, test } from 'node:test'
import { environmentWithoutGit } from './git-env.mjs'

const repoRoot = join(import.meta.dirname, '..')

function makeRepoWithUntypedMod() {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-test-'))
  mkdirSync(join(root, 'scripts'))
  cpSync(join(repoRoot, 'scripts', 'mods.mjs'), join(root, 'scripts', 'mods.mjs'))
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
  cpSync(join(repoRoot, 'scripts', 'mods.mjs'), join(root, 'scripts', 'mods.mjs'))
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
  cpSync(join(repoRoot, 'scripts', 'mods.mjs'), join(root, 'scripts', 'mods.mjs'))
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

function makeRepoWithTimedMod(output, source) {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-times-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  cpSync(join(repoRoot, 'scripts', 'mods.mjs'), join(root, 'scripts', 'mods.mjs'))
  writeFileSync(
    join(root, 'scripts', 'passing.test.mjs'),
    "import { test } from 'node:test'\ntest('passes', () => {})\n",
  )
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  const mod = join(root, 'mods', 'timed')
  mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
  writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'timed' }))
  writeFileSync(join(mod, 'timed.test.ts'), source)
  return { root, bin: makeFakeClaude(`process.stdout.write(${JSON.stringify(output)})`) }
}

function runTimedTests(output, { runnerEnv = {}, source = timedTestSource } = {}) {
  const repo = makeRepoWithTimedMod(output, source)
  const env = { ...process.env, PATH: repo.bin }
  delete env.GITHUB_ACTIONS
  return spawnSync(process.execPath, [join(repo.root, 'scripts', 'mods.mjs'), 'test'], {
    cwd: repo.root,
    encoding: 'utf8',
    env: { ...env, ...runnerEnv },
  })
}

function failLines(result) {
  return result.stderr.split('\n').filter((line) => line.startsWith('FAIL '))
}

const overShareOutput = testOutput([
  `(pass) ${criterionTitle} > a draw with 1 agents [1667.01ms]`,
  `(pass) ${criterionTitle} > a draw with 30 agents [9999.00ms]`,
  `(pass) ${criterionTitle} > a short draw [200.01ms]`,
  `(pass) ${criterionTitle} > a default draw [1667.67ms]`,
])
const overShareResult = runTimedTests(overShareOutput)

test('test fails and names the mod, the test, its time and its limit when a test takes more than a third of its limit', () => {
  assert.equal(overShareResult.status, 1, overShareResult.stdout + overShareResult.stderr)
  assert.deepEqual(failLines(overShareResult), [
    `FAIL timed: timed.test.ts test "${criterionTitle} > a short draw" took 200.01 ms of its 600 ms limit, more than a third, so a slower CI runner can time it out; make it faster, or set timeoutMs in its TestOptions to at least 601 ms`,
    `FAIL timed: timed.test.ts test "${criterionTitle} > a default draw" took 1667.67 ms of its 5000 ms limit, more than a third, so a slower CI runner can time it out; make it faster, or set timeoutMs in its TestOptions to at least 5004 ms`,
  ])
  assert.match(overShareResult.stdout, /^\(pass\) .+ > a default draw \[1667\.67ms\]$/m)
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
  const refused = (title) =>
    `FAIL timed: timed.test.ts test "${title}" took 4000 ms of its 5000 ms limit, more than a third, so a slower CI runner can time it out; make it faster, or set timeoutMs in its TestOptions to at least 12000 ms`
  assert.deepEqual(failLines(sharedTitleResult), [
    refused('D > a draw with many agents'),
    refused('D > a draw with > no agents'),
    refused('D > the same draw'),
    refused('E > a draw with lots of agents'),
  ])
})

const untimedResult = runTimedTests('\ntimed.test.ts:\n\n 4 pass\n 0 fail\n')

test('test fails by name when claude plugin test prints no test time', () => {
  assert.equal(untimedResult.status, 1, untimedResult.stdout + untimedResult.stderr)
  assert.deepEqual(failLines(untimedResult), [
    'FAIL timed: claude plugin test printed no test time such as "(pass) name [12.34ms]", so the test time gate read no test',
  ])
})
