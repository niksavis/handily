import type { EngineInterface, Register, Timer } from 'claude-code'
import {
  dropCall,
  finishCall,
  mergeList,
  noteSpawn,
  noteTurnEnd,
  startCall,
  toolTarget,
  type Tracks,
} from './agents'
import { boardRows, renderBoard, type CardPlans } from './board'
import { readPlan, type PlanTask } from './plan'

export const PANE_ID = 'agent-board'
export const PANE_TITLE = 'Subagents'
export const REDRAW_INTERVAL_MS = 1000

type Board = {
  tracks: Tracks
  unfolded: Set<string>
  redraw: Timer | undefined
}

function stopRedraw(board: Board): void {
  board.redraw?.cancel()
  board.redraw = undefined
}

async function redrawShownBoard($: EngineInterface, board: Board): Promise<void> {
  const pane = (await $.ui.panes()).find((open) => open.id === PANE_ID)
  if (!pane) {
    stopRedraw(board)
    return
  }
  if (pane.isShown) $.ui.invalidate('ui.render')
}

function startRedraw($: EngineInterface, board: Board): void {
  if (board.redraw) return
  board.redraw = $.clock.every(REDRAW_INTERVAL_MS, () => {
    redrawShownBoard($, board).catch((error: unknown) => {
      $.ui.log(`agent-board: the redraw failed: ${String(error)}`, { to: 'debug' })
    })
  })
}

async function readPlans($: EngineInterface, tracks: Tracks): Promise<Map<string, PlanTask[]>> {
  const plans = new Map<string, PlanTask[]>()
  for (const agentId of tracks.keys()) {
    const ref = { plugin: 'task-pane', key: 'agentList', id: agentId } as const
    const plan = readPlan((await $.state.get(ref)).value)
    if (plan !== null) plans.set(agentId, plan)
  }
  return plans
}

function cardPlans($: EngineInterface, board: Board, lists: Map<string, PlanTask[]>): CardPlans {
  return {
    lists,
    unfolded: board.unfolded,
    toggle: (agentId) => {
      if (!board.unfolded.delete(agentId)) board.unfolded.add(agentId)
      $.ui.invalidate('ui.render')
    },
  }
}

export const register: Register = (on) => {
  const board: Board = { tracks: new Map(), unfolded: new Set(), redraw: undefined }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'agent-board',
      description: 'Shows what each subagent of this session does: its tool, tool count and time.',
      argumentHint: '[close]',
    })
    await $.state.set({ plugin: 'agent-board', key: 'ready' }, { root: $.plugin.root })
    return started
  })

  on('session.end', (_$, e, next) => {
    board.tracks.clear()
    board.unfolded.clear()
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const { agentId } = e
    if (agentId === undefined) return next(e)
    const callId = e.tool_use_id
    const sight = { tool: e.tool, target: toolTarget(e) }
    startCall(board.tracks, agentId, callId, sight, await $.clock.now())
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (error) {
      dropCall(board.tracks, agentId, callId)
      throw error
    }
    finishCall(board.tracks, agentId, callId)
    return result
  }).catch((_$, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId === undefined) return spawned
    const facts = {
      description: e.description,
      type: e.subagentType,
      name: e.name,
      parentId: e.parentAgentId,
    }
    noteSpawn(board.tracks, spawned.agentId, facts, await $.clock.now())
    return spawned
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) noteTurnEnd(board.tracks, e.agentId, await $.clock.now())
    return completed
  }).catch((_$, e, next) => next(e))

  on('ui.close', { id: PANE_ID }, async (_$, e, next) => {
    const closed = await next(e)
    stopRedraw(board)
    return closed
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: 'agent-board' }, async ($, e) => {
    const argument = e.args.trim()
    if (argument === 'close') {
      stopRedraw(board)
      await $.ui.close({ id: PANE_ID })
      return { text: 'Agent board closed.' }
    }
    if (argument !== '') {
      return { text: `Unknown argument "${argument}". Use /agent-board or /agent-board close.` }
    }
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    startRedraw($, board)
    return { text: 'Agent board opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const now = await $.clock.now()
    mergeList(board.tracks, await $.agent.list(), now)
    startRedraw($, board)
    const plans = cardPlans($, board, await readPlans($, board.tracks))
    return renderBoard(elements, boardRows(board.tracks, now), e.props.bodyColumns, plans)
  }).catch(($, e, next) => {
    $.ui.log(`agent-board: the board could not be drawn (${next.error.kind})`, { to: 'debug' })
    return next(e)
  })
}
