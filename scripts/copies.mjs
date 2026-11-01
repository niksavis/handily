import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(entry.parentPath, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

export function keepersOf(dir, file) {
  return readdirSync(dir)
    .filter((mod) => existsSync(join(dir, mod, 'hooks', file)))
    .sort()
}

export function listedKeeperProblems(dir, file, listed, list) {
  const keepers = keepersOf(dir, file)
  const unlisted = keepers
    .filter((mod) => !listed.includes(mod))
    .map((mod) => `mods/${mod}/hooks/${file} is not in ${list}; add the mod there`)
  const missing = listed
    .filter((mod) => !keepers.includes(mod))
    .map(
      (mod) =>
        `${list.replace(/ of .*$/, '')} lists ${mod}, but mods/${mod}/hooks/${file} is missing`,
    )
  return [...unlisted, ...missing]
}

export function differingCopies(dir, file) {
  const [first, ...rest] = keepersOf(dir, file).map((mod) => ({
    mod,
    bytes: readFileSync(join(dir, mod, 'hooks', file)),
  }))
  return rest
    .filter(({ bytes }) => !bytes.equals(first.bytes))
    .map(
      ({ mod }) =>
        `mods/${first.mod}/hooks/${file} and mods/${mod}/hooks/${file} differ; copy one over the other`,
    )
}

export function withModsTree(files, body) {
  const tree = mkdtempSync(join(tmpdir(), 'handily-mods-'))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(tree, path)), { recursive: true })
      writeFileSync(join(tree, path), text)
    }
    body(join(tree, 'mods'))
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
}

const NAMED = String.raw`\{[^}]*\}`
const NAMESPACE = String.raw`\*(?:\s+as\s+[\w$]+)?`
const SOURCE = String.raw`\s*(?:'[^'\n]*'|"[^"\n]*")`
const MODULE_STATEMENT = new RegExp(
  [
    String.raw`^[ \t]*import\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:${NAMED}|${NAMESPACE})?\s*from${SOURCE}`,
    String.raw`^[ \t]*export\s+(?:type\s+)?(?:${NAMED}|${NAMESPACE})\s*from${SOURCE}`,
    String.raw`^[ \t]*import${SOURCE}`,
  ].join('|'),
  'gm',
)
const TYPE_STATEMENT = /^\s*(?:import|export)\s+type\b/

export function valueImports(text) {
  return [...text.matchAll(MODULE_STATEMENT)]
    .map(([statement]) => statement.trim())
    .filter((statement) => !TYPE_STATEMENT.test(statement))
}
