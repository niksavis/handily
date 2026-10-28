import { update } from 'claude-code'
import type {
  EngineInterface,
  HookFailure,
  PromptOrigin,
  Register,
  Timer,
  ToolCheckInput,
  ToolCheckResult,
  ToolSpec,
} from 'claude-code'
import {
  type StatusLineSetting,
  agentWaitText,
  attentionText,
  mainWaitText,
  noticeText,
  statusLineSetting,
} from './attention'
import {
  EMPTY_ACTIVITY,
  isNoteDue,
  isTaskTool,
  planLag,
  planNote,
  toolTarget,
  withClocks,
  withMainCall,
  withPlanUpdate,
} from './activity'
import {
  type AgentHost,
  NEEDS_YOU_AFTER_MS,
  agentView,
  labelledAgents,
  noteAgentList,
  noteAsk,
  noteSpawn,
  noteTurnEnd,
  trackAgentCall,
  withAgentPlan,
  withFoundPlans,
} from './agents'
import {
  BOARD_PANES,
  SESSIONS_PANE,
  TASKS_PANE,
  type PaneUi,
  boardMode,
  closeBoard,
  isTasksSeen,
  openBoard,
  openUnasked,
  sessionCommand,
} from './board'
import { EMPTY_CHECKS, withCheck } from './checks'
import { detailsText } from './details'
import {
  type ListEdit,
  type TaskHost,
  listReply,
  parseBoardCommand,
  personAdd,
  personClear,
  personNote,
  personPlace,
  personRemove,
  personStatus,
  readList,
  resetList,
  unknownReply,
  withoutFinalPeriod,
} from './commands'
import { lastSegment } from './agents-json'
import { drawMachine } from './machine'
import {
  type Machine,
  type SessionsHost,
  newMachine,
  readMachine,
  removeExpiredKeys,
  updateProgress,
} from './sessions'
import {
  type AgentSummary,
  agentSummary,
  completeTurn,
  startTurn,
  withAgents,
  withTasks,
} from './progress'
import { type PaneWork, drawPane } from './pane'
import type {
  BoardCallRow,
  BoardChecks,
  BoardList,
  BoardPersonChange,
  BoardTask,
  BoardToolSight,
} from '../types'
import {
  EMPTY_LIST,
  MAX_AGENT_LISTS,
  STATUSES,
  TRACKER_TEXT_IS_DATA,
  addTask,
  escaped,
  findTask,
  isStatus,
  listText,
  moveTask,
  numbersText,
  removeTask,
  setStatus,
  taskText,
  withTrackerNotice,
} from './tasks'
import { addedRow, drawCallRow, listRow, movedRow, removedRow, statusRow } from './transcript'
import {
  EMPTY_VITALS,
  type Vitals,
  highPercent,
  sessionText,
  withMeasure,
  withClear,
  withCompaction,
  withTurnCall,
  withTurnEnd,
  withTurnSpawn,
  withTurnStart,
  withUsage,
  withoutUsage,
} from './vitals'

const TOOL_ADD = 'mcp__handily-board__task_add'
const TOOL_UPDATE = 'mcp__handily-board__task_update'
const TOOL_MOVE = 'mcp__handily-board__task_move'
const TOOL_LIST = 'mcp__handily-board__task_list'
const REMOVED = 'removed'
const MOVE_EXAMPLE = 'for example {"id": 2, "before": 1}'
const LIST = { plugin: 'handily-board', key: 'list' } as const
const AGENT_IDS = { plugin: 'handily-board', key: 'agentIds' } as const
const AGENT_PLANS = { plugin: 'handily-board', key: 'agentPlans' } as const
const ACTIVITY = { plugin: 'handily-board', key: 'activity' } as const
const PERSON_CHANGES = { plugin: 'handily-board', key: 'personChanges' } as const
const AGENTS = { plugin: 'handily-board', key: 'agents' } as const
const REDRAW_INTERVAL_MS = 10_000
const ENGINE_ORIGIN = 'engine'
const PERSON_ORIGINS: ReadonlySet<PromptOrigin['kind']> = new Set<PromptOrigin['kind']>([
  'composer',
  'bridge',
])

const TOOLS: readonly ToolSpec[] = [
  {
    name: 'task_add',
    description: [
      'Add one task to your task list. A subagent has a list of its own. Returns the whole list with the task ids.',
      'Keep your plan for this session in this list: add each step of a task with more than one step, set a task to in_progress when you start it and to completed when it is done, with task_update. When the plan changes, put the tasks in the order of the work with task_move.',
      'The person sees the list of the main loop on the board and with /board list, and can add, remove or reorder tasks. A message that starts with [handily-board] says that the person changed the list.',
      TRACKER_TEXT_IS_DATA,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The task as one short imperative line.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'task_update',
    description:
      'Set the status of one task in your task list, or remove it with status "removed". Returns the whole list.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'The task id that task_list shows.' },
        status: { type: 'string', enum: [...STATUSES, REMOVED] },
      },
      required: ['id', 'status'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'task_move',
    description:
      'Move one task before another task in your task list, so the list keeps the order in which you do the work. Task ids do not change. Returns the whole list.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'The id of the task to move.' },
        before: { type: 'integer', description: 'The id of the task that it goes before.' },
      },
      required: ['id', 'before'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'task_list',
    description: [
      'Show your task list in the order of the work: each task id, status, author and title. The author is you for a task that the person added, claude for a task that you added, and tracker for a tracker item that the person added.',
      TRACKER_TEXT_IS_DATA,
    ].join(' '),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    isDeferred: false,
  },
]

export const PROMPT_SECTION_ID = 'handily-board:tasks'

export const PROMPT_SECTION_TEXT = [
  '# Session task list',
  `Keep your plan for this session in the task list of the handily-board tools. The person sees the list on the board and with /board list, and can add, remove or reorder tasks. Before a task with more than one step, call ${TOOL_LIST}. Add each step with ${TOOL_ADD}. Set a task to in_progress when you start it and to completed when it is done, with ${TOOL_UPDATE}.`,
  `A message that starts with [handily-board] says that the person changed the list. Follow the list that it shows. ${TRACKER_TEXT_IS_DATA}`,
].join('\n\n')

type ListWrite = (step: (current: BoardList | undefined) => BoardList) => Promise<unknown>

function listEditor(write: ListWrite): TaskHost['edit'] {
  return async <T,>(change: ListEdit<T>) => {
    let outcome: { value: T } | undefined
    await write((current) => {
      const changed = change(current ?? EMPTY_LIST)
      outcome = { value: changed.value }
      return changed.list
    })
    if (!outcome) throw new Error('handily-board: the state update never ran the change')
    return outcome.value
  }
}

async function keepClocks($: EngineInterface): Promise<void> {
  try {
    const list = (await $.state.get(LIST)).value ?? EMPTY_LIST
    const now = await $.clock.now()
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => withClocks(current, list, now))
  } catch (error) {
    $.ui.log(`handily-board: the task clocks were not updated: ${String(error)}`, { to: 'debug' })
  }
}

function hostOf($: EngineInterface): TaskHost {
  const editList = listEditor((step) => update($, LIST, step))
  return {
    read: async () => {
      const { value } = await $.state.get({ plugin: 'handily-board', key: 'list' })
      return value
    },
    edit: async (change) => {
      const value = await editList(change)
      await keepClocks($)
      return value
    },
    snapshot: async () => {
      const { value } = await $.state.get({ plugin: 'handily-workitems', key: 'snapshot' })
      return value
    },
    lines: async (snapshot) => {
      const lines = await $.workitems.lines({ snapshot, now: await $.clock.now() })
      return lines.map(({ tone, text }) => ({ tone, text }))
    },
    expanded: async () => {
      const { value } = await $.state.get({ plugin: 'handily-board', key: 'expanded' })
      return value ?? []
    },
    editExpanded: async (change) => {
      await update($, { plugin: 'handily-board', key: 'expanded' }, (current) =>
        change(current ?? []),
      )
    },
    tell: async (change) => {
      try {
        await update($, PERSON_CHANGES, (current = []) => [...current, change])
        return undefined
      } catch (error) {
        $.ui.log(`handily-board: the change was not kept for Claude: ${String(error)}`)
        return 'the board could not keep the note; see the transcript log'
      }
    },
  }
}

function modelHostOf($: EngineInterface, agentId: string | undefined): TaskHost {
  if (agentId === undefined) return hostOf($)
  const read = async () => {
    const { value } = await $.state.get({
      plugin: 'handily-board',
      key: 'agentList',
      id: agentId,
    })
    return value
  }
  const edit = listEditor((step) =>
    update($, { plugin: 'handily-board', key: 'agentList', id: agentId }, step),
  )
  return {
    ...hostOf($),
    read,
    edit: async (change) => {
      if ((await read()) === undefined) {
        const unchanged = change(EMPTY_LIST)
        if (unchanged.list === EMPTY_LIST) return unchanged.value
      }
      return edit(change)
    },
  }
}

async function claimAgentList(
  $: EngineInterface,
  agentId: string | undefined,
): Promise<string | undefined> {
  if (agentId === undefined) return undefined
  let refusal: string | undefined
  await update($, AGENT_IDS, (current = []) => {
    refusal = undefined
    if (current.includes(agentId)) return current
    if (current.length >= MAX_AGENT_LISTS) {
      refusal = `the session keeps the task lists of ${String(MAX_AGENT_LISTS)} agents. Keep this plan in your reply.`
      return current
    }
    return [...current, agentId]
  })
  return refusal
}

function agentHostOf($: EngineInterface): AgentHost {
  return {
    now: () => $.clock.now(),
    listed: () => $.agent.list(),
    stored: async () => (await $.state.get(AGENTS)).value ?? [],
    change: async (step) => {
      await update($, AGENTS, (current = []) => labelledAgents(step(current)))
    },
    plans: async () => (await $.state.get(AGENT_PLANS)).value ?? {},
    plan: async (agentId) => {
      const { value, version } = await $.state.get({
        plugin: 'handily-board',
        key: 'agentList',
        id: agentId,
      })
      return { agentId, tasks: value?.tasks ?? [], version }
    },
    keepPlans: (found) => {
      $.clock.after(0, () => {
        update($, AGENT_PLANS, (current = {}) => withFoundPlans(current, found)).catch(
          (error: unknown) => {
            $.ui.log(`handily-board: the agent plans were not kept: ${String(error)}`, {
              to: 'debug',
            })
          },
        )
      })
    },
  }
}

async function agentSummaries($: EngineInterface): Promise<AgentSummary[]> {
  const rows = await agentView(agentHostOf($), await $.clock.now())
  return rows
    .filter((row) => !row.isEnded)
    .map((row) => agentSummary(row.label, row.plan, row.look === 'failed'))
}

async function keepAgentPlan(
  $: EngineInterface,
  agentId: string,
  list: BoardList,
  version: number,
): Promise<void> {
  await update($, AGENT_PLANS, (current = {}) =>
    withAgentPlan(current, agentId, list.tasks, version),
  )
}

function shareAgents($: EngineInterface, machine: Machine): Promise<void> {
  return updateProgress(sessionsHost($), machine, async (progress, now) =>
    withAgents(progress, await agentSummaries($), now),
  )
}

type Redraw = { timer: Timer | undefined }

function stopRedraw(redraw: Redraw): void {
  redraw.timer?.cancel()
  redraw.timer = undefined
}

function isBoardPaneId(id: string): boolean {
  return BOARD_PANES.some((pane) => pane.id === id)
}

async function openBoardPanes($: EngineInterface) {
  return (await $.ui.panes()).filter((open) => isBoardPaneId(open.id))
}

async function redrawShownPane($: EngineInterface, redraw: Redraw): Promise<void> {
  const panes = await openBoardPanes($)
  if (panes.length === 0) {
    stopRedraw(redraw)
    return
  }
  if (!panes.some((pane) => pane.isShown)) return
  await noteAgentList(agentHostOf($))
  $.ui.invalidate('ui.render')
}

function startRedraw($: EngineInterface, redraw: Redraw, attention: AttentionKeep): void {
  if (redraw.timer) return
  redraw.timer = $.clock.every(REDRAW_INTERVAL_MS, () => {
    redrawShownPane($, redraw).catch((error: unknown) => {
      $.ui.log(`handily-board: the redraw failed: ${String(error)}`, { to: 'debug' })
    })
    void refreshStatus($, attention)
  })
}

async function resetActivity($: EngineInterface): Promise<void> {
  await $.state.set(ACTIVITY, EMPTY_ACTIVITY)
}

async function notePlanChange($: EngineInterface): Promise<void> {
  try {
    const list = await readList(hostOf($))
    const now = await $.clock.now()
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => withPlanUpdate(current, list, now))
  } catch (error) {
    $.ui.log(`handily-board: the plan clock was not updated: ${String(error)}`, { to: 'debug' })
  }
}

type DueNote = { text: string; calls: number }

async function takeChanges($: EngineInterface): Promise<readonly BoardPersonChange[]> {
  let taken: readonly BoardPersonChange[] = []
  await update($, PERSON_CHANGES, (current = []) => {
    taken = current
    return []
  })
  return taken
}

async function putBackChanges(
  $: EngineInterface,
  taken: readonly BoardPersonChange[],
): Promise<void> {
  if (taken.length === 0) return
  try {
    await update($, PERSON_CHANGES, (current = []) => [...taken, ...current])
  } catch (error) {
    $.ui.log(`handily-board: the changes for Claude were lost: ${String(error)}`)
  }
}

async function dueNote($: EngineInterface): Promise<DueNote | undefined> {
  const list = await readList(hostOf($))
  const { value: activity = EMPTY_ACTIVITY } = await $.state.get(ACTIVITY)
  const lag = planLag(activity)
  if (lag === undefined || !isNoteDue(activity)) return undefined
  return { text: planNote(lag, list.tasks.length > 0), calls: activity.calls }
}

async function recordNote($: EngineInterface, calls: number): Promise<void> {
  try {
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => ({ ...current, noteAt: calls }))
  } catch (error) {
    $.ui.log(`handily-board: the plan note was not recorded: ${String(error)}`, { to: 'debug' })
  }
}

async function workOf($: EngineInterface, vitals: Vitals, checks: BoardChecks): Promise<PaneWork> {
  const now = await $.clock.now()
  const { value: activity } = await $.state.get(ACTIVITY)
  const agents = await agentView(agentHostOf($), now)
  return { now, activity: activity ?? EMPTY_ACTIVITY, agents, vitals, checks }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

type CheckedCall = ToolCheckInput & { tool_use_id: string }

type ChecksKeep = { current: BoardChecks }

type VitalsKeep = { current: Vitals }

type WaitingAsk = { agentId: string | undefined; sight: BoardToolSight }

type AttentionKeep = {
  setting: StatusLineSetting
  vitals: VitalsKeep
  text: string | undefined
  refreshes: number
  asks: Map<string, WaitingAsk>
}

function hasAgentAsk(attention: AttentionKeep): boolean {
  return [...attention.asks.values()].some((ask) => ask.agentId !== undefined)
}

async function isSessionTabSeen($: EngineInterface): Promise<boolean> {
  return isTasksSeen(await $.ui.panes())
}

async function attentionNow(
  $: EngineInterface,
  attention: AttentionKeep,
): Promise<string | undefined> {
  const rows = hasAgentAsk(attention) ? await agentView(agentHostOf($), await $.clock.now()) : []
  const text = attentionText(rows, attention.vitals.current)
  if (text === undefined || (await isSessionTabSeen($))) return undefined
  return text
}

function showStatus($: EngineInterface, attention: AttentionKeep, text: string | undefined): void {
  if (text === attention.text) return
  attention.text = text
  $.ui.status(text)
}

function clearStatus($: EngineInterface, attention: AttentionKeep): void {
  if (attention.setting === 'off') return
  attention.refreshes += 1
  showStatus($, attention, undefined)
}

async function refreshStatus($: EngineInterface, attention: AttentionKeep): Promise<void> {
  if (attention.setting === 'off') return
  attention.refreshes += 1
  const refresh = attention.refreshes
  try {
    const text = await attentionNow($, attention)
    if (refresh === attention.refreshes) showStatus($, attention, text)
  } catch (error) {
    $.ui.log(`handily-board: the status line was not updated: ${String(error)}`, { to: 'debug' })
  }
}

async function forgetAsks(
  $: EngineInterface,
  attention: AttentionKeep,
  isForgotten: (callId: string, ask: WaitingAsk) => boolean,
): Promise<void> {
  const forgotten = [...attention.asks].filter(([callId, ask]) => isForgotten(callId, ask))
  for (const [callId] of forgotten) attention.asks.delete(callId)
  if (forgotten.some(([, ask]) => ask.agentId !== undefined)) await refreshStatus($, attention)
}

async function untilSettled<R>(
  $: EngineInterface,
  attention: AttentionKeep,
  callId: string,
  run: () => Promise<R>,
): Promise<R> {
  try {
    return await run()
  } finally {
    await forgetAsks($, attention, (askedId) => askedId === callId)
  }
}

async function waitOf($: EngineInterface, ask: WaitingAsk): Promise<string | undefined> {
  const { agentId } = ask
  if (agentId === undefined) return mainWaitText(ask.sight)
  const rows = await agentView(agentHostOf($), await $.clock.now())
  const row = rows.find((one) => one.id === agentId && one.look === 'needsYou')
  return row === undefined ? undefined : agentWaitText(row)
}

async function notifyOrToast($: EngineInterface, text: string): Promise<void> {
  try {
    const sent = await $.ui.notify(text)
    if (sent.isSent) return
    $.ui.log(`handily-board: no desktop notice (${sent.reason}), so a toast shows it`, {
      to: 'debug',
    })
  } catch (error) {
    $.ui.log(`handily-board: the desktop notice failed: ${String(error)}`, { to: 'debug' })
  }
  $.ui.toast(text)
}

async function noticeWait($: EngineInterface, attention: AttentionKeep, callId: string) {
  const ask = attention.asks.get(callId)
  if (ask === undefined) return
  try {
    const wait = await waitOf($, ask)
    if (wait === undefined || (await isSessionTabSeen($))) return
    const session = escaped(lastSegment(await $.session.cwd()))
    if (attention.asks.get(callId) !== ask) return
    await notifyOrToast($, noticeText(session, wait))
  } catch (error) {
    $.ui.log(`handily-board: no notice for the wait: ${String(error)}`, { to: 'debug' })
  }
}

async function noteCheck(
  $: EngineInterface,
  keep: ChecksKeep,
  attention: AttentionKeep,
  e: CheckedCall,
  verdict: ToolCheckResult,
) {
  const target = isRecord(e.input) ? toolTarget(e.input, await $.session.cwd()) : null
  const check = { decision: verdict.decision, tool: e.tool, target, agentId: e.agentId ?? null }
  keep.current = withCheck(keep.current, check)
  $.ui.invalidate('ui.render')
  if (verdict.decision !== 'ask') return
  const { agentId, tool_use_id: callId } = e
  if (agentId !== undefined) await noteAsk(agentHostOf($), agentId, callId, target)
  attention.asks.set(callId, { agentId, sight: { tool: e.tool, target } })
  $.clock.after(NEEDS_YOU_AFTER_MS, () => {
    $.ui.invalidate('ui.render')
    void refreshStatus($, attention)
    void noticeWait($, attention, callId)
  })
}

async function noteVitals(
  $: EngineInterface,
  attention: AttentionKeep,
  change: (vitals: Vitals) => Vitals,
): Promise<void> {
  const keep = attention.vitals
  const now = await $.clock.now()
  const drawn = sessionText(keep.current)
  const details = detailsText(keep.current, now)
  const high = highPercent(keep.current)
  keep.current = change(keep.current)
  if (sessionText(keep.current) !== drawn || detailsText(keep.current, now) !== details) {
    $.ui.invalidate('ui.render')
  }
  if (highPercent(keep.current) !== high) await refreshStatus($, attention)
}

async function readUsage($: EngineInterface, attention: AttentionKeep): Promise<void> {
  try {
    const usage = await $.session.usage()
    await noteVitals($, attention, (vitals) => withUsage(vitals, usage))
  } catch (error) {
    $.ui.log(`handily-board: no context or cost on this host: ${String(error)}`, { to: 'debug' })
    await noteVitals($, attention, withoutUsage)
  }
}

async function resetAgentLists($: EngineInterface): Promise<void> {
  let agentIds: readonly string[] = []
  await update($, AGENT_IDS, (current = []) => {
    agentIds = current
    return []
  })
  for (const id of agentIds) {
    await $.state.set({ plugin: 'handily-board', key: 'agentList', id }, EMPTY_LIST)
  }
  await $.state.set(AGENT_PLANS, {})
}

function uiOf($: EngineInterface): PaneUi {
  return {
    open: (pane, focus) =>
      $.ui.open(focus ? { id: pane.id, title: pane.title, focus } : { ...pane }),
    close: (id) => $.ui.close({ id }),
    panes: () => $.ui.panes(),
    fillPrompt: async (text) => {
      const draft = await $.prompt.read()
      const filled = await $.prompt.fill(
        draft.text.trim() === '' ? { text } : { text: ` ${text}`, mode: 'append' },
      )
      return { isFilled: filled.isFilled, refusal: filled.refusal }
    },
    openAgents: async () => {
      await $.command.run({ command: 'tasks' })
    },
    focus: async (key) => {
      const stayed = (reason: string) => {
        $.ui.log(`handily-board: the focus did not move to ${key}: ${reason}`, { to: 'debug' })
      }
      try {
        const moved = await $.ui.focus({ requestId: TASKS_PANE.id, key })
        if (moved.deny !== undefined) stayed(moved.deny)
      } catch (error) {
        stayed(String(error))
      }
    },
    toast: (text) => {
      $.ui.toast(text)
    },
    log: (text) => {
      $.ui.log(text)
    },
  }
}

function sessionsHost($: EngineInterface): SessionsHost {
  return {
    now: () => $.clock.now(),
    sessionId: () => $.session.id(),
    cwd: () => $.session.cwd(),
    surfaces: () => $.session.surfaces(),
    list: async () => (await $.state.get(LIST)).value ?? EMPTY_LIST,
    agents: () => $.agent.list(),
    storeGet: (key) => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    storeDelete: (key) => $.store.delete(key),
    storeKeys: () => $.store.keys(),
    run: (argv) => $.process.run(argv),
    panes: () => $.ui.panes(),
    redraw: () => {
      $.ui.invalidate('ui.render')
    },
    every: (ms, fn) => $.clock.every(ms, fn),
    after: (ms, fn) => $.clock.after(ms, fn),
    debug: (line) => {
      $.ui.log(line, { to: 'debug' })
    },
  }
}

function listAnswer(list: BoardList, lead: string): string {
  const shown = list.tasks.length === 0 ? 'The task list is empty.' : listText(list)
  return withTrackerNotice(lead === '' ? shown : `${lead}\n\n${shown}`, list.tasks)
}

async function listResult(host: TaskHost, lead: string): Promise<string> {
  return listAnswer(await readList(host), lead)
}

type ModelAnswer = { deny: string } | { result: string; row: BoardCallRow }

async function keepRow($: EngineInterface, toolUseId: string, row: BoardCallRow) {
  try {
    await $.state.set({ plugin: 'handily-board', key: 'rows', id: toolUseId }, row)
  } catch (error) {
    $.ui.log(`handily-board: the engine draws the row of ${toolUseId}: ${String(error)}`, {
      to: 'debug',
    })
  }
}

async function answerWithRow($: EngineInterface, toolUseId: string, answer: ModelAnswer) {
  if ('deny' in answer) return answer
  await keepRow($, toolUseId, answer.row)
  return { result: answer.result }
}

async function keptRow($: EngineInterface, toolUseId: string) {
  try {
    const { value } = await $.state.get({ plugin: 'handily-board', key: 'rows', id: toolUseId })
    return value
  } catch (error) {
    $.ui.log(`handily-board: the engine draws the row of ${toolUseId}: ${String(error)}`, {
      to: 'debug',
    })
    return undefined
  }
}

async function modelList(host: TaskHost): Promise<ModelAnswer> {
  const list = await readList(host)
  return { result: listAnswer(list, ''), row: listRow(list) }
}

function knownIds(numbers: string): string {
  return numbers === '' ? 'The list is empty.' : `The ids are ${numbers}.`
}

async function modelAdd(
  host: TaskHost,
  title: unknown,
  claim: () => Promise<string | undefined>,
): Promise<ModelAnswer> {
  if (typeof title !== 'string' || title.trim() === '') {
    return {
      deny: 'task_add needs a title: a non-empty string, for example {"title": "Write the tests"}.',
    }
  }
  const tried = addTask(EMPTY_LIST, title.trim(), { by: 'model', item: null })
  if ('refusal' in tried) return { deny: `task_add refused: ${tried.refusal}` }
  const unclaimed = await claim()
  if (unclaimed !== undefined) return { deny: `task_add refused: ${unclaimed}` }
  const outcome = await host.edit((list) => {
    const added = addTask(list, title.trim(), { by: 'model', item: null })
    return { list: 'refusal' in added ? list : added.list, value: added }
  })
  if ('refusal' in outcome) return { deny: `task_add refused: ${outcome.refusal}` }
  const { task } = outcome
  return {
    result: await listResult(host, `Added task ${String(task.id)}: ${taskText(task)}.`),
    row: addedRow(task),
  }
}

async function modelUpdate(host: TaskHost, id: unknown, status: unknown): Promise<ModelAnswer> {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    return { deny: 'task_update needs id: the integer task id that task_list shows.' }
  }
  if (status !== REMOVED && !isStatus(status)) {
    return {
      deny: `task_update needs status: one of ${[...STATUSES, REMOVED].join(', ')}.`,
    }
  }
  const outcome = await host.edit<{ task: BoardTask | undefined; numbers: string }>((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { task, numbers: numbersText(list.tasks) } }
    const next = status === REMOVED ? removeTask(list, id) : setStatus(list, id, status)
    return { list: next, value: { task, numbers: '' } }
  })
  const { task } = outcome
  if (!task) {
    return {
      deny: `No task ${String(id)}. ${knownIds(outcome.numbers)} Call task_list to see them.`,
    }
  }
  if (status === REMOVED) {
    return {
      result: await listResult(host, `Removed task ${String(id)}.`),
      row: removedRow(task),
    }
  }
  return {
    result: await listResult(host, `Task ${String(id)} is now ${status}.`),
    row: statusRow(task, status),
  }
}

async function modelMove(host: TaskHost, id: unknown, before: unknown): Promise<ModelAnswer> {
  if (
    typeof id !== 'number' ||
    !Number.isInteger(id) ||
    typeof before !== 'number' ||
    !Number.isInteger(before)
  ) {
    return {
      deny: `task_move needs id and before: the integer task ids that task_list shows, ${MOVE_EXAMPLE}.`,
    }
  }
  if (id === before) return { deny: `task_move needs two different task ids, ${MOVE_EXAMPLE}.` }
  const outcome = await host.edit<
    { missing: number; numbers: string } | { missing: undefined; task: BoardTask }
  >((list) => {
    const task = findTask(list, id)
    if (task && findTask(list, before)) {
      return { list: moveTask(list, id, before), value: { missing: undefined, task } }
    }
    return { list, value: { missing: task ? before : id, numbers: numbersText(list.tasks) } }
  })
  if (outcome.missing !== undefined) {
    const known = knownIds(outcome.numbers)
    return {
      deny: `No task ${String(outcome.missing)}. ${known} Call task_list, then task_move with two of its ids, ${MOVE_EXAMPLE}.`,
    }
  }
  return {
    result: await listResult(host, `Moved task ${String(id)} before task ${String(before)}.`),
    row: movedRow(outcome.task, before),
  }
}

function toolFailed($: EngineInterface, tool: string, error: HookFailure): { deny: string } {
  $.ui.log(`handily-board: ${tool} failed (${error.kind}): ${error.message ?? 'no message'}`)
  const reason = withoutFinalPeriod(error.message ?? error.kind)
  return { deny: `handily-board could not answer ${tool}: ${reason}.` }
}

export const register: Register = (on, options) => {
  const mode = boardMode(options)
  const redraw: Redraw = { timer: undefined }
  const machine = newMachine(SESSIONS_PANE.id)
  const vitals: VitalsKeep = { current: EMPTY_VITALS }
  const checks: ChecksKeep = { current: EMPTY_CHECKS }
  const attention: AttentionKeep = {
    setting: statusLineSetting(options),
    vitals,
    text: undefined,
    refreshes: 0,
    asks: new Map(),
  }

  on('session.start', async ($, e, next) => {
    for (const tool of TOOLS) await $.tool.register(tool)
    await $.command.register({
      name: 'board',
      description: 'handily · Show the board: the tasks of this session and this machine',
      argumentHint:
        '[machine | add <text|id> | rm <n> | mv <n> before <m>|top|bottom | done <n> | start <n> | open <n> | clear | list | close]',
      immediate: true,
    })
    if (mode === 'always') await openUnasked(uiOf($))
    await $.state.set({ plugin: 'handily-board', key: 'ready' }, { root: $.plugin.root })
    const started = await next(e)
    const host = sessionsHost($)
    await removeExpiredKeys(host)
    await updateProgress(host, machine, (progress, now, list) => withTasks(progress, list, now))
    await readUsage($, attention)
    return started
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await noteVitals($, attention, (current) => withMeasure(current, e))
    return measured
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    const isMainCompaction = e.agentId === undefined && e.trigger !== 'precompute'
    if (isMainCompaction && compacted.skip === undefined) {
      await noteVitals($, attention, withCompaction)
    }
    return compacted
  }).catch((_$, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await noteVitals($, attention, withTurnStart)
    await updateProgress(sessionsHost($), machine, (progress, now, list) =>
      withTasks(startTurn(progress, now), list, now),
    )
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      await noteVitals($, attention, (current) => withTurnEnd(current, e.durationMs))
      await updateProgress(sessionsHost($), machine, (progress, now, list) =>
        withTasks(completeTurn(progress, now), list, now),
      )
    } else {
      const { agentId } = e
      await noteTurnEnd(agentHostOf($), agentId)
      await forgetAsks($, attention, (_callId, ask) => ask.agentId === agentId)
      await shareAgents($, machine)
    }
    return completed
  }).catch((_$, e, next) => next(e))

  on('state.set', { plugin: 'handily-board', key: 'list' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.value.isSet) {
      const list = e.value
      await updateProgress(sessionsHost($), machine, (progress, now) =>
        withTasks(progress, list, now),
      )
    }
    return result
  })

  on('state.set', { plugin: 'handily-board', key: 'agentList' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.value.isSet) {
      await keepAgentPlan($, e.id, e.value, result.value.version)
      await shareAgents($, machine)
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    await $.state.set(AGENTS, [])
    if (e.reason === 'clear') {
      attention.asks.clear()
      await noteVitals($, attention, withClear)
      await refreshStatus($, attention)
      checks.current = EMPTY_CHECKS
      await resetList(hostOf($))
      await $.state.set(PERSON_CHANGES, [])
      await resetAgentLists($)
      await resetActivity($)
    }
    return next(e)
  })

  on('prompt.compose', async (_$, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(TOOL_LIST)) return composed
    return {
      sections: [
        ...composed.sections,
        { id: PROMPT_SECTION_ID, text: PROMPT_SECTION_TEXT, scope: 'session' as const },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const plan = PERSON_ORIGINS.has(e.origin.kind) ? await dueNote($) : undefined
    const taken = await takeChanges($)
    try {
      const changes = taken.length === 0 ? undefined : personNote(taken, await readList(hostOf($)))
      const notes = [changes, plan?.text].filter((text) => text !== undefined)
      if (notes.length === 0) return await next(e)
      const entered = await next({ ...e, context: [...(e.context ?? []), ...notes] })
      if (entered.drop !== undefined) {
        await putBackChanges($, taken)
        return entered
      }
      if (plan) await recordNote($, plan.calls)
      return entered
    } catch (error) {
      await putBackChanges($, taken)
      throw error
    }
  }).catch(($, e, next) => {
    $.ui.log(
      `handily-board: no note for Claude (${next.error.kind}): ${next.error.message ?? 'no message'}`,
    )
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (isTaskTool(e.tool)) {
      const answer = await next(e)
      if (e.agentId === undefined && e.tool !== TOOL_LIST && answer.deny === undefined) {
        await notePlanChange($)
      }
      return answer
    }
    if (next.origin.plugin !== ENGINE_ORIGIN) return next(e)
    const sight = { tool: e.tool, target: toolTarget(e, await $.session.cwd()) }
    const { agentId } = e
    if (agentId === undefined) {
      const now = await $.clock.now()
      await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => withMainCall(current, sight, now))
      const answer = await untilSettled($, attention, e.tool_use_id, () => next(e))
      await noteVitals($, attention, (current) =>
        withTurnCall(current, e.tool, answer.isError === true),
      )
      return answer
    }
    return untilSettled($, attention, e.tool_use_id, () =>
      trackAgentCall(agentHostOf($), agentId, { id: e.tool_use_id, ...sight }, () => next(e)),
    )
  }).catch(($, e, next) => {
    $.ui.log(`handily-board: the work was not tracked (${next.error.kind})`, { to: 'debug' })
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const { tool_use_id: callId } = e
    if (callId === undefined || next.origin.plugin !== ENGINE_ORIGIN) return verdict
    await noteCheck($, checks, attention, { ...e, tool_use_id: callId }, verdict)
    return verdict
  }).catch(($, e, next) => {
    $.ui.log(`handily-board: the check was not kept (${next.error.kind})`, { to: 'debug' })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const at = await $.clock.now()
    const spawned = await next(e)
    if (spawned.agentId === undefined) return spawned
    const facts = {
      description: e.description,
      type: e.subagentType,
      name: e.name,
      parentId: e.parentAgentId,
    }
    await noteSpawn(agentHostOf($), spawned.agentId, facts, at)
    if (e.parentAgentId === undefined) await noteVitals($, attention, withTurnSpawn)
    await shareAgents($, machine)
    return spawned
  }).catch((_$, e, next) => next(e))

  on('tool.call', { tool: TOOL_ADD }, async ($, e) =>
    answerWithRow(
      $,
      e.tool_use_id,
      await modelAdd(modelHostOf($, e.agentId), e.title, () => claimAgentList($, e.agentId)),
    ),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_UPDATE }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelUpdate(modelHostOf($, e.agentId), e.id, e.status)),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_MOVE }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelMove(modelHostOf($, e.agentId), e.id, e.before)),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_LIST }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelList(modelHostOf($, e.agentId))),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))

  on('command.run', { command: 'board' }, async ($, e) => {
    const host = hostOf($)
    const command = parseBoardCommand(e.args)
    switch (command.kind) {
      case 'session':
        return { text: await sessionCommand(uiOf($), mode) }
      case 'machine':
        return { text: await openBoard(uiOf($), SESSIONS_PANE) }
      case 'close':
        return { text: await closeBoard(uiOf($)) }
      case 'clear':
        return { text: await personClear(host) }
      case 'list':
        return { text: await listReply(host) }
      case 'add':
        return { text: await personAdd(host, command.text) }
      case 'rm':
        return { text: await personRemove(host, command.text) }
      case 'mv':
        return { text: await personPlace(host, command.text) }
      case 'status':
        return { text: await personStatus(host, command.text, command.word) }
      case 'unknown':
        return { text: unknownReply(command.word) }
    }
  }).catch(($, _e, next) => {
    $.ui.log(
      `handily-board: /board failed (${next.error.kind}): ${next.error.message ?? 'no message'}`,
    )
    const reason = withoutFinalPeriod(next.error.message ?? next.error.kind)
    return { text: `handily-board: /board failed: ${reason}. Run /board list to see the tasks.` }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (isBoardPaneId(e.id) && (await openBoardPanes($)).length === 0) stopRedraw(redraw)
    if (isBoardPaneId(e.id)) await refreshStatus($, attention)
    return closed
  })

  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, async ($, e, next) => {
    if (!isTaskTool(e.props.tool) || e.props.isErrored) return next(e)
    if (e.component === 'ToolUse' && (e.props.isRunning || e.props.isInterrupted)) return next(e)
    const row = await keptRow($, e.props.tool_use_id)
    if (row === undefined) return next(e)
    const elements = $.ui.resolve(e)
    if (e.component === 'ToolResult') return elements.Box({})
    const look = { elements, hasToolMarker: e.surface === 'terminal' }
    return drawCallRow(look, row, e.viewport?.columns)
  })

  on('ui.render', { component: 'Pane', requestId: TASKS_PANE.id }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const { bodyColumns, placement } = e.props
    const elements = { Box, Text, Button, Input, bodyColumns, isInline: placement === 'inline' }
    const work = await workOf($, vitals.current, checks.current)
    clearStatus($, attention)
    startRedraw($, redraw, attention)
    return drawPane(elements, hostOf($), uiOf($), work)
  })

  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE.id }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const host = hostOf($)
    const expanded = new Set(await host.expanded())
    const { view, now } = await readMachine(sessionsHost($), machine)
    startRedraw($, redraw, attention)
    const { bodyColumns, placement } = e.props
    const toggle = (key: string) => {
      host
        .editExpanded((keys) =>
          keys.includes(key) ? keys.filter((one) => one !== key) : [...keys, key],
        )
        .catch((error: unknown) => {
          $.ui.log(`handily-board: the fold did not change: ${String(error)}`)
        })
    }
    const elements = {
      Box,
      Text,
      Button,
      bodyColumns,
      isInline: placement === 'inline',
      expanded,
      toggle,
    }
    return drawMachine(elements, view, now)
  })
}
