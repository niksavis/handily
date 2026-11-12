import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

const createdScratchFolders = new Set()

function isStrictlyUnder(path, root) {
  const inside = relative(root, path)
  return inside !== '' && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)
}

function resolvedPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

export function createScratchFolder(prefix, { created = createdScratchFolders } = {}) {
  const path = mkdtempSync(join(tmpdir(), prefix))
  created.add(path)
  return path
}

export function removeScratchFolder(
  path,
  { temporaryRoot = tmpdir(), created = createdScratchFolders } = {},
) {
  if (!created.has(path)) {
    return `the scratch folder ${path} was not created by this run of the gate; the gate did not remove it`
  }
  const resolved = resolvedPath(path)
  const resolvedRoot = resolvedPath(temporaryRoot)
  if (
    resolved === undefined ||
    resolvedRoot === undefined ||
    !isStrictlyUnder(resolved, resolvedRoot)
  ) {
    return `the scratch folder ${path} is not under the temporary root ${temporaryRoot}; the gate did not remove it`
  }
  rmSync(resolved, { recursive: true, force: true })
  created.delete(path)
  return undefined
}
