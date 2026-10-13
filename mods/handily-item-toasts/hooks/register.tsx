import type { EngineInterface, Register, Timer } from 'claude-code'
import type { ItemToastsMode } from '../types'
import { isTrackerWrite, type ToolUse, type TrackerRules } from './match'
import { createToaster, type ToastHost, type Toaster } from './toasts'

const TICK_MS = 2000
const BACKGROUND_LIMIT_MS = 30 * 60 * 1000

type CallResult = Awaited<ReturnType<EngineInterface['tool']['call']>>
type BackgroundTask = { taskId: string | null; limit: Timer }

type Toasts = {
  toaster: Toaster | undefined
  ticks: Timer | undefined
  background: Map<string, BackgroundTask>
  generation: number
}

const TASK_ID_TAG = /<task-id>([^<]*)<\/task-id>/g
const TOOL_USE_ID_TAG = /<tool-use-id>([^<]*)<\/tool-use-id>/g
const NOT_OWN = 'item-toasts: not counting the call as own;'
const COMMAND = 'item-toasts'
const DEFAULT_MODE: ItemToastsMode = 'on'
const MODE = { plugin: 'handily-item-toasts', key: 'mode' } as const
const ON_TEXT = 'item-toasts on for this session. A work item that changes elsewhere draws a toast.'
const OFF_TEXT =
  'item-toasts off for this session. No work item change draws a toast until /item-toasts on.'
const USAGE_TEXT =
  '/item-toasts takes on or off. /item-toasts on and /item-toasts off set this session.'

function hostOf($: EngineInterface): ToastHost {
  return {
    snapshot: async () =>
      (await $.state.get({ plugin: 'handily-workitems', key: 'snapshot' })).value,
    refresh: (since) => $.workitems.refresh({ since }),
    lines: async (snapshot) => $.workitems.lines({ snapshot, now: await $.clock.now() }),
    now: () => $.clock.now(),
    toast: (text) => {
      $.ui.toast(text)
    },
    log: (text) => {
      $.ui.log(text)
    },
    announced: async () =>
      (await $.state.get({ plugin: 'handily-item-toasts', key: 'announced' })).value,
    announce: async (health) => {
      await $.state.set({ plugin: 'handily-item-toasts', key: 'announced' }, health)
    },
    lastToastAt: async () =>
      (await $.state.get({ plugin: 'handily-item-toasts', key: 'lastToastAt' })).value,
    noteToast: async (at) => {
      await $.state.set({ plugin: 'handily-item-toasts', key: 'lastToastAt' }, at)
    },
  }
}

function stopToasts(toasts: Toasts): void {
  toasts.generation += 1
  toasts.ticks?.cancel()
  toasts.ticks = undefined
  toasts.toaster = undefined
  for (const task of toasts.background.values()) task.limit.cancel()
  toasts.background.clear()
}

function startToasts($: EngineInterface, toasts: Toasts): Toaster {
  stopToasts(toasts)
  const toaster = createToaster(hostOf($))
  toasts.toaster = toaster
  toasts.ticks = $.clock.every(TICK_MS, () => {
    toaster.tick().catch((error: unknown) => {
      $.ui.log(`item-toasts: the tick failed: ${String(error)}`)
    })
  })
  return toaster
}

async function isOn($: EngineInterface): Promise<boolean> {
  const { value: mode = DEFAULT_MODE } = await $.state.get(MODE)
  return mode === 'on'
}

async function toasterOf($: EngineInterface, toasts: Toasts): Promise<Toaster | undefined> {
  if (toasts.toaster !== undefined) return toasts.toaster
  return (await isOn($)) ? startToasts($, toasts) : undefined
}

async function setMode($: EngineInterface, toasts: Toasts, mode: ItemToastsMode): Promise<string> {
  await $.state.set(MODE, mode)
  if (mode === 'off') {
    stopToasts(toasts)
    return OFF_TEXT
  }
  if (toasts.toaster === undefined) await startToasts($, toasts).tick()
  return ON_TEXT
}

function rulesOf($: EngineInterface): TrackerRules {
  return {
    classify: (command) => $.workitems.classify(command),
    trackerFile: (args) => $.workitems.trackerFile(args),
  }
}

async function isOwnCall($: EngineInterface, use: ToolUse): Promise<boolean> {
  try {
    return await isTrackerWrite(rulesOf($), use)
  } catch (error) {
    const check = use.tool === 'Bash' ? 'the command check' : 'the tracker file check'
    $.ui.log(`${NOT_OWN} ${check} failed: ${String(error)}`)
    return false
  }
}

function backgroundTaskIdOf(
  isLaunchedInBackground: boolean,
  result: CallResult,
): { taskId: string | null } | null {
  const output: unknown = result.result
  const taskId =
    typeof output === 'object' &&
    output !== null &&
    'backgroundTaskId' in output &&
    typeof output.backgroundTaskId === 'string'
      ? output.backgroundTaskId
      : null
  if (taskId === null && !isLaunchedInBackground) return null
  return { taskId }
}

async function endBackground(
  toasts: Toasts,
  hasEnded: (toolUseId: string, task: BackgroundTask) => boolean,
): Promise<void> {
  for (const [toolUseId, task] of [...toasts.background]) {
    if (!hasEnded(toolUseId, task)) continue
    task.limit.cancel()
    toasts.background.delete(toolUseId)
    await toasts.toaster?.leaveCall()
  }
}

function keepBackgroundOpen(
  $: EngineInterface,
  toasts: Toasts,
  toolUseId: string,
  taskId: string | null,
): void {
  const limit = $.clock.after(BACKGROUND_LIMIT_MS, () => {
    endBackground(toasts, (openId) => openId === toolUseId).catch((error: unknown) => {
      $.ui.log(`item-toasts: closing a background call failed: ${String(error)}`)
    })
  })
  toasts.background.set(toolUseId, { taskId, limit })
}

function idsIn(text: string, tag: RegExp): ReadonlySet<string> {
  return new Set(Array.from(text.matchAll(tag), (match) => (match[1] ?? '').trim()))
}

function isNamedIn(text: string, toolUseId: string, task: BackgroundTask): boolean {
  if (idsIn(text, TOOL_USE_ID_TAG).has(toolUseId)) return true
  return task.taskId !== null && idsIn(text, TASK_ID_TAG).has(task.taskId)
}

export const register: Register = (on) => {
  const toasts: Toasts = {
    toaster: undefined,
    ticks: undefined,
    background: new Map(),
    generation: 0,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'handily · Set the toasts for work item changes on or off for this session',
      argumentHint: 'on|off',
    })
    const started = await next(e)
    if (await isOn($)) await startToasts($, toasts).tick()
    await $.state.set({ plugin: 'handily-item-toasts', key: 'ready' }, { root: $.plugin.root })
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const asked = e.args.trim()
    if (asked !== 'on' && asked !== 'off') return { text: USAGE_TEXT }
    return { text: await setMode($, toasts, asked) }
  })

  on('session.end', (_$, e, next) => {
    stopToasts(toasts)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await isOwnCall($, { tool: 'Bash', command: e.command }))) return next(e)
    const toaster = await toasterOf($, toasts)
    if (toaster === undefined) return next(e)
    const generation = toasts.generation
    await toaster.enterCall()
    let result: CallResult
    try {
      result = await next(e)
    } catch (error) {
      await toaster.leaveCall()
      throw error
    }
    if (toasts.generation !== generation) return result
    const background = backgroundTaskIdOf(e.run_in_background === true, result)
    if (background === null) await toaster.leaveCall()
    else keepBackgroundOpen($, toasts, e.tool_use_id, background.taskId)
    return result
  })

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const { value: snapshot } = await $.state.get({ plugin: 'handily-workitems', key: 'snapshot' })
    if (snapshot === undefined) {
      $.ui.log(`${NOT_OWN} workitems has no root yet`)
      return next(e)
    }
    const use: ToolUse = { tool: e.tool, filePath: e.file_path, root: snapshot.root }
    if (!(await isOwnCall($, use))) return next(e)
    const toaster = await toasterOf($, toasts)
    if (toaster === undefined) return next(e)
    await toaster.enterCall()
    try {
      return await next(e)
    } finally {
      await toaster.leaveCall()
    }
  })

  on('prompt.submit', async (_$, e, next) => {
    if (e.origin.kind === 'task-notification') {
      await endBackground(toasts, (toolUseId, task) => isNamedIn(e.text, toolUseId, task))
    }
    return next(e)
  })

  on('classic.Stop', async (_$, e, next) => {
    const running = e.background_tasks
    if (running !== undefined) {
      const runningIds = new Set(running.map((task) => task.id))
      await endBackground(
        toasts,
        (_toolUseId, task) => task.taskId !== null && !runningIds.has(task.taskId),
      )
    }
    return next(e)
  })
}
