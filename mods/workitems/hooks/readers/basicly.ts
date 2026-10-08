import type { WorkitemsItem } from '../../types'
import { numeral } from '../states'
import { coverStamp, type CoveredFolder } from '../approval'
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
const KIT_CLI = `${KIT_FOLDER}/cli.py`
const KIT_CODE: readonly CoveredFolder[] = [{ path: KIT_FOLDER, suffix: '.py' }]
const PATH_PROGRAM = 'basicly'
const OPEN_STATUSES = ['open', 'in_progress', 'blocked'] as const

type OpenStatus = (typeof OPEN_STATUSES)[number]

type Lister = {
  label: string
  command: readonly string[]
  argv: (status: OpenStatus) => string[]
}

const PATH_LISTER: Lister = {
  label: 'basicly tracker list',
  command: [PATH_PROGRAM, 'tracker', 'list'],
  argv: (status) => [PATH_PROGRAM, 'tracker', 'list', '--status', status],
}

const KIT_LISTER: Lister = {
  label: `python3 ${KIT_CLI} list`,
  command: ['python3', KIT_CLI],
  argv: (status) => ['python3', KIT_CLI, 'list', '--status', status, LEDGER],
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

function pythonWithoutRepoBytecode(root: string): Readonly<Record<string, string>> {
  return {
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPYCACHEPREFIX: `${root.replace(/[\\/]+$/, '')}/.handily-pycache-${crypto.randomUUID()}`,
  }
}

async function listOpenItems(files: TrackerFiles, lister: Lister): Promise<WorkitemsItem[]> {
  const byKey = new Map<string, WorkitemsItem>()
  const env = pythonWithoutRepoBytecode(files.root)
  for (const status of OPEN_STATUSES) {
    const parsed = await runJson(files, lister.label, lister.argv(status), env)
    for (const item of itemsOf(lister.label, parsed)) byKey.set(item.key, item)
  }
  return [...byKey.values()]
}

async function availableLister(files: TrackerFiles): Promise<Lister | ReadOutcome> {
  if ((await files.commands.which(PATH_PROGRAM)) !== undefined) return PATH_LISTER
  if (await files.exists(KIT_CLI)) return KIT_LISTER
  return {
    ok: false,
    reason: `basicly is not on PATH and ${KIT_CLI} is missing, so the tracker could not be read.`,
  }
}

async function approvedLister(files: TrackerFiles): Promise<Lister | ReadOutcome> {
  const lister = await availableLister(files)
  if ('ok' in lister) return lister
  const verdict = await files.commands.approvals.check(files, {
    command: lister.command,
    shown: lister.argv('open'),
    folders: KIT_CODE,
  })
  if (verdict === 'approved') return lister
  return {
    ok: false,
    state: 'approval-needed',
    command: lister.command.join(' '),
    sourceLabel: SOURCE,
  }
}

async function readBasicly(files: TrackerFiles): Promise<ReadOutcome> {
  if (!(await files.commands.canRun())) {
    return { ok: false, state: 'terminal-only', sourceLabel: SOURCE }
  }
  const lister = await approvedLister(files)
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
    await coverStamp(files, { command: KIT_LISTER.command, folders: KIT_CODE }),
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
