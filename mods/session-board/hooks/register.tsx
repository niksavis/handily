import type { EngineInterface, Register, Timer } from 'claude-code'
import {
  AGENTS_CACHE_KEY,
  POLL_INTERVAL_MS,
  pollAgents,
  readCache,
  type AgentsCache,
  type AgentsHost,
} from './agents'
import { renderBoard, renderDesktop } from './board'
import {
  completeTurn,
  emptyProgress,
  isExpired,
  progressKey,
  PROGRESS_PREFIX,
  readProgress,
  readTaskList,
  startTurn,
  withTasks,
  type Progress,
  type TaskView,
} from './progress'

export const PANE_ID = 'session-board'
export const PANE_TITLE = 'Sessions'
const TASK_LIST = { plugin: 'task-pane', key: 'list' } as const

type Change = (progress: Progress, now: number, tasks: TaskView | null) => Progress

async function canListSessions($: EngineInterface): Promise<boolean> {
  return (await $.session.surfaces()).includes('terminal')
}

async function readTasks($: EngineInterface): Promise<TaskView | null> {
  try {
    return readTaskList((await $.state.get(TASK_LIST)).value)
  } catch {
    return null
  }
}

async function readAllProgress($: EngineInterface): Promise<Progress[]> {
  const keys = (await $.store.keys()).filter((key) => key.startsWith(PROGRESS_PREFIX))
  const entries = await Promise.all(keys.map(async (key) => readProgress(await $.store.get(key))))
  return entries.filter((entry): entry is Progress => entry !== null)
}

function agentsHost($: EngineInterface): AgentsHost {
  return {
    now: () => $.clock.now(),
    run: (argv) => $.process.run(argv),
    load: () => $.store.get(AGENTS_CACHE_KEY),
    save: async (cache) => {
      await pruneExpired($, cache)
      await $.store.set(AGENTS_CACHE_KEY, cache)
    },
    log: (line) => {
      $.ui.log(line, { to: 'debug' })
    },
  }
}

async function deleteExpired($: EngineInterface, live: ReadonlySet<string>): Promise<void> {
  const now = await $.clock.now()
  for (const entry of await readAllProgress($)) {
    if (isExpired(entry, live, now)) await $.store.delete(progressKey(entry.sessionId))
  }
}

async function pruneExpired($: EngineInterface, cache: AgentsCache): Promise<void> {
  if (cache.outcome.kind !== 'ok') return
  await deleteExpired($, new Set(cache.outcome.rows.flatMap((row) => row.sessionId ?? [])))
}

type Board = {
  poll: Timer | undefined
  inFlight: Promise<void> | undefined
  writes: Promise<void>
}

function stopPolling(board: Board): void {
  board.poll?.cancel()
  board.poll = undefined
}

async function pollShownBoard($: EngineInterface, board: Board): Promise<void> {
  const pane = (await $.ui.panes()).find((open) => open.id === PANE_ID)
  if (!pane) {
    stopPolling(board)
    return
  }
  if (!pane.isShown) return
  await pollAgents(agentsHost($))
  $.ui.invalidate('ui.render')
}

function pollOnce($: EngineInterface, board: Board): Promise<void> {
  if (board.inFlight) return board.inFlight
  const running = pollShownBoard($, board).finally(() => {
    board.inFlight = undefined
  })
  board.inFlight = running
  return running
}

function startPolling($: EngineInterface, board: Board): void {
  if (board.poll) return
  const tick = () => {
    pollOnce($, board).catch((error: unknown) => {
      $.ui.log(`session-board: the poll failed: ${String(error)}`, { to: 'debug' })
    })
  }
  board.poll = $.clock.every(POLL_INTERVAL_MS, tick)
  $.clock.after(0, tick)
}

async function writeProgress($: EngineInterface, change: Change): Promise<void> {
  const sessionId = await $.session.id()
  const now = await $.clock.now()
  const key = progressKey(sessionId)
  const current =
    readProgress(await $.store.get(key)) ?? emptyProgress(sessionId, await $.session.cwd(), now)
  await $.store.set(key, change(current, now, await readTasks($)))
  $.ui.invalidate('ui.render')
}

function updateProgress($: EngineInterface, board: Board, change: Change): Promise<void> {
  const run = () => writeProgress($, change)
  board.writes = board.writes.then(run, run)
  return board.writes
}

export const register: Register = (on) => {
  const board: Board = { poll: undefined, inFlight: undefined, writes: Promise.resolve() }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'session-board',
      description: 'Shows every local Claude Code session: state, task, worktree and time.',
      argumentHint: '[close]',
    })
    await deleteExpired($, new Set([await $.session.id()]))
    await updateProgress($, board, (progress, now, tasks) => withTasks(progress, tasks, now))
    await $.state.set({ plugin: 'session-board', key: 'ready' }, { root: $.plugin.root })
    return started
  })

  on('turn.start', async ($, e, next) => {
    await updateProgress($, board, (progress, now, tasks) =>
      withTasks(startTurn(progress, now), tasks, now),
    )
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      await updateProgress($, board, (progress, now, tasks) =>
        withTasks(completeTurn(progress, now), tasks, now),
      )
    }
    return completed
  })

  on('state.set', { plugin: 'task-pane', key: 'list' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.value.isSet) {
      await updateProgress($, board, (progress, now) =>
        withTasks(progress, readTaskList(e.value), now),
      )
    }
    return result
  }).catch((_$, e, next) => next(e))

  on('ui.close', { id: PANE_ID }, async (_$, e, next) => {
    const closed = await next(e)
    stopPolling(board)
    return closed
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: 'session-board' }, async ($, e) => {
    const argument = e.args.trim()
    if (argument === 'close') {
      stopPolling(board)
      await $.ui.close({ id: PANE_ID })
      return { text: 'Session board closed.' }
    }
    if (argument !== '') {
      return {
        text: `Unknown argument "${argument}". Use /session-board or /session-board close.`,
      }
    }
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    if (!(await canListSessions($))) {
      return {
        text: 'Session board opened. Other sessions are listed only in a terminal session.',
      }
    }
    startPolling($, board)
    return { text: 'Session board opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const now = await $.clock.now()
    const ownSessionId = await $.session.id()
    if (!(await canListSessions($))) {
      const own = readProgress(await $.store.get(progressKey(ownSessionId))) ?? undefined
      return renderDesktop(elements, { now, own, subagents: await $.agent.list() })
    }
    startPolling($, board)
    const cache = readCache(await $.store.get(AGENTS_CACHE_KEY))
    const progress = await readAllProgress($)
    return renderBoard(elements, { now, ownSessionId, cache, progress }, e.props.bodyColumns)
  }).catch(($, e, next) => {
    $.ui.log(`session-board: the board could not be drawn (${next.error.kind})`, { to: 'debug' })
    return next(e)
  })
}
