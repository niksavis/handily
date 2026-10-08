import type { WorkitemsItem, WorkitemsStatus } from '../../types'
import { numeral } from '../states'
import { itemTextProblem } from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const ISSUES_FILE = '.beads/issues.jsonl'
const METADATA_FILE = '.beads/metadata.json'
const SOURCE = 'beads'
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

function parseLine(text: string): Line {
  const parsed = parseJson(text)
  if (!isRecord(parsed)) throw new MalformedLine('json')
  return parsed
}

export function parseIssues(text: string): ReadOutcome {
  const items: WorkitemsItem[] = []
  const lines = text.split('\n')
  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    try {
      const line = parseLine(trimmed)
      if (isSkipped(line)) continue
      const item = itemOf(line)
      const problem = itemTextProblem(item)
      if (problem !== null) {
        return {
          ok: false,
          reason: `${ISSUES_FILE} line ${numeral(index + 1)} has ${problem}, so it could not be read.`,
        }
      }
      items.push(item)
    } catch (error) {
      if (!(error instanceof MalformedLine)) throw error
      return { ok: false, reason: `${ISSUES_FILE} line ${numeral(index + 1)} is malformed.` }
    }
  }
  return { ok: true, items, sourceLabel: SOURCE, caveat: null }
}

async function readBeads(files: TrackerFiles): Promise<ReadOutcome> {
  const outcome = parseIssues(await files.read(ISSUES_FILE))
  if (!outcome.ok || !(await files.exists(METADATA_FILE))) return outcome
  const metadata = parseJson(await files.read(METADATA_FILE))
  if (!isRecord(metadata)) return { ok: false, reason: `${METADATA_FILE} could not be read.` }
  if (metadata.backend !== 'dolt') return outcome
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

export const beadsReader: Reader = { name: SOURCE, marker: ISSUES_FILE, read: readBeads }
