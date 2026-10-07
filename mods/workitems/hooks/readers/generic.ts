import type { WorkitemsFailedReason, WorkitemsItem, WorkitemsStatus } from '../../types'
import {
  CONFIG_FILE,
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
const NESTED = Symbol('nested')
const FRONT_MATTER_FENCE = '---'
const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(.*)$/
const LIST_ITEM_LINE = /^\s+-\s*(.*)$/

export class ItemFault extends Error {
  constructor(readonly reason: WorkitemsFailedReason) {
    super(reason)
  }
}

export type Located = {
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

function optionalPriority(located: Located, field: string | undefined): number | null {
  if (field === undefined) return null
  const value = located.value(field)
  if (isAbsent(value)) return null
  const priority = typeof value === 'string' ? Number(value) : value
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0) {
    throw new ItemFault(located.invalid(field))
  }
  return priority
}

export function normalStatusOf(rawStatus: string): WorkitemsStatus {
  return NORMAL_STATUSES.find((status) => status === rawStatus) ?? 'other'
}

function scalarOf(raw: string, path: string, line: number): string | null {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null') return null
  if (text.startsWith('"')) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (typeof parsed === 'string') return parsed
    } catch {
      throw new ItemFault(lineFault(path, line))
    }
    throw new ItemFault(lineFault(path, line))
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new ItemFault(lineFault(path, line))
    return text.slice(1, -1).replaceAll("''", "'")
  }
  return text.replace(/\s+#.*$/, '')
}

function flowListOf(raw: string, path: string, line: number): string[] {
  const inner = raw.trim().slice(1, -1).trim()
  if (inner === '') return []
  return inner.split(',').map((part) => scalarOf(part, path, line) ?? '')
}

type FrontMatter = { values: Map<string, unknown>; lines: Map<string, number> }

function frontMatterLines(path: string, text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) throw new ItemFault(lineFault(path, 1))
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE)
  if (end < 0) throw new ItemFault(lineFault(path, 1))
  return lines.slice(1, end)
}

export function parseFrontMatter(path: string, text: string): FrontMatter {
  const values = new Map<string, unknown>()
  const lines = new Map<string, number>()
  let openKey: string | undefined
  for (const [index, raw] of frontMatterLines(path, text).entries()) {
    const lineNumber = index + 2
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue
    const listItem = LIST_ITEM_LINE.exec(raw)
    if (/^\s/.test(raw)) {
      if (openKey === undefined) throw new ItemFault(lineFault(path, lineNumber))
      const current = values.get(openKey)
      if (listItem && Array.isArray(current))
        current.push(scalarOf(listItem[1] ?? '', path, lineNumber) ?? '')
      else values.set(openKey, NESTED)
      continue
    }
    const keyLine = KEY_LINE.exec(raw)
    if (!keyLine) throw new ItemFault(lineFault(path, lineNumber))
    const key = keyLine[1] ?? ''
    const rest = (keyLine[2] ?? '').trim()
    lines.set(key, lineNumber)
    openKey = undefined
    if (rest === '' || rest.startsWith('#')) {
      values.set(key, [])
      openKey = key
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      values.set(key, flowListOf(rest, path, lineNumber))
    } else {
      values.set(key, scalarOf(rest, path, lineNumber))
    }
  }
  return { values, lines }
}

export function frontMatterLocated(path: string, frontMatter: FrontMatter): Located {
  return {
    value: (field) => {
      const value = frontMatter.values.get(field)
      const isEmptyBlock = Array.isArray(value) && value.length === 0
      return isEmptyBlock ? undefined : value
    },
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
    value: (field) => record[field],
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
  return item
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

function locatedItems(config: FilesConfig, path: string, text: string): Located[] {
  if (config.format === 'json') return jsonLocatedItems(path, text)
  if (config.format === 'jsonl') return jsonlLocatedItems(path, text)
  return [frontMatterLocated(path, parseFrontMatter(path, text))]
}

export function uniqueByKey(
  items: readonly { item: WorkitemsItem; path: string }[],
): WorkitemsItem[] {
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
    const found: { item: WorkitemsItem; path: string }[] = []
    for (const match of await matchGlobs(files, config.globs)) {
      const text = await files.read(match.path)
      for (const located of locatedItems(config, match.path, text)) {
        found.push({ item: itemOf(located, config.fields), path: match.path })
      }
    }
    return { ok: true, items: uniqueByKey(found), sourceLabel: SOURCE, caveat: null }
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
