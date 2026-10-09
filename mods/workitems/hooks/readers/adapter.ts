import type { WorkitemsFailedReason, WorkitemsItem, WorkitemsStatus } from '../../types'
import { programOutsideRoot, quotedCommand } from '../approval'
import {
  argumentProblem,
  CONFIG_FILE,
  FileProblem,
  matchGlobs,
  signatureOfMatches,
  USER_ADAPTERS_FILE,
  USER_ADAPTERS_SHOWN,
} from '../config'
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
const MAX_DESCRIBED_ENTRIES = 100
const UNSAFE_TEXT = 'with a control character or over 256 characters'
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

export type CommandFaultKind = 'not-run' | 'cut' | 'exit' | 'not-json'

export class CommandFault extends ItemFault {
  constructor(
    reason: WorkitemsFailedReason,
    readonly kind: CommandFaultKind,
  ) {
    super(reason)
  }
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
    throw new CommandFault(
      `${label} did not start or did not end in time, so it could not be read.`,
      'not-run',
    )
  }
  if (result.isStdoutTruncated) throw new CommandFault(`${label} output was cut off.`, 'cut')
  if (result.exitCode !== 0) {
    throw new CommandFault(
      `${label} exited ${numeral(result.exitCode)}. Run it in a shell to see why.`,
      'exit',
    )
  }
  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    throw new CommandFault(`${label} printed no valid JSON, so it could not be read.`, 'not-json')
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

function refuseUnsafe(label: string, what: string, values: readonly string[]): void {
  if (values.length > MAX_DESCRIBED_ENTRIES) {
    throw new ItemFault(
      `${label} gives more than ${String(MAX_DESCRIBED_ENTRIES)} ${what}s, so it could not be read.`,
    )
  }
  if (values.some((value) => argumentProblem(value) !== null)) {
    throw new ItemFault(`${label} gives a ${what} ${UNSAFE_TEXT}, so it could not be read.`)
  }
}

function statusMapOf(label: string, value: unknown): Map<string, WorkitemsStatus> {
  const map = new Map<string, WorkitemsStatus>()
  if (value === undefined) return map
  if (!isRecord(value))
    throw new ItemFault(`${label} has an invalid statusMap, so it could not be read.`)
  refuseUnsafe(label, 'status', Object.keys(value))
  for (const [raw, normal] of Object.entries(value)) {
    const status = MAPPED_STATUSES.find((known) => known === normal)
    if (!status) {
      throw new ItemFault(
        `${label} maps a status to a value that is not one of ${MAPPED_STATUSES.join(', ')}, so it could not be read.`,
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
  const writes = value.map((write) => write.join(' '))
  refuseUnsafe(label, 'write', writes)
  return writes
}

function watchOf(label: string, value: unknown): string[] {
  if (value === undefined) return []
  if (!isTextList(value))
    throw new ItemFault(`${label} has an invalid watch, so it could not be read.`)
  refuseUnsafe(label, 'watch glob', value)
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
  if (argumentProblem(name) !== null) {
    throw new ItemFault(`${label} gives a name ${UNSAFE_TEXT}, so it could not be read.`)
  }
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

type UserCommand =
  | { kind: 'none' }
  | { kind: 'found'; argv: readonly string[] }
  | { kind: 'fault'; reason: WorkitemsFailedReason }

function userFault(detail: string): UserCommand {
  return { kind: 'fault', reason: `${USER_ADAPTERS_SHOWN} ${detail}, so it could not be read.` }
}

async function readUserCommand(files: TrackerFiles): Promise<UserCommand> {
  let text: string | undefined
  try {
    text = await files.readUserFile(USER_ADAPTERS_FILE)
  } catch (error) {
    if (error instanceof FileProblem) return { kind: 'fault', reason: error.reason }
    throw error
  }
  if (text === undefined) return { kind: 'none' }
  const rootReal = await files.realPath('.')
  if (rootReal === undefined) return { kind: 'fault', reason: 'the repo root could not be read.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return userFault('is not valid JSON')
  }
  if (!isRecord(parsed)) return userFault('is not a JSON object')
  if (!Object.hasOwn(parsed, rootReal)) return { kind: 'none' }
  const entry = parsed[rootReal]
  if (!isTextList(entry) || entry.length === 0)
    return userFault('has an invalid entry for this repo')
  return { kind: 'found', argv: entry }
}

const userCommands = new WeakMap<TrackerFiles, Promise<UserCommand>>()

function userCommandOf(files: TrackerFiles): Promise<UserCommand> {
  let lookup = userCommands.get(files)
  if (!lookup) {
    lookup = readUserCommand(files)
    userCommands.set(files, lookup)
  }
  return lookup
}

async function hasUserCommand(files: TrackerFiles): Promise<boolean> {
  return (await userCommandOf(files)).kind !== 'none'
}

async function missingEntry(files: TrackerFiles): Promise<WorkitemsFailedReason> {
  const rootReal = await files.realPath('.')
  const isShown = rootReal !== undefined && argumentProblem(rootReal) === null
  const shown = isShown ? ` (${JSON.stringify(rootReal)})` : ''
  return `${USER_ADAPTERS_SHOWN} has no entry for this repo${shown}, so it could not be read.`
}

export function createAdapterReader(): Reader {
  let described: { argv: string; description: Description } | undefined

  async function readAdapter(files: TrackerFiles): Promise<ReadOutcome> {
    const lookup = await userCommandOf(files)
    if (lookup.kind === 'fault') return { ok: false, reason: lookup.reason }
    if (lookup.kind === 'none') return { ok: false, reason: await missingEntry(files) }
    if (!(await files.commands.canRun())) {
      return { ok: false, state: 'terminal-only', sourceLabel: SOURCE }
    }
    const { argv } = lookup
    const argv0 = await programOutsideRoot(files, argv)
    const label = quotedCommand(argv)
    try {
      described = undefined
      const describeLabel = `${label} describe --json`
      const describeArgv = [argv0, ...argv.slice(1), 'describe', '--json']
      const description = descriptionOf(
        describeLabel,
        await runJson(files, describeLabel, describeArgv),
      )
      described = { argv: JSON.stringify(argv), description }
      const itemsLabel = `${label} items --json`
      const parsed = await runJson(files, itemsLabel, [argv0, ...argv.slice(1), 'items', '--json'])
      return {
        ok: true,
        items: itemsOf(itemsLabel, parsed, description),
        sourceLabel: description.name,
        caveat: null,
        adapterWrites: { command: argv.join(' '), verbs: description.writes },
      }
    } catch (error) {
      if (error instanceof ItemFault) return { ok: false, reason: error.reason }
      throw error
    }
  }

  async function adapterSignature(files: TrackerFiles): Promise<string> {
    const lookup = await userCommandOf(files)
    const parts = [JSON.stringify(lookup)]
    if (lookup.kind === 'found' && described?.argv === JSON.stringify(lookup.argv)) {
      parts.push(signatureOfMatches(await matchGlobs(files, described.description.watch)))
    }
    return parts.join('\n')
  }

  return {
    name: SOURCE,
    marker: CONFIG_FILE,
    lookedForAs: USER_ADAPTERS_SHOWN,
    isPresent: hasUserCommand,
    signature: adapterSignature,
    read: readAdapter,
  }
}
