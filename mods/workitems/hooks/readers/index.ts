import type { FsEntry, ProcessRunResult } from 'claude-code'
import type {
  WorkitemsAdapterWrites,
  WorkitemsFailedReason,
  WorkitemsItem,
  WorkitemsWriteVerbs,
} from '../../types'
import type { Approvals, FileDigest } from '../approval'
import { createAdapterReader } from './adapter'
import { basiclyReader } from './basicly'
import { beadsReader } from './beads'
import { beansReader } from './beans'
import { filesReader } from './generic'

export type TrackerCommands = {
  canRun: () => Promise<boolean>
  run: (
    argv: readonly string[],
    env?: Readonly<Record<string, string>>,
  ) => Promise<ProcessRunResult>
  which: (program: string) => Promise<string | undefined>
  approvals: Approvals
}

export type TrackerFiles = {
  root: string
  read: (relativePath: string) => Promise<string>
  exists: (relativePath: string) => Promise<boolean>
  list: (relativeDirectory: string) => Promise<FsEntry[]>
  realPath: (relativePath: string) => Promise<string | undefined>
  stat: (
    relativePath: string,
  ) => Promise<{ size: number; mtimeMs: number; kind?: 'file' | 'dir' | 'other' }>
  hash: (relativePath: string) => Promise<FileDigest | undefined>
  commands: TrackerCommands
}

export type ReadOutcome =
  | {
      ok: true
      items: WorkitemsItem[]
      sourceLabel: string
      caveat: string | null
      adapterWrites?: WorkitemsAdapterWrites
    }
  | { ok: false; reason: WorkitemsFailedReason }
  | { ok: false; state: 'approval-needed'; command: string; sourceLabel: string }
  | { ok: false; state: 'terminal-only'; sourceLabel: string }

export type Reader = {
  name: string
  marker: string
  lookedForAs?: string
  listsOpenOnly?: true
  isPresent?: (files: TrackerFiles) => Promise<boolean>
  signature?: (files: TrackerFiles) => Promise<string>
  read: (files: TrackerFiles) => Promise<ReadOutcome>
}

export function createReaders(): readonly Reader[] {
  return [basiclyReader, beadsReader, beansReader, filesReader, createAdapterReader()]
}

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
