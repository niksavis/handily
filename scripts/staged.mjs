import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

const documentPattern = /\.md$/i
const sourcePattern = /\.[cm]?[jt]sx?$/
const specifierPattern = /\b(?:from|import)\s*\(?\s*(['"])(\.{1,2}\/[^'"\n]*)\1/g
const literalPattern = /(['"`])([^'"`\n]+)\1/g
const resolvedSuffixes = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.mjs']
const scriptTestPattern = /\.test\.mjs$/
const generatedTypesPattern = /(?:^|\/)\.claude-plugin\/types\//
const rootConfigPattern =
  /^(?:package\.json|package-lock\.json|eslint\.config\.mjs|\.prettierrc\.json|tsconfig[^/]*\.json)$/
const gateRunner = 'scripts/mods.mjs'
const scriptsFolder = 'scripts/'

function posixPath(path) {
  return path.split(sep).join('/')
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readSource(root, path) {
  if (!sourcePattern.test(path)) return ''
  try {
    return readFileSync(join(root, path), 'utf8')
  } catch {
    return ''
  }
}

function resolveImport(root, from, specifier) {
  const base = posixPath(join(dirname(from), specifier))
  return resolvedSuffixes.map((suffix) => base + suffix).find((path) => isFile(join(root, path)))
}

function importClosure(root, starts) {
  const seen = new Set()
  const pending = [...starts]
  while (pending.length > 0) {
    const path = pending.pop()
    if (seen.has(path)) continue
    seen.add(path)
    for (const [, , specifier] of readSource(root, path).matchAll(specifierPattern)) {
      const target = resolveImport(root, path, specifier)
      if (target !== undefined) pending.push(target)
    }
  }
  return seen
}

function quotedNames(root, paths) {
  const names = new Set()
  for (const path of paths) {
    for (const [, , text] of readSource(root, path).matchAll(literalPattern)) {
      names.add(text.split('/').at(-1))
    }
  }
  return names
}

function sourceFilesOf(root, dir, isSkipped) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !isSkipped(path))
    .map((path) => posixPath(relative(root, path)))
    .filter((path) => sourcePattern.test(path))
}

function scriptTestsOf(root) {
  return readdirSync(join(root, 'scripts'))
    .filter((name) => scriptTestPattern.test(name))
    .sort()
    .map((name) => `scripts/${name}`)
}

export function isDocument(path) {
  return documentPattern.test(path)
}

export function isGeneratedTypes(path) {
  return generatedTypesPattern.test(path)
}

function gateRunnerFiles(root) {
  return new Set([...importClosure(root, [gateRunner]), 'scripts/staged.mjs'])
}

function dependantsClosure(mods, reached, dependenciesOf) {
  const names = new Set(reached)
  let grown = true
  while (grown) {
    grown = false
    for (const mod of mods) {
      if (names.has(mod.name)) continue
      if (dependenciesOf(mod).some((name) => names.has(name))) {
        names.add(mod.name)
        grown = true
      }
    }
  }
  return names
}

export function changedMods({
  root,
  mods,
  paths,
  isSkipped = () => false,
  dependenciesOf = () => [],
}) {
  const changed = paths.filter((path) => !isDocument(path))
  const allNames = new Set(mods.map((mod) => mod.name))
  const runnerFiles = gateRunnerFiles(root)
  const setsAll = (path) => rootConfigPattern.test(path) || runnerFiles.has(path)
  if (changed.some(setsAll)) return { all: true, names: allNames }
  const mapped = new Set(changed.filter((path) => path.startsWith(scriptsFolder)))
  const reached = new Set()
  for (const mod of mods) {
    const folder = `${posixPath(relative(root, mod.dir))}/`
    const closure = importClosure(root, sourceFilesOf(root, mod.dir, isSkipped))
    const hits = changed.filter((path) => path.startsWith(folder) || closure.has(path))
    for (const path of hits) mapped.add(path)
    if (hits.length > 0) reached.add(mod.name)
  }
  if (changed.some((path) => !mapped.has(path))) return { all: true, names: allNames }
  return { all: false, names: dependantsClosure(mods, reached, dependenciesOf) }
}

export function changedTests({
  root,
  mods,
  paths,
  testFilesOf,
  isSkipped = () => false,
  dependenciesOf = () => [],
}) {
  const changed = paths.filter((path) => !isDocument(path) && !isGeneratedTypes(path))
  const reached = changedMods({ root, mods, paths: changed, isSkipped, dependenciesOf }).names
  const filesByMod = new Map()
  for (const mod of mods) {
    if (reached.has(mod.name)) filesByMod.set(mod.name, new Set(testFilesOf(mod)))
  }
  const scriptTests = scriptTestsOf(root).filter((test) => {
    const closure = importClosure(root, [test])
    const names = quotedNames(root, [...closure])
    return changed.some((path) => closure.has(path) || names.has(basename(path)))
  })
  return { filesByMod, scriptTests }
}
