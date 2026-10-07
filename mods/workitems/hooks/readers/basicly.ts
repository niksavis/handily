import type { WorkitemsItem } from '../../types'
import { numeral } from '../states'
import { runJson, stampOf } from './adapter'
import {
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
const KIT_CLI = '.basicly/core/kit/tracker/cli.py'
const PATH_PROGRAM = 'basicly'
const KIT_COMMAND = ['python3', KIT_CLI] as const
const OPEN_STATUSES = ['open', 'in_progress', 'blocked'] as const

type OpenStatus = (typeof OPEN_STATUSES)[number]

type Lister = { label: string; argv: (status: OpenStatus) => string[] }

const PATH_LISTER: Lister = {
  label: 'basicly tracker list',
  argv: (status) => [PATH_PROGRAM, 'tracker', 'list', '--status', status],
}

const KIT_LISTER: Lister = {
  label: `${KIT_COMMAND.join(' ')} list`,
  argv: (status) => [...KIT_COMMAND, 'list', '--status', status, LEDGER],
}

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
    value: (field) => valueAt(record, field),
    invalid: (field) => `${where} has an invalid ${field}, so it could not be read.`,
    missing: (field) => `${where} has no ${field}, so it could not be read.`,
  }
}

function itemOf(record: Record<string, unknown>, where: string): WorkitemsItem {
  const located = recordLocated(record, where)
  const id = requiredText(located, 'record')
  const rawStatus = requiredText(located, 'status')
  return {
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

async function listOpenItems(files: TrackerFiles, lister: Lister): Promise<WorkitemsItem[]> {
  const byKey = new Map<string, WorkitemsItem>()
  for (const status of OPEN_STATUSES) {
    const parsed = await runJson(files, lister.label, lister.argv(status))
    for (const item of itemsOf(lister.label, parsed)) byKey.set(item.key, item)
  }
  return [...byKey.values()]
}

async function listerFor(files: TrackerFiles): Promise<Lister | ReadOutcome> {
  if ((await files.commands.which(PATH_PROGRAM)) !== undefined) return PATH_LISTER
  if (!(await files.exists(KIT_CLI))) {
    return {
      ok: false,
      reason: `basicly is not on PATH and ${KIT_CLI} is missing, so the tracker could not be read.`,
    }
  }
  const verdict = await files.commands.approvals.check(files, {
    command: KIT_COMMAND,
    shown: KIT_LISTER.argv('open'),
  })
  if (verdict === 'approved') return KIT_LISTER
  return {
    ok: false,
    state: 'approval-needed',
    command: KIT_COMMAND.join(' '),
    sourceLabel: SOURCE,
  }
}

async function readBasicly(files: TrackerFiles): Promise<ReadOutcome> {
  if (!(await files.commands.canRun())) {
    return { ok: false, state: 'terminal-only', sourceLabel: SOURCE }
  }
  const lister = await listerFor(files)
  if ('ok' in lister) return lister
  try {
    const items = await listOpenItems(files, lister)
    return { ok: true, items, sourceLabel: SOURCE, caveat: null }
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
    await stampOf(files, KIT_CLI),
    String(files.commands.approvals.generation()),
  ].join('\n')
}

export const basiclyReader: Reader = {
  name: SOURCE,
  marker: TEMPLATE,
  signature: basiclySignature,
  read: readBasicly,
}
