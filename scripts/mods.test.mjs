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
import { join } from 'node:path'
import { after, test } from 'node:test'

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

function engineTsconfig(types) {
  return JSON.stringify({ compilerOptions: { ...engineCompilerOptions, types } })
}

function makeRepoWithUnlaidContract({ listsDependency }) {
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
const headlessClaude = makeFakeClaude(notLoggedIn)
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
const contractResult = runMods(contractRepo, 'typecheck', emptyBin)

test('typecheck lays a missing dependency contract as a regular file and passes without the engine', () => {
  assert.equal(contractResult.status, 0, contractResult.stdout + contractResult.stderr)
  assert.equal(lstatSync(contractRepo.laid).isSymbolicLink(), false)
  assert.equal(readFileSync(contractRepo.laid, 'utf8'), 'export type BaseValue = number\n')
})

const typesRepo = makeRepoWithUnlaidContract({ listsDependency: true })
const typesResult = runMods(typesRepo, 'types', headlessClaude)

test('types lays the dependency contracts and passes when the headless engine lays nothing', () => {
  assert.equal(typesResult.status, 0, typesResult.stdout + typesResult.stderr)
  assert.equal(readFileSync(typesRepo.laid, 'utf8'), 'export type BaseValue = number\n')
})

const staleRepo = makeRepoWithUnlaidContract({ listsDependency: false })
const staleResult = runMods(staleRepo, 'typecheck', layingClaude)

test('typecheck lays the types again when the laid tsconfig does not list a dependency', () => {
  assert.equal(staleResult.status, 0, staleResult.stdout + staleResult.stderr)
  const laid = JSON.parse(readFileSync(staleRepo.laidTsconfig, 'utf8'))
  assert.deepEqual(laid.compilerOptions.types, ['base'])
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
