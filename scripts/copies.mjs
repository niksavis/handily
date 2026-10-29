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
