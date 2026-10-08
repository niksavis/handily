import type { WorkitemsItem } from '../../types'
import { numeral } from '../states'
import { coverStamp, quotedCommand, type CoveredFolder } from '../approval'
import { runJson } from './adapter'
import {
  checkedItem,
  ItemFault,
  normalStatusOf,
  optionalPriority,
  optionalText,
  requiredText,
  type Located,
} from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const SOURCE = 'basicly'
const LEDGER = '.basicly/ledger'
const TEMPLATE = `${LEDGER}/template.json`
const KIT_FOLDER = '.basicly/core/kit/tracker'
const KIT_CODE: readonly CoveredFolder[] = [{ path: KIT_FOLDER, suffix: '', recursive: true }]
const PROGRAM = 'basicly'
const LABEL = 'basicly tracker list'
const COMMAND = [PROGRAM, 'tracker', 'list'] as const
const OPEN_STATUSES = ['open', 'in_progress', 'blocked'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valueAt(record: Record<string, unknown>, path: string): unknown {
  let value: unknown = record
  for (const part of path.split('.')) {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}

function recordLocated(record: Record<string, unknown>, where: string): Located {
  return {
    where,
    value: (field) => valueAt(record, field),
    invalid: (field) => `${where} has an invalid ${field}, so it could not be read.`,
    missing: (field) => `${where} has no ${field}, so it could not be read.`,
  }
}

function itemOf(record: Record<string, unknown>, where: string): WorkitemsItem {
  const located = recordLocated(record, where)
  const id = requiredText(located, 'record')
  const rawStatus = requiredText(located, 'status')
  const item: WorkitemsItem = {
    key: `${SOURCE}:${id}`,
    id,
    title: requiredText(located, 'fields.title'),
    status: normalStatusOf(rawStatus),
    rawStatus,
    priority: optionalPriority(located, 'fields.priority'),
    type: optionalText(located, 'fields.issue_type'),
    assignee: optionalText(located, 'fields.assignee'),
    updatedAt: optionalText(located, 'dates.updated'),
    source: SOURCE,
  }
  return checkedItem(item, where)
}

function itemsOf(label: string, parsed: unknown): WorkitemsItem[] {
  const records = isRecord(parsed) ? parsed.records : undefined
  if (!Array.isArray(records)) {
    throw new ItemFault(`${label} printed no records list, so it could not be read.`)
  }
  const items: WorkitemsItem[] = []
  for (const [index, record] of records.entries()) {
    const where = `${label} record ${numeral(index + 1)}`
    if (!isRecord(record))
      throw new ItemFault(`${where} is not an object, so it could not be read.`)
    if (record.tombstoned === true) continue
    items.push(itemOf(record, where))
  }
  return items
}

function freshCacheFolder(root: string): string {
  return `${root.replace(/[\\/]+$/, '')}/.handily-pycache-${crypto.randomUUID()}`
}

function approvalNeeded(): ReadOutcome {
  return {
    ok: false,
    state: 'approval-needed',
    command: quotedCommand(COMMAND),
    sourceLabel: SOURCE,
  }
}

async function approvedProgram(files: TrackerFiles): Promise<string | undefined> {
  const verdict = await files.commands.approvals.check(files, {
    command: COMMAND,
    shown: [...COMMAND, '--status', 'open'],
    folders: KIT_CODE,
  })
  return verdict.approved ? verdict.argv0 : undefined
}

async function listOpenItems(files: TrackerFiles): Promise<ReadOutcome> {
  const byKey = new Map<string, WorkitemsItem>()
  const env = {
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPYCACHEPREFIX: freshCacheFolder(files.root),
  }
  for (const status of OPEN_STATUSES) {
    const argv0 = await approvedProgram(files)
    if (argv0 === undefined) return approvalNeeded()
    const argv = [argv0, ...COMMAND.slice(1), '--status', status]
    for (const item of itemsOf(LABEL, await runJson(files, LABEL, argv, env))) {
      byKey.set(item.key, item)
    }
  }
  return { ok: true, items: [...byKey.values()], sourceLabel: SOURCE, caveat: null }
}

async function readBasicly(files: TrackerFiles): Promise<ReadOutcome> {
  if (!(await files.commands.canRun())) {
    return { ok: false, state: 'terminal-only', sourceLabel: SOURCE }
  }
  if ((await files.commands.which(PROGRAM)) === undefined) {
    return { ok: false, reason: 'basicly is not on PATH. Install it to read this tracker.' }
  }
  try {
    return await listOpenItems(files)
  } catch (error) {
    if (error instanceof ItemFault) return { ok: false, reason: error.reason }
    throw error
  }
}

async function basiclySignature(files: TrackerFiles): Promise<string> {
  const ledger = (await files.list(LEDGER))
    .map((entry) => `${entry.name} ${String(entry.size)} ${String(entry.mtimeMs)}`)
    .sort()
  return [
    ...ledger,
    await coverStamp(files, KIT_CODE),
    String(files.commands.approvals.generation()),
  ].join('\n')
}

export const basiclyReader: Reader = {
  name: SOURCE,
  marker: TEMPLATE,
  listsOpenOnly: true,
  signature: basiclySignature,
  read: readBasicly,
}
