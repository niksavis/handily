import type { WorkitemsFailedReason, WorkitemsItem, WorkitemsStatus } from '../../types'
import { FileProblem, FileTooLarge } from '../config'
import { numeral } from '../states'
import { checkedItem, ItemFault } from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const ISSUES_FILE = '.beads/issues.jsonl'
const METADATA_FILE = '.beads/metadata.json'
const SOURCE = 'beads'
const DOLT_TOO_LARGE = `br cannot list a bd tracker on Dolt. Make ${ISSUES_FILE} 4 MiB or less to read it, because the engine reads no file that is over 4 MiB.`
const KNOWN_STATUSES: readonly WorkitemsStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'deferred',
  'closed',
]
const TOMBSTONE = 'tombstone'
const POSSIBLY_STALE = 'possibly stale'

type Line = Record<string, unknown>

class MalformedLine extends Error {}

function isRecord(value: unknown): value is Line {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(line: Line, field: string): string {
  const value = line[field]
  if (typeof value !== 'string' || value === '') throw new MalformedLine(field)
  return value
}

function optionalText(line: Line, field: string): string | null {
  const value = line[field]
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new MalformedLine(field)
  return value
}

function priorityOf(line: Line): number | null {
  const value = line.priority
  if (value === undefined || value === null) return null
  const isBeadsPriority = Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4
  if (!isBeadsPriority) throw new MalformedLine('priority')
  return Number(value)
}

function labelsOf(line: Line): string[] | undefined {
  const value = line.labels
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) {
    throw new MalformedLine('labels')
  }
  return value
}

function parentOf(line: Line): string | undefined {
  const dependencies = line.dependencies
  if (!Array.isArray(dependencies)) return undefined
  for (const dependency of dependencies) {
    if (isRecord(dependency) && dependency.type === 'parent-child') {
      const parent = dependency.depends_on_id
      if (typeof parent === 'string' && parent !== '') return parent
    }
  }
  return undefined
}

function statusOf(rawStatus: string): WorkitemsStatus {
  return KNOWN_STATUSES.find((status) => status === rawStatus) ?? 'other'
}

function itemOf(line: Line): WorkitemsItem {
  const id = requiredText(line, 'id')
  const rawStatus = requiredText(line, 'status')
  const item: WorkitemsItem = {
    key: `${SOURCE}:${id}`,
    id,
    title: requiredText(line, 'title'),
    status: statusOf(rawStatus),
    rawStatus,
    priority: priorityOf(line),
    type: optionalText(line, 'issue_type'),
    assignee: optionalText(line, 'assignee'),
    updatedAt: optionalText(line, 'updated_at'),
    source: SOURCE,
  }
  const labels = labelsOf(line)
  if (labels) item.labels = labels
  const parent = parentOf(line)
  if (parent) item.parent = parent
  return item
}

function isSkipped(line: Line): boolean {
  const isOtherRecordType = '_type' in line && line._type !== 'issue'
  return isOtherRecordType || line.status === TOMBSTONE
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

type MalformedFault = (field: string) => WorkitemsFailedReason

function issueAt(
  value: unknown,
  where: string,
  malformed: MalformedFault,
): WorkitemsItem | undefined {
  try {
    if (!isRecord(value)) throw new MalformedLine('json')
    if (isSkipped(value)) return undefined
    return checkedItem(itemOf(value), where)
  } catch (error) {
    if (error instanceof MalformedLine) throw new ItemFault(malformed(error.message))
    throw error
  }
}

export function parseIssues(text: string): ReadOutcome {
  const items: WorkitemsItem[] = []
  const lines = text.split('\n')
  try {
    for (const [index, raw] of lines.entries()) {
      const trimmed = raw.trim()
      if (trimmed === '') continue
      const where = `${ISSUES_FILE} line ${numeral(index + 1)}` as const
      const item = issueAt(parseJson(trimmed), where, () => `${where} is malformed.`)
      if (item) items.push(item)
    }
  } catch (error) {
    if (error instanceof ItemFault) return { ok: false, reason: error.reason }
    throw error
  }
  return { ok: true, items, sourceLabel: SOURCE, caveat: null }
}

const STATUS_KEY = '"status":'
const SKIPPED_STATUSES = ['"status":"closed"', `"status":"${TOMBSTONE}"`]

export function isClosedLineText(raw: string): boolean {
  const first = raw.indexOf(STATUS_KEY)
  if (first === -1 || raw.indexOf(STATUS_KEY, first + 1) !== -1) return false
  return SKIPPED_STATUSES.some((status) => raw.startsWith(status, first))
}

export type OpenIssues = { push: (text: string) => void; end: () => WorkitemsItem[] }

export function openIssues(): OpenIssues {
  const items: WorkitemsItem[] = []
  let pending = ''
  let lineNumber = 0
  function take(raw: string): void {
    lineNumber += 1
    if (isClosedLineText(raw)) return
    const trimmed = raw.trim()
    if (trimmed === '') return
    const where = `${ISSUES_FILE} line ${numeral(lineNumber)}` as const
    const item = issueAt(parseJson(trimmed), where, () => `${where} is malformed.`)
    if (item && item.status !== 'closed') items.push(item)
  }
  return {
    push: (text) => {
      const lines = (pending + text).split('\n')
      pending = lines.pop() ?? ''
      for (const raw of lines) take(raw)
    },
    end: () => {
      take(pending)
      pending = ''
      return items
    },
  }
}

async function streamOpenIssues(files: TrackerFiles): Promise<ReadOutcome> {
  if (!(await files.commands.canRun())) {
    return { ok: false, state: 'terminal-only', sourceLabel: SOURCE }
  }
  const parsed = openIssues()
  try {
    for await (const text of files.stream(ISSUES_FILE)) parsed.push(text)
    return {
      ok: true,
      items: parsed.end(),
      sourceLabel: SOURCE,
      caveat: null,
      listsOpenOnly: true,
    }
  } catch (error) {
    if (error instanceof ItemFault) return { ok: false, reason: error.reason }
    throw error
  }
}

async function isOnDolt(files: TrackerFiles): Promise<boolean> {
  if (!(await files.exists(METADATA_FILE))) return false
  const metadata = parseJson(await files.read(METADATA_FILE))
  if (!isRecord(metadata)) throw new FileProblem(`${METADATA_FILE} could not be read.`)
  return metadata.backend === 'dolt'
}

async function readLargeBeads(files: TrackerFiles): Promise<ReadOutcome> {
  if (await isOnDolt(files)) return { ok: false, reason: DOLT_TOO_LARGE }
  return streamOpenIssues(files)
}

async function readBeads(files: TrackerFiles): Promise<ReadOutcome> {
  let text: string
  try {
    text = await files.read(ISSUES_FILE)
  } catch (error) {
    if (error instanceof FileTooLarge) return readLargeBeads(files)
    throw error
  }
  const outcome = parseIssues(text)
  if (!outcome.ok || !(await isOnDolt(files))) return outcome
  return {
    ok: true,
    items: outcome.items.map((item) => ({
      ...item,
      labels: [...(item.labels ?? []), POSSIBLY_STALE],
    })),
    sourceLabel: 'beads (bd)',
    caveat: 'bd keeps data in Dolt',
  }
}

async function beadsSignature(files: TrackerFiles): Promise<string> {
  const { size, mtimeMs } = await files.stat(ISSUES_FILE)
  return [String(mtimeMs), String(size)].join('\n')
}

export const beadsReader: Reader = {
  name: SOURCE,
  marker: ISSUES_FILE,
  signature: beadsSignature,
  read: readBeads,
}
