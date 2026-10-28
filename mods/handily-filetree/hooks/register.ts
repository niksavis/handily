import { update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import {
  FILES_PANE,
  type TreeUi,
  closeTree,
  parseTreeCommand,
  toggleTree,
  unknownReply,
} from './commands'
import { gitView } from './gitview'
import { type PaneActions, drawInline, drawTree } from './pane'
import type { GitMarks } from './status'
import { type ListFolder, type Listing, ROOT_PATH, listed, treeRows, withDeleted } from './tree'
import { showToast } from './toast'
import {
  type GitWatch,
  forgetRepo,
  newWatch,
  noticeFocus,
  requestStatus,
  resetWatch,
  stopWatch,
  syncRepo,
  watchShown,
} from './watch'
import type { FiletreePaths } from '../types'

const OPEN = { plugin: 'handily-filetree', key: 'open' } as const
const WHOLE = { plugin: 'handily-filetree', key: 'whole' } as const
const PERMISSION_DENIED = /\b(EACCES|EPERM)\b/
const GONE = /\bENOENT\b/
const CHANGING_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Edit', 'Write'])

function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part !== '')
  return parts.at(-1) ?? cwd
}

function reasonOf(error: unknown): string {
  const text = String(error)
  if (PERMISSION_DENIED.test(text)) return 'permission denied'
  if (GONE.test(text)) return 'it is not there any more'
  return 'see the transcript log'
}

function absolutePath(cwd: string, path: string): string {
  if (path === ROOT_PATH) return cwd
  return /[\\/]$/.test(cwd) ? `${cwd}${path}` : `${cwd}/${path}`
}

type Listings = Map<string, Listing>

async function readListing($: EngineInterface, at: string, path: string): Promise<Listing> {
  try {
    return listed(await $.fs.list(at))
  } catch (error) {
    $.ui.log(`handily-filetree: cannot list ${path}: ${String(error)}`)
    return { kind: 'failed', reason: reasonOf(error) }
  }
}

async function keptListing(
  $: EngineInterface,
  at: string,
  path: string,
  listings: Listings,
): Promise<Listing> {
  const kept = listings.get(at)
  if (kept !== undefined) return kept
  const listing = await readListing($, at, path)
  listings.set(at, listing)
  return listing
}

function listerOf(
  $: EngineInterface,
  cwd: string,
  listings: Listings,
  marks: GitMarks | undefined,
): ListFolder {
  return async (path) => {
    const listing = await keptListing($, absolutePath(cwd, path), path, listings)
    if (marks === undefined) return listing
    return withDeleted(listing, marks.deletedIn(path), marks.isDeletedFolder(path))
  }
}

function treeUiOf($: EngineInterface): TreeUi {
  return {
    open: (focus) => $.ui.open(focus ? { ...FILES_PANE, focus } : { ...FILES_PANE }),
    close: () => $.ui.close({ id: FILES_PANE.id }),
    panes: () => $.ui.panes(),
  }
}

function toggled(paths: FiletreePaths, path: string): FiletreePaths {
  return paths.includes(path) ? paths.filter((one) => one !== path) : [...paths, path]
}

function actionsOf(
  $: EngineInterface,
  cwd: string,
  listings: Listings,
  watch: GitWatch,
): PaneActions {
  const failed = (error: unknown) => {
    $.ui.log(`handily-filetree: the tree did not change: ${String(error)}`)
    showToast($, ['■ Tree did not change', 'the transcript shows why'])
  }
  return {
    toggle: (path) => {
      update($, OPEN, (current = []) => {
        if (!current.includes(path)) listings.delete(absolutePath(cwd, path))
        return toggled(current, path)
      }).catch(failed)
    },
    showAll: (path) => {
      update($, WHOLE, (current = []) =>
        current.includes(path) ? current : [...current, path],
      ).catch(failed)
    },
    refresh: () => {
      listings.clear()
      forgetRepo(watch)
      $.ui.invalidate('ui.render')
    },
    retry: () => {
      requestStatus($, watch)
    },
  }
}

export const register: Register = (on) => {
  const listings: Listings = new Map()
  const watch = newWatch()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tree',
      description: 'handily · Show the files tab: the working folder as a tree',
      argumentHint: '[close]',
      immediate: true,
    })
    await $.state.set({ plugin: 'handily-filetree', key: 'ready' }, { root: $.plugin.root })
    return next(e)
  })

  on('session.end', async (_$, e, next) => {
    listings.clear()
    resetWatch(watch)
    return next(e)
  })

  on('ui.close', async (_$, e, next) => {
    const closed = await next(e)
    if (e.id === FILES_PANE.id) {
      listings.clear()
      stopWatch(watch)
    }
    return closed
  })

  on('tool.call', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (CHANGING_TOOLS.has(e.tool)) requestStatus($, watch)
    }
  })

  on('prompt.submit', async ($, e, next) => {
    requestStatus($, watch)
    return next(e)
  })

  on('command.run', { command: 'tree' }, async ($, e) => {
    const command = parseTreeCommand(e.args)
    switch (command.kind) {
      case 'toggle':
        return { text: await toggleTree(treeUiOf($)) }
      case 'close':
        return { text: await closeTree(treeUiOf($)) }
      case 'unknown':
        return { text: unknownReply(command.word) }
    }
  }).catch(($, _e, next) => {
    $.ui.log(
      `handily-filetree: /tree failed (${next.error.kind}): ${next.error.message ?? 'no message'}`,
    )
    return { text: 'handily-filetree: /tree failed; see the transcript log.' }
  })

  on('ui.render', { component: 'Pane', requestId: FILES_PANE.id }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const elements = { Box, Text, Button, bodyColumns: e.props.bodyColumns }
    const cwd = await $.session.cwd()
    await syncRepo($, watch, cwd)
    watchShown($, watch)
    noticeFocus($, watch, e.props.isFocused)
    const git = gitView(watch, await $.clock.now())
    const rootName = folderName(cwd)
    const list = listerOf($, cwd, listings, git.marks)
    const view = { git, actions: actionsOf($, cwd, listings, watch) }
    if (e.props.placement === 'inline') {
      return drawInline(elements, rootName, await list(ROOT_PATH), view)
    }
    const open = new Set((await $.state.get(OPEN)).value ?? [])
    const whole = new Set((await $.state.get(WHOLE)).value ?? [])
    const rows = await treeRows(list, { open, whole }, rootName)
    return drawTree(elements, rootName, rows, view)
  })
}
