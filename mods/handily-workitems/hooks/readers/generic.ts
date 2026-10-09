import type { WorkitemsFailedReason, WorkitemsItem, WorkitemsStatus } from '../../types'
import {
  CONFIG_FILE,
  FileProblem,
  isUnsafeCharacter,
  matchGlobs,
  readConfig,
  signatureOfMatches,
  type FieldMap,
  type FilesConfig,
  type MappedField,
} from '../config'
import { numeral } from '../states'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const SOURCE = 'files'
const NORMAL_STATUSES: readonly WorkitemsStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'deferred',
  'closed',
]
const UNREADABLE = Symbol('unreadable')
const FRONT_MATTER_FENCE = '---'
const WHOLE_NUMBER = /^\d+$/
const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(.*)$/
const LIST_ITEM_LINE = /^\s*-(?:\s+(.*))?$/
const BLOCK_SCALAR = /^([|>])([+-]?)\s*(#.*)?$/

export class ItemFault extends Error {
  constructor(readonly reason: WorkitemsFailedReason) {
    super(reason)
  }
}

export type Located = {
  where: string
  value: (field: string) => unknown
  invalid: (field: string) => WorkitemsFailedReason
  missing: (field: string) => WorkitemsFailedReason
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lineFault(path: string, line: number): WorkitemsFailedReason {
  return `${path} line ${numeral(line)} is malformed.`
}

function missingFault(where: string, field: string): WorkitemsFailedReason {
  return `${where} has no ${field}, so it could not be read.`
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

const TEXT_LIMITS = [
  ['id', 'an id', 200],
  ['title', 'a title', 500],
  ['rawStatus', 'a status', 100],
] as const

function textProblem(text: string, name: string, limit: number): string | null {
  let length = 0
  for (const character of text) {
    if (isUnsafeCharacter(character.codePointAt(0) ?? 0)) return `${name} with a control character`
    length += 1
  }
  return length > limit ? `${name} over ${String(limit)} characters` : null
}

export function itemTextProblem(item: WorkitemsItem): string | null {
  for (const [field, name, limit] of TEXT_LIMITS) {
    const problem = textProblem(item[field], name, limit)
    if (problem !== null) return problem
  }
  return null
}

export function checkedItem(item: WorkitemsItem, where: string): WorkitemsItem {
  const problem = itemTextProblem(item)
  if (problem !== null) throw new ItemFault(`${where} has ${problem}, so it could not be read.`)
  return item
}

export function requiredText(located: Located, field: string): string {
  const value = located.value(field)
  if (isAbsent(value)) throw new ItemFault(located.missing(field))
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') throw new ItemFault(located.invalid(field))
  return value
}

export function optionalText(located: Located, field: string | undefined): string | null {
  if (field === undefined) return null
  const value = located.value(field)
  if (isAbsent(value)) return null
  if (typeof value !== 'string') throw new ItemFault(located.invalid(field))
  return value
}

export function optionalLabels(
  located: Located,
  field: string | undefined,
): readonly string[] | undefined {
  if (field === undefined) return undefined
  const value = located.value(field)
  if (isAbsent(value)) return undefined
  if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) {
    throw new ItemFault(located.invalid(field))
  }
  return value
}

export function optionalPriority(located: Located, field: string | undefined): number | null {
  if (field === undefined) return null
  const value = located.value(field)
  if (isAbsent(value)) return null
  const priority = typeof value === 'string' && WHOLE_NUMBER.test(value) ? Number(value) : value
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0) {
    throw new ItemFault(located.invalid(field))
  }
  return priority
}

export function normalStatusOf(rawStatus: string): WorkitemsStatus {
  return NORMAL_STATUSES.find((status) => status === rawStatus) ?? 'other'
}

function closingQuoteOf(text: string): number {
  const quote = text[0]
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index]
    if (quote === '"' && character === '\\') index += 1
    else if (character === quote && quote === "'" && text[index + 1] === "'") index += 1
    else if (character === quote) return index
  }
  return -1
}

function quotedScalarOf(text: string): string | typeof UNREADABLE {
  const close = closingQuoteOf(text)
  if (close < 0) return UNREADABLE
  const after = text.slice(close + 1).trim()
  if (after !== '' && !after.startsWith('#')) return UNREADABLE
  const literal = text.slice(0, close + 1)
  if (literal.startsWith("'")) return literal.slice(1, -1).replaceAll("''", "'")
  try {
    const parsed = JSON.parse(literal) as unknown
    return typeof parsed === 'string' ? parsed : UNREADABLE
  } catch {
    return UNREADABLE
  }
}

function scalarOf(raw: string): string | null | typeof UNREADABLE {
  const text = raw.trim()
  if (text.startsWith('"') || text.startsWith("'")) return quotedScalarOf(text)
  const plain = text.replace(/(^|\s+)#.*$/, '')
  if (plain === '' || plain === '~' || plain === 'null') return null
  if (/^[[{&*!|>@`]/.test(plain)) return UNREADABLE
  return plain
}

function flowListOf(rest: string): readonly string[] | typeof UNREADABLE {
  const close = rest.lastIndexOf(']')
  const after = rest.slice(close + 1).trim()
  if (close < 0 || (after !== '' && !after.startsWith('#'))) return UNREADABLE
  const inner = rest.slice(1, close).trim()
  if (inner === '') return []
  const items = inner.split(',').map(scalarOf)
  if (items.some((item) => item === UNREADABLE)) return UNREADABLE
  return items.map((item) => (typeof item === 'string' ? item : ''))
}

function blockScalarOf(style: string, chomping: string, body: readonly string[]): string {
  const indent = Math.min(
    ...body.filter((line) => line.trim() !== '').map((line) => /^\s*/.exec(line)?.[0].length ?? 0),
  )
  const lines = body.map((line) => line.slice(indent).replace(/\s+$/, ''))
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  const text =
    style === '|'
      ? lines.join('\n')
      : lines
          .map((line) => (line === '' ? '\n' : line))
          .join(' ')
          .replace(/ ?\n ?/g, '\n')
  return chomping === '-' ? text : `${text}\n`
}

function listOrNestedOf(body: readonly string[]): unknown {
  const content = body.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  if (content.length === 0) return undefined
  const items = content.map((line) => LIST_ITEM_LINE.exec(line))
  if (items.some((item) => item === null)) return UNREADABLE
  const scalars = items.map((item) => scalarOf(item?.[1] ?? ''))
  if (scalars.some((scalar) => scalar === UNREADABLE)) return UNREADABLE
  return scalars.map((scalar) => (typeof scalar === 'string' ? scalar : ''))
}

type FrontMatter = { values: Map<string, unknown>; lines: Map<string, number> }

function frontMatterLines(path: string, text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) throw new ItemFault(lineFault(path, 1))
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE)
  if (end < 0) throw new ItemFault(lineFault(path, 1))
  return lines.slice(1, end)
}

function isContinuation(line: string, takesListItems: boolean): boolean {
  return line.trim() === '' || /^\s/.test(line) || (takesListItems && /^-(\s|$)/.test(line))
}

function valueOf(rest: string, body: readonly string[]): unknown {
  const block = BLOCK_SCALAR.exec(rest)
  if (block) return blockScalarOf(block[1] ?? '|', block[2] ?? '', body)
  if (rest === '' || rest.startsWith('#')) return listOrNestedOf(body)
  if (body.some((line) => line.trim() !== '')) return UNREADABLE
  if (rest.startsWith('[')) return flowListOf(rest)
  return scalarOf(rest)
}

export function parseFrontMatter(path: string, text: string): FrontMatter {
  const values = new Map<string, unknown>()
  const lines = new Map<string, number>()
  const source = frontMatterLines(path, text)
  let index = 0
  while (index < source.length) {
    const raw = source[index] ?? ''
    const lineNumber = index + 2
    index += 1
    if (raw.trim() === '' || raw.startsWith('#')) continue
    const keyLine = KEY_LINE.exec(raw)
    if (!keyLine) throw new ItemFault(lineFault(path, lineNumber))
    const key = keyLine[1] ?? ''
    const rest = (keyLine[2] ?? '').trim()
    const takesListItems = rest === '' || rest.startsWith('#')
    const body: string[] = []
    while (index < source.length && isContinuation(source[index] ?? '', takesListItems)) {
      body.push(source[index] ?? '')
      index += 1
    }
    lines.set(key, lineNumber)
    values.set(key, valueOf(rest, body))
  }
  return { values, lines }
}

export function frontMatterLocated(path: string, frontMatter: FrontMatter): Located {
  return {
    where: path,
    value: (field) => frontMatter.values.get(field),
    invalid: (field) => lineFault(path, frontMatter.lines.get(field) ?? 1),
    missing: (field) => missingFault(path, field),
  }
}

function recordLocated(
  record: Record<string, unknown>,
  where: string,
  invalid: Located['invalid'],
): Located {
  return {
    where,
    value: (field) => (Object.hasOwn(record, field) ? record[field] : undefined),
    invalid,
    missing: (field) => missingFault(where, field),
  }
}

function itemOf(located: Located, fields: FieldMap): WorkitemsItem {
  const id = requiredText(located, fields.id)
  const rawStatus = requiredText(located, fields.status)
  const item: WorkitemsItem = {
    key: `${SOURCE}:${id}`,
    id,
    title: requiredText(located, fields.title),
    status: normalStatusOf(rawStatus),
    rawStatus,
    priority: optionalPriority(located, fields.priority),
    type: optionalText(located, fields.type),
    assignee: optionalText(located, fields.assignee),
    updatedAt: optionalText(located, fields.updatedAt),
    source: SOURCE,
  }
  const optional: readonly [MappedField, 'url' | 'parent'][] = [
    ['url', 'url'],
    ['parent', 'parent'],
  ]
  for (const [field, key] of optional) {
    const value = optionalText(located, fields[field])
    if (value !== null) item[key] = value
  }
  const labels = optionalLabels(located, fields.labels)
  if (labels) item.labels = labels
  return checkedItem(item, located.where)
}

function jsonLocatedItems(path: string, text: string): Located[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new ItemFault(`${path} is not valid JSON, so it could not be read.`)
  }
  const records = Array.isArray(parsed) ? parsed : [parsed]
  return records.map((record, index) => {
    const where = `${path} item ${numeral(index + 1)}`
    if (!isRecord(record))
      throw new ItemFault(`${where} is not an object, so it could not be read.`)
    return recordLocated(
      record,
      where,
      (field) => `${where} has an invalid ${field}, so it could not be read.`,
    )
  })
}

function jsonlLocatedItems(path: string, text: string): Located[] {
  const located: Located[] = []
  for (const [index, raw] of text.split('\n').entries()) {
    if (raw.trim() === '') continue
    let record: unknown
    try {
      record = JSON.parse(raw) as unknown
    } catch {
      throw new ItemFault(lineFault(path, index + 1))
    }
    if (!isRecord(record)) throw new ItemFault(lineFault(path, index + 1))
    const where = `${path} line ${numeral(index + 1)}`
    located.push(recordLocated(record, where, () => lineFault(path, index + 1)))
  }
  return located
}

export type FoundItem = { item: WorkitemsItem; path: string }

export type ItemFiles = { found: FoundItem[]; skipped: WorkitemsFailedReason[] }

export async function readItemFiles(
  files: TrackerFiles,
  paths: readonly string[],
  itemOfFile: (path: string, text: string) => WorkitemsItem,
): Promise<ItemFiles> {
  const result: ItemFiles = { found: [], skipped: [] }
  for (const path of paths) {
    try {
      result.found.push({ item: itemOfFile(path, await files.read(path)), path })
    } catch (error) {
      if (!(error instanceof ItemFault || error instanceof FileProblem)) throw error
      result.skipped.push(error.reason)
    }
  }
  return result
}

export function skippedCaveat(skipped: readonly WorkitemsFailedReason[]): string | null {
  const [first] = skipped
  if (first === undefined) return null
  if (skipped.length === 1) return `1 item file skipped: ${first}`
  return `${numeral(skipped.length)} item files skipped, the first: ${first}`
}

async function readFrontMatterFiles(
  files: TrackerFiles,
  config: FilesConfig,
  paths: readonly string[],
): Promise<ItemFiles> {
  return readItemFiles(files, paths, (path, text) =>
    itemOf(frontMatterLocated(path, parseFrontMatter(path, text)), config.fields),
  )
}

async function readRecordFiles(
  files: TrackerFiles,
  config: FilesConfig,
  paths: readonly string[],
): Promise<ItemFiles> {
  const found: FoundItem[] = []
  for (const path of paths) {
    const text = await files.read(path)
    const located =
      config.format === 'json' ? jsonLocatedItems(path, text) : jsonlLocatedItems(path, text)
    for (const record of located) found.push({ item: itemOf(record, config.fields), path })
  }
  return { found, skipped: [] }
}

export function uniqueByKey(items: readonly FoundItem[]): WorkitemsItem[] {
  const seen = new Set<string>()
  for (const { item, path } of items) {
    if (seen.has(item.key)) {
      throw new ItemFault(`${path} repeats the id ${item.id}, so it could not be read.`)
    }
    seen.add(item.key)
  }
  return items.map(({ item }) => item)
}

async function filesConfigOf(files: TrackerFiles): Promise<FilesConfig> {
  const outcome = await readConfig(files)
  if (!outcome.ok) throw new ItemFault(outcome.reason)
  if (outcome.config.files === null) {
    throw new ItemFault(`${CONFIG_FILE} names no globs, so it could not be read.`)
  }
  return outcome.config.files
}

async function readFiles(files: TrackerFiles): Promise<ReadOutcome> {
  try {
    const config = await filesConfigOf(files)
    const paths = (await matchGlobs(files, config.globs)).map((match) => match.path)
    const { found, skipped } =
      config.format === 'frontmatter'
        ? await readFrontMatterFiles(files, config, paths)
        : await readRecordFiles(files, config, paths)
    return {
      ok: true,
      items: uniqueByKey(found),
      sourceLabel: SOURCE,
      caveat: skippedCaveat(skipped),
    }
  } catch (error) {
    if (error instanceof ItemFault) return { ok: false, reason: error.reason }
    throw error
  }
}

async function isConfigured(files: TrackerFiles): Promise<boolean> {
  const outcome = await readConfig(files)
  return outcome.ok && outcome.config.files !== null
}

async function filesSignature(files: TrackerFiles): Promise<string> {
  const config = await filesConfigOf(files)
  return [JSON.stringify(config), signatureOfMatches(await matchGlobs(files, config.globs))].join(
    '\n',
  )
}

export const filesReader: Reader = {
  name: SOURCE,
  marker: CONFIG_FILE,
  lookedForAs: CONFIG_FILE,
  isPresent: isConfigured,
  signature: filesSignature,
  read: readFiles,
}
