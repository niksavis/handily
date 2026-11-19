export type StatReader = (path: string) => Promise<string>

export type ProcessStart =
  { kind: 'running'; start: number } | { kind: 'gone' } | { kind: 'unknown' }

export type Liveness = { canCheck: boolean; starts: ReadonlyMap<number, ProcessStart> }

export const NO_PROCESS_CHECK: Liveness = { canCheck: false, starts: new Map() }

const SELF_STAT = '/proc/self/stat'
const START_FIELD_AFTER_NAME = 19
const GONE = /\bENOENT\b/

export function isGoneError(error: unknown): boolean {
  return GONE.test(error instanceof Error ? error.message : String(error))
}

export function startOfStat(stat: string): number | null {
  const nameEnd = stat.lastIndexOf(')')
  if (nameEnd < 0) return null
  const fields = stat
    .slice(nameEnd + 1)
    .trim()
    .split(/\s+/)
  const field = fields[START_FIELD_AFTER_NAME]
  if (field === undefined || !/^\d+$/.test(field)) return null
  return Number(field)
}

async function processStart(read: StatReader, pid: number): Promise<ProcessStart> {
  try {
    const start = startOfStat(await read(`/proc/${String(pid)}/stat`))
    return start === null ? { kind: 'unknown' } : { kind: 'running', start }
  } catch (error) {
    return isGoneError(error) ? { kind: 'gone' } : { kind: 'unknown' }
  }
}

async function canCheckProcesses(read: StatReader): Promise<boolean> {
  try {
    return startOfStat(await read(SELF_STAT)) !== null
  } catch {
    return false
  }
}

export async function readLiveness(read: StatReader, pids: readonly number[]): Promise<Liveness> {
  if (!(await canCheckProcesses(read))) return NO_PROCESS_CHECK
  const starts = new Map<number, ProcessStart>()
  for (const pid of new Set(pids)) starts.set(pid, await processStart(read, pid))
  return { canCheck: true, starts }
}

export function isEnded(liveness: Liveness, pid: number, pidStart: number): boolean {
  if (!liveness.canCheck) return false
  const known = liveness.starts.get(pid)
  if (known === undefined || known.kind === 'unknown') return false
  return known.kind === 'gone' || known.start !== pidStart
}
