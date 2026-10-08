import type { WorkitemsItem, WorkitemsStatus } from '../../types'
import { coverStamp } from '../approval'
import { CONFIG_FILE, matchGlobs, readConfig, signatureOfMatches } from '../config'
import { numeral } from '../states'
import {
  checkedItem,
  ItemFault,
  normalStatusOf,
  optionalLabels,
  optionalPriority,
  optionalText,
  requiredText,
  uniqueByKey,
  type Located,
} from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const SOURCE = 'adapter'
const CONTRACT = 1
const MAPPED_STATUSES: readonly WorkitemsStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'deferred',
  'closed',
  'other',
]

type Description = {
  name: string
  watch: readonly string[]
  writes: readonly string[]
  statusMap: ReadonlyMap<string, WorkitemsStatus>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry !== '')
}

export async function runJson(
  files: TrackerFiles,
  label: string,
  argv: readonly string[],
  env?: Readonly<Record<string, string>>,
): Promise<unknown> {
  let result
  try {
    result = await files.commands.run(argv, env)
  } catch {
    throw new ItemFault(`${label} did not start or did not end in time, so it could not be read.`)
  }
  if (result.isStdoutTruncated) throw new ItemFault(`${label} output was cut off.`)
  if (result.exitCode !== 0) {
    throw new ItemFault(
      `${label} exited ${numeral(result.exitCode)}. Run it in a shell to see why.`,
    )
  }
  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    throw new ItemFault(`${label} printed no valid JSON, so it could not be read.`)
  }
}

function recordLocated(record: Record<string, unknown>, where: string): Located {
  return {
    where,
    value: (field) => (Object.hasOwn(record, field) ? record[field] : undefined),
    invalid: (field) => `${where} has an invalid ${field}, so it could not be read.`,
    missing: (field) => `${where} has no ${field}, so it could not be read.`,
  }
}

function statusMapOf(label: string, value: unknown): Map<string, WorkitemsStatus> {
  const map = new Map<string, WorkitemsStatus>()
  if (value === undefined) return map
  if (!isRecord(value))
    throw new ItemFault(`${label} has an invalid statusMap, so it could not be read.`)
  for (const [raw, normal] of Object.entries(value)) {
    const status = MAPPED_STATUSES.find((known) => known === normal)
    if (!status) {
      throw new ItemFault(
        `${label} maps the status ${raw} to ${String(normal)}, which is not one of ${MAPPED_STATUSES.join(', ')}, so it could not be read.`,
      )
    }
    map.set(raw, status)
  }
  return map
}

function writesOf(label: string, value: unknown): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    !value.every(isTextList) ||
    value.some((write) => write.length === 0)
  ) {
    throw new ItemFault(`${label} has invalid writes, so it could not be read.`)
  }
  return value.map((write) => write.join(' '))
}

function watchOf(label: string, value: unknown): string[] {
  if (value === undefined) return []
  if (!isTextList(value))
    throw new ItemFault(`${label} has an invalid watch, so it could not be read.`)
  return value
}

function descriptionOf(label: string, parsed: unknown): Description {
  if (!isRecord(parsed))
    throw new ItemFault(`${label} printed no JSON object, so it could not be read.`)
  const contract = parsed.contract
  if (contract === undefined) {
    throw new ItemFault(`${label} names no contract, so it could not be read.`)
  }
  if (typeof contract !== 'number' || !Number.isFinite(contract)) {
    throw new ItemFault(
      `${label} says contract ${JSON.stringify(contract)}, which is not the number 1, so it could not be read.`,
    )
  }
  if (contract !== CONTRACT) {
    throw new ItemFault(`the adapter says contract ${numeral(contract)}; handily reads contract 1.`)
  }
  const name = requiredText(recordLocated(parsed, label), 'name')
  return {
    name,
    watch: watchOf(label, parsed.watch),
    writes: writesOf(label, parsed.writes),
    statusMap: statusMapOf(label, parsed.statusMap),
  }
}

function itemOf(
  record: Record<string, unknown>,
  where: string,
  description: Description,
): WorkitemsItem {
  const located = recordLocated(record, where)
  const id = requiredText(located, 'id')
  const rawStatus = requiredText(located, 'status')
  const item: WorkitemsItem = {
    key: `${description.name}:${id}`,
    id,
    title: requiredText(located, 'title'),
    status: description.statusMap.get(rawStatus) ?? normalStatusOf(rawStatus),
    rawStatus,
    priority: optionalPriority(located, 'priority'),
    type: optionalText(located, 'type'),
    assignee: optionalText(located, 'assignee'),
    updatedAt: optionalText(located, 'updatedAt'),
    source: description.name,
  }
  for (const key of ['url', 'parent'] as const) {
    const value = optionalText(located, key)
    if (value !== null) item[key] = value
  }
  const labels = optionalLabels(located, 'labels')
  if (labels) item.labels = labels
  return checkedItem(item, where)
}

function itemsOf(label: string, parsed: unknown, description: Description): WorkitemsItem[] {
  if (!Array.isArray(parsed)) {
    throw new ItemFault(`${label} printed no list of items, so it could not be read.`)
  }
  const found = parsed.map((record, index) => {
    const where = `${label} item ${numeral(index + 1)}`
    if (!isRecord(record))
      throw new ItemFault(`${where} is not an object, so it could not be read.`)
    return { item: itemOf(record, where, description), path: label }
  })
  return uniqueByKey(found)
}

async function commandOf(files: TrackerFiles): Promise<readonly string[]> {
  const outcome = await readConfig(files)
  if (!outcome.ok) throw new ItemFault(outcome.reason)
  if (outcome.config.command === null) {
    throw new ItemFault(`${CONFIG_FILE} names no command, so it could not be read.`)
  }
  return outcome.config.command
}

async function hasCommand(files: TrackerFiles): Promise<boolean> {
  const outcome = await readConfig(files)
  return outcome.ok && outcome.config.command !== null
}

export function createAdapterReader(): Reader {
  let described: { command: string; description: Description } | undefined

  async function readAdapter(files: TrackerFiles): Promise<ReadOutcome> {
    try {
      const command = await commandOf(files)
      const text = command.join(' ')
      if (!(await files.commands.canRun())) {
        return { ok: false, state: 'terminal-only', sourceLabel: text }
      }
      const describeArgv = [...command, 'describe', '--json']
      const verdict = await files.commands.approvals.check(files, { command, shown: describeArgv })
      if (verdict !== 'approved') {
        return { ok: false, state: 'approval-needed', command: text, sourceLabel: text }
      }
      described = undefined
      const describeLabel = `${text} describe --json`
      const description = descriptionOf(
        describeLabel,
        await runJson(files, describeLabel, describeArgv),
      )
      described = { command: text, description }
      const itemsLabel = `${text} items --json`
      const parsed = await runJson(files, itemsLabel, [...command, 'items', '--json'])
      return {
        ok: true,
        items: itemsOf(itemsLabel, parsed, description),
        sourceLabel: description.name,
        caveat: null,
        adapterWrites: { command: text, verbs: description.writes },
      }
    } catch (error) {
      if (error instanceof ItemFault) return { ok: false, reason: error.reason }
      throw error
    }
  }

  async function adapterSignature(files: TrackerFiles): Promise<string> {
    const command = await commandOf(files)
    const parts = [JSON.stringify(command), String(files.commands.approvals.generation())]
    parts.push(await coverStamp(files, { command }))
    if (described?.command === command.join(' ')) {
      parts.push(signatureOfMatches(await matchGlobs(files, described.description.watch)))
    }
    return parts.join('\n')
  }

  return {
    name: SOURCE,
    marker: CONFIG_FILE,
    lookedForAs: CONFIG_FILE,
    isPresent: hasCommand,
    signature: adapterSignature,
    read: readAdapter,
  }
}
