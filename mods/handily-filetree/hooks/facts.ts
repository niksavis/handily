import type { EngineInterface, FsStat } from 'claude-code'
import { reasonOf } from './reason'
import { READ_LIMIT_BYTES, isBinary, linesOf } from './source'

export type StatFact =
  { kind: 'stat'; size: number; mtimeMs: number } | { kind: 'failed'; reason: string }

export type LineFact =
  | { kind: 'lines'; count: number }
  | { kind: 'binary' }
  | { kind: 'too-large' }
  | { kind: 'unreadable'; reason: string }

export type FileFacts = { stat: StatFact | undefined; lines: LineFact | undefined }

type KeptStat = { fact: StatFact; generation: number }

type KeptLines = { fact: LineFact; stamp: string }

export type Facts = {
  stats: Map<string, KeptStat>
  lines: Map<string, KeptLines>
  queue: Map<string, boolean>
  inFlight: Set<string>
  generation: number
  session: number
  isLoading: boolean
}

const TOO_LARGE = /\b4 ?MiB\b|too large|EFBIG/i

export function newFacts(): Facts {
  return {
    stats: new Map(),
    lines: new Map(),
    queue: new Map(),
    inFlight: new Set(),
    generation: 0,
    session: 0,
    isLoading: false,
  }
}

export function clearFacts(facts: Facts): void {
  facts.stats.clear()
  facts.lines.clear()
  facts.queue.clear()
  facts.inFlight.clear()
  facts.session += 1
  facts.isLoading = false
}

export function staleFacts(facts: Facts): void {
  facts.generation += 1
}

function stampOf(stat: StatFact | undefined): string | undefined {
  return stat?.kind === 'stat' ? `${String(stat.size)}:${String(stat.mtimeMs)}` : undefined
}

export function factsOf(facts: Facts, at: string): FileFacts {
  const stat = facts.stats.get(at)?.fact
  const kept = facts.lines.get(at)
  const lines = kept !== undefined && kept.stamp === stampOf(stat) ? kept.fact : undefined
  return { stat, lines }
}

function isWanted(facts: Facts, at: string, needsLines: boolean): boolean {
  if (facts.inFlight.has(at)) return false
  const kept = facts.stats.get(at)
  if (kept === undefined || kept.generation < facts.generation) return true
  if (!needsLines || kept.fact.kind !== 'stat') return false
  return facts.lines.get(at)?.stamp !== stampOf(kept.fact)
}

function log($: EngineInterface, text: string): void {
  $.ui.log(`handily-filetree: ${text}`)
}

const NOT_A_FILE: Readonly<Record<Exclude<FsStat['kind'], 'file'>, string>> = {
  dir: 'it leads to a folder',
  other: 'it is not a regular file',
}

async function statOf($: EngineInterface, at: string): Promise<StatFact> {
  try {
    const { kind, size, mtimeMs } = await $.fs.stat(at)
    if (kind !== 'file') return { kind: 'failed', reason: NOT_A_FILE[kind] }
    return { kind: 'stat', size, mtimeMs }
  } catch (error) {
    log($, `cannot stat ${at}: ${String(error)}`)
    return { kind: 'failed', reason: reasonOf(error) }
  }
}

async function linesFactOf($: EngineInterface, at: string, size: number): Promise<LineFact> {
  if (size > READ_LIMIT_BYTES) return { kind: 'too-large' }
  try {
    const text = await $.fs.read(at)
    if (isBinary(text)) return { kind: 'binary' }
    return { kind: 'lines', count: linesOf(text).length }
  } catch (error) {
    log($, `cannot count the lines of ${at}: ${String(error)}`)
    if (TOO_LARGE.test(String(error))) return { kind: 'too-large' }
    return { kind: 'unreadable', reason: reasonOf(error) }
  }
}

async function loadOne(
  $: EngineInterface,
  facts: Facts,
  wanted: { at: string; needsLines: boolean },
): Promise<void> {
  const { at, needsLines } = wanted
  const { generation, session } = facts
  const stat = await statOf($, at)
  if (facts.session !== session) return
  facts.stats.set(at, { fact: stat, generation })
  const stamp = stampOf(stat)
  if (!needsLines || stat.kind !== 'stat' || stamp === undefined) return
  if (facts.lines.get(at)?.stamp === stamp) return
  const fact = await linesFactOf($, at, stat.size)
  if (facts.session === session) facts.lines.set(at, { fact, stamp })
}

async function loadQueued($: EngineInterface, facts: Facts, session: number): Promise<void> {
  try {
    while (facts.queue.size > 0 && facts.session === session) {
      const batch = [...facts.queue]
      facts.queue.clear()
      for (const [at, needsLines] of batch) {
        if (facts.session !== session) return
        facts.inFlight.add(at)
        await loadOne($, facts, { at, needsLines })
        if (facts.session === session) facts.inFlight.delete(at)
      }
      if (facts.session === session) $.ui.invalidate('ui.render')
    }
  } finally {
    if (facts.session === session) facts.isLoading = false
  }
}

export function wantFacts(
  $: EngineInterface,
  facts: Facts,
  wanted: { paths: readonly string[]; needsLines: boolean },
): void {
  for (const at of wanted.paths) {
    if (isWanted(facts, at, wanted.needsLines)) {
      facts.queue.set(at, wanted.needsLines || facts.queue.get(at) === true)
    }
  }
  if (facts.isLoading || facts.queue.size === 0) return
  facts.isLoading = true
  loadQueued($, facts, facts.session).catch((error: unknown) => {
    log($, `the file facts did not load: ${String(error)}`)
  })
}
