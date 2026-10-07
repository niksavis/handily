import type { WorkitemsFailedReason, WorkitemsItem, WorkitemsWriteVerbs } from '../../types'
import { beadsReader } from './beads'

export type TrackerFiles = {
  read: (relativePath: string) => Promise<string>
  exists: (relativePath: string) => Promise<boolean>
}

export type ReadOutcome =
  | { ok: true; items: WorkitemsItem[]; sourceLabel: string; caveat: string | null }
  | { ok: false; reason: WorkitemsFailedReason }

export type Reader = {
  name: string
  marker: string
  read: (files: TrackerFiles) => Promise<ReadOutcome>
}

export const readers: readonly Reader[] = [beadsReader]

export const writeVerbs: WorkitemsWriteVerbs = {
  br: [
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
  ],
  'basicly tracker': [
    'close',
    'comments add',
    'create',
    'dep add',
    'dep remove',
    'gate report',
    'update',
  ],
  '.basicly/core/kit/tracker/cli.py': [
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
  ],
}
