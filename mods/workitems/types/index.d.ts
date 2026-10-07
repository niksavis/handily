export type WorkitemsState =
  'ok' | 'failed' | 'approval-needed' | 'stale' | 'no-tracker' | 'terminal-only'

export type WorkitemsStatus = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed' | 'other'

export type WorkitemsItem = {
  key: `${string}:${string}`
  id: string
  title: string
  status: WorkitemsStatus
  rawStatus: string
  priority: number | null
  type: string | null
  assignee: string | null
  updatedAt: string | null
  source: string
  url?: string
  labels?: readonly string[]
  parent?: string
}

export type WorkitemsFailedReason =
  | `${string} exited ${number}. Run it in a shell to see why.`
  | `${string} is over 4 MiB.`
  | `${string} output was cut off.`
  | `the adapter says contract ${number}; handily reads contract 1.`
  | `${string} line ${number} is malformed.`
  | `${string} could not be read.`

export type WorkitemsSnapshotBase = {
  at: number
  root: string
  items: readonly WorkitemsItem[]
  ignored: readonly string[]
  version: number
  checkedAt: number
}

export type WorkitemsSourced = {
  source: string
  sourceLabel: string
  caveat: string | null
}

export type WorkitemsUnsourced = {
  source: null
  sourceLabel: null
  caveat: null
}

export type WorkitemsSnapshot = WorkitemsSnapshotBase &
  (
    | ({ state: 'ok'; reason: null } & WorkitemsSourced)
    | ({ state: 'failed'; reason: WorkitemsFailedReason } & WorkitemsSourced)
    | ({ state: 'stale'; reason: string } & WorkitemsSourced)
    | ({ state: 'approval-needed'; reason: string } & WorkitemsSourced)
    | ({ state: 'terminal-only'; reason: null } & WorkitemsSourced)
    | ({ state: 'no-tracker'; reason: `looked for ${string}` } & WorkitemsUnsourced)
  )

export type WorkitemsDiff = {
  created: readonly WorkitemsItem[]
  updated: readonly WorkitemsItem[]
  closed: readonly WorkitemsItem[]
}

export type WorkitemsWriteVerbs = {
  readonly br: readonly [
    'close',
    'create',
    'defer',
    'delete',
    'q',
    'reopen',
    'undefer',
    'update',
    'comments add',
    'dep add',
    'dep remove',
    'dep import',
    'label add',
    'label remove',
    'label rename',
    'epic close-eligible',
  ]
  readonly 'basicly tracker': readonly [
    'close',
    'comments add',
    'create',
    'dep add',
    'dep remove',
    'gate report',
    'update',
  ]
  readonly '.basicly/core/kit/tracker/cli.py': readonly [
    'create',
    'compact',
    'sync',
    'import',
    'migrate-fields',
    'child',
    'update',
    'close',
    'comment',
    'dep',
    'undep',
    'assign',
    'claim',
    'resolve',
    'unassign',
    'delete',
  ]
}

export type WorkitemsLineTone = 'dim' | 'warning' | 'error'

export type WorkitemsLineTexts = {
  header:
    | `${string} · ${number} open · read ${string} ago`
    | `${string} · ${number} open · read ${string} ago · may be stale: ${string}`
  ignored: `Using ${string}; ignoring ${string}. Name one in .handily.json to change it.`
  stale: `Work items may be out of date: last good read ${string} ago (${string}).`
  failed: `Work items unavailable: ${WorkitemsFailedReason}`
  'approval-needed': `Work items need your approval to run ${string}.`
  'approval-hint': 'Asked at the next refresh in an interactive session.'
  'no-tracker': `No tracker found at the repo root (${string}).`
  'terminal-only': `${string} is read through a CLI, which only a terminal session can run. Open this repo in a terminal to see its items.`
}

export type WorkitemsLine = {
  [K in keyof WorkitemsLineTexts]: { kind: K; tone: WorkitemsLineTone; text: WorkitemsLineTexts[K] }
}[keyof WorkitemsLineTexts]

export type WorkitemsRefreshArgs = {
  since?: number
}

export type WorkitemsLinesArgs = {
  snapshot: WorkitemsSnapshot
  now: number
}

export type Workitems = {
  refresh: (args?: WorkitemsRefreshArgs) => Promise<WorkitemsDiff>
  writeVerbs: () => Promise<WorkitemsWriteVerbs>
  lines: (args: WorkitemsLinesArgs) => Promise<readonly WorkitemsLine[]>
}

declare module 'claude-code' {
  interface EngineInterface {
    workitems: Workitems
  }
  interface PluginState {
    workitems: { snapshot: WorkitemsSnapshot }
  }
}
