import type { FsEntry } from 'claude-code'
import type { WorkitemsFailedReason } from '../types'
import type { TrackerFiles } from './readers/index'

export const CONFIG_FILE = '.handily.json'
export const USER_ADAPTERS_FILE = '.config/handily/adapters.json'
export const USER_ADAPTERS_SHOWN = `~/${USER_ADAPTERS_FILE}`
export const MAX_ARGUMENT_LENGTH = 256

export function isUnsafeCharacter(code: number): boolean {
  const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f)
  const isLineBreak = code === 0x2028 || code === 0x2029
  const isBidiControl = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
  return isControl || isLineBreak || isBidiControl
}

export function argumentProblem(argument: string): string | null {
  for (const character of argument) {
    if (isUnsafeCharacter(character.codePointAt(0) ?? 0)) return 'with a control character'
  }
  if (argument.length > MAX_ARGUMENT_LENGTH) {
    return `over ${String(MAX_ARGUMENT_LENGTH)} characters`
  }
  return null
}

export class FileProblem extends Error {
  constructor(readonly reason: WorkitemsFailedReason) {
    super(reason)
  }
}

export type FilesFormat = 'json' | 'jsonl' | 'frontmatter'

export const MAPPED_FIELDS = [
  'id',
  'title',
  'status',
  'priority',
  'type',
  'assignee',
  'updatedAt',
  'labels',
  'parent',
  'url',
] as const

export type MappedField = (typeof MAPPED_FIELDS)[number]

export type FieldMap = { id: string; title: string; status: string } & Partial<
  Record<MappedField, string>
>

export type FilesConfig = { globs: readonly string[]; format: FilesFormat; fields: FieldMap }

export type HandilyConfig = { source: string | null; files: FilesConfig | null }

export type ConfigOutcome =
  { ok: true; config: HandilyConfig } | { ok: false; reason: WorkitemsFailedReason }

export type GlobMatch = { path: string; size: number; mtimeMs: number }

const FORMATS: readonly FilesFormat[] = ['json', 'jsonl', 'frontmatter']
const TOP_LEVEL_KEYS = ['source', 'globs', 'format', 'fields'] as const
const REQUIRED_FIELDS = ['id', 'title', 'status'] as const
const UNSUPPORTED_GLOB_CHARACTERS = /[[\]{}\\]/
const ABSOLUTE_PATH = /^([\\/]|[A-Za-z]:)/

class ConfigFault extends Error {}

function configFault(detail: string): never {
  throw new ConfigFault(`${CONFIG_FILE} ${detail}, so it could not be read.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function globsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isText)) {
    configFault('needs globs as a list of paths')
  }
  return value
}

function formatOf(value: unknown): FilesFormat {
  const format = FORMATS.find((known) => known === value)
  if (!format) configFault(`needs a format of ${FORMATS.join(', ')}`)
  return format
}

function fieldsOf(value: unknown): FieldMap {
  if (!isRecord(value)) configFault('needs fields as a map of item fields to file fields')
  const fields: Partial<Record<MappedField, string>> = {}
  for (const [key, name] of Object.entries(value)) {
    const field = MAPPED_FIELDS.find((known) => known === key)
    if (!field) configFault(`fields names ${key}, which is not one of ${MAPPED_FIELDS.join(', ')}`)
    if (!isText(name)) configFault(`fields gives ${key} no file field`)
    fields[field] = name
  }
  for (const required of REQUIRED_FIELDS) {
    if (!fields[required]) configFault(`fields has no ${required}`)
  }
  return fields as FieldMap
}

function isCopyableCommand(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((argument) => isText(argument) && argumentProblem(argument) === null)
  )
}

async function repoCommandFault(files: TrackerFiles, command: unknown): Promise<never> {
  const refusal = `${CONFIG_FILE} names a command, and handily runs an adapter only from ${USER_ADAPTERS_SHOWN}`
  const rootReal = await files.realPath('.')
  if (rootReal === undefined || argumentProblem(rootReal) !== null || !isCopyableCommand(command)) {
    throw new ConfigFault(`${refusal}, so it could not be read.`)
  }
  throw new ConfigFault(
    `${refusal}. To run it, add ${JSON.stringify(rootReal)}: ${JSON.stringify(command)} to that file. The repo command could not be read.`,
  )
}

function configOf(parsed: unknown): HandilyConfig {
  if (!isRecord(parsed)) configFault('is not a JSON object')
  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL_KEYS.some((known) => known === key)) {
      configFault(`has the key ${key}, which is not one of ${TOP_LEVEL_KEYS.join(', ')}`)
    }
  }
  const { source, globs, format, fields } = parsed
  if (source !== undefined && !isText(source)) configFault('needs source as a tracker name')
  const namesFiles = globs !== undefined || format !== undefined || fields !== undefined
  return {
    source: source ?? null,
    files: namesFiles
      ? { globs: globsOf(globs), format: formatOf(format), fields: fieldsOf(fields) }
      : null,
  }
}

const configReads = new WeakMap<TrackerFiles, Promise<ConfigOutcome>>()

export function readConfig(files: TrackerFiles): Promise<ConfigOutcome> {
  let outcome = configReads.get(files)
  if (!outcome) {
    outcome = readConfigOnce(files)
    configReads.set(files, outcome)
  }
  return outcome
}

async function readConfigOnce(files: TrackerFiles): Promise<ConfigOutcome> {
  try {
    if (!(await files.exists(CONFIG_FILE)))
      return { ok: true, config: { source: null, files: null } }
    const parsed = parseJson(await files.read(CONFIG_FILE))
    if (isRecord(parsed) && Object.hasOwn(parsed, 'command')) {
      await repoCommandFault(files, parsed.command)
    }
    return { ok: true, config: configOf(parsed) }
  } catch (error) {
    if (error instanceof FileProblem) return { ok: false, reason: error.reason }
    if (error instanceof ConfigFault) {
      return { ok: false, reason: error.message as WorkitemsFailedReason }
    }
    throw error
  }
}

function joined(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

export function isInside(rootReal: string, real: string): boolean {
  const base = rootReal.replace(/[\\/]+$/, '')
  return real === base || real.startsWith(`${base}/`) || real.startsWith(`${base}\\`)
}

function segmentPattern(segment: string): RegExp {
  const source = segment
    .split('')
    .map((character) => {
      if (character === '*') return '[^/]*'
      if (character === '?') return '[^/]'
      return character.replace(/[.+^$()|]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${source}$`)
}

function hasWildcard(segment: string): boolean {
  return segment.includes('*') || segment.includes('?')
}

function isHidden(name: string, segment: string): boolean {
  return name.startsWith('.') && !segment.startsWith('.')
}

type Walk = { files: TrackerFiles; rootReal: string; glob: string }

async function confine(walk: Walk, path: string): Promise<void> {
  const real = await walk.files.realPath(path === '' ? '.' : path)
  if (real === undefined) {
    throw new FileProblem(`the glob ${walk.glob} needs ${path}, which could not be read.`)
  }
  if (!isInside(walk.rootReal, real)) {
    throw new FileProblem(
      `${path} resolves outside the repo root, so the glob ${walk.glob} could not be read.`,
    )
  }
}

async function entriesOf(walk: Walk, directory: string): Promise<FsEntry[]> {
  await confine(walk, directory)
  return walk.files.list(directory === '' ? '.' : directory)
}

async function lastSegment(walk: Walk, directory: string, segment: string): Promise<GlobMatch[]> {
  const pattern = segmentPattern(segment)
  const matches: GlobMatch[] = []
  for (const entry of await entriesOf(walk, directory)) {
    const isCandidate = entry.kind === 'file' || entry.isLink
    if (!isCandidate || isHidden(entry.name, segment) || !pattern.test(entry.name)) continue
    const path = joined(directory, entry.name)
    if (!entry.isLink) {
      matches.push({ path, size: entry.size, mtimeMs: entry.mtimeMs })
      continue
    }
    await confine(walk, path)
    const target = await walk.files.stat(path)
    matches.push({ path, size: target.size, mtimeMs: target.mtimeMs })
  }
  return matches
}

async function subdirectories(walk: Walk, directory: string, segment: string): Promise<string[]> {
  const pattern = segment === '**' ? undefined : segmentPattern(segment)
  return (await entriesOf(walk, directory))
    .filter((entry) => entry.kind === 'dir' && !isHidden(entry.name, segment))
    .filter((entry) => pattern === undefined || pattern.test(entry.name))
    .map((entry) => joined(directory, entry.name))
}

async function expand(walk: Walk, directory: string, segments: string[]): Promise<GlobMatch[]> {
  const [segment, ...rest] = segments
  if (segment === undefined) return []
  if (rest.length === 0) return lastSegment(walk, directory, segment)
  if (segment === '**') {
    const matches = await expand(walk, directory, rest)
    for (const child of await subdirectories(walk, directory, segment)) {
      matches.push(...(await expand(walk, child, segments)))
    }
    return matches
  }
  if (!hasWildcard(segment)) return expand(walk, joined(directory, segment), rest)
  const matches: GlobMatch[] = []
  for (const child of await subdirectories(walk, directory, segment)) {
    matches.push(...(await expand(walk, child, rest)))
  }
  return matches
}

export async function matchGlobs(
  files: TrackerFiles,
  globs: readonly string[],
): Promise<GlobMatch[]> {
  const rootReal = await files.realPath('.')
  if (rootReal === undefined) throw new FileProblem('the repo root could not be read.')
  const byPath = new Map<string, GlobMatch>()
  for (const glob of globs) {
    if (ABSOLUTE_PATH.test(glob)) {
      throw new FileProblem(
        `the glob ${glob} is not relative to the repo root, so it could not be read.`,
      )
    }
    if (UNSUPPORTED_GLOB_CHARACTERS.test(glob)) {
      throw new FileProblem(
        `the glob ${glob} uses a wildcard other than * and ?, so it could not be read.`,
      )
    }
    const segments = glob.split('/').filter((segment) => segment !== '' && segment !== '.')
    for (const match of await expand({ files, rootReal, glob }, '', segments)) {
      byPath.set(match.path, match)
    }
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function signatureOfMatches(matches: readonly GlobMatch[]): string {
  return matches
    .map((match) => [match.path, String(match.size), String(match.mtimeMs)].join(' '))
    .join('\n')
}
