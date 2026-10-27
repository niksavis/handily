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
import { type PaneActions, drawInline, drawTree } from './pane'
import { type ListFolder, type Listing, ROOT_PATH, listed, treeRows } from './tree'
import { showToast } from './toast'
import type { FiletreePaths } from '../types'

const OPEN = { plugin: 'handily-filetree', key: 'open' } as const
const WHOLE = { plugin: 'handily-filetree', key: 'whole' } as const
const PERMISSION_DENIED = /\b(EACCES|EPERM)\b/
const GONE = /\bENOENT\b/

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

function listerOf($: EngineInterface, cwd: string, listings: Listings): ListFolder {
  return async (path) => {
    const at = absolutePath(cwd, path)
    const kept = listings.get(at)
    if (kept !== undefined) return kept
    const listing = await readListing($, at, path)
    listings.set(at, listing)
    return listing
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

function actionsOf($: EngineInterface, cwd: string, listings: Listings): PaneActions {
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
      $.ui.invalidate('ui.render')
    },
  }
}

export const register: Register = (on) => {
  const listings: Listings = new Map()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tree',
      description: 'handily · Show the files tab: the working folder as a tree',
      argumentHint: '[close]',
      immediate: true,
    })
    return next(e)
  })

  on('session.end', async (_$, e, next) => {
    listings.clear()
    return next(e)
  })

  on('ui.close', async (_$, e, next) => {
    const closed = await next(e)
    if (e.id === FILES_PANE.id) listings.clear()
    return closed
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
    const rootName = folderName(cwd)
    const list = listerOf($, cwd, listings)
    const actions = actionsOf($, cwd, listings)
    if (e.props.placement === 'inline') {
      return drawInline(elements, rootName, await list(ROOT_PATH), actions)
    }
    const open = new Set((await $.state.get(OPEN)).value ?? [])
    const whole = new Set((await $.state.get(WHOLE)).value ?? [])
    const rows = await treeRows(list, { open, whole }, rootName)
    return drawTree(elements, rootName, rows, actions)
  })
}
