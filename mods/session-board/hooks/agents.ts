import type { ProcessRunResult } from 'claude-code'

export const POLL_INTERVAL_MS = 15_000
export const AGENTS_ARGV: readonly string[] = ['claude', 'agents', '--json', '--all']
export const AGENTS_CACHE_KEY = 'agents'

const ENDED_STATES = new Set(['done', 'failed', 'stopped'])
const NOT_ON_PATH = /ENOENT|not found|no such file|cannot find/i

export type AgentKind = 'interactive' | 'background'

export type AgentRow = {
  key: string
  sessionId: string | null
  name: string
  kind: AgentKind
  word: string
  waitingFor: string | null
  cwd: string
  startedAt: number
  isEnded: boolean
}

export type AgentsOutcome =
  | { kind: 'ok'; rows: AgentRow[] }
  | { kind: 'exit'; exitCode: number }
  | { kind: 'not-on-path' }
  | { kind: 'not-a-list' }
  | { kind: 'did-not-run' }

export type GitPlace = { worktree: string; branch: string | null }

export type PlaceEntry = { cwd: string; place: GitPlace }

export type AgentsCache = {
  at: number
  outcome: AgentsOutcome
  places: Record<string, PlaceEntry>
}

export type AgentsHost = {
  now: () => Promise<number>
  run: (argv: readonly string[]) => Promise<ProcessRunResult>
  load: () => Promise<unknown>
  save: (cache: AgentsCache) => Promise<void>
  log: (line: string) => void
}

class UnreadableRow extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function rowKey(entry: Record<string, unknown>, sessionId: string | null): string {
  if (sessionId !== null) return sessionId
  if (typeof entry.id === 'string') return `bg:${entry.id}`
  return `pid:${String(entry.pid)}`
}

function rowName(entry: Record<string, unknown>, sessionId: string | null): string {
  return (
    optionalText(entry.name) ??
    optionalText(entry.id) ??
    sessionId?.slice(0, 8) ??
    `pid ${String(entry.pid)}`
  )
}

function readRow(entry: unknown): AgentRow {
  if (!isRecord(entry)) throw new UnreadableRow()
  const { kind, cwd, startedAt } = entry
  if (kind !== 'interactive' && kind !== 'background') throw new UnreadableRow()
  if (typeof cwd !== 'string' || typeof startedAt !== 'number') throw new UnreadableRow()
  const sessionId = optionalText(entry.sessionId)
  const word = optionalText(kind === 'background' ? entry.state : entry.status) ?? 'unknown'
  return {
    key: rowKey(entry, sessionId),
    sessionId,
    name: rowName(entry, sessionId),
    kind,
    word,
    waitingFor: optionalText(entry.waitingFor),
    cwd,
    startedAt,
    isEnded: kind === 'background' && ENDED_STATES.has(word),
  }
}

export function parseAgents(stdout: string): AgentsOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { kind: 'not-a-list' }
  }
  if (!Array.isArray(parsed)) return { kind: 'not-a-list' }
  try {
    return { kind: 'ok', rows: parsed.map(readRow) }
  } catch (error) {
    if (error instanceof UnreadableRow) return { kind: 'not-a-list' }
    throw error
  }
}

export function readCache(value: unknown): AgentsCache | undefined {
  if (!isRecord(value)) return undefined
  const { at, outcome, places } = value
  if (typeof at !== 'number' || !isRecord(outcome) || !isRecord(places)) return undefined
  if (typeof outcome.kind !== 'string') return undefined
  return value as AgentsCache
}

async function runAgents(host: AgentsHost): Promise<AgentsOutcome> {
  let result: ProcessRunResult
  try {
    result = await host.run(AGENTS_ARGV)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    host.log(`session-board: claude agents --json could not run: ${reason}`)
    return NOT_ON_PATH.test(reason) ? { kind: 'not-on-path' } : { kind: 'did-not-run' }
  }
  if (result.exitCode !== 0) return { kind: 'exit', exitCode: result.exitCode }
  if (result.isStdoutTruncated) return { kind: 'not-a-list' }
  return parseAgents(result.stdout)
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part !== '')
}

function lastSegments(path: string, count: number): string {
  const parts = segments(path)
  return parts.length === 0 ? path : parts.slice(-count).join('/')
}

export async function gitPlace(host: AgentsHost, cwd: string): Promise<GitPlace> {
  const fallback = { worktree: lastSegments(cwd, 1), branch: null }
  let paths: ProcessRunResult
  try {
    paths = await host.run([
      'git',
      '-C',
      cwd,
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
    ])
  } catch {
    return fallback
  }
  const [top, gitDir, commonDir] = paths.stdout.trim().split(/\r?\n/)
  if (paths.exitCode !== 0 || top === undefined || top === '') return fallback
  const isLinked = gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir
  const worktree = lastSegments(top, isLinked ? 2 : 1)
  let branch: ProcessRunResult
  try {
    branch = await host.run(['git', '-C', cwd, 'branch', '--show-current'])
  } catch {
    return { worktree, branch: null }
  }
  const name = branch.stdout.trim()
  return { worktree, branch: branch.exitCode === 0 && name !== '' ? name : null }
}

async function placesFor(
  host: AgentsHost,
  rows: readonly AgentRow[],
  previous: Record<string, PlaceEntry>,
): Promise<Record<string, PlaceEntry>> {
  const places: Record<string, PlaceEntry> = {}
  for (const row of rows) {
    const known = previous[row.key]
    places[row.key] =
      known?.cwd === row.cwd ? known : { cwd: row.cwd, place: await gitPlace(host, row.cwd) }
  }
  return places
}

export async function pollAgents(host: AgentsHost): Promise<AgentsCache> {
  const now = await host.now()
  const previous = readCache(await host.load())
  if (previous && now - previous.at < POLL_INTERVAL_MS) return previous
  const outcome = await runAgents(host)
  const known = previous?.places ?? {}
  const places = outcome.kind === 'ok' ? await placesFor(host, outcome.rows, known) : known
  const cache = { at: now, outcome, places }
  await host.save(cache)
  return cache
}
