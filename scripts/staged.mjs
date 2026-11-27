import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

const documentPattern = /\.md$/i
const sourcePattern = /\.[cm]?[jt]sx?$/
const specifierPattern = /\b(?:from|import)\s*\(?\s*(['"])(\.{1,2}\/[^'"\n]*)\1/g
const literalPattern = /(['"`])([^'"`\n]+)\1/g
const resolvedSuffixes = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.mjs']
const scriptTestPattern = /\.test\.mjs$/

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

export function stagedTests({ root, mods, paths, testFilesOf, isSkipped = () => false }) {
  const changed = paths.filter((path) => !isDocument(path))
  const filesByMod = new Map()
  for (const mod of mods) {
    const folder = `${posixPath(relative(root, mod.dir))}/`
    const reached =
      changed.some((path) => path.startsWith(folder)) ||
      [...importClosure(root, sourceFilesOf(root, mod.dir, isSkipped))].some(
        (path) => !path.startsWith(folder) && changed.includes(path),
      )
    if (reached) filesByMod.set(mod.name, new Set(testFilesOf(mod)))
  }
  const scriptTests = scriptTestsOf(root).filter((test) => {
    const closure = importClosure(root, [test])
    const names = quotedNames(root, [...closure])
    return changed.some((path) => closure.has(path) || names.has(basename(path)))
  })
  return { filesByMod, scriptTests }
}
