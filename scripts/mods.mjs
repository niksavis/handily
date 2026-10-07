import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const modsDir = join(root, 'mods')
const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
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

function layTypes(mods, { force }) {
  const configDir = mkdtempSync(join(tmpdir(), 'handily-types-'))
  try {
    for (const mod of mods) {
      if (!force && existsSync(join(typesDir(mod), 'tsconfig.json'))) continue
      spawnSync('claude', ['--plugin-dir', mod.dir, '-p', 'ok'], {
        cwd: root,
        stdio: 'ignore',
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: '' },
        timeout: 120_000,
      })
      if (!existsSync(join(typesDir(mod), 'tsconfig.json'))) {
        fail(`${mod.name}: Claude Code wrote no types; is the claude CLI on PATH?`)
      }
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

function checkMarketplace(mods) {
  const marketplace = readJson(marketplacePath, 'marketplace')
  if (!marketplace) return
  const listed = new Map((marketplace.plugins ?? []).map((plugin) => [plugin.name, plugin]))
  for (const mod of mods) {
    const manifest = readJson(join(mod.dir, '.claude-plugin', 'plugin.json'), mod.name)
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

function lint(mods) {
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
    if (path.includes(`${join('.claude-plugin', 'types')}`)) continue
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
