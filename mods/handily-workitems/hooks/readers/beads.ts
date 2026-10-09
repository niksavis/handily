import type { WorkitemsFailedReason, WorkitemsItem, WorkitemsStatus } from '../../types'
import { quotedCommand } from '../approval'
import { FileProblem, FileTooLarge } from '../config'
import { MAX_FILE_BYTES } from '../snapshot'
import { numeral } from '../states'
import { CommandFault, runJson } from './adapter'
import { checkedItem, ItemFault } from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const ISSUES_FILE = '.beads/issues.jsonl'
const METADATA_FILE = '.beads/metadata.json'
const SOURCE = 'beads'
const BR_SOURCE_LABEL = 'beads (br)'
const BR = 'br'
const LIST_COMMAND = [BR, 'list', '--json', '--limit', '0'] as const
const LIST_LABEL = 'br list'
const BR_NOTE =
  '(checked on br 0.3.2: br list writes the .beads cache beads.db and beads.base.jsonl, imports an edited issues.jsonl into beads.db and does not rewrite issues.jsonl. It started no git, sh, bash, python3, node, env, editor or vi from PATH. A program that it starts by an absolute path was not ruled out. Asked again if the command or the real path of br changes. A new br at the same path is not asked again)'
const SEE_WHY =
  'Run "br list --json --limit 0" at the repo root to see why the list could not be read.'
const TOO_MANY_OPEN = 'Close some open items, because their list is over 4 MiB.'
const BR_MISSING = `br is not on PATH. Install br to list the open items of ${ISSUES_FILE}, which is over 4 MiB.`
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

function listedIssues(parsed: unknown): WorkitemsItem[] {
  const issues = isRecord(parsed) ? parsed.issues : undefined
  if (!isRecord(parsed) || !Array.isArray(issues)) {
    throw new ItemFault(`${LIST_LABEL} printed no issues list, so it could not be read.`)
  }
  if (parsed.has_more !== false || typeof parsed.total !== 'number') {
    throw new ItemFault(
      `${LIST_LABEL} did not say that it printed every item, so it could not be read.`,
    )
  }
  if (parsed.total !== issues.length) {
    throw new ItemFault(
      `${LIST_LABEL} printed ${numeral(issues.length)} of ${numeral(parsed.total)} items, so it could not be read.`,
    )
  }
  const items: WorkitemsItem[] = []
  for (const [index, issue] of issues.entries()) {
    const where = `${LIST_LABEL} item ${numeral(index + 1)}`
    if (!isRecord(issue)) throw new ItemFault(`${where} is not an object, so it could not be read.`)
    const item = issueAt(
      issue,
      where,
      (field) => `${where} has an invalid ${field}, so it could not be read.`,
    )
    if (item) items.push(item)
  }
  return items
}

function approvalNeeded(): ReadOutcome {
  return {
    ok: false,
    state: 'approval-needed',
    command: quotedCommand(LIST_COMMAND),
    sourceLabel: BR_SOURCE_LABEL,
  }
}

async function approvedBr(files: TrackerFiles): Promise<string | undefined> {
  const verdict = await files.commands.approvals.check(files, {
    command: LIST_COMMAND,
    shown: LIST_COMMAND,
    folders: [],
    note: BR_NOTE,
    ignoresFolders: () => Promise.resolve(false),
  })
  return verdict.approved ? verdict.argv0 : undefined
}

function reasonWithFix(fault: ItemFault): WorkitemsFailedReason {
  if (fault instanceof CommandFault && fault.kind === 'exit') return fault.reason
  if (fault instanceof CommandFault && fault.kind === 'cut') {
    return `${fault.reason} ${TOO_MANY_OPEN}`
  }
  return `${fault.reason} ${SEE_WHY}`
}

async function listOpenThroughBr(files: TrackerFiles): Promise<ReadOutcome> {
  if (!(await files.commands.canRun())) {
    return { ok: false, state: 'terminal-only', sourceLabel: BR_SOURCE_LABEL }
  }
  if ((await files.commands.which(BR)) === undefined) return { ok: false, reason: BR_MISSING }
  const argv0 = await approvedBr(files)
  if (argv0 === undefined) return approvalNeeded()
  try {
    const parsed = await runJson(files, LIST_LABEL, [argv0, ...LIST_COMMAND.slice(1)])
    return {
      ok: true,
      items: listedIssues(parsed),
      sourceLabel: BR_SOURCE_LABEL,
      caveat: null,
      listsOpenOnly: true,
      omitsParent: true,
    }
  } catch (error) {
    if (error instanceof ItemFault) return { ok: false, reason: reasonWithFix(error) }
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
  return listOpenThroughBr(files)
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
  const stamp = [String(mtimeMs), String(size)]
  if (size <= MAX_FILE_BYTES) return stamp.join('\n')
  const br = (await files.commands.which(BR)) ?? 'br not on PATH'
  return [...stamp, br, String(files.commands.approvals.generation())].join('\n')
}

export const beadsReader: Reader = {
  name: SOURCE,
  marker: ISSUES_FILE,
  signature: beadsSignature,
  read: readBeads,
}
