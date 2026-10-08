import type { AgentInfo, AgentStatus } from 'claude-code'

export const TARGET_CHARS_AT_MOST = 200

const TARGET_KEYS = [
  'file_path',
  'notebook_path',
  'pattern',
  'path',
  'url',
  'query',
  'command',
  'description',
  'skill',
] as const

const ENDED_STATUSES: ReadonlySet<string> = new Set<AgentStatus>(['completed', 'failed', 'killed'])

export type RowStatus = AgentStatus | 'unknown'

export type ToolSight = { tool: string; target: string | null }

export type SpawnFacts = {
  description: string
  type: string
  name: string | undefined
  parentId: string | undefined
}

export type AgentTrack = {
  id: string
  startedAt: number
  seenAt: number
  endedAt: number | null
  tools: number
  running: Map<string, ToolSight>
  last: ToolSight | null
  description: string | null
  type: string | null
  name: string | null
  parentId: string | null
  listedStatus: AgentStatus | null
  isListed: boolean
}

export type Tracks = Map<string, AgentTrack>

export function isEnded(status: RowStatus): boolean {
  return ENDED_STATUSES.has(status)
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

export function toolTarget(input: Readonly<Record<string, unknown>>): string | null {
  for (const key of TARGET_KEYS) {
    const value = input[key]
    if (typeof value !== 'string') continue
    const line = firstLine(value)
    if (line !== '') return line.slice(0, TARGET_CHARS_AT_MOST)
  }
  return null
}

export function trackOf(tracks: Tracks, id: string, now: number): AgentTrack {
  const known = tracks.get(id)
  if (known) return known
  const created: AgentTrack = {
    id,
    startedAt: now,
    seenAt: now,
    endedAt: null,
    tools: 0,
    running: new Map(),
    last: null,
    description: null,
    type: null,
    name: null,
    parentId: null,
    listedStatus: null,
    isListed: false,
  }
  tracks.set(id, created)
  return created
}

export function noteSpawn(tracks: Tracks, id: string, facts: SpawnFacts, now: number): void {
  const track = trackOf(tracks, id, now)
  track.description ??= facts.description
  track.type ??= facts.type
  track.name ??= facts.name ?? null
  track.parentId ??= facts.parentId ?? null
}

export function startCall(
  tracks: Tracks,
  agentId: string,
  callId: string,
  sight: ToolSight,
  now: number,
): void {
  const track = trackOf(tracks, agentId, now)
  track.seenAt = now
  track.endedAt = null
  track.running.set(callId, sight)
}

export function finishCall(tracks: Tracks, agentId: string, callId: string): void {
  const track = tracks.get(agentId)
  const sight = track?.running.get(callId)
  if (!track || !sight) return
  track.running.delete(callId)
  track.tools += 1
  track.last = sight
}

export function dropCall(tracks: Tracks, agentId: string, callId: string): void {
  tracks.get(agentId)?.running.delete(callId)
}

export function noteTurnEnd(tracks: Tracks, agentId: string, now: number): void {
  const track = trackOf(tracks, agentId, now)
  track.seenAt = now
  track.endedAt = now
}

export function mergeList(tracks: Tracks, listed: readonly AgentInfo[], now: number): void {
  const seen = new Set<string>()
  for (const info of listed) {
    seen.add(info.id)
    const track = trackOf(tracks, info.id, now)
    track.isListed = true
    track.seenAt = now
    track.listedStatus = info.status
    track.description = info.description === '' ? track.description : info.description
    track.type = info.type
    track.name = info.name ?? track.name
    track.parentId = info.parentId ?? track.parentId
    if (isEnded(info.status)) track.endedAt ??= now
  }
  for (const track of tracks.values()) {
    if (!seen.has(track.id)) track.isListed = false
  }
}

export function rowStatus(track: AgentTrack): RowStatus {
  if (track.listedStatus !== null) {
    if (track.isListed || isEnded(track.listedStatus)) return track.listedStatus
    return 'unknown'
  }
  if (track.running.size > 0) return 'running'
  return track.endedAt === null ? 'unknown' : 'completed'
}

export function currentCall(track: AgentTrack): ToolSight | null {
  let current: ToolSight | null = null
  for (const sight of track.running.values()) current = sight
  return current
}

function endOf(track: AgentTrack, now: number): number {
  const status = rowStatus(track)
  if (isEnded(status)) return track.endedAt ?? now
  return status === 'unknown' ? track.seenAt : now
}

export function elapsedMs(track: AgentTrack, now: number): number {
  return Math.max(endOf(track, now) - track.startedAt, 0)
}
