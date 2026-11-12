import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, loadavg, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { createScratchFolder, removeScratchFolder } from './scratch.mjs'

const root = join(import.meta.dirname, '..')
const modsDir = join(root, 'mods')
const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
const marketplaceCommand = 'npm run marketplace'
const marketplaceRepository = 'niksavis/handily'
const marketplaceHeader = {
  name: 'niksavis',
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
  if (typeof result.stdout === 'string') process.stdout.write(result.stdout)
  if (result.error) {
    fail(`${label}: cannot run ${command} (${result.error.message})`)
    return undefined
  }
  if (result.status !== 0) fail(`${label}: exit ${result.status}`)
  return result
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

function declaredDependencies(manifest, label) {
  const declared = manifest?.dependencies ?? []
  if (!Array.isArray(declared) || !declared.every((name) => typeof name === 'string')) {
    fail(`${label}: plugin.json "dependencies" must be a list of mod names`)
    return []
  }
  return declared
}

function dependenciesOf(mod, mods) {
  const declared = declaredDependencies(readManifest(mod), mod.name)
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

function layContracts(mod, dependencies) {
  for (const dependency of dependencies) {
    if (isLaidContractCurrent(mod, dependency)) continue
    const laid = laidContractPath(mod, dependency)
    mkdirSync(dirname(laid), { recursive: true })
    rmSync(laid, { force: true })
    writeFileSync(laid, readFileSync(dependency.contract, 'utf8'))
  }
}

const layTimeoutMs = 120_000
const versionTimeoutMs = 30_000
const headlessExitMessage = 'Not logged in'
const versionPattern = /^\d+\.\d+\.\d+\S*$/
const engineHeaderPattern = /^\/\/ Written by Claude Code (\S+)\.$/

function firstLine(text) {
  return text.trim().split('\n')[0] ?? ''
}

function versionReadProblem(result, printed) {
  if (result.error) return result.error.message
  if (result.status !== 0) {
    return `exit ${result.status}: ${firstLine(result.stderr || result.stdout)}`
  }
  if (!versionPattern.test(printed)) return `it printed "${firstLine(result.stdout)}"`
  return undefined
}

function readInstalledVersion() {
  const result = spawnSync('claude', ['--version'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: versionTimeoutMs,
  })
  const printed = firstLine(result.stdout ?? '').split(' ')[0]
  const problem = versionReadProblem(result, printed)
  if (problem === undefined) return printed
  fail(
    `claude --version: cannot read the installed Claude Code version (${problem}); is the claude CLI on PATH?`,
  )
  return undefined
}

function engineTypesPath(mod) {
  return join(typesDir(mod), 'claude-code', 'index.d.ts')
}

function laidEngineVersion(mod) {
  const path = engineTypesPath(mod)
  if (!existsSync(path)) return undefined
  return engineHeaderPattern.exec(firstLine(readFileSync(path, 'utf8')))?.[1]
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

function hasLaidTypes(mod) {
  return existsSync(join(typesDir(mod), 'tsconfig.json'))
}

function layCommand(mod, dependencies) {
  const pluginDirs = [mod, ...dependencies].map(
    (loaded) => `--plugin-dir ${relative(root, loaded.dir)}`,
  )
  return `claude ${pluginDirs.join(' ')}`
}

function laidTypeNames(mod) {
  const laid = readJson(join(typesDir(mod), 'tsconfig.json'), mod.name)
  const names = laid?.compilerOptions?.types
  return Array.isArray(names) ? names : []
}

function unlistedDependencies(mod, dependencies) {
  const listed = new Set(laidTypeNames(mod))
  return dependencies.filter(
    (dependency) => dependency.contract !== undefined && !listed.has(dependency.name),
  )
}

function needsTypes(mod, dependencies) {
  if (!hasLaidTypes(mod)) return true
  return unlistedDependencies(mod, dependencies).length > 0
}

function layTypes(mods, { force, installedVersion }) {
  const configDir = mkdtempSync(join(tmpdir(), 'handily-types-'))
  try {
    for (const mod of mods) {
      const dependencies = dependenciesOf(mod, mods)
      layContracts(mod, dependencies)
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
      if (!hasLaidTypes(mod)) {
        fail(
          `${mod.name}: Claude Code wrote no types; load the mod once in an interactive session: ${layCommand(mod, dependencies)}`,
        )
      } else {
        const unlisted = unlistedDependencies(mod, dependencies).map(
          (dependency) => dependency.name,
        )
        if (unlisted.length > 0) {
          fail(
            `${mod.name}: the laid ${relative(root, join(typesDir(mod), 'tsconfig.json'))} does not list the types of its dependencies ${unlisted.join(', ')}; load the mod once in an interactive session: ${layCommand(mod, dependencies)}`,
          )
        }
        const laidVersion = laidEngineVersion(mod)
        if (installedVersion !== undefined && laidVersion !== installedVersion) {
          fail(
            `${mod.name}: the header of ${relative(root, engineTypesPath(mod))} names Claude Code ${laidVersion ?? 'no version'}, and the installed Claude Code is ${installedVersion}; load the mod once in an interactive session: ${layCommand(mod, dependencies)}`,
          )
        }
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

function layTypesOfInstalledVersion(mods) {
  const installedVersion = readInstalledVersion()
  if (installedVersion === undefined) return
  layTypes(mods, { force: true, installedVersion })
}

function releaseTag(name, version) {
  return `${name}--v${version}`
}

function isReleaseTagOf(name, tag) {
  const prefix = releaseTag(name, '')
  return (
    typeof tag === 'string' &&
    tag.startsWith(prefix) &&
    versionPattern.test(tag.slice(prefix.length))
  )
}

function pinCommand(name) {
  return `${marketplaceCommand} -- --pin ${name}`
}

const fetchTagsAdvice = 'run `git fetch --tags`, then run the command again'

function runGit(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' })
}

function isShallowClone() {
  const result = runGit(['rev-parse', '--is-shallow-repository'])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function missingTagMessage(name, tag) {
  if (isShallowClone()) {
    return `the release tag ${tag} is not in this shallow clone; ${fetchTagsAdvice}`
  }
  return `the release tag ${tag} does not exist; create it with \`claude plugin tag mods/${name}\`, then run \`${pinCommand(name)}\``
}

function peeledTagCommit(mod, tag) {
  const result = runGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])
  if (result.error) {
    fail(`${mod.name}: cannot run git to read the release tag ${tag} (${result.error.message})`)
    return undefined
  }
  if (result.status !== 0) {
    fail(`${mod.name}: ${missingTagMessage(mod.name, tag)}`)
    return undefined
  }
  return result.stdout.trim()
}

function releaseTagsNewestFirst(mod) {
  const result = runGit(['tag', '--list', '--sort=-v:refname', releaseTag(mod.name, '*')])
  if (result.error || result.status !== 0) {
    return { problem: result.error?.message ?? firstLine(result.stderr) }
  }
  return { tags: result.stdout.split('\n').filter((tag) => isReleaseTagOf(mod.name, tag)) }
}

function commitOf(revision) {
  const result = runGit(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])
  return result.status === 0 ? result.stdout.trim() : undefined
}

function isFirstReleaseAtThisCommit(tags) {
  if (tags.length !== 1) return false
  const head = commitOf('HEAD')
  return head !== undefined && commitOf(`refs/tags/${tags[0]}`) === head
}

function taggedManifest(mod, tag, sha) {
  const path = `mods/${mod.name}/.claude-plugin/plugin.json`
  const result = runGit(['show', `${sha}:${path}`])
  if (result.status !== 0) {
    fail(
      `${mod.name}: cannot read ${path} at ${tag} (${result.error?.message ?? firstLine(result.stderr)})`,
    )
    return undefined
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    fail(`${mod.name}: cannot read ${path} at ${tag} (${error.message})`)
    return undefined
  }
}

function pinnedEntry(mod) {
  const version = readManifest(mod)?.version
  if (typeof version !== 'string' || version === '') {
    fail(`${mod.name}: plugin.json has no version; --pin reads the release tag from it`)
    return undefined
  }
  const tag = releaseTag(mod.name, version)
  const sha = peeledTagCommit(mod, tag)
  if (sha === undefined) return undefined
  const tagged = taggedManifest(mod, tag, sha)
  if (tagged === undefined) return undefined
  if (tagged.version !== version) {
    fail(`${mod.name}: plugin.json at ${tag} has version ${tagged.version}, not ${version}`)
    return undefined
  }
  if (typeof tagged.description !== 'string' || tagged.description === '') {
    fail(`${mod.name}: plugin.json at ${tag} has no description; the marketplace entry needs it`)
    return undefined
  }
  return {
    name: mod.name,
    source: pinnedSource(mod.name, tag, sha),
    description: tagged.description,
  }
}

function pinnedSource(name, tag, sha) {
  return { source: 'git-subdir', url: marketplaceRepository, path: `mods/${name}`, ref: tag, sha }
}

function isPinnedEntry(entry) {
  return typeof entry?.source === 'object' && entry.source !== null
}

function writtenEntries() {
  if (!existsSync(marketplacePath)) return new Map()
  const written = readJson(marketplacePath, 'marketplace')
  const plugins = Array.isArray(written?.plugins) ? written.plugins : []
  return new Map(plugins.map((plugin) => [plugin?.name, plugin]))
}

function generatedPlugins(mods, { pins = new Set(), reportUnlisted = false } = {}) {
  const written = writtenEntries()
  const plugins = []
  for (const mod of mods) {
    const kept = written.get(mod.name)
    if (pins.has(mod.name)) {
      const entry = pinnedEntry(mod)
      if (entry) plugins.push(entry)
    } else if (isPinnedEntry(kept)) {
      plugins.push(kept)
    } else if (reportUnlisted) {
      checkUnlistedMod(mod)
    }
  }
  return plugins
}

function marketplaceText(plugins) {
  return `${JSON.stringify({ ...marketplaceHeader, plugins }, null, 2)}\n`
}

function generateMarketplace(mods, { values }) {
  const pins = new Set(values.pin ?? [])
  const names = new Set(mods.map((mod) => mod.name))
  for (const name of pins) {
    if (!names.has(name)) fail(`--pin ${name}: mods/${name} is not a mod`)
  }
  if (failures.length > 0) return
  const plugins = generatedPlugins(mods, { pins, reportUnlisted: true })
  if (failures.length > 0) return
  const text = marketplaceText(plugins)
  if (values['dry-run']) {
    process.stdout.write(text)
    return
  }
  const label = relative(root, marketplacePath)
  const current = existsSync(marketplacePath) ? readFileSync(marketplacePath, 'utf8') : undefined
  if (current === text) {
    console.log(`${label} is unchanged with ${plugins.length} plugin(s)`)
    return
  }
  writeFileSync(marketplacePath, text)
  console.log(`wrote ${label} with ${plugins.length} plugin(s)`)
}

function checkMarketplaceIsGenerated(mods) {
  const expected = marketplaceText(generatedPlugins(mods))
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

const marketplaceLabel = '.claude-plugin/marketplace.json'

function noteUntaggedMod(mod) {
  note(
    `${mod.name}: no release tag ${releaseTag(mod.name, '*')} exists yet, so the marketplace cannot pin it; create one with \`claude plugin tag mods/${mod.name}\``,
  )
}

function noteFirstRelease(mod, tag) {
  note(
    `${mod.name}: its only release tag ${tag} points at this commit, and ${marketplaceLabel} does not list it yet; after the tag, run \`${pinCommand(mod.name)}\` and commit the file in the pin commit`,
  )
}

function checkUnlistedMod(mod) {
  const { tags, problem } = releaseTagsNewestFirst(mod)
  if (problem !== undefined) {
    fail(
      `${mod.name}: ${marketplaceLabel} does not list it, and git cannot list its release tags (${problem})`,
    )
  } else if (isFirstReleaseAtThisCommit(tags)) {
    noteFirstRelease(mod, tags[0])
  } else if (tags.length > 0) {
    fail(
      `${mod.name}: it has the release tag ${tags[0]}, and ${marketplaceLabel} does not list it; run \`${pinCommand(mod.name)}\``,
    )
  } else if (isShallowClone()) {
    fail(
      `${mod.name}: ${marketplaceLabel} does not list it, and this shallow clone has no tags to show whether it has a release tag; ${fetchTagsAdvice}`,
    )
  } else {
    noteUntaggedMod(mod)
  }
}

function checkUnpinnedEntry(mod, entry) {
  fail(
    `${mod.name}: marketplace source is ${JSON.stringify(entry.source)}; it must be a git-subdir source at a release tag, which \`${pinCommand(mod.name)}\` writes`,
  )
}

function pinnedSourceProblem(mod, source) {
  if (!isReleaseTagOf(mod.name, source.ref)) {
    return `"ref" is ${JSON.stringify(source.ref)}; it must be a release tag ${releaseTag(mod.name, 'VERSION')}`
  }
  const expected = pinnedSource(mod.name, source.ref, source.sha)
  for (const field of Object.keys(source)) {
    if (!Object.hasOwn(expected, field)) {
      return `has the field "${field}", which a pinned source does not have`
    }
  }
  for (const [field, value] of Object.entries(expected)) {
    if (source[field] !== value) {
      return `${JSON.stringify(field)} is ${JSON.stringify(source[field])}; it must be ${JSON.stringify(value)}`
    }
  }
  return undefined
}

function checkPinnedEntry(mod, entry, listed) {
  const { source } = entry
  const problem = pinnedSourceProblem(mod, source)
  if (problem !== undefined) {
    fail(`${mod.name}: the marketplace source ${problem}; run \`${pinCommand(mod.name)}\``)
  }
  if (Object.hasOwn(entry, 'version')) {
    fail(
      `${mod.name}: a pinned marketplace entry carries no version, because \`claude plugin tag\` refuses a release with Version mismatch when the entry version differs from plugin.json; run \`${pinCommand(mod.name)}\``,
    )
  }
  if (problem !== undefined) return
  const sha = peeledTagCommit(mod, source.ref)
  if (sha === undefined) return
  if (source.sha !== sha) {
    fail(
      `${mod.name}: the marketplace pins sha ${source.sha ?? 'none'}, which is not ${sha}, the commit of its tag ${source.ref}; run \`${pinCommand(mod.name)}\``,
    )
    return
  }
  const tagged = taggedManifest(mod, source.ref, sha)
  if (tagged === undefined) return
  for (const dependency of declaredDependencies(tagged, `${mod.name} at ${source.ref}`)) {
    if (isPinnedEntry(listed.get(dependency))) continue
    fail(
      `${mod.name}: plugin.json at ${source.ref} names the dependency ${dependency}, which ${marketplaceLabel} does not list at a release tag, so an install says that the dependency was not installed; run \`${pinCommand(dependency)}\``,
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
    if (!entry) checkUnlistedMod(mod)
    else if (isPinnedEntry(entry)) checkPinnedEntry(mod, entry, listed)
    else checkUnpinnedEntry(mod, entry)
  }
  const names = new Set(mods.map((mod) => mod.name))
  for (const name of listed.keys()) {
    if (!names.has(name)) fail(`marketplace lists "${name}", but mods/${name} does not exist`)
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
    if (!hasLaidTypes(mod)) {
      fail(
        `${mod.name}: no laid types; tsc did not run. Lay them with: ${layCommand(mod, dependenciesOf(mod, mods))}`,
      )
      continue
    }
    run(`${mod.name}: tsc`, process.execPath, [
      tsc,
      '-p',
      join(mod.dir, 'tsconfig.json'),
      '--noEmit',
    ])
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

function lint(mods) {
  checkSourceCharacters()
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

const engineSnapshotFiles = [
  '.gitignore',
  'tsconfig.json',
  join('claude-code', 'index.d.ts'),
  join('claude-code-mcp', 'index.d.ts'),
  join('claude-code-tools', 'index.d.ts'),
]

function checkEngineSnapshotIsTracked(mods) {
  const laid = mods.flatMap((mod) =>
    engineSnapshotFiles
      .map((file) => ({ mod, path: relative(root, join(typesDir(mod), file)) }))
      .filter(({ path }) => existsSync(join(root, path))),
  )
  if (laid.length === 0) return
  const result = spawnSync('git', ['ls-files', '-z', '--', ...laid.map(({ path }) => path)], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) {
    fail(
      `engine types: cannot list the tracked files with git ls-files (${result.error?.message ?? firstLine(result.stderr)})`,
    )
    return
  }
  const tracked = new Set(result.stdout.split('\0').filter((path) => path !== ''))
  for (const { mod, path } of laid) {
    if (tracked.has(path.split(sep).join('/'))) continue
    fail(
      `${mod.name}: ${path} of the engine types is not tracked by git, so a fresh clone and CI miss it; run \`git add -f ${path}\` and commit it`,
    )
  }
}

function validate(mods) {
  checkMarketplace(mods)
  checkMarketplaceIsGenerated(mods)
  checkCodexMarketplaceIsEmpty()
  checkEngineSnapshotIsTracked(mods)
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

const testFilePattern = /\.test\.tsx?$/

function hasTests(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name)
    if (isGeneratedTypesPath(path)) continue
    if (entry.isFile() && testFilePattern.test(entry.name)) return true
  }
  return false
}

const defaultTestLimitMs = 5000
const testTimeShare = { divisor: 3, name: 'a third' }
const referenceTestTimes = [
  { title: 'a draw with 30 agents of 20 tasks reads the state 5 times', ms: 1856 },
  {
    title:
      'a session from a version that kept no agentPlans draws every plan on the first draw and reads the state 5 times from the second',
    ms: 1130,
  },
  { title: 'ignores a call that completes after its session ended', ms: 865 },
  { title: 'closes a background call after 30 minutes without a notification', ms: 572 },
  {
    title:
      'the this session tab draws each Button once, under its own key, in the order a person reads the tab, before the Add input',
    ms: 418,
  },
]
const testOutputMaxBytes = 64 * 1024 * 1024
const creepTimeShare = { divisor: 4, name: 'a quarter' }
const creepWindowRuns = 5
const creepRunsAlone = 3
const runsAloneStoreName = 'handily-test-reruns.json'
const isCiRunner = process.env.GITHUB_ACTIONS === 'true'
const testFileHeaderPattern = /^(\S.*\.test\.tsx?):$/
const testTimePattern = /^\((?:pass|fail)\) (.+) \[(\d+(?:\.\d+)?)ms\]$/
const regExpSyntaxPattern = /[.*+?^${}()|[\]\\]/g
const anyTitlePart = '.*'

function readTestTimes(output) {
  const times = []
  let file
  for (const line of output.split(/\r?\n/)) {
    const header = testFileHeaderPattern.exec(line)
    if (header) {
      file = header[1]
      continue
    }
    const timed = testTimePattern.exec(line)
    if (timed) times.push({ file, title: timed[1], ms: Number(timed[2]) })
  }
  return times
}

function escapeRegExp(text) {
  return text.replace(regExpSyntaxPattern, '\\$&')
}

function readDeclaredTestLimits(path) {
  if (!existsSync(path)) return []
  const ts = require('typescript')
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    kind,
  )
  const constants = new Map()
  const testCalls = []
  const isCallOf = (node, name) =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
  const visit = (node) => {
    const isConstant =
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) !== 0
    if (isConstant) {
      constants.set(node.name.text, constants.has(node.name.text) ? undefined : node.initializer)
    }
    if (isCallOf(node, 'test') && node.arguments.length >= 2) testCalls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const resolve = (node, seen = new Set()) => {
    if (node === undefined || seen.has(node)) return undefined
    seen.add(node)
    const isWrapper =
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    if (isWrapper) return resolve(node.expression, seen)
    if (ts.isIdentifier(node)) return resolve(constants.get(node.text), seen)
    return node
  }
  const numberOf = (node) => {
    const value = resolve(node)
    return value !== undefined && ts.isNumericLiteral(value) ? Number(value.text) : undefined
  }
  const timeoutOf = (options) => {
    const object = resolve(options)
    if (object === undefined || !ts.isObjectLiteralExpression(object)) return undefined
    let timeoutMs
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        timeoutMs = timeoutOf(property.expression) ?? timeoutMs
      } else if (property.name?.text === 'timeoutMs') {
        timeoutMs = numberOf(
          ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer,
        )
      }
    }
    return timeoutMs
  }
  const titlePart = (name) => {
    const node = resolve(name)
    if (node === undefined) return undefined
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return escapeRegExp(node.text)
    }
    if (!ts.isTemplateExpression(node)) return undefined
    const literals = [node.head, ...node.templateSpans.map((span) => span.literal)]
    return literals.map((literal) => escapeRegExp(literal.text)).join('.*')
  }
  const titlePattern = (call, unreadablePart) => {
    const parts = [titlePart(call.arguments[0])]
    for (let node = call.parent; node !== undefined; node = node.parent) {
      if (isCallOf(node, 'describe')) parts.unshift(titlePart(node.arguments[0]))
    }
    if (parts.some((part) => part === undefined) && unreadablePart === undefined) return undefined
    return new RegExp(`^${parts.map((part) => part ?? unreadablePart).join(' > ')}$`)
  }
  return testCalls.flatMap((call) => {
    const declaredMs = call.arguments.length === 3 ? timeoutOf(call.arguments[1]) : undefined
    const limitMs = declaredMs ?? defaultTestLimitMs
    const isDefaultLimit = limitMs === defaultTestLimitMs
    const pattern = titlePattern(call, isDefaultLimit ? anyTitlePart : undefined)
    if (pattern === undefined) return []
    const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1
    return [{ pattern, limitMs, isDeclared: !isDefaultLimit, line }]
  })
}

function testLimitMs(title, declared) {
  const limits = declared.filter(({ pattern }) => pattern.test(title)).map(({ limitMs }) => limitMs)
  return limits.length === 0 ? defaultTestLimitMs : Math.min(...limits)
}

function lostLimits(titles, declared) {
  return declared.filter(({ pattern, limitMs, isDeclared }) => {
    if (!isDeclared) return false
    const matched = titles.filter((title) => pattern.test(title))
    return matched.length > 0 && matched.every((title) => testLimitMs(title, declared) < limitMs)
  })
}

function unhonouredLimit(title, declared, lost) {
  const lostHere = lost.find(({ pattern }) => pattern.test(title))
  if (lostHere === undefined) return undefined
  const lowest = declared
    .filter(({ pattern }) => pattern.test(title))
    .reduce((low, match) => (match.limitMs < low.limitMs ? match : low))
  return { lost: lostHere, lowest }
}

function note(message) {
  console.log(`NOTE ${message}`)
}

function machineSlowness(timesByMod) {
  const ratios = []
  for (const { title, ms } of referenceTestTimes) {
    const measured = timesByMod
      .flatMap(({ times }) => times)
      .find((time) => time.title === title || time.title.endsWith(` > ${title}`))
    if (measured !== undefined) ratios.push(measured.ms / ms)
  }
  if (ratios.length === 0) return 1
  ratios.sort((a, b) => a - b)
  const middle = Math.floor(ratios.length / 2)
  const median =
    ratios.length % 2 === 1 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2
  return Math.max(1, median)
}

function isWithinShare(ms, limitMs, slowness, share = testTimeShare) {
  return ms * share.divisor <= limitMs * slowness
}

function testName(mod, file, title) {
  return `${mod.name}: ${file ?? 'a test file'} test "${title}"`
}

function timeoutAdvice(ms, slowness) {
  return `make it faster, or set timeoutMs in its TestOptions to at least ${Math.ceil((ms * testTimeShare.divisor) / slowness)} ms`
}

function machineLoad() {
  return `a load average of ${loadavg()[0].toFixed(2)} on ${cpus().length} CPUs`
}

function testFileOf(mod, path) {
  return relative(mod.dir, path).split(sep).join('/')
}

function runTestFileAlone(mod, file) {
  const copyRoot = createScratchFolder('handily-rerun-')
  try {
    const copy = join(copyRoot, basename(mod.dir))
    cpSync(mod.dir, copy, {
      recursive: true,
      filter: (path) => !testFilePattern.test(path) || testFileOf(mod, path) === file,
    })
    const load = machineLoad()
    const result = run(
      `${mod.name}: claude plugin test of ${file} alone`,
      'claude',
      ['plugin', 'test', copy],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: testOutputMaxBytes },
    )
    return { load, times: result?.status === 0 ? readTestTimes(result.stdout) : [] }
  } finally {
    const refusal = removeScratchFolder(copyRoot)
    if (refusal !== undefined) fail(`${mod.name}: ${refusal}`)
  }
}

function judgeRunAlone(over, aloneMs, load) {
  const { mod, file, title, ms, limitMs, slowness, machine } = over
  const name = testName(mod, file, title)
  const firstRun = `took ${ms} ms of its ${limitMs} ms limit in the suite run`
  const share = testTimeShare.name
  if (aloneMs === undefined) {
    fail(
      `${name} ${firstRun}, more than ${share}${machine}, and its run again alone printed no time for it, at ${load}, so the gate cannot pass it; ${timeoutAdvice(ms, slowness)}`,
    )
  } else if (isWithinShare(aloneMs, limitMs, slowness)) {
    note(
      `${name} ${firstRun}, more than ${share}${machine}, and ${aloneMs} ms when it ran again alone, at most ${share}, at ${load}, so the gate passes it`,
    )
  } else {
    fail(
      `${name} ${firstRun} and ${aloneMs} ms when it ran again alone, more than ${share} both times${machine}, at ${load}, so a slower CI runner can time it out; ${timeoutAdvice(Math.max(ms, aloneMs), slowness)}`,
    )
  }
  return { key: `${mod.name} > ${file} > ${title}`, name, limitMs, aloneMs, slowness }
}

function checkTestTimes(mod, times, slowness) {
  if (times.length === 0) {
    fail(
      `${mod.name}: claude plugin test printed no test time such as "(pass) name [12.34ms]", so the test time gate read no test`,
    )
    return []
  }
  const machine =
    slowness > 1 ? ` on a machine ${slowness.toFixed(2)} times slower than the reference times` : ''
  const declaredByFile = new Map()
  const lostByFile = new Map()
  for (const file of new Set(times.map((time) => time.file))) {
    if (file === undefined) continue
    const declared = readDeclaredTestLimits(join(mod.dir, file))
    const titles = times.filter((time) => time.file === file).map((time) => time.title)
    declaredByFile.set(file, declared)
    lostByFile.set(file, lostLimits(titles, declared))
  }
  const unhonoured = new Set()
  const occurrences = new Map()
  const runsAlone = new Map()
  const ranAgain = []
  for (const { file, title, ms } of times) {
    const conflict = unhonouredLimit(
      title,
      declaredByFile.get(file) ?? [],
      lostByFile.get(file) ?? [],
    )
    const conflictKey = `${file ?? ''} > ${title}`
    if (conflict !== undefined && !unhonoured.has(conflictKey)) {
      unhonoured.add(conflictKey)
      const { lost, lowest } = conflict
      fail(
        `${mod.name}: ${file ?? 'a test file'} test "${title}" matches the timeoutMs of ${lost.limitMs} ms at line ${lost.line} and also ${lowest.pattern} of the test at line ${lowest.line} with a limit of ${lowest.limitMs} ms, so the gate cannot honour the ${lost.limitMs} ms; give each test a title that no other test in the file matches, or move the test with timeoutMs to a file where every title is a string literal`,
      )
    }
    const occurrence = occurrences.get(conflictKey) ?? 0
    occurrences.set(conflictKey, occurrence + 1)
    const limitMs = testLimitMs(title, declaredByFile.get(file) ?? [])
    if (isWithinShare(ms, limitMs, slowness)) continue
    if (isCiRunner || file === undefined) {
      const report = isCiRunner ? note : fail
      report(
        `${testName(mod, file, title)} took ${ms} ms of its ${limitMs} ms limit, more than ${testTimeShare.name}${machine}, so a slower CI runner can time it out; ${timeoutAdvice(ms, slowness)}`,
      )
      continue
    }
    if (!runsAlone.has(file)) runsAlone.set(file, runTestFileAlone(mod, file))
    const alone = runsAlone.get(file)
    const aloneMs = alone.times.filter((time) => time.title === title)[occurrence]?.ms
    const over = { mod, file, title, ms, limitMs, slowness, machine }
    ranAgain.push(judgeRunAlone(over, aloneMs, alone.load))
  }
  return ranAgain
}

function readCommonDir() {
  const result = runGit(['rev-parse', '--git-common-dir'])
  if (result.error || result.status !== 0) return undefined
  return resolve(root, result.stdout.trim())
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function readRunsAlone(path) {
  if (!existsSync(path)) return { runs: 0, tests: {} }
  const store = parseJson(readFileSync(path, 'utf8'))
  const isStore =
    Number.isInteger(store?.runs) && typeof store.tests === 'object' && store.tests !== null
  if (isStore) return store
  note(
    `test: ${runsAloneStoreName} in the git common directory holds no count that the gate can read, so the gate counts again from this run`,
  )
  return { runs: 0, tests: {} }
}

function keptEntry(entry, oldestRun) {
  const runs = Array.isArray(entry?.runs)
    ? entry.runs.filter((run) => Number.isInteger(run) && run > oldestRun)
    : []
  return { total: Number.isInteger(entry?.total) ? entry.total : runs.length, runs }
}

function writeRunsAlone(path, store) {
  const written = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(written, `${JSON.stringify(store, null, 2)}\n`)
    renameSync(written, path)
  } catch (error) {
    note(
      `test: cannot write ${runsAloneStoreName} in the git common directory (${error.message}), so the gate keeps no count of this run`,
    )
  }
}

function timesInAll(total) {
  return total === 1 ? 'once in all' : `${total} times in all`
}

function lastGateRuns(count, windowRuns) {
  if (count === windowRuns) {
    return windowRuns === 1 ? 'in its last gate run' : `in each of its last ${windowRuns} gate runs`
  }
  return `in ${count} of its last ${windowRuns} gate runs`
}

function warnOfCreep(again, entry, windowRuns) {
  const { name, limitMs, aloneMs, slowness } = again
  const count = entry.runs.length
  const isNearLimit =
    aloneMs !== undefined && !isWithinShare(aloneMs, limitMs, slowness, creepTimeShare)
  if (count < creepRunsAlone && !isNearLimit) return
  const share =
    aloneMs === undefined
      ? 'printed no time alone'
      : `took ${aloneMs} ms alone, ${Math.round((aloneMs / limitMs) * 100)} percent of its ${limitMs} ms limit`
  console.log(
    `WARN ${name} ran again alone ${lastGateRuns(count, windowRuns)}, ${timesInAll(entry.total)}, and ${share}; a test that runs again alone in ${creepRunsAlone} of ${creepWindowRuns} gate runs, or takes more than ${creepTimeShare.name} of its limit alone, comes near its limit, so make it faster or set timeoutMs in its TestOptions`,
  )
}

function countRunsAlone(ranAgain) {
  const commonDir = readCommonDir()
  if (commonDir === undefined) {
    if (ranAgain.length > 0) {
      note(
        'test: git rev-parse --git-common-dir did not answer, so the gate keeps no count of the tests that ran again alone',
      )
    }
    return
  }
  const path = join(commonDir, runsAloneStoreName)
  const store = readRunsAlone(path)
  const run = store.runs + 1
  const tests = {}
  for (const [key, entry] of Object.entries(store.tests)) {
    tests[key] = keptEntry(entry, run - creepWindowRuns)
  }
  for (const { key } of ranAgain) {
    const entry = tests[key] ?? { total: 0, runs: [] }
    if (!entry.runs.includes(run))
      tests[key] = { total: entry.total + 1, runs: [...entry.runs, run] }
  }
  writeRunsAlone(path, { runs: run, tests })
  const windowRuns = Math.min(run, creepWindowRuns)
  for (const again of ranAgain) warnOfCreep(again, tests[again.key], windowRuns)
}

function test(mods) {
  const timesByMod = []
  for (const mod of mods) {
    if (!hasTests(mod.dir)) {
      fail(`${mod.name}: no *.test.ts file; every mod ships tests`)
      continue
    }
    const result = run(`${mod.name}: claude plugin test`, 'claude', ['plugin', 'test', mod.dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: testOutputMaxBytes,
    })
    if (result?.status === 0) timesByMod.push({ mod, times: readTestTimes(result.stdout) })
  }
  const slowness = machineSlowness(timesByMod)
  if (slowness > 1) {
    console.log(
      `test: the reference tests ran ${slowness.toFixed(2)} times slower than their reference times, so the time share scales by that factor`,
    )
  }
  const ranAgain = timesByMod.flatMap(({ mod, times }) => checkTestTimes(mod, times, slowness))
  if (!isCiRunner) countRunsAlone(ranAgain)
  run('scripts: node --test', process.execPath, ['--test', 'scripts/*.test.mjs'])
}

const tasks = {
  marketplace: generateMarketplace,
  types: layTypesOfInstalledVersion,
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

const taskArguments = {
  marketplace: { pin: { type: 'string', multiple: true }, 'dry-run': { type: 'boolean' } },
}
const usage = `usage: node scripts/mods.mjs <${Object.keys(tasks).join('|')}>, or node scripts/mods.mjs marketplace [--pin <mod>]... [--dry-run]`

function readTaskArguments(name, args) {
  try {
    return parseArgs({ args, options: taskArguments[name] ?? {}, strict: true })
  } catch (error) {
    console.error(`${name}: ${error.message}`)
    console.error(usage)
    process.exit(2)
  }
}

const taskName = process.argv[2]
const task = tasks[taskName]
if (!task) {
  console.error(usage)
  process.exit(2)
}
const taskOptions = readTaskArguments(taskName, process.argv.slice(3))
const mods = listMods()
console.log(
  `${taskName}: ${mods.length} mod(s)${mods.length ? `: ${mods.map((m) => m.name).join(', ')}` : ''}`,
)
task(mods, taskOptions)
if (failures.length > 0) {
  console.error(`${taskName}: ${failures.length} failure(s)`)
  process.exitCode = 1
} else {
  console.log(`${taskName}: passed`)
}
