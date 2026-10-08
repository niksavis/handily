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
const KIT_CLI = `${KIT_FOLDER}/cli.py`
const KIT_CODE: readonly CoveredFolder[] = [{ path: KIT_FOLDER, suffix: '', recursive: true }]
const PATH_PROGRAM = 'basicly'
const OPEN_STATUSES = ['open', 'in_progress', 'blocked'] as const

type OpenStatus = (typeof OPEN_STATUSES)[number]

type ListRun = { argv: string[]; env?: Readonly<Record<string, string>> }

type Lister = {
  label: string
  command: readonly string[]
  tail: (status: OpenStatus) => string[]
  run: (argv0: string, status: OpenStatus, cacheFolder: string) => ListRun
}

const PATH_LISTER: Lister = {
  label: 'basicly tracker list',
  command: [PATH_PROGRAM, 'tracker', 'list'],
  tail: (status) => ['--status', status],
  run: (argv0, status, cacheFolder) => ({
    argv: [argv0, 'tracker', 'list', '--status', status],
    env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: cacheFolder },
  }),
}

const KIT_LISTER: Lister = {
  label: `python3 ${KIT_CLI} list`,
  command: ['python3', '-I', '-B', KIT_CLI],
  tail: (status) => ['list', '--status', status, LEDGER],
  run: (argv0, status, cacheFolder) => ({
    argv: [
      argv0,
      '-I',
      '-B',
      '-X',
      `pycache_prefix=${cacheFolder}`,
      KIT_CLI,
      'list',
      '--status',
      status,
      LEDGER,
    ],
  }),
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

function freshCacheFolder(root: string): string {
  return `${root.replace(/[\\/]+$/, '')}/.handily-pycache-${crypto.randomUUID()}`
}

function approvalNeeded(lister: Lister): ReadOutcome {
  return {
    ok: false,
    state: 'approval-needed',
    command: quotedCommand(lister.command),
    sourceLabel: SOURCE,
  }
}

async function approvedProgram(files: TrackerFiles, lister: Lister): Promise<string | undefined> {
  const verdict = await files.commands.approvals.check(files, {
    command: lister.command,
    shown: [...lister.command, ...lister.tail('open')],
    folders: KIT_CODE,
  })
  return verdict.approved ? verdict.argv0 : undefined
}

async function listOpenItems(files: TrackerFiles, lister: Lister): Promise<ReadOutcome> {
  const byKey = new Map<string, WorkitemsItem>()
  const cacheFolder = freshCacheFolder(files.root)
  for (const status of OPEN_STATUSES) {
    const argv0 = await approvedProgram(files, lister)
    if (argv0 === undefined) return approvalNeeded(lister)
    const { argv, env } = lister.run(argv0, status, cacheFolder)
    const parsed = await runJson(files, lister.label, argv, env)
    for (const item of itemsOf(lister.label, parsed)) byKey.set(item.key, item)
  }
  return { ok: true, items: [...byKey.values()], sourceLabel: SOURCE, caveat: null }
}

async function availableLister(files: TrackerFiles): Promise<Lister | ReadOutcome> {
  if ((await files.commands.which(PATH_PROGRAM)) !== undefined) return PATH_LISTER
  if (await files.exists(KIT_CLI)) return KIT_LISTER
  return {
    ok: false,
    reason: `basicly is not on PATH and ${KIT_CLI} is missing, so the tracker could not be read.`,
  }
}

async function readBasicly(files: TrackerFiles): Promise<ReadOutcome> {
  if (!(await files.commands.canRun())) {
    return { ok: false, state: 'terminal-only', sourceLabel: SOURCE }
  }
  const lister = await availableLister(files)
  if ('ok' in lister) return lister
  try {
    return await listOpenItems(files, lister)
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
