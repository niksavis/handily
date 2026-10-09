import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(import.meta.dirname, '..')
const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
const bundleName = 'handily'
const bundleProbeMod = 'handily-agent-board'
const runTimeoutMs = 60_000
const goalStateFailure = 'already_in_goal_state'
const dependentsFailure = 'required_by_dependents'
const unsatisfiedDependency = 'dependency-unsatisfied'
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const personalConfigFiles = [
  'settings.json',
  join('plugins', 'installed_plugins.json'),
  join('plugins', 'known_marketplaces.json'),
]
const globalConfigFile = '.claude.json'
const parentSessionVariable = /^CLAUDE/

export const timestampFields = new Set(['installedAt', 'lastUpdated'])

function isTimestamp(value) {
  return typeof value === 'string' && timestampPattern.test(value)
}

function isTimestampChange(field, first, second) {
  return timestampFields.has(field) && isTimestamp(first) && isTimestamp(second) && first !== second
}

export function differences(before, after, measuredTimestamps = new Set()) {
  const found = []
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  for (const id of ids) {
    const first = before[id]
    const second = after[id]
    if (!first || !second) {
      found.push({ id, field: 'installed' })
      continue
    }
    const fields = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort()
    for (const field of fields) {
      const isMeasured = measuredTimestamps.has(field)
      if (isMeasured && isTimestampChange(field, first[field], second[field])) continue
      if (JSON.stringify(first[field]) !== JSON.stringify(second[field])) {
        found.push({ id, field })
      }
    }
  }
  return found
}

export function changedTimestamps(before, after) {
  const changed = new Set()
  for (const id of Object.keys(before)) {
    if (!after[id]) continue
    for (const field of timestampFields) {
      if (isTimestampChange(field, before[id][field], after[id][field])) changed.add(field)
    }
  }
  return [...changed].sort()
}

export function expectedStateFailures(action, state, plugins) {
  const found = []
  for (const plugin of plugins) {
    const entry = state[plugin.id]
    if (!entry) {
      found.push(`${plugin.id}: installed is false after ${action.name}; expected true`)
      continue
    }
    if (entry.enabled !== action.enabled) {
      found.push(
        `${plugin.id}: enabled is ${entry.enabled} after ${action.name}; expected ${action.enabled}`,
      )
    }
    if (entry.version !== plugin.version) {
      found.push(
        `${plugin.id}: version is ${entry.version} after ${action.name}; expected ${plugin.version}`,
      )
    }
    if (!entry.cacheVersions.includes(plugin.version)) {
      found.push(
        `${plugin.id}: cacheVersions is [${entry.cacheVersions.join(', ')}] after ${action.name}; expected it to include ${plugin.version}`,
      )
    }
  }
  return found
}

export function restoredBundleFailures(state, bundleId, probeId) {
  const entry = state[bundleId]
  if (!entry) {
    return [`${bundleId}: installed is false after ${probeId} is enabled again; expected true`]
  }
  if (entry.errorDetails !== undefined) {
    return [`${bundleId}: errorDetails remain after ${probeId} is enabled again`]
  }
  return []
}

export function personalConfigPaths(env, home) {
  const dir = env.CLAUDE_CONFIG_DIR ?? join(home, '.claude')
  return personalConfigFiles.map((file) => join(dir, file))
}

export function scratchGlobalConfigFailures(configDir) {
  if (existsSync(join(configDir, globalConfigFile))) return []
  return [
    `claude wrote no ${globalConfigFile} into the scratch config folder; it may have written the person's global config instead`,
  ]
}

export function childEnv(parentEnv, configDir) {
  const kept = Object.entries(parentEnv).filter(([name]) => !parentSessionVariable.test(name))
  return { ...Object.fromEntries(kept), CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: '' }
}

export function isEntryScript(argvPath, moduleUrl) {
  if (argvPath === undefined) return false
  return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl))
}

const failures = []

function fail(message) {
  failures.push(message)
  console.error(`FAIL ${message}`)
}

function readMarketplace() {
  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'))
  return marketplace.plugins.map((plugin) => ({
    name: plugin.name,
    id: `${plugin.name}@${marketplace.name}`,
    marketplace: marketplace.name,
    version: plugin.version,
    dependencies:
      JSON.parse(readFileSync(join(root, plugin.source, '.claude-plugin', 'plugin.json'), 'utf8'))
        .dependencies ?? [],
  }))
}

function dependenciesFirst(plugins) {
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]))
  const ordered = []
  const visit = (plugin) => {
    if (ordered.includes(plugin)) return
    for (const name of plugin.dependencies) visit(byName.get(name))
    ordered.push(plugin)
  }
  plugins.forEach(visit)
  return ordered
}

function readPersonalConfig() {
  return personalConfigPaths(process.env, homedir()).map((path) => ({
    path,
    bytes: existsSync(path) ? readFileSync(path) : undefined,
  }))
}

function checkPersonalConfigUnchanged(before) {
  for (const { path, bytes } of before) {
    const now = existsSync(path) ? readFileSync(path) : undefined
    const same = bytes === undefined ? now === undefined : now !== undefined && bytes.equals(now)
    if (!same) fail(`the person's Claude config file ${path} changed during the gate`)
  }
}

function claude(scratch, args) {
  const result = spawnSync('claude', args, {
    cwd: scratch.work,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(process.env, scratch.config),
    timeout: runTimeoutMs,
  })
  if (result.error) {
    throw new Error(`cannot run claude ${args.join(' ')} (${result.error.message})`)
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function claudeResult(scratch, args) {
  const { status, stdout, stderr } = claude(scratch, [...args, '--json'])
  const lastLine = stdout.trim().split('\n').at(-1) ?? ''
  try {
    return { status, outcome: JSON.parse(lastLine) }
  } catch {
    throw new Error(`claude ${args.join(' ')} printed no JSON result: ${stderr || stdout}`)
  }
}

function isAccepted(action, { status, outcome }) {
  if (status === 0 && outcome.outcome === 'ok') return true
  return action.goalStateIsOk && status === 1 && outcome.failureCode === goalStateFailure
}

function cacheVersions(scratch, plugin) {
  const dir = join(scratch.config, 'plugins', 'cache', plugin.marketplace, plugin.name)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

function snapshot(scratch, plugins) {
  const { status, stdout, stderr } = claude(scratch, ['plugin', 'list', '--json'])
  if (status !== 0) throw new Error(`claude plugin list exited ${status}: ${stderr}`)
  const listed = new Map(JSON.parse(stdout).map((entry) => [entry.id, entry]))
  const state = {}
  for (const plugin of plugins) {
    const entry = listed.get(plugin.id)
    if (entry) state[plugin.id] = { ...entry, cacheVersions: cacheVersions(scratch, plugin) }
  }
  return state
}

function runAction(scratch, action, plugins) {
  for (const plugin of action.order(plugins)) {
    const result = claudeResult(scratch, ['plugin', action.name, plugin.id])
    if (!isAccepted(action, result)) {
      fail(
        `${plugin.id}: claude plugin ${action.name} exited ${result.status}: ${result.outcome.message}`,
      )
    }
  }
  return snapshot(scratch, plugins)
}

function runPair(scratch, action, plugins) {
  const first = runAction(scratch, action, plugins)
  const second = runAction(scratch, action, plugins)
  const measuredTimestamps = changedTimestamps(first, second)
  for (const { id, field } of differences(first, second, new Set(measuredTimestamps))) {
    fail(`${id}: ${field} differs between the two ${action.name} runs`)
  }
  expectedStateFailures(action, second, plugins).forEach(fail)
  console.log(
    `${action.name} twice: ${Object.keys(second).length} plugin(s); timestamps ignored because they changed between the runs: ${measuredTimestamps.join(', ') || 'none'}`,
  )
}

function hasUnsatisfiedDependency(entry, dependencyId) {
  return (entry?.errorDetails ?? []).some(
    (detail) => detail.type === unsatisfiedDependency && detail.dependency === dependencyId,
  )
}

function checkBundleWithDisabledMod(scratch, plugins) {
  const bundle = plugins.find((plugin) => plugin.name === bundleName)
  const probe = plugins.find((plugin) => plugin.name === bundleProbeMod)
  if (!bundle || !probe || !bundle.dependencies.includes(probe.name)) {
    fail(`bundle: ${bundleName} must list ${bundleProbeMod} as a dependency for this check`)
    return
  }
  const refused = claudeResult(scratch, ['plugin', 'disable', probe.id])
  const isRefused =
    refused.status === 1 &&
    refused.outcome.failureCode === dependentsFailure &&
    (refused.outcome.reverseDependents ?? []).includes(bundle.name)
  if (!isRefused) {
    fail(
      `${probe.id}: claude plugin disable exited ${refused.status} with ${refused.outcome.failureCode}; expected ${dependentsFailure} naming ${bundle.name}`,
    )
  }
  const settingsPath = join(scratch.config, 'settings.json')
  const settingsText = readFileSync(settingsPath, 'utf8')
  const settings = JSON.parse(settingsText)
  settings.enabledPlugins[probe.id] = false
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  const skipped = snapshot(scratch, plugins)
  writeFileSync(settingsPath, settingsText)
  if (!hasUnsatisfiedDependency(skipped[bundle.id], probe.id)) {
    fail(
      `${bundle.id}: errorDetails has no ${unsatisfiedDependency} for ${probe.id} while ${probe.id} is disabled`,
    )
  }
  restoredBundleFailures(snapshot(scratch, plugins), bundle.id, probe.id).forEach(fail)
  console.log(
    `bundle: disable ${probe.id} is refused while ${bundle.id} is enabled; with ${probe.id} disabled in settings, ${bundle.id} reports ${unsatisfiedDependency}`,
  )
}

const actions = [
  { name: 'install', enabled: true, goalStateIsOk: false, order: (plugins) => plugins },
  { name: 'update', enabled: true, goalStateIsOk: false, order: (plugins) => plugins },
  {
    name: 'disable',
    enabled: false,
    goalStateIsOk: true,
    order: (plugins) => dependenciesFirst(plugins).reverse(),
  },
  { name: 'enable', enabled: true, goalStateIsOk: true, order: dependenciesFirst },
]

function runGate() {
  const plugins = readMarketplace()
  const personalConfig = readPersonalConfig()
  const base = mkdtempSync(join(tmpdir(), 'handily-install-gate-'))
  const scratch = { config: join(base, 'config'), work: join(base, 'work') }
  mkdirSync(scratch.config)
  mkdirSync(scratch.work)
  try {
    const added = claudeResult(scratch, ['plugin', 'marketplace', 'add', root])
    if (!isAccepted({ goalStateIsOk: false }, added)) {
      throw new Error(
        `claude plugin marketplace add exited ${added.status}: ${added.outcome.message}`,
      )
    }
    for (const action of actions) runPair(scratch, action, plugins)
    checkBundleWithDisabledMod(scratch, plugins)
    scratchGlobalConfigFailures(scratch.config).forEach(fail)
  } catch (error) {
    fail(error.message)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  checkPersonalConfigUnchanged(personalConfig)
  if (failures.length > 0) {
    console.error(`install-gate: failed (${failures.length} differences)`)
    process.exit(1)
  }
  console.log('install-gate: passed')
}

if (isEntryScript(process.argv[1], import.meta.url)) runGate()
