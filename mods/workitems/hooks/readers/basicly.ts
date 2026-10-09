import type { WorkitemsItem } from '../../types'
import { numeral } from '../states'
import { coverStamp, quotedCommand, type ApprovalKey, type CoveredFolder } from '../approval'
import { runJson } from './adapter'
import {
  checkedItem,
  ItemFault,
  normalStatusOf,
  optionalPriority,
  optionalText,
  requiredText,
  uniqueByKey,
  type Located,
} from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const SOURCE = 'basicly'
const LEDGER = '.basicly/ledger'
const TEMPLATE = `${LEDGER}/template.json`
const KIT_FOLDER = '.basicly/core/kit/tracker'
const KIT_CODE: readonly CoveredFolder[] = [{ path: KIT_FOLDER, suffix: '', recursive: true }]
const PROGRAM = 'basicly'
const LABEL = 'basicly tracker items'
const COMMAND = [PROGRAM, 'tracker', 'items'] as const
const OPEN_STATUSES = ['open', 'in_progress', 'blocked'] as const
const ITEMS_FLAGS = ['--json', ...OPEN_STATUSES.flatMap((status) => ['--status', status])]
const VERSION_LABEL = 'basicly --version'
const VERSION_LINE = /^basicly (\d+)\.(\d+)\.(\d+)$/
const RUNS_ONLY_PACKAGE_SINCE = [0, 21, 1] as const
const KIT_NOTE = `(basicly 0.21.1 or later runs only the installed package; asked again if the command changes. An older basicly also runs the repo code in ${KIT_FOLDER}; asked again if a file there changes)`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordLocated(record: Record<string, unknown>, where: string): Located {
  return {
    where,
    value: (field) => (Object.hasOwn(record, field) ? record[field] : undefined),
    invalid: (field) => `${where} has an invalid ${field}, so it could not be read.`,
    missing: (field) => `${where} has no ${field}, so it could not be read.`,
  }
}

function itemOf(record: Record<string, unknown>, where: string): WorkitemsItem {
  const located = recordLocated(record, where)
  const id = requiredText(located, 'id')
  const rawStatus = requiredText(located, 'rawStatus')
  const item: WorkitemsItem = {
    key: `${SOURCE}:${id}`,
    id,
    title: requiredText(located, 'title'),
    status: normalStatusOf(rawStatus),
    rawStatus,
    priority: optionalPriority(located, 'priority'),
    type: optionalText(located, 'type'),
    assignee: optionalText(located, 'assignee'),
    updatedAt: optionalText(located, 'updatedAt'),
    source: SOURCE,
  }
  return checkedItem(item, where)
}

function itemsOf(label: string, parsed: unknown): WorkitemsItem[] {
  if (!Array.isArray(parsed)) {
    throw new ItemFault(`${label} printed no list of items, so it could not be read.`)
  }
  const found = parsed.map((record: unknown, index) => {
    const where = `${label} record ${numeral(index + 1)}`
    if (!isRecord(record))
      throw new ItemFault(`${where} is not an object, so it could not be read.`)
    return { item: itemOf(record, where), path: label }
  })
  return uniqueByKey(found)
}

function freshCacheFolder(root: string): string {
  return `${root.replace(/[\\/]+$/, '')}/.handily-pycache-${crypto.randomUUID()}`
}

function pythonEnv(root: string): Record<string, string> {
  return {
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPYCACHEPREFIX: freshCacheFolder(root),
  }
}

function runsOnlyPackage(versionOutput: string): boolean {
  const match = VERSION_LINE.exec(versionOutput.trim())
  if (match === null) return false
  const version = match.slice(1).map(Number)
  for (const [index, floor] of RUNS_ONLY_PACKAGE_SINCE.entries()) {
    const part = version[index] ?? 0
    if (part !== floor) return part > floor
  }
  return true
}

async function versionIgnoresKit(files: TrackerFiles, argv0: string): Promise<boolean> {
  let result
  try {
    result = await files.commands.run([argv0, '--version'], pythonEnv(files.root))
  } catch {
    throw new ItemFault(
      `${VERSION_LABEL} did not start or did not end in time, so it could not be read.`,
    )
  }
  return result.exitCode === 0 && !result.isStdoutTruncated && runsOnlyPackage(result.stdout)
}

type VersionMemory = { kept?: { key: string; ignoresKit: boolean } }

async function ignoresKit(
  files: TrackerFiles,
  approval: ApprovalKey,
  memory: VersionMemory,
): Promise<boolean> {
  const program = await files.commands.stamp(approval.argv0)
  const key = program === undefined ? undefined : JSON.stringify({ ...approval, program })
  if (key !== undefined && memory.kept?.key === key) return memory.kept.ignoresKit
  const verdict = await versionIgnoresKit(files, approval.argv0)
  if (key !== undefined) memory.kept = { key, ignoresKit: verdict }
  return verdict
}

function approvalNeeded(): ReadOutcome {
  return {
    ok: false,
    state: 'approval-needed',
    command: quotedCommand(COMMAND),
    sourceLabel: SOURCE,
  }
}

async function approvedProgram(
  files: TrackerFiles,
  memory: VersionMemory,
): Promise<string | undefined> {
  const verdict = await files.commands.approvals.check(files, {
    command: COMMAND,
    shown: [...COMMAND, ...ITEMS_FLAGS],
    folders: KIT_CODE,
    note: KIT_NOTE,
    ignoresFolders: (approval) => ignoresKit(files, approval, memory),
  })
  return verdict.approved ? verdict.argv0 : undefined
}

async function listOpenItems(files: TrackerFiles, memory: VersionMemory): Promise<ReadOutcome> {
  const argv0 = await approvedProgram(files, memory)
  if (argv0 === undefined) return approvalNeeded()
  const argv = [argv0, ...COMMAND.slice(1), ...ITEMS_FLAGS]
  const items = itemsOf(LABEL, await runJson(files, LABEL, argv, pythonEnv(files.root)))
  return { ok: true, items, sourceLabel: SOURCE, caveat: null, listsOpenOnly: true }
}

async function readBasicly(files: TrackerFiles, memory: VersionMemory): Promise<ReadOutcome> {
  if (!(await files.commands.canRun())) {
    return { ok: false, state: 'terminal-only', sourceLabel: SOURCE }
  }
  if ((await files.commands.which(PROGRAM)) === undefined) {
    return { ok: false, reason: 'basicly is not on PATH. Install it to read this tracker.' }
  }
  try {
    return await listOpenItems(files, memory)
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

export function createBasiclyReader(): Reader {
  const memory: VersionMemory = {}
  return {
    name: SOURCE,
    marker: TEMPLATE,
    signature: basiclySignature,
    read: (files) => readBasicly(files, memory),
  }
}
