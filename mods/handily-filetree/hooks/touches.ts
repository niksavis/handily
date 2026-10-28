export type TouchKind = 'read' | 'edit'

export const MAIN_AGENT = ''

export const REVEALED_PER_SEARCH = 12

export type Touch = { kind: TouchKind; agent: string; at: number; shell?: readonly string[] }

export type SightSource = 'call' | 'Grep' | 'Bash'

export type Sight = Touch & { path: string; hidden: number; source: SightSource }

export type Mark = Touch & { others: number }

type Call = Touch & { path: string }

export type Touches = {
  files: Map<string, Map<string, Touch>>
  sights: Map<string, Sight>
  calls: Map<string, Call>
}

export type TouchView = {
  files: ReadonlyMap<string, Mark>
  folders: ReadonlyMap<string, Mark>
  sights: readonly Sight[]
  agents: readonly string[]
}

export function newTouches(): Touches {
  return { files: new Map(), sights: new Map(), calls: new Map() }
}

export function clearTouches(touches: Touches): void {
  touches.files.clear()
  touches.sights.clear()
  touches.calls.clear()
}

function kept(touches: Touches, path: string, touch: Touch, agent = touch.agent): void {
  const byAgent = touches.files.get(path) ?? new Map<string, Touch>()
  byAgent.set(agent, touch)
  touches.files.set(path, byAgent)
}

export function beginTouch(touches: Touches, callId: string, call: Call): void {
  touches.calls.set(callId, call)
}

export function endTouch(touches: Touches, callId: string, isAnswered: boolean): void {
  const call = touches.calls.get(callId)
  if (call === undefined) return
  touches.calls.delete(callId)
  if (!isAnswered) return
  const { kind, agent, at, path } = call
  kept(touches, path, { kind, agent, at })
  touches.sights.set(agent, { kind, agent, at, path, hidden: 0, source: 'call' })
}

export function revealSearch(
  touches: Touches,
  search: { agent: string; at: number; paths: readonly string[] },
): void {
  const revealed = [...new Set(search.paths)]
  const shown = revealed.slice(0, REVEALED_PER_SEARCH)
  const first = shown[0]
  if (first === undefined) return
  const touch: Touch = { kind: 'read', agent: search.agent, at: search.at }
  for (const path of shown) kept(touches, path, touch)
  touches.sights.set(search.agent, {
    ...touch,
    path: first,
    hidden: revealed.length - shown.length,
    source: 'Grep',
  })
}

export function touchesOf(touches: Touches, path: string): Touch[] {
  return [...new Set(touches.files.get(path)?.values() ?? [])].sort((a, b) => b.at - a.at)
}

function isNewer(touch: Touch, than: Touch | undefined): boolean {
  return than === undefined || touch.at >= than.at
}

export type Window = { from: number; to: number }

export function editorsOf(touches: Touches, path: string, window: Window): string[] {
  const done = [...(touches.files.get(path)?.values() ?? [])].filter(
    (touch) =>
      touch.kind === 'edit' &&
      touch.shell === undefined &&
      touch.at >= window.from &&
      touch.at <= window.to,
  )
  const running = [...touches.calls.values()].filter(
    (call) => call.path === path && call.kind === 'edit',
  )
  return [...done, ...running].map((touch) => touch.agent)
}

export function markShell(
  touches: Touches,
  change: { paths: readonly string[]; agents: readonly string[]; at: number },
): void {
  const agents = agentOrder(change.agents)
  const first = agents[0]
  const paths = [...new Set(change.paths)].sort()
  const firstPath = paths[0]
  if (first === undefined || firstPath === undefined) return
  const touch: Touch = { kind: 'edit', agent: first, at: change.at, shell: agents }
  for (const path of paths) {
    for (const agent of agents) {
      const own = touches.files.get(path)?.get(agent)
      const isOwnEdit = agents.length > 1 && own?.kind === 'edit' && own.shell === undefined
      if (!isOwnEdit && isNewer(touch, own)) kept(touches, path, touch, agent)
    }
  }
  if (agents.length !== 1 || !isNewer(touch, touches.sights.get(first))) return
  touches.sights.set(first, {
    ...touch,
    path: firstPath,
    hidden: paths.length - 1,
    source: 'Bash',
  })
}

function filesWithCalls(touches: Touches): Map<string, Map<string, Touch>> {
  const files = new Map([...touches.files].map(([path, byAgent]) => [path, new Map(byAgent)]))
  for (const { path, ...touch } of touches.calls.values()) {
    const byAgent = files.get(path) ?? new Map<string, Touch>()
    if (isNewer(touch, byAgent.get(touch.agent))) byAgent.set(touch.agent, touch)
    files.set(path, byAgent)
  }
  return files
}

function sightsWithCalls(touches: Touches): Map<string, Sight> {
  const sights = new Map(touches.sights)
  for (const call of touches.calls.values()) {
    if (isNewer(call, sights.get(call.agent))) {
      sights.set(call.agent, { ...call, hidden: 0, source: 'call' })
    }
  }
  return sights
}

function latest(touches: Iterable<Touch>): Touch | undefined {
  let found: Touch | undefined
  for (const touch of touches) if (isNewer(touch, found)) found = touch
  return found
}

function othersOf(byAgent: ReadonlyMap<string, Touch>, touch: Touch): number {
  const own = new Set(touch.shell ?? [touch.agent])
  return [...byAgent.keys()].filter((agent) => !own.has(agent)).length
}

function markOf(byAgent: ReadonlyMap<string, Touch>, agent: string | undefined): Mark | undefined {
  const own = agent === undefined ? [...byAgent.values()] : [byAgent.get(agent)]
  const touch = latest(own.filter((one) => one !== undefined))
  if (touch === undefined) return undefined
  return { ...touch, others: agent === undefined ? othersOf(byAgent, touch) : 0 }
}

function parentOf(path: string): string | undefined {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? undefined : path.slice(0, cut)
}

function folderMarks(files: ReadonlyMap<string, Mark>): Map<string, Mark> {
  const folders = new Map<string, Mark>()
  for (const [path, mark] of files) {
    for (let folder: string | undefined = path; folder !== undefined; folder = parentOf(folder)) {
      if (isNewer(mark, folders.get(folder))) folders.set(folder, { ...mark, others: 0 })
    }
  }
  return folders
}

function agentOrder(agents: Iterable<string>): string[] {
  const unique = [...new Set(agents)]
  return [
    ...unique.filter((agent) => agent === MAIN_AGENT),
    ...unique.filter((agent) => agent !== MAIN_AGENT),
  ]
}

export function touchView(touches: Touches, agent: string | undefined): TouchView {
  const files = new Map<string, Mark>()
  for (const [path, byAgent] of filesWithCalls(touches)) {
    const mark = markOf(byAgent, agent)
    if (mark !== undefined) files.set(path, mark)
  }
  const sights = sightsWithCalls(touches)
  const agents = agentOrder(sights.keys())
  const shown = agent === undefined ? agents : agents.filter((one) => one === agent)
  return {
    files,
    folders: folderMarks(files),
    sights: shown.flatMap((one) => sights.get(one) ?? []),
    agents,
  }
}
