import { underPrefix } from './status'

export type LineCount = { added: number; removed: number }

export type FileLines = LineCount | 'bin'

export type Numstat = ReadonlyMap<string, FileLines>

export type LineMarks = {
  fileOf: (path: string) => FileLines | undefined
  folderOf: (folder: string) => LineCount | undefined
  total: LineCount | undefined
}

const BINARY = '-'
const THOUSAND = 1000
const TEN_THOUSAND = 10_000
const ROOT = '.'

export function numstatArgv(): readonly string[] {
  return [
    'git',
    '--no-optional-locks',
    'diff',
    '--numstat',
    '-z',
    '--no-relative',
    'HEAD',
    '--',
    '.',
  ]
}

function countOf(field: string): number | undefined {
  return /^\d+$/.test(field) ? Number(field) : undefined
}

function linesOf(added: string, removed: string): FileLines | undefined {
  if (added === BINARY && removed === BINARY) return 'bin'
  const plus = countOf(added)
  const minus = countOf(removed)
  return plus === undefined || minus === undefined ? undefined : { added: plus, removed: minus }
}

export function parseNumstat(stdout: string): Numstat {
  const records = stdout.split('\0')
  records.pop()
  const byPath = new Map<string, FileLines>()
  for (let index = 0; index < records.length; index += 1) {
    const [added = '', removed = '', ...rest] = (records[index] ?? '').split('\t')
    let path = rest.join('\t')
    if (path === '') {
      path = records[index + 2] ?? ''
      index += 2
    }
    const lines = linesOf(added, removed)
    if (lines !== undefined && path !== '') byPath.set(path, lines)
  }
  return byPath
}

function foldersAbove(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

function addTo(sums: Map<string, LineCount>, folder: string, lines: LineCount): void {
  const sum = sums.get(folder) ?? { added: 0, removed: 0 }
  sums.set(folder, { added: sum.added + lines.added, removed: sum.removed + lines.removed })
}

export function lineMarks(numstat: Numstat, prefix: string): LineMarks {
  const byPath = new Map<string, FileLines>()
  const sums = new Map<string, LineCount>()
  for (const [path, lines] of numstat) {
    const inCwd = underPrefix(path, prefix)
    if (inCwd === undefined || inCwd === '') continue
    byPath.set(inCwd, lines)
    if (lines === 'bin') continue
    for (const folder of [ROOT, ...foldersAbove(inCwd)]) addTo(sums, folder, lines)
  }
  return {
    fileOf: (path) => byPath.get(path),
    folderOf: (folder) => sums.get(folder),
    total: sums.get(ROOT),
  }
}

export function lineNumber(count: number): string {
  if (count < THOUSAND) return String(count)
  if (count < TEN_THOUSAND) return `${(Math.floor((count * 10) / THOUSAND) / 10).toFixed(1)}k`
  return `${String(Math.floor(count / THOUSAND))}k`
}
