import { update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'
import { agentOfFilter, labelsOf } from './agents'
import {
  FILES_PANE,
  type TreeUi,
  closeTree,
  parseTreeCommand,
  toggleTree,
  unknownReply,
} from './commands'
import { gitView } from './gitview'
import type { LookSite } from './look'
import { lookActionsOf, newLooking, resetLooking } from './looking'
import { drawLook } from './lookpane'
import { markColumnOf } from './marks'
import { type PaneActions, type TouchDraw, drawInline, drawTree } from './pane'
import { absolutePath, resolvedPath, shownPath } from './paths'
import { reasonOf } from './reason'
import { type GitMarks, gitMarks } from './status'
import { type ListFolder, type Listing, ROOT_PATH, listed, treeRows, withDeleted } from './tree'
import { showToast } from './toast'
import { type ToolTouch, isAnswered, searchedFiles, toolTouchOf } from './toolcall'
import {
  MAIN_AGENT,
  type Touches,
  beginTouch,
  clearTouches,
  endTouch,
  newTouches,
  revealSearch,
  touchView,
  touchesOf,
} from './touches'
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
const CHANGING_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Edit', 'Write'])
const BOARD_AGENTS = { plugin: 'handily-board', key: 'agents' } as const

type AgentFilter = { picked: string | undefined }

function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part !== '')
  return parts.at(-1) ?? cwd
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

type BaseActions = Pick<PaneActions, 'toggle' | 'showAll' | 'refresh' | 'retry'>

function actionsOf(
  $: EngineInterface,
  cwd: string,
  listings: Listings,
  watch: GitWatch,
): BaseActions {
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

function redraw($: EngineInterface): void {
  $.ui.invalidate('ui.render')
}

function lookSiteOf(watch: GitWatch, cwd: string): LookSite {
  const { repo, shown } = watch
  if (repo === null || repo === undefined) return { cwd, prefix: '', marks: undefined }
  const marks = shown === undefined ? undefined : gitMarks(shown.status, repo.prefix)
  return { cwd, prefix: repo.prefix, marks }
}

type SeenCall = { touch: ToolTouch; agent: string; cwd: string }

async function seenCallOf($: EngineInterface, e: ToolCallInput): Promise<SeenCall | undefined> {
  const touch = toolTouchOf(e)
  if (touch === undefined) return undefined
  return { touch, agent: e.agentId ?? MAIN_AGENT, cwd: await $.session.cwd() }
}

async function beginCall(
  $: EngineInterface,
  touches: Touches,
  callId: string,
  seen: SeenCall,
): Promise<void> {
  if (seen.touch.kind !== 'file') return
  const path = resolvedPath(seen.cwd, seen.touch.path)
  beginTouch(touches, callId, {
    kind: seen.touch.touch,
    agent: seen.agent,
    at: await $.clock.now(),
    path,
  })
  redraw($)
}

async function endCall(
  $: EngineInterface,
  touches: Touches,
  call: { id: string; seen: SeenCall; answer: ToolCallResult | undefined },
): Promise<void> {
  const { id, seen, answer } = call
  const answered = answer !== undefined && isAnswered(answer)
  endTouch(touches, id, answered)
  if (answered && seen.touch.kind === 'search') {
    const paths = searchedFiles(answer.result).map((path) => resolvedPath(seen.cwd, path))
    revealSearch(touches, { agent: seen.agent, at: await $.clock.now(), paths })
  }
  redraw($)
}

async function touchDrawOf(
  $: EngineInterface,
  site: { cwd: string; bodyColumns: number; inView: string | undefined },
  touches: Touches,
  filter: AgentFilter,
): Promise<TouchDraw> {
  const { cwd, inView } = site
  const agent = inView ?? filter.picked
  const touched = touchView(touches, agent)
  return {
    column: markColumnOf(site.bodyColumns),
    fileMark: (path) => touched.files.get(resolvedPath(cwd, path)),
    folderMark: (path) => touched.folders.get(resolvedPath(cwd, path)),
    labelOf: labelsOf((await $.state.get(BOARD_AGENTS)).value),
    touchesOf: (path) => touchesOf(touches, resolvedPath(cwd, path)),
    shownPath: (path) => shownPath(cwd, path),
    sights: touched.sights,
    agents: touched.agents,
    agent,
    inView,
    pick: (value) => {
      filter.picked = agentOfFilter(value)
      redraw($)
    },
    now: await $.clock.now(),
  }
}

export const register: Register = (on) => {
  const listings: Listings = new Map()
  const watch = newWatch()
  const touches = newTouches()
  const filter: AgentFilter = { picked: undefined }
  const looking = newLooking()

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
    clearTouches(touches)
    resetLooking(looking)
    filter.picked = undefined
    return next(e)
  })

  on('ui.close', async (_$, e, next) => {
    const closed = await next(e)
    if (e.id === FILES_PANE.id) {
      listings.clear()
      stopWatch(watch)
      resetLooking(looking)
    }
    return closed
  })

  on('tool.call', async ($, e, next) => {
    const seen = await seenCallOf($, e)
    if (seen !== undefined) await beginCall($, touches, e.tool_use_id, seen)
    let answer: ToolCallResult | undefined
    try {
      answer = await next(e)
      return answer
    } finally {
      if (seen !== undefined) await endCall($, touches, { id: e.tool_use_id, seen, answer })
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
    const resolved = $.ui.resolve(e)
    const { Box, Text, Button, Code, Markdown } = resolved
    const Select = 'Select' in resolved ? resolved.Select : undefined
    const { bodyColumns } = e.props
    const elements = { Box, Text, Button, Select, Code, Markdown, bodyColumns }
    const cwd = await $.session.cwd()
    await syncRepo($, watch, cwd)
    watchShown($, watch)
    noticeFocus($, watch, e.props.isFocused)
    const git = gitView(watch, await $.clock.now())
    const rootName = folderName(cwd)
    const list = listerOf($, cwd, listings, git.marks)
    const site = { cwd, bodyColumns, inView: e.props.view.agentId }
    const view = {
      git,
      actions: {
        ...actionsOf($, cwd, listings, watch),
        ...lookActionsOf($, looking, () => lookSiteOf(watch, cwd)),
      },
      touched: await touchDrawOf($, site, touches, filter),
      opened: looking.opened,
    }
    if (e.props.placement === 'inline') {
      return drawInline(elements, rootName, await list(ROOT_PATH), view)
    }
    if (looking.look !== undefined) return drawLook({ ...view, elements }, rootName, looking.look)
    const open = new Set((await $.state.get(OPEN)).value ?? [])
    const whole = new Set((await $.state.get(WHOLE)).value ?? [])
    const rows = await treeRows(list, { open, whole }, rootName)
    return drawTree(elements, rootName, rows, view)
  })
}
