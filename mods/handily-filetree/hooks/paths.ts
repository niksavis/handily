import { ROOT_PATH } from './tree'

const BACKSLASHES = /\\/g
const TRAILING_SLASHES = /(?<=.)\/+$/
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/
const ROOT_PART = /^(?:[A-Za-z]:)?\//
const HERE = '.'
const UP = '..'

export function normalPath(path: string): string {
  return path.replace(BACKSLASHES, '/').replace(TRAILING_SLASHES, '')
}

function withoutDots(path: string): string {
  const root = ROOT_PART.exec(path)?.[0] ?? ''
  const parts: string[] = []
  for (const part of path.slice(root.length).split('/')) {
    if (part === '' || part === HERE) continue
    const last = parts.at(-1)
    if (part === UP && last !== undefined && last !== UP) parts.pop()
    else if (part !== UP || root === '') parts.push(part)
  }
  const joined = `${root}${parts.join('/')}`
  return joined === '' ? HERE : joined
}

function cleanPath(path: string): string {
  return withoutDots(normalPath(path))
}

function withSlash(folder: string): string {
  return folder.endsWith('/') ? folder : `${folder}/`
}

export function resolvedPath(cwd: string, path: string): string {
  const normal = normalPath(path)
  if (ABSOLUTE.test(normal)) return cleanPath(normal)
  return cleanPath(`${withSlash(normalPath(cwd))}${normal}`)
}

export function insidePath(cwd: string, path: string): string | undefined {
  const prefix = withSlash(cleanPath(cwd))
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined
}

export function shownPath(cwd: string, path: string): string {
  return insidePath(cwd, path) ?? path
}

export function absolutePath(cwd: string, path: string): string {
  if (path === ROOT_PATH) return cwd
  return /[\\/]$/.test(cwd) ? `${cwd}${path}` : `${cwd}/${path}`
}
