import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const modsDir = join(root, 'mods')
const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
const marketplaceCommand = 'npm run marketplace'
const marketplaceHeader = {
  name: 'handily',
  owner: { name: 'niksavis' },
  metadata: {
    description: 'Claude Code mods that show your work items, tasks and sessions, for any tracker.',
  },
}
const require = createRequire(import.meta.url)
const failures = []

function fail(message) {
  failures.push(message)
  console.error(`FAIL ${message}`)
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) {
    fail(`${label}: cannot run ${command} (${result.error.message})`)
    return false
  }
  if (result.status !== 0) {
    fail(`${label}: exit ${result.status}`)
    return false
  }
  return true
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${label}: cannot read ${relative(root, path)} (${error.message})`)
    return undefined
  }
}

function listMods() {
  if (!existsSync(modsDir)) return []
  const mods = []
  for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(modsDir, entry.name)
    if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) {
      fail(`mods/${entry.name}: no .claude-plugin/plugin.json; a folder under mods/ is a mod`)
      continue
    }
    mods.push({ name: entry.name, dir })
  }
  return mods.sort((a, b) => a.name.localeCompare(b.name))
}

function typesDir(mod) {
  return join(mod.dir, '.claude-plugin', 'types')
}

function readManifest(mod) {
  return readJson(join(mod.dir, '.claude-plugin', 'plugin.json'), mod.name)
}

function dependenciesOf(mod, mods) {
  const declared = readManifest(mod)?.dependencies ?? []
  if (!Array.isArray(declared) || !declared.every((name) => typeof name === 'string')) {
    fail(`${mod.name}: plugin.json "dependencies" must be a list of mod names`)
    return []
  }
  const byName = new Map(mods.map((candidate) => [candidate.name, candidate]))
  const found = new Map()
  const pending = [...declared]
  while (pending.length > 0) {
    const name = pending.shift()
    if (found.has(name) || name === mod.name) continue
    const dependency = byName.get(name)
    if (!dependency) {
      fail(`${mod.name}: dependency "${name}" is not a mod under mods/`)
      continue
    }
    found.set(name, { ...dependency, contract: contractPath(dependency) })
    const nested = readManifest(dependency)?.dependencies
    if (Array.isArray(nested)) pending.push(...nested)
  }
  return [...found.values()]
}

function contractPath(mod) {
  const declared = readManifest(mod)?.types
  if (declared === undefined) return undefined
  if (typeof declared !== 'string' || declared === '') {
    fail(
      `${mod.name}: plugin.json "types" must name the contract file, such as "./types/index.d.ts"`,
    )
    return undefined
  }
  const path = join(mod.dir, declared)
  if (!existsSync(path)) {
    fail(`${mod.name}: plugin.json "types" names ${declared}, which does not exist`)
    return undefined
  }
  return path
}

function laidContractPath(mod, dependency) {
  return join(typesDir(mod), dependency.name, 'index.d.ts')
}

function isLaidContractCurrent(mod, dependency) {
  if (dependency.contract === undefined) return true
  const laid = laidContractPath(mod, dependency)
  if (!existsSync(laid)) return false
  return readFileSync(dependency.contract, 'utf8') === readFileSync(laid, 'utf8')
}

const layTimeoutMs = 120_000
const headlessExitMessage = 'Not logged in'

function firstLine(text) {
  return text.trim().split('\n')[0] ?? ''
}

function layingRunProblem(result) {
  if (result.error?.code === 'ETIMEDOUT') {
    return `claude did not finish laying the types within ${layTimeoutMs / 1000} s`
  }
  if (result.error) return `cannot run claude (${result.error.message}); is the claude CLI on PATH?`
  if (result.signal) return `claude was stopped by ${result.signal} while it laid the types`
  const isHeadlessExit = result.status === 1 && result.stdout.includes(headlessExitMessage)
  if (result.status !== 0 && !isHeadlessExit) {
    return `claude exited ${result.status} while it laid the types: ${firstLine(result.stderr || result.stdout)}`
  }
  return undefined
}

function needsTypes(mod, dependencies) {
  if (!existsSync(join(typesDir(mod), 'tsconfig.json'))) return true
  return !dependencies.every((dependency) => isLaidContractCurrent(mod, dependency))
}

function layTypes(mods, { force }) {
  const configDir = mkdtempSync(join(tmpdir(), 'handily-types-'))
  try {
    for (const mod of mods) {
      const dependencies = dependenciesOf(mod, mods)
      if (!force && !needsTypes(mod, dependencies)) continue
      const pluginDirs = [mod, ...dependencies].flatMap((loaded) => ['--plugin-dir', loaded.dir])
      const result = spawnSync('claude', [...pluginDirs, '-p', 'ok'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: '' },
        timeout: layTimeoutMs,
      })
      const problem = layingRunProblem(result)
      if (problem) {
        fail(`${mod.name}: ${problem}`)
        continue
      }
      if (!existsSync(join(typesDir(mod), 'tsconfig.json'))) {
        fail(`${mod.name}: Claude Code wrote no types; is the claude CLI on PATH?`)
      }
      for (const dependency of dependencies) {
        if (!isLaidContractCurrent(mod, dependency)) {
          fail(
            `${mod.name}: the laid types of its dependency "${dependency.name}" are missing or differ from ${relative(root, dependency.contract)}`,
          )
        }
      }
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

function marketplaceText(mods) {
  const plugins = []
  for (const mod of mods) {
    const manifest = readManifest(mod)
    if (!manifest) continue
    for (const field of ['version', 'description']) {
      if (typeof manifest[field] !== 'string' || manifest[field] === '') {
        fail(`${mod.name}: plugin.json has no ${field}; the marketplace entry needs it`)
      }
    }
    plugins.push({
      name: mod.name,
      source: `./mods/${mod.name}`,
      version: manifest.version,
      description: manifest.description,
    })
  }
  return `${JSON.stringify({ ...marketplaceHeader, plugins }, null, 2)}\n`
}

function generateMarketplace(mods) {
  const text = marketplaceText(mods)
  if (failures.length > 0) return
  writeFileSync(marketplacePath, text)
  console.log(`wrote ${relative(root, marketplacePath)} with ${mods.length} plugin(s)`)
}

function checkMarketplaceIsGenerated(mods) {
  const expected = marketplaceText(mods)
  const actual = existsSync(marketplacePath) ? readFileSync(marketplacePath, 'utf8') : ''
  if (actual.replaceAll('\r\n', '\n') !== expected) {
    fail(
      `marketplace: .claude-plugin/marketplace.json differs from the generator output; run \`${marketplaceCommand}\` and commit the file`,
    )
  }
}

function checkCodexMarketplaceIsEmpty() {
  const path = join(root, '.agents', 'plugins', 'marketplace.json')
  const label = relative(root, path)
  const codex = existsSync(path) ? readJson(path, 'codex marketplace') : undefined
  if (!codex || !Array.isArray(codex.plugins) || codex.plugins.length > 0) {
    fail(
      `codex marketplace: ${label} must exist with an empty "plugins" list, so Codex offers none of the Claude Code mods`,
    )
  }
}

function checkMarketplace(mods) {
  const marketplace = readJson(marketplacePath, 'marketplace')
  if (!marketplace) return
  const listed = new Map((marketplace.plugins ?? []).map((plugin) => [plugin.name, plugin]))
  for (const mod of mods) {
    const manifest = readManifest(mod)
    if (manifest && manifest.name !== mod.name) {
      fail(`${mod.name}: plugin.json name is "${manifest.name}"; it must equal the folder name`)
    }
    const entry = listed.get(mod.name)
    if (!entry) {
      fail(`${mod.name}: not listed in .claude-plugin/marketplace.json`)
    } else if (entry.source !== `./mods/${mod.name}`) {
      fail(`${mod.name}: marketplace source is "${entry.source}"; it must be "./mods/${mod.name}"`)
    }
    listed.delete(mod.name)
  }
  for (const name of listed.keys()) {
    fail(`marketplace lists "${name}", but mods/${name} does not exist`)
  }
}

function typecheck(mods) {
  layTypes(mods, { force: false })
  const tsc = require.resolve('typescript/bin/tsc')
  for (const mod of mods) {
    if (!existsSync(join(mod.dir, 'tsconfig.json'))) {
      fail(`${mod.name}: no tsconfig.json; it extends ./.claude-plugin/types/tsconfig.json`)
      continue
    }
    run(`${mod.name}: tsc`, process.execPath, [tsc, '-p', join(mod.dir, 'tsconfig.json')])
  }
}

const generatedTypesSegment = join('.claude-plugin', 'types')

function isGeneratedTypesPath(path) {
  return path.includes(generatedTypesSegment)
}

const sourceDirs = [modsDir, join(root, 'scripts')]
const sourceFilePattern = /\.(ts|tsx|mjs)$/
const hiddenCharacterPattern = /[\p{Cf}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu

function listSourceFiles(dir) {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || isGeneratedTypesPath(path)) continue
      files.push(...listSourceFiles(path))
    } else if (entry.isFile() && sourceFilePattern.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

function codePointLabel(character) {
  return `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
}

function checkSourceCharacters() {
  for (const path of sourceDirs.flatMap(listSourceFiles)) {
    const lines = readFileSync(path, 'utf8').split('\n')
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(hiddenCharacterPattern)) {
        const label = codePointLabel(match[0])
        fail(
          `${relative(root, path)}:${index + 1}:${match.index + 1}: raw ${label} is an invisible or bidi character; write it as the escape \\u{${label.slice(2)}}`,
        )
      }
    }
  }
}

const identicalCopies = [
  ['mods/quiet-items/hooks/parse.ts', 'mods/item-toasts/hooks/parse.ts'],
  ['mods/quiet-items/fixtures/commands.ts', 'mods/item-toasts/fixtures/commands.ts'],
]

function firstDifferingLine(left, right) {
  const leftLines = left.split('\n')
  const rightLines = right.split('\n')
  const count = Math.max(leftLines.length, rightLines.length)
  for (let index = 0; index < count; index += 1) {
    if (leftLines[index] !== rightLines[index]) return index + 1
  }
  return count
}

function checkIdenticalCopies() {
  for (const [source, copy] of identicalCopies) {
    const missing = [source, copy].filter((path) => !existsSync(join(root, path)))
    if (missing.length > 0) {
      fail(`copies: ${missing.join(' and ')} not found; ${source} and ${copy} must both exist`)
      continue
    }
    const [sourceBytes, copyBytes] = [source, copy].map((path) => readFileSync(join(root, path)))
    if (sourceBytes.equals(copyBytes)) continue
    const line = firstDifferingLine(sourceBytes.toString('utf8'), copyBytes.toString('utf8'))
    fail(
      `copies: ${source} and ${copy} differ from line ${line}; they must be byte-identical, so copy ${source} over ${copy}`,
    )
  }
}

function lint(mods) {
  checkSourceCharacters()
  checkIdenticalCopies()
  layTypes(mods, { force: false })
  const eslint = join(require.resolve('eslint/package.json'), '..', 'bin', 'eslint.js')
  run('eslint', process.execPath, [
    eslint,
    '--no-error-on-unmatched-pattern',
    '--max-warnings',
    '0',
    'mods',
    'scripts',
    'eslint.config.mjs',
  ])
}

function validate(mods) {
  checkMarketplace(mods)
  checkMarketplaceIsGenerated(mods)
  checkCodexMarketplaceIsEmpty()
  const strict = mods.length > 0 ? ['--strict'] : []
  if (mods.length === 0) {
    console.log(
      '0 mods under mods/: the marketplace is checked without --strict until the first mod',
    )
  }
  run('marketplace: claude plugin validate', 'claude', ['plugin', 'validate', ...strict, root])
  for (const mod of mods) {
    run(`${mod.name}: claude plugin validate`, 'claude', [
      'plugin',
      'validate',
      '--strict',
      mod.dir,
    ])
  }
}

function hasTests(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name)
    if (isGeneratedTypesPath(path)) continue
    if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) return true
  }
  return false
}

function test(mods) {
  for (const mod of mods) {
    if (!hasTests(mod.dir)) {
      fail(`${mod.name}: no *.test.ts file; every mod ships tests`)
      continue
    }
    run(`${mod.name}: claude plugin test`, 'claude', ['plugin', 'test', mod.dir])
  }
}

const tasks = {
  marketplace: generateMarketplace,
  types: (mods) => layTypes(mods, { force: true }),
  typecheck,
  lint,
  validate,
  test,
  check: (mods) => {
    validate(mods)
    typecheck(mods)
    lint(mods)
    test(mods)
  },
}

const taskName = process.argv[2]
const task = tasks[taskName]
if (!task) {
  console.error(`usage: node scripts/mods.mjs <${Object.keys(tasks).join('|')}>`)
  process.exit(2)
}
const mods = listMods()
console.log(
  `${taskName}: ${mods.length} mod(s)${mods.length ? `: ${mods.map((m) => m.name).join(', ')}` : ''}`,
)
task(mods)
if (failures.length > 0) {
  console.error(`${taskName}: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log(`${taskName}: passed`)
