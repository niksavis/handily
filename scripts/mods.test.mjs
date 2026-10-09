import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
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

function makeRepoWithUnlaidContract() {
  const root = mkdtempSync(join(tmpdir(), 'handily-mods-contract-'))
  mkdirSync(join(root, 'scripts'))
  cpSync(join(repoRoot, 'scripts', 'mods.mjs'), join(root, 'scripts', 'mods.mjs'))
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  const engineTypes = { compilerOptions: { strict: true, noEmit: true, types: [] } }
  const layMod = (name, manifest) => {
    const mod = join(root, 'mods', name)
    mkdirSync(join(mod, '.claude-plugin', 'types'), { recursive: true })
    mkdirSync(join(mod, 'hooks'))
    writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
    writeFileSync(
      join(mod, '.claude-plugin', 'types', 'tsconfig.json'),
      JSON.stringify(engineTypes),
    )
    writeFileSync(
      join(mod, 'tsconfig.json'),
      JSON.stringify({ extends: './.claude-plugin/types/tsconfig.json', include: ['hooks'] }),
    )
    writeFileSync(join(mod, 'hooks', 'register.ts'), 'export const answer: number = 42\n')
    return mod
  }
  const base = layMod('base', { name: 'base', types: './types/index.d.ts' })
  mkdirSync(join(base, 'types'))
  writeFileSync(join(base, 'types', 'index.d.ts'), 'export type BaseValue = number\n')
  const dependent = layMod('dependent', { name: 'dependent', dependencies: ['base'] })
  return { root, laid: join(dependent, '.claude-plugin', 'types', 'base', 'index.d.ts') }
}

const contractRepo = makeRepoWithUnlaidContract()
after(() => rmSync(contractRepo.root, { recursive: true, force: true }))

const contractResult = spawnSync(
  process.execPath,
  [join(contractRepo.root, 'scripts', 'mods.mjs'), 'typecheck'],
  { cwd: contractRepo.root, encoding: 'utf8', env: { ...process.env, PATH: emptyBin } },
)

test('typecheck lays a missing dependency contract as a regular file and passes without the engine', () => {
  assert.equal(contractResult.status, 0, contractResult.stdout + contractResult.stderr)
  assert.equal(lstatSync(contractRepo.laid).isSymbolicLink(), false)
  assert.equal(readFileSync(contractRepo.laid, 'utf8'), 'export type BaseValue = number\n')
})
