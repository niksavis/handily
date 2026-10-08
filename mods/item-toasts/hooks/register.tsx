import type { EngineInterface, Register, Timer } from 'claude-code'
import { isTrackerWrite } from './match'
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

function hostOf($: EngineInterface): ToastHost {
  return {
    snapshot: async () => (await $.state.get({ plugin: 'workitems', key: 'snapshot' })).value,
    refresh: (since) => $.workitems.refresh({ since }),
    lines: async (snapshot) => $.workitems.lines({ snapshot, now: await $.clock.now() }),
    now: () => $.clock.now(),
    toast: (text) => {
      $.ui.toast(text)
    },
    log: (text) => {
      $.ui.log(text)
    },
    announced: async () => (await $.state.get({ plugin: 'item-toasts', key: 'announced' })).value,
    announce: async (health) => {
      await $.state.set({ plugin: 'item-toasts', key: 'announced' }, health)
    },
    lastToastAt: async () =>
      (await $.state.get({ plugin: 'item-toasts', key: 'lastToastAt' })).value,
    noteToast: async (at) => {
      await $.state.set({ plugin: 'item-toasts', key: 'lastToastAt' }, at)
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

async function isOwnCommand($: EngineInterface, command: string): Promise<boolean> {
  try {
    return isTrackerWrite({ tool: 'Bash', command, verbs: await $.workitems.writeVerbs() })
  } catch (error) {
    $.ui.log(`${NOT_OWN} the write verbs failed: ${String(error)}`)
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
    const started = await next(e)
    await startToasts($, toasts).tick()
    return started
  })

  on('session.end', (_$, e, next) => {
    stopToasts(toasts)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await isOwnCommand($, e.command))) return next(e)
    const toaster = toasts.toaster ?? startToasts($, toasts)
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
    const { value: snapshot } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
    if (snapshot === undefined) {
      $.ui.log(`${NOT_OWN} workitems has no root yet`)
      return next(e)
    }
    if (!isTrackerWrite({ tool: e.tool, filePath: e.file_path, root: snapshot.root })) {
      return next(e)
    }
    const toaster = toasts.toaster ?? startToasts($, toasts)
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
