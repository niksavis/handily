import { update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'
import { agentOfFilter, labelsOf } from './agents'
import {
  FILES_PANE,
  type TreeUi,
  badEditsReply,
  badTaskReply,
  closeTree,
  noEditReply,
  parseTreeCommand,
  showEdit,
  showTask,
  toggleTree,
  unknownReply,
} from './commands'
import {
  type Edits,
  clearEdits,
  closeSteps,
  editChangeOf,
  endMainTurn,
  isEditTool,
  isNewerEnded,
  newEdits,
  noteEdit,
  readLastTurn,
  shownStep,
} from './edits'
import { type GitView, gitView } from './gitview'
import type { LookSite } from './look'
import { type Looking, lookActionsOf, newLooking, resetLooking } from './looking'
import { drawLook } from './lookpane'
import { markColumnOf } from './marks'
import {
  type LastTurnDraw,
  type PaneActions,
  type TaskDraw,
  type TouchDraw,
  drawInline,
  drawTree,
} from './pane'
import { absolutePath, insidePath, resolvedPath, shownPath } from './paths'
import { reasonOf } from './reason'
import {
  type ListingSite,
  type Listings,
  type Shell,
  type Snapshot,
  beginShellRun,
  clearShell,
  endShellRun,
  endTurn,
  gitBaseline,
  judgeListing,
  listingSnapshot,
  newShell,
} from './shellmarks'
import { type GitMarks, gitMarks } from './status'
import { type StepActions, drawInlineSteps, drawSteps } from './steps'
import {
  type ListFolder,
  type Listing,
  type TreeRow,
  ROOT_PATH,
  listed,
  treeRows,
  withDeleted,
} from './tree'
import { marked } from './toast'
import { keepChangedGlyphSetting, keepGlyphSetting, paneGlyphs, showGlyphToast } from './toasting'
import { type ToolTouch, isAnswered, searchedFiles, toolTouchOf } from './toolcall'
import {
  MAIN_AGENT,
  type Mark,
  type Touches,
  beginTouch,
  clearTouches,
  endTouch,
  newTouches,
  noteClocks,
  revealSearch,
  taskTouches,
  touchView,
  touchesOf,
} from './touches'
import {
  type GitWatch,
  forgetRepo,
  freshStatus,
  newWatch,
  noteChange,
  noticeFocus,
  requestStatus,
  resetWatch,
  stopWatch,
  syncRepo,
  watchShown,
} from './watch'
import { type WorkSource, type WorkTree, nowFirst, workPaths, workRows, workTree } from './work'
import type { FiletreePaths } from '../types'

const OPEN = { plugin: 'handily-filetree', key: 'open' } as const
const WHOLE = { plugin: 'handily-filetree', key: 'whole' } as const
const SHUT = { plugin: 'handily-filetree', key: 'shut' } as const
const WORK_WHOLE = { plugin: 'handily-filetree', key: 'workWhole' } as const
const VIEW = { plugin: 'handily-filetree', key: 'view' } as const
const CHANGING_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Edit', 'Write'])
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])
const BOARD_AGENTS = { plugin: 'handily-board', key: 'agents' } as const
const BOARD_ACTIVITY = { plugin: 'handily-board', key: 'activity' } as const
const BOARD_LIST = { plugin: 'handily-board', key: 'list' } as const

type AgentFilter = { picked: string | undefined; task: number | undefined }

function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part !== '')
  return parts.at(-1) ?? cwd
}

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

type BaseActions = Pick<PaneActions, 'toggle' | 'showAll' | 'refresh' | 'retry' | 'switchView'>

function actionsOf(
  $: EngineInterface,
  site: { cwd: string; listings: Listings; watch: GitWatch; work: WorkTree | undefined },
): BaseActions {
  const { cwd, listings, watch, work } = site
  const failed = (error: unknown) => {
    $.ui.log(`handily-filetree: the tree did not change: ${String(error)}`)
    showGlyphToast($, [marked('blocked', 'Tree did not change'), 'the transcript shows why'])
  }
  return {
    toggle: (path) => {
      if (work?.folders.has(path) === true) {
        update($, SHUT, (current = []) => toggled(current, path)).catch(failed)
        return
      }
      update($, OPEN, (current = []) => {
        if (!current.includes(path)) listings.delete(absolutePath(cwd, path))
        return toggled(current, path)
      }).catch(failed)
    },
    showAll: (path) => {
      const added = (current: FiletreePaths = []) =>
        current.includes(path) ? current : [...current, path]
      if (work === undefined) update($, WHOLE, added).catch(failed)
      else update($, WORK_WHOLE, added).catch(failed)
    },
    refresh: () => {
      listings.clear()
      forgetRepo(watch)
      $.ui.invalidate('ui.render')
    },
    retry: () => {
      requestStatus($, watch)
    },
    switchView: () => {
      update($, VIEW, (current = 'work') => (current === 'work' ? 'all' : 'work')).catch(failed)
    },
  }
}

function redraw($: EngineInterface): void {
  $.ui.invalidate('ui.render')
}

function shownFolders(cwd: string, open: readonly string[]): Set<string> {
  const opened = new Set(open)
  const isShown = (path: string): boolean => {
    const cut = path.lastIndexOf('/')
    return opened.has(path) && (cut < 0 || isShown(path.slice(0, cut)))
  }
  const shown = open.filter(isShown).map((path) => absolutePath(cwd, path))
  return new Set([absolutePath(cwd, ROOT_PATH), ...shown])
}

type ShellContext = { shell: Shell; watch: GitWatch; listings: Listings }

async function listingSiteOf(
  $: EngineInterface,
  context: ShellContext,
): Promise<ListingSite | undefined> {
  const { watch, listings } = context
  if (watch.repo !== null || watch.cwd === undefined || listings.size === 0) return undefined
  const { cwd } = watch
  const open = (await $.state.get(OPEN)).value ?? []
  return {
    cwd,
    listings,
    shown: shownFolders(cwd, open),
    relist: (at) => readListing($, at, at),
  }
}

async function baselineOf(
  $: EngineInterface,
  context: ShellContext,
): Promise<Snapshot | undefined> {
  const { shell, watch } = context
  if (watch.repo === null) {
    const site = await listingSiteOf($, context)
    return site === undefined ? undefined : listingSnapshot($, site)
  }
  const shown = await freshStatus($, watch)
  return gitBaseline(shell, shown?.startedAt)
}

async function beginShell(
  $: EngineInterface,
  context: ShellContext,
  e: ToolCallInput,
): Promise<boolean> {
  if (!SHELL_TOOLS.has(e.tool)) return false
  const baseline = await baselineOf($, context)
  beginShellRun(context.shell, {
    id: e.tool_use_id,
    agent: e.agentId ?? MAIN_AGENT,
    baseline,
    startedAt: await $.clock.now(),
  })
  return true
}

async function endShell(
  $: EngineInterface,
  context: ShellContext,
  call: { id: string; answer: ToolCallResult | undefined },
): Promise<void> {
  const { shell } = context
  endShellRun(shell, {
    id: call.id,
    hasRun: call.answer?.deny === undefined,
    endedAt: await $.clock.now(),
  })
  const site = await listingSiteOf($, context)
  if (site !== undefined) await judgeListing($, shell, site)
}

async function noteEditCall(
  $: EngineInterface,
  edits: Edits,
  call: { tool: string; seen: SeenCall | undefined; answer: ToolCallResult | undefined },
): Promise<void> {
  const { tool, seen, answer } = call
  if (!isEditTool(tool) || seen?.touch.kind !== 'file') return
  if (answer === undefined || !isAnswered(answer)) return
  noteEdit(edits, {
    path: resolvedPath(seen.cwd, seen.touch.path),
    agent: seen.agent,
    tool,
    at: await $.clock.now(),
    change: editChangeOf(tool, answer.result),
  })
}

function openSteps($: EngineInterface, site: { edits: Edits; looking: Looking }, at: number): void {
  const { edits, looking } = site
  looking.look = undefined
  looking.generation += 1
  readLastTurn(edits, at)
  redraw($)
}

function lastTurnOf(
  $: EngineInterface,
  site: { edits: Edits; looking: Looking },
): LastTurnDraw | undefined {
  const { edits } = site
  const { last } = edits
  if (last === undefined) return undefined
  return {
    total: last.total,
    isNoteShown: edits.isNoteShown,
    press: () => {
      if (last.edits.length > 0) {
        openSteps($, site, 1)
        return
      }
      edits.isNoteShown = !edits.isNoteShown
      redraw($)
    },
  }
}

function stepActionsOf(
  $: EngineInterface,
  site: { edits: Edits; looking: Looking },
  copy: PaneActions['copy'],
): StepActions {
  const { edits } = site
  return {
    newest: () => {
      openSteps($, site, 1)
    },
    move: (at) => {
      const step = shownStep(edits.reading, at)
      if (step === undefined || step === edits.at) return
      edits.at = step
      redraw($)
    },
    back: () => {
      closeSteps(edits)
      redraw($)
    },
    copy,
  }
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

async function noteBoardClocks($: EngineInterface, touches: Touches): Promise<void> {
  noteClocks(touches, (await $.state.get(BOARD_ACTIVITY)).value?.clocks ?? {})
}

async function taskDrawOf(
  $: EngineInterface,
  id: number,
  files: Iterable<Mark>,
  filter: AgentFilter,
): Promise<TaskDraw> {
  const tasks = (await $.state.get(BOARD_LIST)).value?.tasks ?? []
  const counts = { edit: 0, read: 0 }
  for (const mark of files) if (mark.isFolder !== true) counts[mark.kind] += 1
  return {
    id,
    title: tasks.find((task) => task.id === id)?.title ?? null,
    counts,
    clear: () => {
      filter.task = undefined
      redraw($)
    },
  }
}

async function touchDrawOf(
  $: EngineInterface,
  site: { cwd: string; bodyColumns: number; inView: string | undefined; task: number | undefined },
  touches: Touches,
  filter: AgentFilter,
): Promise<TouchDraw> {
  const { cwd, inView, task } = site
  const agent = inView ?? filter.picked
  const touched = touchView(task === undefined ? touches : taskTouches(touches, task), agent)
  return {
    column: markColumnOf(site.bodyColumns),
    fileMark: (path) => touched.files.get(resolvedPath(cwd, path)),
    folderMark: (path) => touched.folders.get(resolvedPath(cwd, path)),
    labelOf: labelsOf((await $.state.get(BOARD_AGENTS)).value),
    touchesOf: (path) => touchesOf(touches, resolvedPath(cwd, path)),
    shownPath: (path) => shownPath(cwd, path),
    paths: [...touched.files].flatMap(([path, mark]) => {
      const inside = insidePath(cwd, path)
      return inside === undefined ? [] : [{ path: inside, isFolder: mark.isFolder === true }]
    }),
    sights: touched.sights,
    agents: touched.agents,
    agent,
    inView,
    pick: (value) => {
      filter.picked = agentOfFilter(value)
      redraw($)
    },
    now: await $.clock.now(),
    task:
      task === undefined ? undefined : await taskDrawOf($, task, touched.files.values(), filter),
  }
}

function workSourceOf(git: GitView, touched: TouchDraw): WorkSource {
  if (touched.task !== undefined) return { changed: [], touched: touched.paths, isFiltered: true }
  return {
    changed: git.marks?.changedIn(ROOT_PATH) ?? [],
    touched: touched.paths,
    isFiltered: touched.agent !== undefined,
  }
}

async function rowsOf(
  $: EngineInterface,
  list: ListFolder,
  work: WorkTree | undefined,
  rootName: string,
): Promise<TreeRow[]> {
  const open = new Set((await $.state.get(OPEN)).value ?? [])
  if (work === undefined) {
    const whole = new Set((await $.state.get(WHOLE)).value ?? [])
    return treeRows(list, { open, whole }, rootName)
  }
  const whole = new Set((await $.state.get(WORK_WHOLE)).value ?? [])
  const shut = new Set((await $.state.get(SHUT)).value ?? [])
  return workRows(list, { tree: work, folders: { open, whole, shut } }, rootName)
}

export const register: Register = (on) => {
  const listings: Listings = new Map()
  const touches = newTouches()
  const shell = newShell(touches)
  const watch = newWatch(shell)
  const context = { shell, watch, listings }
  const filter: AgentFilter = { picked: undefined, task: undefined }
  const looking = newLooking()
  const edits = newEdits()
  const stepSite = { edits, looking }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tree',
      description: 'handily · Show the files tab: the working folder as a tree',
      argumentHint: '[close | task <n>]',
      immediate: true,
    })
    await $.state.set({ plugin: 'handily-filetree', key: 'ready' }, { root: $.plugin.root })
    await keepGlyphSetting($)
    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    await keepChangedGlyphSetting($, e)
    return result
  })

  on('session.end', async (_$, e, next) => {
    listings.clear()
    resetWatch(watch)
    clearTouches(touches)
    clearShell(shell)
    resetLooking(looking)
    clearEdits(edits)
    filter.picked = undefined
    filter.task = undefined
    return next(e)
  })

  on('ui.close', async (_$, e, next) => {
    const closed = await next(e)
    if (e.id === FILES_PANE.id) {
      listings.clear()
      stopWatch(watch)
      resetLooking(looking)
      closeSteps(edits)
    }
    return closed
  })

  on('tool.call', async ($, e, next) => {
    const seen = await seenCallOf($, e)
    await noteBoardClocks($, touches)
    if (seen !== undefined) await beginCall($, touches, e.tool_use_id, seen)
    const isShell = await beginShell($, context, e)
    let answer: ToolCallResult | undefined
    try {
      answer = await next(e)
      return answer
    } finally {
      await noteBoardClocks($, touches)
      if (seen !== undefined) await endCall($, touches, { id: e.tool_use_id, seen, answer })
      await noteEditCall($, edits, { tool: e.tool, seen, answer })
      if (isShell) await endShell($, context, { id: e.tool_use_id, answer })
      if (CHANGING_TOOLS.has(e.tool)) {
        noteChange(watch)
        requestStatus($, watch)
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    endTurn(shell, { agent: e.agentId, at: await $.clock.now() })
    if (e.agentId === undefined) {
      endMainTurn(edits)
      redraw($)
    }
    return next(e)
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
      case 'task':
        filter.task = command.id
        redraw($)
        return { text: await showTask(treeUiOf($), command.id) }
      case 'badTask':
        return { text: badTaskReply(command.word) }
      case 'edits': {
        const kept = edits.last?.edits.length ?? 0
        const refused = noEditReply(command.at, {
          kept,
          total: edits.last?.total ?? 0,
          hasEnded: edits.last !== undefined,
        })
        if (refused !== undefined) return { text: refused }
        openSteps($, stepSite, command.at)
        return { text: await showEdit(treeUiOf($), command.at, kept) }
      }
      case 'badEdits':
        return { text: badEditsReply(command.word) }
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
    const glyphs = await paneGlyphs($, e.surface)
    const elements = { Box, Text, Button, Select, Code, Markdown, bodyColumns, glyphs }
    const cwd = await $.session.cwd()
    await syncRepo($, watch, cwd)
    watchShown($, watch)
    noticeFocus($, watch, e.props.isFocused)
    const git = gitView(watch, await $.clock.now(), glyphs)
    const rootName = folderName(cwd)
    const list = listerOf($, cwd, listings, git.marks)
    const isInline = e.props.placement === 'inline'
    const task = isInline ? undefined : filter.task
    const site = { cwd, bodyColumns, inView: e.props.view.agentId, task }
    const touched = await touchDrawOf($, site, touches, filter)
    const choice = isInline ? 'work' : ((await $.state.get(VIEW)).value ?? 'work')
    const isWorkTree = choice === 'work' || task !== undefined
    const tree = isWorkTree ? workTree(workPaths(workSourceOf(git, touched))) : undefined
    const actions = {
      ...actionsOf($, { cwd, listings, watch, work: tree }),
      ...lookActionsOf($, looking, () => lookSiteOf(watch, cwd)),
    }
    const view = {
      git,
      actions,
      touched,
      opened: looking.opened,
      choice,
      lastTurn: lastTurnOf($, stepSite),
    }
    const { reading } = edits
    const step = edits.at === undefined ? undefined : shownStep(reading, edits.at)
    if (reading !== undefined && step !== undefined) {
      const steps = {
        elements,
        git,
        touched,
        last: reading,
        isNewer: isNewerEnded(edits),
        at: step,
        actions: stepActionsOf($, stepSite, actions.copy),
      }
      return isInline ? drawInlineSteps(steps, rootName) : drawSteps(steps, rootName)
    }
    if (tree !== undefined && isInline) {
      const now = touched.sights.map((sight) => touched.shownPath(sight.path))
      const work = nowFirst(tree, now)
      return drawInline(elements, { root: await list(ROOT_PATH), rootName, work }, view)
    }
    if (looking.look !== undefined) return drawLook({ ...view, elements }, rootName, looking.look)
    return drawTree(elements, rootName, await rowsOf($, list, tree, rootName), view)
  })
}
