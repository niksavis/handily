import { ROOT_PATH } from './tree'

const BACKSLASHES = /\\/g
const TRAILING_SLASHES = /(?<=.)\/+$/
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/
const LEADING_DOTS = /^(?:\.\/)+/

export function normalPath(path: string): string {
  return path.replace(BACKSLASHES, '/').replace(TRAILING_SLASHES, '')
}

function withSlash(folder: string): string {
  return folder.endsWith('/') ? folder : `${folder}/`
}

export function resolvedPath(cwd: string, path: string): string {
  const normal = normalPath(path)
  if (ABSOLUTE.test(normal)) return normal
  const rest = normal.replace(LEADING_DOTS, '')
  const base = normalPath(cwd)
  return rest === '' || rest === '.' ? base : `${withSlash(base)}${rest}`
}

export function shownPath(cwd: string, path: string): string {
  const prefix = withSlash(normalPath(cwd))
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export function absolutePath(cwd: string, path: string): string {
  if (path === ROOT_PATH) return cwd
  return /[\\/]$/.test(cwd) ? `${cwd}${path}` : `${cwd}/${path}`
}
