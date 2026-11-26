import { update } from 'claude-code'
import type {
  AgentStatus,
  EngineInterface,
  HookFailure,
  PromptOrigin,
  PromptSubmitInput,
  PromptSubmitResult,
  Register,
  RenderSurface,
  SessionEndReason,
  SessionRateLimit,
  TelemetryLogInput,
  Timer,
  ToolCheckInput,
  ToolCheckResult,
  ToolSpec,
  TurnCompleteReason,
  TurnStepResult,
} from 'claude-code'
import {
  type AskedQuestions,
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
  elapsedText,
  isNoteDue,
  isTaskTool,
  planLag,
  planNote,
  toolTarget,
  withClocks,
  withMainCall,
  withScriptSteps,
  withBoardUse,
  isScriptCall,
  RESUME_NOTE,
  withPlanUpdate,
} from './activity'
import {
  type AgentHost,
  type AgentPulses,
  type AgentRow,
  type AgentStep,
  type SeenEnd,
  NEEDS_YOU_AFTER_MS,
  agentView,
  heard,
  labelledAgents,
  noteAgentList,
  noteAsk,
  noteEndsSeen,
  noteRunStart,
  noteSettled,
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
  type PromptFill,
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
import {
  type BoardLog,
  EMPTY_LOG,
  LOG_KEPT,
  type LogKind,
  logDetail,
  logText,
  withEvent,
} from './log'
import { keepChangedPaletteSetting, keepPaletteSetting, shownPalette } from './palette-setting'
import {
  type RequestFacts,
  NO_REQUEST,
  withFirstToken,
  withMode,
  withRequestsCleared,
  withStep,
} from './request'
import { sessionBlockText } from './session'
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
import { lastSegment } from './names'
import { openedKeys, shownNames, stepText } from './agent-rows'
import { DEFAULT_PALETTE } from './palette'
import { drawMachine, drawMachineGlance } from './machine'
import { type Machine, type SessionsHost, newMachine, readMachine } from './sessions'
import {
  type WarnHost,
  type WarnKeep,
  newWarnKeep,
  randomUnit,
  removeStaleWarnings,
  warnLimits,
} from './limit-warn'
import {
  BACKGROUND_TICK_MS,
  type BackgroundKeep,
  NO_TURN,
  type StopFacts,
  besideAskText,
  forgetBackground,
  isMainStop,
  noteAbortedTurn,
  noteStartSource,
  noteStartup,
  isWaiting,
  newBackgroundKeep,
  noteStop,
  noteTurnStart,
  waitingStatusText,
} from './background'
import { askedQuestion } from './waits'
import { type PaneWork, agentsOpener, drawGlance, drawPane } from './pane'
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
import {
  type StripKeep,
  bandSetting,
  bandView,
  drawBand,
  forgetStrip,
  stripGroup,
  heldRows,
  isEngineDrawing,
  isLiveRow,
  isTimed,
  newStripKeep,
  stripRows,
} from './band'
import {
  type AssignInput,
  CLOSE_HOWS,
  type CloseInput,
  type PromptSend,
  type TakenAnswers,
  answersText,
  answersToTell,
  asksParts,
  assignTask,
  assignment,
  closeTask,
  forYouCommand,
  forYouStatus,
  isNothingTaken,
  keptPrompts,
  openTasksLine,
  personOnlyRefusal,
  putBackAnswers,
  reopenedText,
  stillAsked,
  takeAnswers,
} from './for-you'
import {
  type PersonWords,
  forgetPersonWords,
  keepChatOpen,
  newPersonWords,
  noteChatMarks,
} from './chat'
import { CHANGE_FAILED, refusedParts } from './replies'
import {
  EMPTY_FINDINGS,
  type FindingsHost,
  findingRefusal,
  withFinding,
  withoutSentFixes,
} from './findings'
import { commandOf } from './retry'
import type { ToastParts } from './toast'
import {
  drawnSignals,
  keepChangedGlyphSetting,
  keepGlyphSetting,
  PLAIN_SIGNALS,
  sessionSignals,
  showGlyphToast,
} from './toasting'
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
import {
  addedManyRow,
  addedRow,
  assignedRow,
  drawCallRow,
  listRow,
  movedRow,
  removedRow,
  statusRow,
} from './transcript'
import { EMPTY_TREND, trendMeasured, trendTurnEnded, trendTurnStarted } from './trend'
import {
  EMPTY_VITALS,
  type Vitals,
  isEditTool,
  hasCarriedLimits,
  withMeasure,
  withClear,
  withCompaction,
  withTurnCall,
  withTurnEnd,
  withTurnSpawn,
  withTurnStart,
  withSnapshot,
  withUsage,
  withoutUsage,
} from './vitals'
import {
  type SnapshotHost,
  type SnapshotKeep,
  type SnapshotVariable,
  noteSnapshot,
  snapshotKeep,
} from './usage-snapshot'

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
const TOOL_CLOSE = 'mcp__handily-board__task_close'
const TOOL_FINDING = 'mcp__handily-board__finding_add'
const NOT_PLAN_TOOLS: ReadonlySet<string> = new Set([
  TOOL_LIST,
  TOOL_ASSIGN,
  TOOL_CLOSE,
  TOOL_FINDING,
])
const FINDING_MAIN_LOOP_ONLY =
  'finding_add works only in the main loop; tell the main agent what you found.'
const MAIN_LOOP_ONLY = 'task_assign works only in the main loop; tell the main agent what you need.'
const CLOSE_MAIN_LOOP_ONLY =
  'task_close works only in the main loop; tell the main agent what the person did.'
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
const FINDINGS = { plugin: 'handily-board', key: 'findings' } as const
const BOARD_NOT_OPENED = refusedParts(
  'The board did not open',
  'the transcript shows why',
  '/board list prints the tasks',
)
const REDRAW_INTERVAL_MS = 10_000
const CLOCK_INTERVAL_MS = 1_000
const ENGINE_ORIGIN = 'engine'
const DECISION_EVENT = 'tool_decision'
const REJECTED_DECISION = 'reject'
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
      'When a release, a merge, a cleanup or a delete waits for the person, assign a decide task with the options go and not now, and act only after the answer go, while a permission prompt stays as it is.',
      'The call does not block. The result of the person comes with a later prompt: an answer or a choice that the person presses on the board comes as their own prompt, which names the task, and any other result in a message that starts with [handily-board]; do not wait for it in this turn. Returns the whole list.',
      'Close a task for the person with task_close when you did it, when the person says in the chat that they did it, or when it is no longer needed. Only the main loop can assign a task.',
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
        recommended: {
          anyOf: [{ type: 'integer' }, { type: 'string' }],
          description:
            'Optional. For the kind decide: the number of the option that you recommend, from 1. For the kind answer: the answer that you recommend, as one line of at most 200 characters. The person accepts it with one click on the board or one word in the chat.',
        },
        why: { type: 'string', description: 'Why you ask, as one short line. Optional.' },
      },
      required: ['kind', 'title'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'task_close',
    description: [
      'Close one task that you assigned to the person. how claude_did: you did it yourself, with a note that says what you did; only for the kind do. how person_did: the person said in the chat that they did, answered or decided it; copy their words exactly into said, and add the answer for the kind answer or the option number for the kind decide. how not_needed: the task is no longer needed, with a note that says why.',
      'Never close an answer or decide task by your own choice. The board checks said against the recent prompts of the person and shows the person who closed the task. Only the main loop can close a task. Returns the whole list.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          description: 'The id of the task for the person that task_list shows.',
        },
        how: { type: 'string', enum: [...CLOSE_HOWS] },
        note: {
          type: 'string',
          description:
            'What you did, or why the task is no longer needed, as one line of at most 200 characters. Required for claude_did and not_needed.',
        },
        said: {
          type: 'string',
          description:
            'The words of the person, copied exactly from their prompt, as one line of at most 200 characters. Required for person_did.',
        },
        answer: {
          type: 'string',
          description:
            'For the kind answer with person_did: the answer of the person, as one line of at most 1000 characters.',
        },
        option: {
          type: 'integer',
          minimum: 1,
          maximum: 4,
          description:
            'For the kind decide with person_did: the number of the option that the person chose, from 1.',
        },
      },
      required: ['id', 'how'],
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
  {
    name: 'finding_add',
    description: [
      'Record a finding outside your task: a bug, a risk or a gap that you noticed and do not fix now. The finding shows under Findings on the board, and the person files it in the tracker, hands it back to you as a prompt, or dismisses it.',
      'The call does not block and changes nothing else. Do not act on the finding in this turn. Only the main loop can record a finding.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'The finding as one line of at most 200 characters; it becomes the title of a tracker record when the person files it.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
]

export const PROMPT_SECTION_ID = 'handily-board:tasks'

export const PROMPT_SECTION_TEXT = [
  '# Session task list',
  `Keep your plan for this session in the task list of the handily-board tools. The person sees the list on the board and with /board list, and can add, remove or reorder tasks. Before a task with more than one step, call ${TOOL_LIST}. Add the steps with one ${TOOL_ADD} call, with titles in the order of the work. Set a task to in_progress when you start it and to completed when it is done, with ${TOOL_UPDATE}.`,
  `A message that starts with [handily-board] says that the person changed the list. Follow the list that it shows. ${TRACKER_TEXT_IS_DATA}`,
  'Close a task for the person with task_close when you did it, when the person says in the chat that they did, answered or decided it, or when it is no longer needed; never close an answer or decide task by your own choice.',
  'When you have a recommended option or answer for a decide or answer task, give it with recommended in task_assign.',
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

async function fillPrompt($: EngineInterface, text: string): Promise<PromptFill> {
  const draft = await $.prompt.read()
  const filled = await $.prompt.fill(
    draft.text.trim() === '' ? { text } : { text: ` ${text}`, mode: 'append' },
  )
  return { isFilled: filled.isFilled, refusal: filled.refusal }
}

async function submitPrompt($: EngineInterface, log: LogKeep, text: string): Promise<PromptSend> {
  try {
    const entered = await $.prompt.submit({ text, asUser: true })
    if (entered.drop === undefined) {
      await notePromptText($, log, text)
      return { isSent: true }
    }
    return {
      isSent: false,
      reason: `the prompt was held back: ${withoutFinalPeriod(entered.drop)}`,
    }
  } catch (error) {
    $.ui.log(`handily-board: the answer was not submitted: ${String(error)}`)
    return { isSent: false, reason: 'this session did not take the prompt' }
  }
}

function findingsOf($: EngineInterface): FindingsHost {
  return {
    read: async () => (await $.state.get(FINDINGS)).value ?? EMPTY_FINDINGS,
    edit: async (change) => {
      await update($, FINDINGS, (current = EMPTY_FINDINGS) => change(current))
    },
    create: (title) => $.workitems.create({ title }),
    fillPrompt: (text) => fillPrompt($, text),
  }
}

async function modelFinding(
  $: EngineInterface,
  text: unknown,
  agentId: string | undefined,
): Promise<ModelAnswer> {
  if (agentId !== undefined) return { deny: FINDING_MAIN_LOOP_ONLY }
  const at = await $.clock.now()
  let outcome: { refusal: string } | { id: number } | undefined
  await update($, FINDINGS, (current = EMPTY_FINDINGS) => {
    const refusal = findingRefusal(text, current.findings.length)
    if (refusal !== undefined || typeof text !== 'string') {
      outcome = { refusal: refusal ?? 'finding_add needs text.' }
      return current
    }
    const added = withFinding(current, text, at)
    outcome = { id: added.finding.id }
    return added.findings
  })
  if (outcome === undefined) throw new Error('handily-board: the state update never ran the change')
  if ('refusal' in outcome) return { deny: outcome.refusal }
  return {
    result: `Recorded finding ${String(outcome.id)}. The person sees it under Findings on the board and files, fixes or dismisses it. Do not act on it in this turn.`,
    row: undefined,
  }
}

async function clearSentFixes($: EngineInterface, sent: string): Promise<void> {
  try {
    await update($, FINDINGS, (current = EMPTY_FINDINGS) => withoutSentFixes(current, sent))
  } catch (error) {
    $.ui.log(`handily-board: the sent fix was not cleared: ${String(error)}`)
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

type Redraw = {
  timer: Timer | undefined
  bandTimer: Timer | undefined
  bandSawTab: boolean | undefined
  strip: StripKeep
  clock: Timer | undefined
  clockTicks: number
  clockSurfaces: Map<RenderSurface, number>
  backgroundTimer: Timer | undefined
}

function keepBandTime($: EngineInterface, redraw: Redraw, isTimed: boolean): void {
  if (!isTimed) {
    redraw.bandTimer?.cancel()
    redraw.bandTimer = undefined
    return
  }
  redraw.bandTimer ??= $.clock.every(REDRAW_INTERVAL_MS, () => {
    redraw.strip.isTickDue = true
    $.ui.invalidate('ui.render')
  })
}

function isBandBehind(redraw: Redraw, isSeen: boolean): boolean {
  return redraw.bandSawTab !== undefined && redraw.bandSawTab !== isSeen
}

async function noteTabSeen($: EngineInterface, redraw: Redraw): Promise<void> {
  if (redraw.bandSawTab === undefined) return
  const isSeen = await isSessionTabSeen($)
  if (!isBandBehind(redraw, isSeen)) return
  redraw.bandSawTab = undefined
  $.ui.invalidate('ui.render')
}

function stopRedraw(redraw: Redraw): void {
  redraw.timer?.cancel()
  redraw.timer = undefined
  redraw.clockSurfaces.clear()
  stopClock(redraw)
}

function stopClock(redraw: Redraw): void {
  redraw.clock?.cancel()
  redraw.clock = undefined
}

function dropUndrawnSurfaces(redraw: Redraw): void {
  const previous = redraw.clockTicks
  redraw.clockTicks += 1
  for (const [surface, drawnAt] of redraw.clockSurfaces) {
    if (drawnAt < previous) redraw.clockSurfaces.delete(surface)
  }
}

async function tickClock($: EngineInterface, redraw: Redraw): Promise<void> {
  dropUndrawnSurfaces(redraw)
  if (redraw.clockSurfaces.size > 0 && (await isSessionTabSeen($))) $.ui.invalidate('ui.render')
  else stopClock(redraw)
}

function keepClock(
  $: EngineInterface,
  redraw: Redraw,
  surface: RenderSurface,
  isTicking: boolean,
): void {
  if (isTicking) redraw.clockSurfaces.set(surface, redraw.clockTicks)
  else redraw.clockSurfaces.delete(surface)
  if (redraw.clockSurfaces.size === 0) {
    stopClock(redraw)
    return
  }
  redraw.clock ??= $.clock.every(CLOCK_INTERVAL_MS, () => {
    tickClock($, redraw).catch((error: unknown) => {
      $.ui.log(`handily-board: the card clocks did not tick: ${String(error)}`, { to: 'debug' })
    })
  })
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
  return { text: planNote(lag, ownList(list).tasks.length > 0), calls: activity.sincePlan }
}

const SCRIPT_TOOL = 'REPL'

async function noteScriptSteps(
  $: EngineInterface,
  uses: readonly { name: string }[],
): Promise<void> {
  const steps = uses.filter((use) => use.name === SCRIPT_TOOL).length
  if (steps === 0) return
  try {
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => withScriptSteps(current, steps))
  } catch (error) {
    $.ui.log(`handily-board: the script steps were not counted: ${String(error)}`, { to: 'debug' })
  }
}

async function noteBoardUse($: EngineInterface): Promise<void> {
  const { value: activity = EMPTY_ACTIVITY } = await $.state.get(ACTIVITY)
  if (activity.usesBoard === true) return
  try {
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => withBoardUse(current))
  } catch (error) {
    $.ui.log(`handily-board: the board use was not kept: ${String(error)}`, { to: 'debug' })
  }
}

async function recordNote($: EngineInterface, calls: number): Promise<void> {
  try {
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => ({ ...current, noteAt: calls }))
  } catch (error) {
    $.ui.log(`handily-board: the plan note was not recorded: ${String(error)}`, { to: 'debug' })
  }
}

type StepsKeep = { last: Map<string, AgentStep>; counts: Map<string, number> }

type AgentRun = 'running' | 'ended'

type LogKeep = {
  current: BoardLog
  denied: Set<string>
  runs: Map<string, AgentRun>
}

type FailureKeep = { shown: Set<string> }

function withShownFailures(rows: AgentRow[], failures: FailureKeep): AgentRow[] {
  if (failures.shown.size === 0) return rows
  return rows.map((row) =>
    row.look === 'failed' && failures.shown.has(row.id) ? { ...row, isFailureSeen: true } : row,
  )
}

function noteShownFailures(
  $: EngineInterface,
  failures: FailureKeep,
  rows: readonly AgentRow[],
): void {
  const unseen = rows.filter((row) => stripGroup(row) === 'failed')
  if (unseen.length === 0) return
  for (const row of unseen) failures.shown.add(row.id)
  $.ui.invalidate('ui.render')
}

async function keepShownFailures($: EngineInterface, failures: FailureKeep): Promise<void> {
  if (failures.shown.size === 0) return
  const shown = new Set(failures.shown)
  try {
    await noteEndsSeen(agentHostOf($), 'isFailureSeen', shown)
    for (const id of shown) failures.shown.delete(id)
  } catch (error) {
    $.ui.log(`handily-board: the band may keep an ended agent row: ${String(error)}`, {
      to: 'debug',
    })
  }
}

type SessionKeeps = {
  failures: FailureKeep
  vitals: VitalsKeep
  checks: ChecksKeep
  request: RequestKeep
  steps: StepsKeep
  pulses: AgentPulses
  breakdown: PartsKeep
  trend: TrendKeep
  log: LogKeep
  background: BackgroundKeep
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

async function agentsNow(
  $: EngineInterface,
  keeps: Pick<SessionKeeps, 'steps' | 'pulses' | 'failures'>,
  now: number,
): Promise<AgentRow[]> {
  const rows = withSteps(await agentView(agentHostOf($), now), keeps.steps.last, keeps.steps.counts)
  return withShownFailures(withStalls(rows, keeps.pulses, now), keeps.failures)
}

async function workOf($: EngineInterface, keeps: SessionKeeps, inView?: string): Promise<PaneWork> {
  const now = await $.clock.now()
  const { value: activity } = await $.state.get(ACTIVITY)
  const agents = await agentsNow($, keeps, now)
  noteListedEnds($, keeps.log, agents)
  const trend = await trendOf($, keeps.trend)
  return {
    now,
    activity: activity ?? EMPTY_ACTIVITY,
    agents,
    vitals: keeps.vitals.current,
    background: keeps.background.current,
    checks: keeps.checks.current,
    request: keeps.request.current,
    hasTree: await isTreeListed($),
    context: {
      trend,
      parts: keeps.breakdown.view,
      isPartsDue: keeps.breakdown.view.kind === 'unread' || keeps.breakdown.isStale,
    },
    log: keeps.log.current,
    inView,
  }
}

const TURN_END_KINDS: Readonly<Record<TurnCompleteReason, LogKind>> = {
  answer: 'done',
  aborted: 'aborted',
  refusal: 'failed',
  error: 'failed',
}

const LISTED_END_KINDS: Readonly<Partial<Record<AgentStatus, LogKind>>> = {
  completed: 'done',
  failed: 'failed',
  killed: 'aborted',
}

function noteLogRun(keep: LogKeep, agentId: string): void {
  keep.runs.set(agentId, 'running')
}

function noteAgentEnd(
  $: EngineInterface,
  keep: LogKeep,
  at: number,
  event: { kind: LogKind; agentId: string; detail: string },
): void {
  if (keep.runs.get(event.agentId) === 'ended') return
  keep.runs.set(event.agentId, 'ended')
  noteEvent($, keep, at, event)
}

function listedEndKind(status: AgentStatus | null): LogKind | undefined {
  return status === null ? undefined : LISTED_END_KINDS[status]
}

function noteListedEnds($: EngineInterface, keep: LogKeep, rows: readonly AgentRow[]): void {
  for (const row of rows) {
    const kind = listedEndKind(row.listedStatus)
    const run = keep.runs.get(row.id)
    if (run === undefined) keep.runs.set(row.id, kind === undefined ? 'running' : 'ended')
    else if (kind !== undefined && run === 'running' && !row.isAging) {
      const at = row.startedAt + row.ageMs
      noteAgentEnd($, keep, at, { kind, agentId: row.id, detail: elapsedText(row.ageMs) })
    }
  }
}

function agentLabels(rows: readonly AgentRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, row.label]))
}

function noteEvent(
  $: EngineInterface,
  keep: LogKeep,
  at: number,
  event: { kind: LogKind; agentId: string | null; detail: string },
): void {
  keep.current = withEvent(keep.current, { at, ...event, detail: logDetail(event.detail) })
  $.ui.invalidate('ui.render')
}

function isPersonPrompt(e: PromptSubmitInput): boolean {
  const isPrompt = PERSON_ORIGINS.has(e.origin.kind) && e.command === undefined && !e.isMeta
  return isPrompt && e.text.trim() !== ''
}

async function notePromptText($: EngineInterface, keep: LogKeep, text: string): Promise<void> {
  noteEvent($, keep, await $.clock.now(), { kind: 'prompt', agentId: null, detail: text })
}

async function notePrompt($: EngineInterface, keep: LogKeep, e: PromptSubmitInput): Promise<void> {
  if (!isPersonPrompt(e)) return
  await notePromptText($, keep, e.text)
}

async function clearBandEnds($: EngineInterface, seen: SeenEnd): Promise<void> {
  try {
    await noteEndsSeen(agentHostOf($), seen)
  } catch (error) {
    $.ui.log(`handily-board: the band may keep an ended agent row: ${String(error)}`, {
      to: 'debug',
    })
  }
}

function callDetail(sight: BoardToolSight): string {
  return sight.target === null ? sight.tool : `${sight.tool} ${sight.target}`
}

function keepCallId(ids: Set<string>, callId: string): void {
  ids.add(callId)
  const [oldest] = ids
  if (ids.size > LOG_KEPT && oldest !== undefined) ids.delete(oldest)
}

type CallEvent = { callId: string; agentId: string | undefined; isError: boolean }

async function noteCallEvent(
  $: EngineInterface,
  keep: LogKeep,
  sight: BoardToolSight,
  call: CallEvent,
): Promise<void> {
  const { agentId, isError } = call
  if (keep.denied.delete(call.callId)) return
  if (!isError && !isEditTool(sight.tool)) return
  const kind = isError ? 'error' : 'edit'
  noteEvent($, keep, await $.clock.now(), {
    kind,
    agentId: agentId ?? null,
    detail: callDetail(sight),
  })
}

function noteStep(
  $: EngineInterface,
  steps: StepsKeep,
  agentId: string,
  stepped: TurnStepResult,
): void {
  steps.counts.set(agentId, (steps.counts.get(agentId) ?? 0) + 1)
  const step = stepOf(stepped)
  if (step === undefined) return
  const drawn = stepText(steps.last.get(agentId) ?? null)
  steps.last.set(agentId, step)
  if (stepText(step) !== drawn) $.ui.invalidate('ui.render')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

type CheckedCall = ToolCheckInput & { tool_use_id: string }

type ChecksKeep = { current: BoardChecks }

type RequestKeep = { current: RequestFacts }

type VitalsKeep = { current: Vitals }

type PartsKeep = { view: PartsView; isStale: boolean }

type TrendKeep = { current: BoardTrend | undefined }

type WaitingAsk = {
  agentId: string | undefined
  sight: BoardToolSight
  question: string | null
  since: number
}

type AttentionKeep = {
  setting: StatusLineSetting
  text: string | undefined
  refreshes: number
  asks: Map<string, WaitingAsk>
  background: BackgroundKeep
}

function hasAgentAsk(attention: AttentionKeep): boolean {
  return [...attention.asks.values()].some((ask) => ask.agentId !== undefined)
}

async function isSessionTabSeen($: EngineInterface): Promise<boolean> {
  return isTasksSeen(await $.ui.panes())
}

function askedQuestions(attention: AttentionKeep): AskedQuestions {
  return new Map([...attention.asks].map(([callId, ask]) => [callId, ask.question]))
}

async function attentionNow(
  $: EngineInterface,
  attention: AttentionKeep,
): Promise<string | undefined> {
  const now = await $.clock.now()
  const rows = hasAgentAsk(attention) ? await agentView(agentHostOf($), now) : []
  const signals = await sessionSignals($)
  const asked = attentionText(rows, signals, askedQuestions(attention))
  const waiting = attention.background.current
  let text = asked
  if (isWaiting(waiting)) {
    text =
      asked === undefined
        ? waitingStatusText(waiting, now, signals)
        : `${asked} · ${besideAskText(waiting, signals)}`
  }
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

function decidedCallId(e: TelemetryLogInput): string | undefined {
  if (e.to !== 'collector' || e.event !== DECISION_EVENT) return undefined
  const { tool_use_id: callId } = e.attributes
  return typeof callId === 'string' ? callId : undefined
}

function isRejected(e: TelemetryLogInput): boolean {
  return e.to === 'collector' && e.attributes.decision === REJECTED_DECISION
}

async function settleAsk(
  $: EngineInterface,
  attention: AttentionKeep,
  callId: string,
): Promise<void> {
  const ask = attention.asks.get(callId)
  if (ask === undefined) return
  attention.asks.delete(callId)
  if (ask.agentId === undefined) return
  await noteSettled(agentHostOf($), ask.agentId, callId)
  $.ui.invalidate('ui.render')
  await refreshStatus($, attention)
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
  if (agentId === undefined) return mainWait(ask.sight, ask.question)
  const rows = await agentView(agentHostOf($), await $.clock.now())
  const row = rows.find((one) => one.id === agentId && one.look === 'needsYou')
  return row === undefined ? undefined : agentWait(row, ask.question)
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
  showGlyphToast($, parts)
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
  keeps: { checks: ChecksKeep; log: LogKeep },
  attention: AttentionKeep,
  e: CheckedCall,
  verdict: ToolCheckResult,
) {
  const target = isRecord(e.input) ? toolTarget(e.input, await $.session.cwd()) : null
  const check = { decision: verdict.decision, tool: e.tool, target, agentId: e.agentId ?? null }
  keeps.checks.current = withCheck(keeps.checks.current, check)
  $.ui.invalidate('ui.render')
  if (verdict.decision === 'deny') {
    keepCallId(keeps.log.denied, e.tool_use_id)
    const detail = callDetail({ tool: e.tool, target })
    noteEvent($, keeps.log, await $.clock.now(), { kind: 'denied', agentId: check.agentId, detail })
  }
  if (verdict.decision !== 'ask') return
  const { agentId, tool_use_id: callId } = e
  if (agentId !== undefined) await noteAsk(agentHostOf($), agentId, callId, target)
  attention.asks.set(callId, {
    agentId,
    sight: { tool: e.tool, target },
    question: askedQuestion(e.tool, e.input),
    since: await $.clock.now(),
  })
  $.clock.after(NEEDS_YOU_AFTER_MS, () => {
    $.ui.invalidate('ui.render')
    void refreshStatus($, attention)
    void noticeWait($, attention, callId)
  })
}

async function noteVitals(
  $: EngineInterface,
  keep: VitalsKeep,
  change: (vitals: Vitals, now: number) => Vitals,
): Promise<void> {
  const now = await $.clock.now()
  const drawn = vitalsText(keep.current, now)
  keep.current = change(keep.current, now)
  if (vitalsText(keep.current, now) !== drawn) $.ui.invalidate('ui.render')
}

function vitalsText(vitals: Vitals, now: number): string {
  const view = {
    vitals,
    background: NO_TURN,
    waits: 0,
    checks: EMPTY_CHECKS,
    request: NO_REQUEST,
    now,
    signals: PLAIN_SIGNALS,
    palette: DEFAULT_PALETTE,
    hasResets: true,
  }
  return `${sessionBlockText(view)}\n${detailsText(vitals, now)}`
}

function noteRequest(
  $: EngineInterface,
  keep: RequestKeep,
  change: (facts: RequestFacts) => RequestFacts,
): void {
  const drawn = JSON.stringify(keep.current)
  keep.current = change(keep.current)
  if (JSON.stringify(keep.current) !== drawn) $.ui.invalidate('ui.render')
}

type ClassicFacts = { permission_mode?: string; agent_id?: string }

function noteMode($: EngineInterface, keep: RequestKeep, e: ClassicFacts): void {
  if (e.agent_id !== undefined) return
  noteRequest($, keep, (facts) => withMode(facts, e.permission_mode))
}

function warnHost($: EngineInterface): WarnHost {
  return {
    now: () => $.clock.now(),
    sessionId: () => $.session.id(),
    storeGet: (key) => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    storeDelete: (key) => $.store.delete(key),
    storeKeys: () => $.store.keys(),
    after: (ms, fn) => $.clock.after(ms, fn),
    debug: (line) => {
      $.ui.log(line, { to: 'debug' })
    },
    random: randomUnit,
    showToast: (parts) => {
      showGlyphToast($, parts)
    },
  }
}

async function warnFromVitals($: EngineInterface, keep: WarnKeep, vitals: Vitals): Promise<void> {
  await warnLimits(warnHost($), keep, vitals.limits, vitals.readings)
}

function snapshotVariable($: EngineInterface, name: SnapshotVariable): Promise<string | undefined> {
  switch (name) {
    case 'BASICLY_USAGE_SNAPSHOT_DIR':
      return $.env.get('BASICLY_USAGE_SNAPSHOT_DIR')
    case 'XDG_STATE_HOME':
      return $.env.get('XDG_STATE_HOME')
    case 'HOME':
      return $.env.get('HOME')
    case 'LOCALAPPDATA':
      return $.env.get('LOCALAPPDATA')
  }
}

function snapshotHost($: EngineInterface): SnapshotHost {
  return {
    now: () => $.clock.now(),
    variable: (name) => snapshotVariable($, name),
    isWindows: async () => (await $.session.info()).platform === 'windows',
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    log: (line) => {
      $.ui.log(line)
    },
  }
}

async function mergeSnapshot(
  $: EngineInterface,
  keep: SnapshotKeep,
  limits: readonly SessionRateLimit[],
): Promise<void> {
  try {
    await noteSnapshot(snapshotHost($), keep, limits)
  } catch (error) {
    $.ui.log(`handily-board: the usage snapshot was not merged: ${String(error)}`, {
      to: 'debug',
    })
  }
}

async function readUsage(
  $: EngineInterface,
  keep: VitalsKeep,
  snapshots: SnapshotKeep,
): Promise<void> {
  try {
    const usage = await $.session.usage()
    await mergeSnapshot($, snapshots, usage.rateLimits)
    await noteVitals($, keep, (vitals, now) =>
      withSnapshot(withUsage(vitals, usage, now), snapshots.windows),
    )
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

type UiKeeps = {
  notes: RowNotes
  parts: PartsKeep
  redraw: Redraw
  log: LogKeep
  words: PersonWords
}

function uiOf($: EngineInterface, keeps: UiKeeps): PaneUi {
  const { notes, parts, redraw, log, words } = keeps
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
    fillPrompt: (text) => fillPrompt($, text),
    submitPrompt: (text) => submitPrompt($, log, text),
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
      showGlyphToast($, parts)
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
    chat: () => ({ kept: words.kept, marks: words.marks }),
    keepChatOpen: (id) => {
      keepChatOpen(words, id)
      $.ui.invalidate('ui.render')
    },
    countParts: () => countParts($, parts),
    keepClock: (surface, isTicking) => {
      keepClock($, redraw, surface, isTicking)
    },
  }
}

function sessionsHost($: EngineInterface): SessionsHost {
  const debug = (line: string) => {
    $.ui.log(line, { to: 'debug' })
  }
  return {
    now: () => $.clock.now(),
    sessionId: () => $.session.id(),
    surfaces: () => $.session.surfaces(),
    home: () => $.env.get('HOME'),
    panes: () => $.ui.panes(),
    store: { list: (path) => $.fs.list(path), read: (path) => $.fs.read(path), debug },
    redraw: () => {
      $.ui.invalidate('ui.render')
    },
    every: (ms, fn) => $.clock.every(ms, fn),
    after: (ms, fn) => $.clock.after(ms, fn),
    debug,
  }
}

async function fillAsk(
  $: EngineInterface,
  machine: Machine,
  record: string,
  text: string,
): Promise<void> {
  let refusal: string | null
  try {
    const filled = await fillPrompt($, text)
    refusal = filled.isFilled ? null : (filled.refusal ?? 'the prompt box did not take it')
  } catch (error) {
    $.ui.log(`handily-board: the answer was not put in the prompt box: ${String(error)}`, {
      to: 'debug',
    })
    refusal = 'the prompt box did not take it'
  }
  machine.fills.set(record, { text, refusal })
  $.ui.invalidate('ui.render')
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
    row:
      tasks.length === 1 && task
        ? addedRow(task)
        : addedManyRow(tasks, before === LIST_END ? null : before),
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
    if (isForPerson(task)) return { list, value: { task, numbers: '' } }
    const next = status === REMOVED ? removeTask(list, id) : setStatus(list, id, status)
    return { list: next, value: { task, numbers: '' } }
  })
  const { task } = outcome
  if (!task) {
    return {
      deny: `No task ${String(id)}. ${knownIds(outcome.numbers)} Call task_list to see them.`,
    }
  }
  if (isForPerson(task)) return { deny: personOnlyRefusal(task, status === REMOVED) }
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
  return { answer: { result: await listResult(host, lead), row: assignedRow(task) }, task }
}

async function modelClose(
  host: TaskHost,
  input: CloseInput,
  agentId: string | undefined,
  words: PersonWords,
  now: number,
): Promise<ModelAnswer> {
  if (agentId !== undefined) return { deny: CLOSE_MAIN_LOOP_ONLY }
  const closed = await host.edit((list) => closeTask(list, input, words.kept, now))
  if ('deny' in closed) return closed
  return { result: await listResult(host, closed.lead), row: closed.row }
}

async function keepPersonWords($: EngineInterface, words: PersonWords, text: string) {
  try {
    words.seq += 1
    const said = { text, at: await $.clock.now(), seq: words.seq }
    words.kept = keptPrompts(words.kept, said, await readList(hostOf($)))
  } catch (error) {
    $.ui.log(`handily-board: the prompt was not kept for task_close: ${String(error)}`, {
      to: 'debug',
    })
  }
}

async function noteChatAnswers($: EngineInterface, words: PersonWords): Promise<void> {
  try {
    noteChatMarks(words, await readList(hostOf($)))
  } catch (error) {
    $.ui.log(`handily-board: the answers in the chat were not read: ${String(error)}`, {
      to: 'debug',
    })
  }
  $.ui.invalidate('ui.render')
}

async function takeAnswered($: EngineInterface, isPersonPrompt: boolean): Promise<TakenAnswers> {
  return hostOf($).edit((list) => takeAnswers(list, isPersonPrompt))
}

async function putBackAnswered($: EngineInterface, taken: TakenAnswers): Promise<void> {
  if (isNothingTaken(taken)) return
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

function keepBackgroundTick($: EngineInterface, redraw: Redraw, attention: AttentionKeep): void {
  if (!isWaiting(attention.background.current)) {
    redraw.backgroundTimer?.cancel()
    redraw.backgroundTimer = undefined
    return
  }
  redraw.backgroundTimer ??= $.clock.every(BACKGROUND_TICK_MS, () => {
    $.ui.invalidate('ui.render')
    void refreshStatus($, attention)
  })
}

async function noteBackground(
  $: EngineInterface,
  redraw: Redraw,
  attention: AttentionKeep,
): Promise<void> {
  keepBackgroundTick($, redraw, attention)
  $.ui.invalidate('ui.render')
  await refreshStatus($, attention)
}

async function noteBackgroundStop(
  $: EngineInterface,
  redraw: Redraw,
  attention: AttentionKeep,
  facts: StopFacts,
): Promise<void> {
  if (!isMainStop(facts)) return
  noteStop(attention.background, facts, await $.clock.now())
  await noteBackground($, redraw, attention)
}

export const register: Register = (on, options) => {
  const mode = boardMode(options)
  const band = bandSetting(options)
  const redraw: Redraw = {
    timer: undefined,
    bandTimer: undefined,
    bandSawTab: undefined,
    strip: newStripKeep(),
    clock: undefined,
    clockTicks: 0,
    clockSurfaces: new Map(),
    backgroundTimer: undefined,
  }
  const machine = newMachine(SESSIONS_PANE.id)
  const storeOptions = { store: options.store, answerWindow: options.answerWindow }
  const vitals: VitalsKeep = { current: EMPTY_VITALS }
  const warnings = newWarnKeep()
  const snapshots = snapshotKeep()
  const checks: ChecksKeep = { current: EMPTY_CHECKS }
  const request: RequestKeep = { current: NO_REQUEST }
  const breakdown: PartsKeep = { view: UNREAD_PARTS, isStale: false }
  const trend: TrendKeep = { current: undefined }
  const steps: StepsKeep = { last: new Map(), counts: new Map() }
  const failures: FailureKeep = { shown: new Set() }
  const resume = { isNoteDue: false }
  const log: LogKeep = { current: EMPTY_LOG, denied: new Set(), runs: new Map() }
  const refused = new Set<string>()
  const notes: RowNotes = new Map()
  const words = newPersonWords()
  const uiKeeps: UiKeeps = { notes, parts: breakdown, redraw, log, words }
  const asks: BoardTask[] = []
  const pulses = newPulses()
  const background = newBackgroundKeep()
  const attention: AttentionKeep = {
    setting: statusLineSetting(options),
    text: undefined,
    refreshes: 0,
    asks: new Map(),
    background,
  }

  on('session.start', async ($, e, next) => {
    for (const tool of TOOLS) await $.tool.register(tool)
    await $.command.register({
      name: 'board',
      description: 'handily · Show the board: the tasks of this session and this machine',
      argumentHint:
        '[machine | add <text|id> | rm <n> | mv <n> before <m>|top|bottom | edit <n> <title> | done <n> | start <n> | open <n> | answer <n> <text> | pick <n> <option> | reject <n> [reason] | undo <n> | reopen <n> | plan | clear | list | stats | log [agent] | close]',
      immediate: true,
    })
    await keepGlyphSetting($)
    await keepPaletteSetting($)
    noteStartup(background, await $.clock.now())
    if (mode === 'always') await openUnasked(uiOf($, uiKeeps))
    await $.state.set({ plugin: 'handily-board', key: 'ready' }, { root: $.plugin.root })
    const started = await next(e)
    await removeStaleWarnings(warnHost($))
    await readUsage($, vitals, snapshots)
    await warnFromVitals($, warnings, vitals.current)
    await trendOf($, trend)
    return started
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    if (await keepChangedGlyphSetting($, e)) await refreshStatus($, attention)
    if (await keepChangedPaletteSetting($, e)) $.ui.invalidate('ui.render')
    return result
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    const isCarried = hasCarriedLimits(e)
    if (isCarried) await mergeSnapshot($, snapshots, e.rateLimits)
    await noteVitals($, vitals, (current, now) =>
      withSnapshot(withMeasure(current, e, now), snapshots.windows),
    )
    if (isCarried) await warnFromVitals($, warnings, vitals.current)
    const { tokens } = e.context
    if (e.changed.includes('context') && tokens !== undefined) {
      await noteTrend($, trend, (current) => trendMeasured(current, tokens))
    }
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
      const now = await $.clock.now()
      await noteVitals($, vitals, (current) => withTurnStart(current, now))
      await noteTrend($, trend, trendTurnStarted)
      const wasWaiting = isWaiting(background.current)
      noteTurnStart(background)
      if (wasWaiting) {
        keepBackgroundTick($, redraw, attention)
        $.ui.invalidate('ui.render')
        await refreshStatus($, attention)
      }
    } else {
      await noteRunStart(agentHostOf($), e.agentId)
      noteLogRun(log, e.agentId)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    if (agentId === undefined) {
      noteRequest($, request, (facts) => withStep(facts, e.model, e.effort))
      const sentAt = await $.clock.now()
      const stream = next(e)
      let isFirst = true
      for await (const chunk of stream) {
        if (isFirst && chunk.kind !== 'engine') {
          isFirst = false
          const ms = (await $.clock.now()) - sentAt
          noteRequest($, request, (facts) => withFirstToken(facts, ms))
        }
        yield chunk
      }
      const result = await stream.result
      await noteScriptSteps($, result.toolUses)
      return result
    }
    heard(pulses, agentId, await $.clock.now())
    const stepped = yield* next(e)
    heard(pulses, agentId, await $.clock.now())
    noteStep($, steps, agentId, stepped)
    return stepped
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      await keepShownFailures($, failures)
      await noteChatAnswers($, words)
      const asked = stillAsked(await readList(hostOf($)), asks.splice(0))
      const parts = asksParts(asked)
      if (parts !== undefined && !(await isSessionTabSeen($))) showGlyphToast($, parts)
      await noteVitals($, vitals, (current) => withTurnEnd(current, e.durationMs))
      await noteTrend($, trend, trendTurnEnded)
      if (await isDetailsShown($)) await countParts($, breakdown)
      else breakdown.isStale = true
      if (e.reason === 'aborted' && noteAbortedTurn(background)) {
        await noteBackground($, redraw, attention)
      }
    } else {
      const { agentId } = e
      const kind = TURN_END_KINDS[e.reason]
      const detail = elapsedText(e.durationMs)
      noteAgentEnd($, log, await $.clock.now(), { kind, agentId, detail })
      await noteTurnEnd(agentHostOf($), agentId, e.answer)
      await forgetAsks($, attention, (_callId, ask) => ask.agentId === agentId)
    }
    return completed
  }).catch((_$, e, next) => next(e))

  on('state.set', { plugin: 'handily-board', key: 'agentList' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.value.isSet) {
      await keepAgentPlan($, e.id, e.value, result.value.version)
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    await $.state.set(AGENTS, [])
    steps.last.clear()
    steps.counts.clear()
    pulses.heardAt.clear()
    pulses.callsFrom.clear()
    forgetBackground(background)
    if (NEW_SESSION_REASONS.has(e.reason)) background.isCarried = true
    await noteBackground($, redraw, attention)
    if (NEW_SESSION_REASONS.has(e.reason)) {
      await noteVitals($, vitals, withClear)
      noteRequest($, request, withRequestsCleared)
      await setTrend($, trend, EMPTY_TREND)
      breakdown.view = UNREAD_PARTS
    }
    if (e.reason === 'clear') {
      forgetPersonWords(words)
      attention.asks.clear()
      await refreshStatus($, attention)
      checks.current = EMPTY_CHECKS
      log.current = EMPTY_LOG
      log.denied.clear()
      log.runs.clear()
      refused.clear()
      await resetList(hostOf($))
      await $.state.set(PERSON_CHANGES, [])
      await $.state.set(FINDINGS, EMPTY_FINDINGS)
      await $.state.set(PLAN_ID, null)
      await resetAgentLists($)
      await resetActivity($)
    }
    return next(e)
  })

  on('classic.SessionStart', ($, e, next) => {
    noteMode($, request, e)
    if (e.agent_id === undefined) {
      if (e.source === 'resume') resume.isNoteDue = true
      const wasIdle = background.current.kind === 'idle'
      noteStartSource(background, e.source)
      if (wasIdle && background.current.kind !== 'idle') $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('classic.UserPromptSubmit', ($, e, next) => {
    noteMode($, request, e)
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    noteMode($, request, e)
    try {
      await noteBackgroundStop($, redraw, attention, e)
    } catch (error) {
      $.ui.log(`handily-board: the background work was not read: ${String(error)}`, {
        to: 'debug',
      })
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
    const isPersonOrigin = PERSON_ORIGINS.has(e.origin.kind)
    const plan = isPersonOrigin ? await dueNote($) : undefined
    const resumed = isPersonOrigin && resume.isNoteDue ? RESUME_NOTE : undefined
    const taken = await takeChanges($)
    const answered = await takeAnswered($, isPersonOrigin)
    const enter = async (sent: PromptSubmitInput) => {
      const kept = words.kept
      if (isPersonPrompt(e)) await keepPersonWords($, words, e.text)
      let entered: PromptSubmitResult
      try {
        entered = await next(sent)
      } catch (error) {
        words.kept = kept
        throw error
      }
      if (entered.drop !== undefined) words.kept = kept
      if (entered.drop === undefined) await notePrompt($, log, e)
      if (entered.drop === undefined && isPersonPrompt(e)) await clearBandEnds($, 'isAnswerSeen')
      if (entered.drop === undefined) await keepShownFailures($, failures)
      if (entered.drop === undefined && isPersonPrompt(e)) await clearSentFixes($, e.text)
      if (entered.drop === undefined && isPersonPrompt(e)) $.ui.invalidate('ui.render')
      return entered
    }
    try {
      const told = answersToTell(answered.answered, e.text)
      const answers = told.length === 0 ? undefined : answersText(told)
      const isTold = taken.length > 0 || answers !== undefined
      const list = await readList(hostOf($))
      const changes = isTold ? personNote(taken, list, answers) : undefined
      const reopened = answered.reopened.map(reopenedText)
      const open = isPersonPrompt(e) ? openTasksLine(list, e.text) : undefined
      const notes = [resumed, changes, ...reopened, open, plan?.text].filter(
        (text) => text !== undefined,
      )
      if (notes.length === 0) return await enter(e)
      const entered = await enter({ ...e, context: [...(e.context ?? []), ...notes] })
      if (entered.drop !== undefined) {
        await putBackChanges($, taken)
        await putBackAnswered($, answered)
        return entered
      }
      if (plan) await recordNote($, plan.calls)
      if (resumed !== undefined) resume.isNoteDue = false
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
      if (e.agentId === undefined && answer.deny === undefined) await noteBoardUse($)
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
      await update($, ACTIVITY, (current = EMPTY_ACTIVITY) =>
        withMainCall(current, sight, now, !isScriptCall(e.tool_use_id)),
      )
      const answer = await untilSettled($, attention, e.tool_use_id, () => next(e))
      await noteVitals($, vitals, (current) =>
        withTurnCall(current, e.tool, answer.isError === true),
      )
      const call = { callId: e.tool_use_id, agentId, isError: answer.isError === true }
      await noteCallEvent($, log, sight, call)
      return answer
    }
    const callId = e.tool_use_id
    const command = await commandOf(e.tool, e)
    const call = { id: callId, ...sight, ...(command === undefined ? {} : { command }) }
    const from = await $.clock.now()
    heard(pulses, agentId, from)
    pulses.callsFrom.set(callId, from)
    try {
      const answer = await untilSettled($, attention, callId, () =>
        trackAgentCall(
          agentHostOf($),
          agentId,
          call,
          () => {
            noteLogRun(log, agentId)
            return next(e)
          },
          () => refused.delete(callId),
        ),
      )
      await noteCallEvent($, log, sight, { callId, agentId, isError: answer.isError === true })
      return answer
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
    if (e.agentId !== undefined && verdict.decision === 'deny') keepCallId(refused, callId)
    await noteCheck($, { checks, log }, attention, { ...e, tool_use_id: callId }, verdict)
    return verdict
  }).catch(($, e, next) => {
    $.ui.log(`handily-board: the check was not kept (${next.error.kind})`, { to: 'debug' })
    return next(e)
  })

  on('telemetry.log', { to: 'collector' }, async ($, e, next) => {
    const callId = next.origin.plugin === ENGINE_ORIGIN ? decidedCallId(e) : undefined
    if (callId !== undefined) {
      if (isRejected(e)) keepCallId(refused, callId)
      try {
        await settleAsk($, attention, callId)
      } catch (error) {
        $.ui.log(`handily-board: the settled ask was not cleared: ${String(error)}`, {
          to: 'debug',
        })
      }
    }
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
    noteLogRun(log, spawned.agentId)
    noteEvent($, log, at, { kind: 'spawn', agentId: spawned.agentId, detail: e.description })
    if (e.parentAgentId === undefined) await noteVitals($, vitals, withTurnSpawn)
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
    const input = {
      kind: e.kind,
      title: e.title,
      options: e.options,
      why: e.why,
      recommended: e.recommended,
    }
    const assigned = await modelAssign(hostOf($), input, e.agentId, await $.clock.now())
    if (assigned.task !== undefined) asks.push(assigned.task)
    return answerWithRow($, e.tool_use_id, assigned.answer)
  }).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_CLOSE }, async ($, e) => {
    const input = {
      id: e.id,
      how: e.how,
      note: e.note,
      said: e.said,
      answer: e.answer,
      option: e.option,
    }
    const now = await $.clock.now()
    return answerWithRow(
      $,
      e.tool_use_id,
      await modelClose(hostOf($), input, e.agentId, words, now),
    )
  }).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_FINDING }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelFinding($, e.text, e.agentId)),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))
  on('tool.call', { tool: TOOL_LIST }, async ($, e) =>
    answerWithRow($, e.tool_use_id, await modelList(modelHostOf($, e.agentId))),
  ).catch(($, e, next) => toolFailed($, e.tool, next.error))

  on('command.run', { command: 'board' }, async ($, e) => {
    await keepShownFailures($, failures)
    const host = hostOf($)
    const command = parseBoardCommand(e.args)
    switch (command.kind) {
      case 'session':
        await clearBandEnds($, 'isFailureSeen')
        return { text: await sessionCommand(uiOf($, uiKeeps), mode) }
      case 'machine':
        return { text: await openBoard(uiOf($, uiKeeps), SESSIONS_PANE) }
      case 'close':
        return { text: await closeBoard(uiOf($, uiKeeps)) }
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
          text: statsText(
            await workOf($, {
              failures,
              vitals,
              checks,
              request,
              steps,
              pulses,
              breakdown,
              trend,
              log,
              background,
            }),
            await sessionSignals($),
          ),
        }
      case 'log': {
        const work = await workOf($, {
          failures,
          vitals,
          checks,
          request,
          steps,
          pulses,
          breakdown,
          trend,
          log,
          background,
        })
        const who = { names: shownNames(work.agents), labels: agentLabels(work.agents) }
        return { text: logText(log.current, who, await sessionSignals($), command.text) }
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
      case 'reopen':
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
    const stopBand = () => {
      keepBandTime($, redraw, false)
      forgetStrip(redraw.strip)
    }
    const yieldBand = () => {
      stopBand()
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
    const now = await $.clock.now()
    const agents = stripRows(await agentsNow($, { steps, pulses, failures }, now))
    const waitingNow = background.current
    const isWaitingNow = isWaiting(waitingNow)
    const view = bandView(await readList(host), plan, activity, now, agents.length, isWaitingNow)
    if (view === undefined) return yieldBand()
    const beneath = await next(e)
    if (!isEngineDrawing(beneath)) {
      stopBand()
      return beneath
    }
    keepBandTime($, redraw, isTimed(view, agents.length, isWaitingNow))
    const rows = heldRows(redraw.strip, agents, now)
    const { Box, Text, Button } = $.ui.resolve(e)
    const signals = await drawnSignals($, e.surface)
    const ui = uiOf($, uiKeeps)
    const failed = (error: unknown) => {
      ui.log(`handily-board: the board did not open from the band: ${String(error)}`)
      ui.showToast(BOARD_NOT_OPENED)
    }
    const open = () => {
      showPane(ui, TASKS_PANE).then((opened) => {
        if (!opened.isPlaced) failed(opened.reason)
      }, failed)
    }
    const openAgents = agentsOpener(ui)
    const strip = { rows, maxRows: e.props.maxRows }
    return drawBand(
      { Box, Text, Button, signals },
      view,
      e.props.bodyColumns,
      {
        open,
        openTasks: openAgents,
        openAgent: (row) => {
          if (isLiveRow(row)) {
            openAgents()
            return
          }
          host
            .editExpanded((keys) => [...new Set([...keys, ...openedKeys(row)])])
            .then(open, failed)
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
      },
      strip,
      isWaitingNow ? { background: waitingNow, now } : undefined,
    )
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    await keepShownFailures($, failures)
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
    const look = {
      elements,
      hasToolMarker: e.surface === 'terminal',
      signals: await drawnSignals($, e.surface),
    }
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
          if (reply.toastParts !== undefined) showGlyphToast($, reply.toastParts)
        },
        (error: unknown) => {
          $.ui.log(`handily-board: the plan was not added: ${String(error)}`)
          showGlyphToast($, CHANGE_FAILED)
        },
      )
    }
    const signals = await drawnSignals($, e.surface)
    const line = drawPlanLine({ Box, Text, Button, signals }, { plan, isCurrent, tasksAfter }, add)
    return Box({ flexDirection: 'column', children: [drawn, line] })
  })

  on('ui.render', { component: 'Pane', requestId: TASKS_PANE.id }, async ($, e) => {
    await noteTabSeen($, redraw)
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const { bodyColumns, placement } = e.props
    const elements = {
      Box,
      Text,
      Button,
      Input,
      bodyColumns,
      isInline: placement === 'inline',
      canFrame: e.surface === 'terminal',
      surface: e.surface,
      signals: await drawnSignals($, e.surface),
      palette: await shownPalette($, e.surface),
    }
    const keeps = {
      failures,
      vitals,
      checks,
      request,
      steps,
      pulses,
      breakdown,
      trend,
      log,
      background,
    }
    const work = await workOf($, keeps, e.props.view.agentId)
    noteShownFailures($, failures, work.agents)
    clearStatus($, attention)
    startRedraw($, redraw, attention)
    if (placement === 'widget') return drawGlance(elements, hostOf($), work)
    return drawPane(elements, hostOf($), plansOf($), uiOf($, uiKeeps), work, findingsOf($))
  })

  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE.id }, async ($, e) => {
    await noteTabSeen($, redraw)
    const { Box, Text, Button } = $.ui.resolve(e)
    const host = hostOf($)
    const expanded = new Set(await host.expanded())
    const { view, now } = await readMachine(sessionsHost($), machine, storeOptions)
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
      signals: await drawnSignals($, e.surface),
      fills: machine.fills,
      fill: (record: string, text: string) => {
        void fillAsk($, machine, record, text)
      },
    }
    if (placement === 'widget') return drawMachineGlance(elements, view, now)
    return drawMachine(elements, view, now)
  })
}
