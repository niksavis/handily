import { update } from 'claude-code'
import type {
  EngineInterface,
  HookFailure,
  PromptOrigin,
  Register,
  SessionEndReason,
  Timer,
  ToolCheckInput,
  ToolCheckResult,
  ToolSpec,
  TurnStepResult,
} from 'claude-code'
import {
  type StatusLineSetting,
  type Wait,
  agentWait,
  attentionText,
  mainWait,
  noticeParts,
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
  type AgentPulses,
  type AgentStep,
  NEEDS_YOU_AFTER_MS,
  agentView,
  heard,
  labelledAgents,
  noteAgentList,
  noteAsk,
  noteSpawn,
  newPulses,
  noteTurnEnd,
  stepOf,
  trackAgentCall,
  withAgentPlan,
  withFoundPlans,
  withStalls,
  withSteps,
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
  showPane,
} from './board'
import {
  ABSENT_PARTS,
  BREAKDOWN_DETAIL,
  COUNTING_PARTS,
  FAILED_PARTS,
  type PartsView,
  UNREAD_PARTS,
  partsOf,
} from './breakdown'
import { EMPTY_CHECKS, withCheck } from './checks'
import { SESSION_DETAILS, detailsText } from './details'
import { statsText } from './stats'
import {
  type ListEdit,
  type TaskHost,
  listReply,
  parseBoardCommand,
  personAdd,
  personClear,
  personEdit,
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
import { stepText } from './agent-rows'
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
  withContext,
  withTasks,
} from './progress'
import { type PaneWork, drawPane } from './pane'
import {
  PLAN_TOOL,
  type PlanAnswer,
  type PlanHost,
  addPlanAsTasks,
  approvedPlanText,
  newPlan,
  offeredPlan,
  planListText,
  tasksAfterPlan,
} from './plan'
import { drawPlanLine } from './plan-view'
import { bandSetting, bandView, drawBand, isEngineDrawing, isTimed } from './band'
import {
  type AssignInput,
  answersText,
  asksParts,
  assignTask,
  assignment,
  forYouCommand,
  forYouStatus,
  personOnlyRefusal,
  putBackAnswers,
  stillAsked,
  takeAnswers,
  withdrawTask,
  withdrawnLead,
} from './for-you'
import { CHANGE_FAILED, refusedParts } from './replies'
import { type ToastParts, showToast } from './toast'
import type {
  BoardCallRow,
  BoardChecks,
  BoardList,
  BoardPersonChange,
  BoardPlan,
  BoardTask,
  BoardToolSight,
  BoardTrend,
} from '../types'
import {
  EMPTY_LIST,
  MAX_AGENT_LISTS,
  LIST_END,
  STATUSES,
  TRACKER_TEXT_IS_DATA,
  type AddedMany,
  addTasks,
  escaped,
  findTask,
  isForPerson,
  isListShownEmpty,
  isStatus,
  ownList,
  listText,
  moveTask,
  numbersText,
  removeTask,
  setStatus,
  taskText,
  titleRefusal,
  withTrackerNotice,
} from './tasks'
import { addedRow, drawCallRow, listRow, movedRow, removedRow, statusRow } from './transcript'
import { EMPTY_TREND, trendMeasured, trendTurnEnded, trendTurnStarted } from './trend'
import {
  EMPTY_VITALS,
  type Vitals,
  sessionText,
  sharedContext,
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

const NEW_SESSION_REASONS: ReadonlySet<SessionEndReason> = new Set<SessionEndReason>([
  'clear',
  'resume',
])
const TOOL_ADD = 'mcp__handily-board__task_add'
const TREE_COMMAND = 'tree'
const TOOL_UPDATE = 'mcp__handily-board__task_update'
const TOOL_MOVE = 'mcp__handily-board__task_move'
const TOOL_LIST = 'mcp__handily-board__task_list'
const TOOL_ASSIGN = 'mcp__handily-board__task_assign'
const NOT_PLAN_TOOLS: ReadonlySet<string> = new Set([TOOL_LIST, TOOL_ASSIGN])
const MAIN_LOOP_ONLY = 'task_assign works only in the main loop; tell the main agent what you need.'
const REMOVED = 'removed'
const MOVE_EXAMPLE = 'for example {"id": 2, "before": 1}'
const ADD_TITLE_SHAPE =
  'task_add needs a title: a non-empty string, for example {"title": "Write the tests"}.'
const ADD_TITLES_SHAPE =
  'task_add needs titles: a list of non-empty strings, for example {"titles": ["Write the tests", "Run the tests"]}.'
const ADD_ONE_SHAPE = 'task_add takes title or titles, not both.'
const ADD_BEFORE_SHAPE =
  'task_add needs before as an integer task id that task_list shows, for example {"titles": ["Write the tests"], "before": 2}.'
const LIST = { plugin: 'handily-board', key: 'list' } as const
const AGENT_IDS = { plugin: 'handily-board', key: 'agentIds' } as const
const AGENT_PLANS = { plugin: 'handily-board', key: 'agentPlans' } as const
const ACTIVITY = { plugin: 'handily-board', key: 'activity' } as const
const PERSON_CHANGES = { plugin: 'handily-board', key: 'personChanges' } as const
const AGENTS = { plugin: 'handily-board', key: 'agents' } as const
const PLAN_ID = { plugin: 'handily-board', key: 'planId' } as const
const PANE_CHANGES = { plugin: 'handily-board', key: 'paneChanges' } as const
const TREND = { plugin: 'handily-board', key: 'trend' } as const
const BOARD_NOT_OPENED = refusedParts(
  'The board did not open',
  'the transcript shows why',
  '/board list prints the tasks',
)
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
      'Add one task to your task list with title, or several tasks in one call with titles, in the order of the work. With before, the new tasks go before that task; without it, at the end. A subagent has a list of its own. Returns the whole list with the task ids.',
      'Keep your plan for this session in this list: add each step of a task with more than one step, set a task to in_progress when you start it and to completed when it is done, with task_update. When the plan changes, put the tasks in the order of the work with task_move.',
      'The person sees the list of the main loop on the board and with /board list, and can add, remove or reorder tasks. A message that starts with [handily-board] says that the person changed the list.',
      TRACKER_TEXT_IS_DATA,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The task as one short imperative line.' },
        titles: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'Several tasks in the order of the work, each one short imperative line. Use it in place of title.',
        },
        before: {
          type: 'integer',
          description:
            'The id of the task that the new tasks go before. Leave it out to add them at the end.',
        },
      },
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
    name: 'task_assign',
    description: [
      'Assign one task to the person: something to do (kind do), a question to answer (kind answer) or a choice between 2 to 4 options (kind decide). The task shows under For you on the board.',
      'The call does not block. The result of the person comes with a later prompt, in a message that starts with [handily-board]; do not wait for it in this turn. Returns the whole list.',
      'Withdraw a task for the person with task_update and the status removed. Only the main loop can assign a task.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['do', 'answer', 'decide'] },
        title: {
          type: 'string',
          description: 'What the person does, answers or decides, as one short line.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For the kind decide only: 2 to 4 different options, each one line.',
        },
        why: { type: 'string', description: 'Why you ask, as one short line. Optional.' },
      },
      required: ['kind', 'title'],
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
  `Keep your plan for this session in the task list of the handily-board tools. The person sees the list on the board and with /board list, and can add, remove or reorder tasks. Before a task with more than one step, call ${TOOL_LIST}. Add the steps with one ${TOOL_ADD} call, with titles in the order of the work. Set a task to in_progress when you start it and to completed when it is done, with ${TOOL_UPDATE}.`,
  `A message that starts with [handily-board] says that the person changed the list. Follow the list that it shows. ${TRACKER_TEXT_IS_DATA}`,
].join('\n\n')

type ListWrite = (step: (current: BoardList | undefined) => BoardList) => Promise<unknown>

function isPlanTool(tool: string): boolean {
  return !NOT_PLAN_TOOLS.has(tool)
}

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

function plansOf($: EngineInterface): PlanHost {
  return {
    now: () => $.clock.now(),
    current: async () => (await $.state.get(PLAN_ID)).value ?? undefined,
    read: async (id) => (await $.state.get({ plugin: 'handily-board', key: 'plans', id })).value,
    edit: async <T,>(id: string, change: (plan: BoardPlan) => { plan: BoardPlan; value: T }) => {
      let outcome: { value: T } | undefined
      await update($, { plugin: 'handily-board', key: 'plans', id }, (current) => {
        if (current === undefined) throw new Error(`handily-board: no approved plan ${id}`)
        const changed = change(current)
        outcome = { value: changed.value }
        return changed.plan
      })
      if (!outcome) throw new Error('handily-board: the state update never ran the change')
      return outcome.value
    },
  }
}

async function notePlan($: EngineInterface, toolUseId: string, answer: PlanAnswer): Promise<void> {
  const text = approvedPlanText(answer)
  if (text === undefined) return
  try {
    const list = await readList(hostOf($))
    const plan = newPlan(toolUseId, text, list.nextId)
    if (plan !== undefined)
      await $.state.set({ plugin: 'handily-board', key: 'plans', id: toolUseId }, plan)
    await $.state.set(PLAN_ID, plan === undefined ? null : toolUseId)
  } catch (error) {
    $.ui.log(`handily-board: the approved plan was not kept: ${String(error)}`)
  }
}

async function notePaneChange($: EngineInterface): Promise<void> {
  try {
    await update($, PANE_CHANGES, (current = 0) => current + 1)
  } catch (error) {
    $.ui.log(`handily-board: the band may show a closed board late: ${String(error)}`, {
      to: 'debug',
    })
  }
}

async function planListLead($: EngineInterface): Promise<string | undefined> {
  const plan = await offeredPlan(plansOf($))
  return plan === undefined ? undefined : planListText(plan)
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

type Redraw = {
  timer: Timer | undefined
  bandTimer: Timer | undefined
  bandSawTab: boolean | undefined
}

function keepBandTime($: EngineInterface, redraw: Redraw, isTimed: boolean): void {
  if (!isTimed) {
    redraw.bandTimer?.cancel()
    redraw.bandTimer = undefined
    return
  }
  redraw.bandTimer ??= $.clock.every(REDRAW_INTERVAL_MS, () => {
    $.ui.invalidate('ui.render')
  })
}

function noteTabSeen($: EngineInterface, redraw: Redraw, isSeen: boolean): void {
  if (redraw.bandSawTab === undefined || redraw.bandSawTab === isSeen) return
  redraw.bandSawTab = undefined
  $.clock.after(0, () => {
    void notePaneChange($)
  })
}

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
  if (!panes.some((pane) => pane.isShown)) {
    if (redraw.bandSawTab === true) $.ui.invalidate('ui.render')
    return
  }
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
  return { text: planNote(lag, ownList(list).tasks.length > 0), calls: activity.calls }
}

async function recordNote($: EngineInterface, calls: number): Promise<void> {
  try {
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => ({ ...current, noteAt: calls }))
  } catch (error) {
    $.ui.log(`handily-board: the plan note was not recorded: ${String(error)}`, { to: 'debug' })
  }
}

type StepsKeep = Map<string, AgentStep>

type SessionKeeps = {
  vitals: VitalsKeep
  checks: ChecksKeep
  steps: StepsKeep
  pulses: AgentPulses
  breakdown: PartsKeep
  trend: TrendKeep
}

async function isTreeListed($: EngineInterface): Promise<boolean> {
  try {
    return (await $.command.list()).some((command) => command.name === TREE_COMMAND)
  } catch (error) {
    $.ui.log(`handily-board: the slash commands could not be listed: ${String(error)}`, {
      to: 'debug',
    })
    return false
  }
}

async function workOf($: EngineInterface, keeps: SessionKeeps): Promise<PaneWork> {
  const now = await $.clock.now()
  const { value: activity } = await $.state.get(ACTIVITY)
  const rows = withSteps(await agentView(agentHostOf($), now), keeps.steps)
  const agents = withStalls(rows, keeps.pulses, now)
  const trend = await trendOf($, keeps.trend)
  return {
    now,
    activity: activity ?? EMPTY_ACTIVITY,
    agents,
    vitals: keeps.vitals.current,
    checks: keeps.checks.current,
    hasTree: await isTreeListed($),
    context: {
      trend,
      parts: keeps.breakdown.view,
      isPartsDue: keeps.breakdown.view.kind === 'unread' || keeps.breakdown.isStale,
    },
  }
}

function noteStep(
  $: EngineInterface,
  steps: StepsKeep,
  agentId: string,
  stepped: TurnStepResult,
): void {
  const step = stepOf(stepped)
  if (step === undefined) return
  const drawn = stepText(steps.get(agentId) ?? null)
  steps.set(agentId, step)
  if (stepText(step) !== drawn) $.ui.invalidate('ui.render')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

type CheckedCall = ToolCheckInput & { tool_use_id: string }

type ChecksKeep = { current: BoardChecks }

type VitalsKeep = { current: Vitals; shared: string | undefined }

type PartsKeep = { view: PartsView; isStale: boolean }

type TrendKeep = { current: BoardTrend | undefined }

type WaitingAsk = { agentId: string | undefined; sight: BoardToolSight }

type AttentionKeep = {
  setting: StatusLineSetting
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
  const text = attentionText(rows)
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

async function waitOf($: EngineInterface, ask: WaitingAsk): Promise<Wait | undefined> {
  const { agentId } = ask
  if (agentId === undefined) return mainWait(ask.sight)
  const rows = await agentView(agentHostOf($), await $.clock.now())
  const row = rows.find((one) => one.id === agentId && one.look === 'needsYou')
  return row === undefined ? undefined : agentWait(row)
}

async function notifyOrToast($: EngineInterface, text: string, parts: ToastParts): Promise<void> {
  try {
    const sent = await $.ui.notify(text)
    if (sent.isSent) return
    $.ui.log(`handily-board: no desktop notice (${sent.reason}), so a toast shows it`, {
      to: 'debug',
    })
  } catch (error) {
    $.ui.log(`handily-board: the desktop notice failed: ${String(error)}`, { to: 'debug' })
  }
  showToast($, parts)
}

async function noticeWait($: EngineInterface, attention: AttentionKeep, callId: string) {
  const ask = attention.asks.get(callId)
  if (ask === undefined) return
  try {
    const wait = await waitOf($, ask)
    if (wait === undefined || (await isSessionTabSeen($))) return
    const session = escaped(lastSegment(await $.session.cwd()))
    if (attention.asks.get(callId) !== ask) return
    await notifyOrToast($, noticeText(session, wait), noticeParts(session, wait))
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
  keep: VitalsKeep,
  change: (vitals: Vitals) => Vitals,
): Promise<void> {
  const now = await $.clock.now()
  const drawn = sessionText(keep.current)
  const details = detailsText(keep.current, now)
  keep.current = change(keep.current)
  if (sessionText(keep.current) !== drawn || detailsText(keep.current, now) !== details) {
    $.ui.invalidate('ui.render')
  }
}

async function shareContext($: EngineInterface, machine: Machine, keep: VitalsKeep): Promise<void> {
  const context = sharedContext(keep.current)
  const shared = JSON.stringify(context)
  if (shared === keep.shared) return
  keep.shared = shared
  await updateProgress(sessionsHost($), machine, (progress, now) =>
    withContext(progress, context, now),
  )
}

async function readUsage($: EngineInterface, keep: VitalsKeep): Promise<void> {
  try {
    const usage = await $.session.usage()
    await noteVitals($, keep, (vitals) => withUsage(vitals, usage))
  } catch (error) {
    $.ui.log(`handily-board: no context or cost on this host: ${String(error)}`, { to: 'debug' })
    await noteVitals($, keep, withoutUsage)
  }
}

async function countParts($: EngineInterface, keep: PartsKeep): Promise<void> {
  keep.isStale = false
  if (keep.view.kind !== 'read') {
    keep.view = COUNTING_PARTS
    $.ui.invalidate('ui.render')
  }
  try {
    const { breakdown } = (await $.session.usage({ breakdown: BREAKDOWN_DETAIL })).context
    keep.view = breakdown === undefined ? ABSENT_PARTS : { kind: 'read', parts: partsOf(breakdown) }
  } catch (error) {
    $.ui.log(`handily-board: the context parts were not counted: ${String(error)}`)
    keep.view = FAILED_PARTS
  }
  $.ui.invalidate('ui.render')
}

async function trendOf($: EngineInterface, keep: TrendKeep): Promise<BoardTrend> {
  keep.current ??= (await $.state.get(TREND)).value ?? EMPTY_TREND
  return keep.current
}

async function setTrend($: EngineInterface, keep: TrendKeep, trend: BoardTrend): Promise<void> {
  keep.current = trend
  await $.state.set(TREND, trend)
}

async function isDetailsShown($: EngineInterface): Promise<boolean> {
  const isOpen = (await hostOf($).expanded()).includes(SESSION_DETAILS)
  return isOpen && (await isSessionTabSeen($))
}

async function noteTrend(
  $: EngineInterface,
  keep: TrendKeep,
  change: (trend: BoardTrend) => BoardTrend,
): Promise<void> {
  const before = await trendOf($, keep)
  const after = change(before)
  if (after === before) return
  await setTrend($, keep, after)
  if (after.tokens !== before.tokens) $.ui.invalidate('ui.render')
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

type RowNotes = Map<number, string>

function uiOf($: EngineInterface, notes: RowNotes, parts: PartsKeep): PaneUi {
  return {
    open: async (pane, focus) => {
      const opened = await $.ui.open(
        focus ? { id: pane.id, title: pane.title, focus } : { ...pane },
      )
      await notePaneChange($)
      return opened
    },
    close: async (id) => {
      await $.ui.close({ id })
      await notePaneChange($)
    },
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
    openFiles: async (taskId) => {
      await $.command.run({ command: TREE_COMMAND, args: `task ${String(taskId)}` })
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
    showToast: (parts) => {
      showToast($, parts)
    },
    log: (text) => {
      $.ui.log(text)
    },
    notes: () => notes,
    noteRow: (id, note) => {
      if (notes.get(id) === note) return
      if (note === undefined) notes.delete(id)
      else notes.set(id, note)
      $.ui.invalidate('ui.render')
    },
    countParts: () => countParts($, parts),
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
  const shown = isListShownEmpty(list) ? 'The task list is empty.' : listText(list)
  return withTrackerNotice(lead === '' ? shown : `${lead}\n\n${shown}`, list.tasks)
}

async function listResult(host: TaskHost, lead: string): Promise<string> {
  return listAnswer(await readList(host), lead)
}

type ModelAnswer = { deny: string } | { result: string; row: BoardCallRow | undefined }

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
  if (answer.row !== undefined) await keepRow($, toolUseId, answer.row)
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

type AddInput = { title: unknown; titles: unknown; before: unknown }

type AddPlan = { titles: string[]; isBatch: boolean; before: number | typeof LIST_END }

function isTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function addPlan(input: AddInput): AddPlan | { deny: string } {
  const { title, titles, before } = input
  if (title !== undefined && titles !== undefined) return { deny: ADD_ONE_SHAPE }
  if (before !== undefined && (typeof before !== 'number' || !Number.isInteger(before))) {
    return { deny: ADD_BEFORE_SHAPE }
  }
  const place = typeof before === 'number' ? before : LIST_END
  if (titles === undefined) {
    if (!isTitle(title)) return { deny: ADD_TITLE_SHAPE }
    return { titles: [title.trim()], isBatch: false, before: place }
  }
  if (!Array.isArray(titles) || titles.length === 0 || !titles.every(isTitle)) {
    return { deny: ADD_TITLES_SHAPE }
  }
  return { titles: titles.map((one) => one.trim()), isBatch: true, before: place }
}

function titlesRefusal(plan: AddPlan): string | undefined {
  for (const [index, title] of plan.titles.entries()) {
    const refusal = titleRefusal(title)
    if (refusal === undefined) continue
    const which = plan.isBatch ? ` title ${String(index + 1)}` : ''
    return `task_add refused${which}: ${refusal}`
  }
  return undefined
}

function placeText(before: number | typeof LIST_END): string {
  return before === LIST_END ? '' : ` before task ${String(before)}`
}

function addedLead(tasks: readonly BoardTask[], before: number | typeof LIST_END): string {
  const [task] = tasks
  if (tasks.length === 1 && task) {
    return `Added task ${String(task.id)}${placeText(before)}: ${taskText(task)}.`
  }
  const ids = tasks.map((one) => String(one.id)).join(', ')
  return `Added tasks ${ids}${placeText(before)}.`
}

type AddOutcome = AddedMany | { refusal: string } | { missing: number; numbers: string }

async function modelAdd(
  host: TaskHost,
  input: AddInput,
  claim: () => Promise<string | undefined>,
): Promise<ModelAnswer> {
  const plan = addPlan(input)
  if ('deny' in plan) return plan
  const refused = titlesRefusal(plan)
  if (refused !== undefined) return { deny: refused }
  const unclaimed = await claim()
  if (unclaimed !== undefined) return { deny: `task_add refused: ${unclaimed}` }
  const { before } = plan
  const outcome = await host.edit<AddOutcome>((list) => {
    if (before !== LIST_END && !findTask(list, before)) {
      return { list, value: { missing: before, numbers: numbersText(list.tasks) } }
    }
    const added = addTasks(list, plan.titles, { by: 'model', item: null }, before)
    return { list: 'refusal' in added ? list : added.list, value: added }
  })
  if ('missing' in outcome) {
    const known = knownIds(outcome.numbers)
    return {
      deny: `No task ${String(outcome.missing)}. ${known} Call task_list, then task_add with one of its ids as before.`,
    }
  }
  if ('refusal' in outcome) return { deny: `task_add refused: ${outcome.refusal}` }
  const { tasks } = outcome
  const [task] = tasks
  return {
    result: await listResult(host, addedLead(tasks, before)),
    row: tasks.length === 1 && task ? addedRow(task) : undefined,
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
    if (isForPerson(task) && status !== REMOVED) return { list, value: { task, numbers: '' } }
    const removed = isForPerson(task) ? withdrawTask(list, id) : removeTask(list, id)
    const next = status === REMOVED ? removed : setStatus(list, id, status)
    return { list: next, value: { task, numbers: '' } }
  })
  const { task } = outcome
  if (!task) {
    return {
      deny: `No task ${String(id)}. ${knownIds(outcome.numbers)} Call task_list to see them.`,
    }
  }
  if (isForPerson(task)) {
    if (status !== REMOVED) return { deny: personOnlyRefusal(task) }
    return {
      result: await listResult(host, withdrawnLead(task)),
      row: removedRow(task),
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
  const asked = findTask(await readList(host), id)
  if (asked && isForPerson(asked)) {
    return {
      deny: `Task ${String(id)} is for the person; its place is the order in which you asked. task_move moves only your own tasks.`,
    }
  }
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

async function modelAssign(
  host: TaskHost,
  input: AssignInput,
  agentId: string | undefined,
  now: number,
): Promise<{ answer: ModelAnswer; task: BoardTask | undefined }> {
  if (agentId !== undefined) return { answer: { deny: MAIN_LOOP_ONLY }, task: undefined }
  const asked = assignment(input)
  if ('deny' in asked) return { answer: asked, task: undefined }
  const outcome = await host.edit((list) => assignTask(list, asked, now))
  if ('refusal' in outcome) {
    return { answer: { deny: `task_assign refused: ${outcome.refusal}` }, task: undefined }
  }
  const { task } = outcome
  const lead = `Assigned task ${String(task.id)} to the person (${asked.kind}). The result comes with a later prompt; do not wait for it in this turn.`
  return { answer: { result: await listResult(host, lead), row: undefined }, task }
}

async function takeAnswered($: EngineInterface): Promise<BoardTask[]> {
  return hostOf($).edit(takeAnswers)
}

async function putBackAnswered($: EngineInterface, taken: readonly BoardTask[]): Promise<void> {
  if (taken.length === 0) return
  try {
    await hostOf($).edit((list) => ({ list: putBackAnswers(list, taken), value: undefined }))
  } catch (error) {
    $.ui.log(`handily-board: the answers for Claude were lost: ${String(error)}`)
  }
}

function toolFailed($: EngineInterface, tool: string, error: HookFailure): { deny: string } {
  $.ui.log(`handily-board: ${tool} failed (${error.kind}): ${error.message ?? 'no message'}`)
  const reason = withoutFinalPeriod(error.message ?? error.kind)
  return { deny: `handily-board could not answer ${tool}: ${reason}.` }
}

export const register: Register = (on, options) => {
  const mode = boardMode(options)
  const band = bandSetting(options)
  const redraw: Redraw = { timer: undefined, bandTimer: undefined, bandSawTab: undefined }
  const machine = newMachine(SESSIONS_PANE.id)
  const vitals: VitalsKeep = { current: EMPTY_VITALS, shared: undefined }
  const checks: ChecksKeep = { current: EMPTY_CHECKS }
  const breakdown: PartsKeep = { view: UNREAD_PARTS, isStale: false }
  const trend: TrendKeep = { current: undefined }
  const steps: StepsKeep = new Map()
  const notes: RowNotes = new Map()
  const asks: BoardTask[] = []
  const pulses = newPulses()
  const attention: AttentionKeep = {
    setting: statusLineSetting(options),
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
        '[machine | add <text|id> | rm <n> | mv <n> before <m>|top|bottom | edit <n> <title> | done <n> | start <n> | open <n> | answer <n> <text> | pick <n> <option> | reject <n> [reason] | undo <n> | plan | clear | list | stats | close]',
      immediate: true,
    })
    if (mode === 'always') await openUnasked(uiOf($, notes, breakdown))
    await $.state.set({ plugin: 'handily-board', key: 'ready' }, { root: $.plugin.root })
    const started = await next(e)
    const host = sessionsHost($)
    await removeExpiredKeys(host)
    await updateProgress(host, machine, (progress, now, list) => withTasks(progress, list, now))
    await readUsage($, vitals)
    await trendOf($, trend)
    vitals.shared = undefined
    await shareContext($, machine, vitals)
    return started
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await noteVitals($, vitals, (current) => withMeasure(current, e))
    const { tokens } = e.context
    if (e.changed.includes('context') && tokens !== undefined) {
      await noteTrend($, trend, (current) => trendMeasured(current, tokens))
    }
    await shareContext($, machine, vitals)
    return measured
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    const isMainCompaction = e.agentId === undefined && e.trigger !== 'precompute'
    if (isMainCompaction && compacted.skip === undefined) {
      await setTrend($, trend, EMPTY_TREND)
      breakdown.isStale = true
      await noteVitals($, vitals, withCompaction)
    }
    return compacted
  }).catch((_$, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await noteVitals($, vitals, withTurnStart)
      await noteTrend($, trend, trendTurnStarted)
    }
    await updateProgress(sessionsHost($), machine, (progress, now, list) =>
      withTasks(startTurn(progress, now), list, now),
    )
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    if (agentId === undefined) return yield* next(e)
    heard(pulses, agentId, await $.clock.now())
    const stepped = yield* next(e)
    heard(pulses, agentId, await $.clock.now())
    noteStep($, steps, agentId, stepped)
    return stepped
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      const asked = stillAsked(await readList(hostOf($)), asks.splice(0))
      const parts = asksParts(asked)
      if (parts !== undefined && !(await isSessionTabSeen($))) showToast($, parts)
      await noteVitals($, vitals, (current) => withTurnEnd(current, e.durationMs))
      await noteTrend($, trend, trendTurnEnded)
      if (await isDetailsShown($)) await countParts($, breakdown)
      else breakdown.isStale = true
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
    steps.clear()
    pulses.heardAt.clear()
    pulses.callsFrom.clear()
    if (NEW_SESSION_REASONS.has(e.reason)) {
      await noteVitals($, vitals, withClear)
      await setTrend($, trend, EMPTY_TREND)
      breakdown.view = UNREAD_PARTS
      await shareContext($, machine, vitals)
    }
    if (e.reason === 'clear') {
      attention.asks.clear()
      await refreshStatus($, attention)
      checks.current = EMPTY_CHECKS
      await resetList(hostOf($))
      await $.state.set(PERSON_CHANGES, [])
      await $.state.set(PLAN_ID, null)
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
    const answered = await takeAnswered($)
    try {
      const answers = answered.length === 0 ? undefined : answersText(answered)
      const isTold = taken.length > 0 || answers !== undefined
      const list = await readList(hostOf($))
      const changes = isTold ? personNote(taken, list, answers) : undefined
      const notes = [changes, plan?.text].filter((text) => text !== undefined)
      if (notes.length === 0) return await next(e)
      const entered = await next({ ...e, context: [...(e.context ?? []), ...notes] })
      if (entered.drop !== undefined) {
        await putBackChanges($, taken)
        await putBackAnswered($, answered)
        return entered
      }
      if (plan) await recordNote($, plan.calls)
      return entered
    } catch (error) {
      await putBackChanges($, taken)
      await putBackAnswered($, answered)
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
      if (e.agentId !== undefined) heard(pulses, e.agentId, await $.clock.now())
      const answer = await next(e)
      if (e.agentId === undefined && isPlanTool(e.tool) && answer.deny === undefined) {
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
      await noteVitals($, vitals, (current) =>
        withTurnCall(current, e.tool, answer.isError === true),
      )
      return answer
    }
    const callId = e.tool_use_id
    const from = await $.clock.now()
    heard(pulses, agentId, from)
    pulses.callsFrom.set(callId, from)
    try {
      return await untilSettled($, attention, callId, () =>
        trackAgentCall(agentHostOf($), agentId, { id: callId, ...sight }, () => next(e)),
      )
    } finally {
      pulses.callsFrom.delete(callId)
      heard(pulses, agentId, await $.clock.now())
    }
  }).catch(($, e, next) => {
    $.ui.log(`handily-board: the work was not tracked (${next.error.kind})`, { to: 'debug' })
    return next(e)
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId === undefined && next.origin.plugin === ENGINE_ORIGIN) {
      await notePlan($, e.tool_use_id, answer)
    }
    return answer
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const { tool_use_id: callId } = e
    if (callId === undefined || next.origin.plugin !== ENGINE_ORIGIN) return verdict
    if (e.agentId !== undefined) heard(pulses, e.agentId, await $.clock.now())
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
    heard(pulses, spawned.agentId, at)
    const facts = {
      description: e.description,
      type: e.subagentType,
      name: e.name,
      parentId: e.parentAgentId,
    }
    await noteSpawn(agentHostOf($), spawned.agentId, facts, at)
    if (e.parentAgentId === undefined) await noteVitals($, vitals, withTurnSpawn)
    await shareAgents($, machine)
    return spawned
  }).catch((_$, e, next) => next(e))

  on('tool.call', { tool: TOOL_ADD }, async ($, e) =>
    answerWithRow(
      $,
      e.tool_use_id,
      await modelAdd(
        modelHostOf($, e.agentId),
        { title: e.title, titles: e.titles, before: e.before },
        () => claimAgentList($, e.agentId),
      ),
    ),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_UPDATE }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelUpdate(modelHostOf($, e.agentId), e.id, e.status)),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_MOVE }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelMove(modelHostOf($, e.agentId), e.id, e.before)),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_ASSIGN }, async ($, e) => {
    const input = { kind: e.kind, title: e.title, options: e.options, why: e.why }
    const assigned = await modelAssign(hostOf($), input, e.agentId, await $.clock.now())
    if (assigned.task !== undefined) asks.push(assigned.task)
    return answerWithRow($, e.tool_use_id, assigned.answer)
  }).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_LIST }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelList(modelHostOf($, e.agentId))),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))

  on('command.run', { command: 'board' }, async ($, e) => {
    const host = hostOf($)
    const command = parseBoardCommand(e.args)
    switch (command.kind) {
      case 'session':
        return { text: await sessionCommand(uiOf($, notes, breakdown), mode) }
      case 'machine':
        return { text: await openBoard(uiOf($, notes, breakdown), SESSIONS_PANE) }
      case 'close':
        return { text: await closeBoard(uiOf($, notes, breakdown)) }
      case 'clear':
        return { text: (await personClear(host)).text }
      case 'list': {
        const lead = await planListLead($)
        const listed = await listReply(host)
        return { text: lead === undefined ? listed : `${lead}\n\n${listed}` }
      }
      case 'plan':
        return { text: (await addPlanAsTasks(plansOf($), host, undefined)).text }
      case 'stats':
        await countParts($, breakdown)
        return {
          text: statsText(await workOf($, { vitals, checks, steps, pulses, breakdown, trend })),
        }
      case 'add':
        return { text: (await personAdd(host, command.text)).text }
      case 'rm':
        return { text: (await personRemove(host, command.text)).text }
      case 'mv':
        return { text: await personPlace(host, command.text) }
      case 'edit':
        return { text: await personEdit(host, command.text) }
      case 'status': {
        const now = await $.clock.now()
        const forYou = await forYouStatus(host, command.text, command.word, now)
        return { text: (forYou ?? (await personStatus(host, command.text, command.word))).text }
      }
      case 'answer':
      case 'pick':
      case 'reject':
      case 'undo':
        return { text: await forYouCommand(host, command.kind, command.text, await $.clock.now()) }
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const yieldBand = () => {
      keepBandTime($, redraw, false)
      return next(e)
    }
    if (band === 'off' || e.props.hasSurvey) return yieldBand()
    await $.state.get(PANE_CHANGES)
    const isTabSeen = await isSessionTabSeen($)
    redraw.bandSawTab = isTabSeen
    if (isTabSeen) return yieldBand()
    const host = hostOf($)
    const plans = plansOf($)
    const { value: activity = EMPTY_ACTIVITY } = await $.state.get(ACTIVITY)
    const plan = await offeredPlan(plans)
    const view = bandView(await readList(host), plan, activity, await $.clock.now())
    if (view === undefined) return yieldBand()
    const beneath = await next(e)
    if (!isEngineDrawing(beneath)) {
      keepBandTime($, redraw, false)
      return beneath
    }
    keepBandTime($, redraw, isTimed(view))
    const { Box, Text, Button } = $.ui.resolve(e)
    const ui = uiOf($, notes, breakdown)
    const failed = (error: unknown) => {
      ui.log(`handily-board: the board did not open from the band: ${String(error)}`)
      ui.showToast(BOARD_NOT_OPENED)
    }
    return drawBand({ Box, Text, Button }, view, e.props.bodyColumns, {
      open: () => {
        showPane(ui, TASKS_PANE).then((opened) => {
          if (!opened.isPlaced) failed(opened.reason)
        }, failed)
      },
      addPlan: (id) => {
        addPlanAsTasks(plans, host, id).then(
          (reply) => {
            if (reply.toastParts !== undefined) ui.showToast(reply.toastParts)
          },
          (error: unknown) => {
            ui.log(`handily-board: the plan was not added: ${String(error)}`)
            ui.showToast(CHANGE_FAILED)
          },
        )
      },
    })
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (isBoardPaneId(e.id)) await notePaneChange($)
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

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== PLAN_TOOL || e.props.isErrored) return next(e)
    const plans = plansOf($)
    const plan = await plans.read(e.props.tool_use_id)
    if (plan === undefined) return next(e)
    const host = hostOf($)
    const isCurrent = (await plans.current()) === plan.id
    const tasksAfter = tasksAfterPlan(plan, await readList(host))
    const drawn = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const add = () => {
      addPlanAsTasks(plans, host, plan.id).then(
        (reply) => {
          if (reply.toastParts !== undefined) showToast($, reply.toastParts)
        },
        (error: unknown) => {
          $.ui.log(`handily-board: the plan was not added: ${String(error)}`)
          showToast($, CHANGE_FAILED)
        },
      )
    }
    const line = drawPlanLine({ Box, Text, Button }, { plan, isCurrent, tasksAfter }, add)
    return Box({ flexDirection: 'column', children: [drawn, line] })
  })

  on('ui.render', { component: 'Pane', requestId: TASKS_PANE.id }, async ($, e) => {
    noteTabSeen($, redraw, true)
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const { bodyColumns, placement } = e.props
    const elements = { Box, Text, Button, Input, bodyColumns, isInline: placement === 'inline' }
    const work = await workOf($, { vitals, checks, steps, pulses, breakdown, trend })
    clearStatus($, attention)
    startRedraw($, redraw, attention)
    return drawPane(elements, hostOf($), plansOf($), uiOf($, notes, breakdown), work)
  })

  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE.id }, async ($, e) => {
    noteTabSeen($, redraw, false)
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
