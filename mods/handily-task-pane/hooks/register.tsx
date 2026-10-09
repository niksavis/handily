import { update } from 'claude-code'
import type {
  AgentStatus,
  EngineInterface,
  HookFailure,
  PromptOrigin,
  Register,
  Timer,
  ToolSpec,
} from 'claude-code'
import {
  EMPTY_ACTIVITY,
  isNoteDue,
  isTaskTool,
  planLag,
  planNote,
  toolTarget,
  withAgentCall,
  withMainCall,
  withPlanUpdate,
} from './activity'
import {
  type ListEdit,
  type TaskHost,
  listReply,
  parseTaskCommand,
  personAdd,
  personRemove,
  readList,
  resetList,
  unknownReply,
  withoutFinalPeriod,
} from './commands'
import {
  PANE_ID,
  type AgentRow,
  type PaneUi,
  type PaneWork,
  drawPane,
  openPane,
  paneCommand,
  paneMode,
} from './pane'
import type { TaskPaneCallRow, TaskPaneList, TaskPaneTask } from '../types'
import {
  EMPTY_LIST,
  MAX_AGENT_LISTS,
  STATUSES,
  TRACKER_TEXT_IS_DATA,
  addTask,
  doneCount,
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

const TOOL_ADD = 'mcp__handily-task-pane__task_add'
const TOOL_UPDATE = 'mcp__handily-task-pane__task_update'
const TOOL_MOVE = 'mcp__handily-task-pane__task_move'
const TOOL_LIST = 'mcp__handily-task-pane__task_list'
const REMOVED = 'removed'
const MOVE_EXAMPLE = 'for example {"id": 2, "before": 1}'
const AGENT_IDS = { plugin: 'handily-task-pane', key: 'agentIds' } as const
const ACTIVITY = { plugin: 'handily-task-pane', key: 'activity' } as const
const AGENT_ACTIVITY = { plugin: 'handily-task-pane', key: 'agentActivity' } as const
const REDRAW_INTERVAL_MS = 10_000
const ACTIVE_AGENT_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  'pending',
  'running',
  'waiting',
])
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
      'The person sees the list of the main loop in /task and in the task pane, and can add or remove tasks. A message that starts with [task-pane] says that the person changed the list.',
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

export const PROMPT_SECTION_ID = 'task-pane:tasks'

export const PROMPT_SECTION_TEXT = [
  '# Session task list',
  `Keep your plan for this session in the task list of the task-pane tools. The person sees the list in /task and in the task pane, and can add or remove tasks. Before a task with more than one step, call ${TOOL_LIST}. Add each step with ${TOOL_ADD}. Set a task to in_progress when you start it and to completed when it is done, with ${TOOL_UPDATE}.`,
  `A message that starts with [task-pane] says that the person changed the list. Follow the list that it shows. ${TRACKER_TEXT_IS_DATA}`,
].join('\n\n')

type ListWrite = (step: (current: TaskPaneList | undefined) => TaskPaneList) => Promise<unknown>

function listEditor(write: ListWrite): TaskHost['edit'] {
  return async <T,>(change: ListEdit<T>) => {
    let outcome: { value: T } | undefined
    await write((current) => {
      const changed = change(current ?? EMPTY_LIST)
      outcome = { value: changed.value }
      return changed.list
    })
    if (!outcome) throw new Error('task-pane: the state update never ran the change')
    return outcome.value
  }
}

function hostOf($: EngineInterface): TaskHost {
  return {
    read: async () => {
      const { value } = await $.state.get({ plugin: 'handily-task-pane', key: 'list' })
      return value
    },
    edit: listEditor((step) => update($, { plugin: 'handily-task-pane', key: 'list' }, step)),
    snapshot: async () => {
      const { value } = await $.state.get({ plugin: 'handily-workitems', key: 'snapshot' })
      return value
    },
    lines: async (snapshot) => {
      const lines = await $.workitems.lines({ snapshot, now: await $.clock.now() })
      return lines.map(({ tone, text }) => ({ tone, text }))
    },
    expanded: async () => {
      const { value } = await $.state.get({ plugin: 'handily-task-pane', key: 'expanded' })
      return value ?? []
    },
    editExpanded: async (change) => {
      await update($, { plugin: 'handily-task-pane', key: 'expanded' }, (current) =>
        change(current ?? []),
      )
    },
    note: async (text) => {
      const appended = await $.session.append({
        message: { type: 'user', content: [{ type: 'text', text }] },
      })
      return appended.deny
    },
  }
}

function modelHostOf($: EngineInterface, agentId: string | undefined): TaskHost {
  if (agentId === undefined) return hostOf($)
  const read = async () => {
    const { value } = await $.state.get({
      plugin: 'handily-task-pane',
      key: 'agentList',
      id: agentId,
    })
    return value
  }
  const edit = listEditor((step) =>
    update($, { plugin: 'handily-task-pane', key: 'agentList', id: agentId }, step),
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

type Redraw = { timer: Timer | undefined }

function stopRedraw(redraw: Redraw): void {
  redraw.timer?.cancel()
  redraw.timer = undefined
}

async function redrawShownPane($: EngineInterface, redraw: Redraw): Promise<void> {
  const pane = (await $.ui.panes()).find((open) => open.id === PANE_ID)
  if (!pane) {
    stopRedraw(redraw)
    return
  }
  if (pane.isShown) $.ui.invalidate('ui.render')
}

function startRedraw($: EngineInterface, redraw: Redraw): void {
  if (redraw.timer) return
  redraw.timer = $.clock.every(REDRAW_INTERVAL_MS, () => {
    redrawShownPane($, redraw).catch((error: unknown) => {
      $.ui.log(`task-pane: the redraw failed: ${String(error)}`, { to: 'debug' })
    })
  })
}

async function resetActivity($: EngineInterface): Promise<void> {
  await $.state.set(ACTIVITY, EMPTY_ACTIVITY)
  await $.state.set(AGENT_ACTIVITY, [])
}

async function notePlanChange($: EngineInterface): Promise<void> {
  try {
    const list = await readList(hostOf($))
    const now = await $.clock.now()
    await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => withPlanUpdate(current, list, now))
  } catch (error) {
    $.ui.log(`task-pane: the plan clock was not updated: ${String(error)}`, { to: 'debug' })
  }
}

type DueNote = { text: string; calls: number }

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
    $.ui.log(`task-pane: the plan note was not recorded: ${String(error)}`, { to: 'debug' })
  }
}

async function agentRows($: EngineInterface): Promise<AgentRow[]> {
  const listed = (await $.agent.list()).filter((agent) => ACTIVE_AGENT_STATUSES.has(agent.status))
  if (listed.length === 0) return []
  const { value: seen = [] } = await $.state.get(AGENT_ACTIVITY)
  const rows: AgentRow[] = []
  for (const agent of listed) {
    const ref = { plugin: 'handily-task-pane', key: 'agentList', id: agent.id } as const
    const { value: plan } = await $.state.get(ref)
    rows.push({
      id: agent.id,
      name: agent.name ?? (agent.description === '' ? agent.type : agent.description),
      status: agent.status,
      plan:
        plan === undefined || plan.tasks.length === 0
          ? null
          : { done: doneCount(plan), total: plan.tasks.length },
      last: seen.find((one) => one.id === agent.id)?.last ?? null,
    })
  }
  return rows
}

async function workOf($: EngineInterface): Promise<PaneWork> {
  const now = await $.clock.now()
  const { value: activity } = await $.state.get(ACTIVITY)
  return { now, activity: activity ?? EMPTY_ACTIVITY, agents: await agentRows($) }
}

async function resetAgentLists($: EngineInterface): Promise<void> {
  let agentIds: readonly string[] = []
  await update($, AGENT_IDS, (current = []) => {
    agentIds = current
    return []
  })
  for (const id of agentIds) {
    await $.state.set({ plugin: 'handily-task-pane', key: 'agentList', id }, EMPTY_LIST)
  }
}

function uiOf($: EngineInterface): PaneUi {
  return {
    open: (id, title) => $.ui.open({ id, title }),
    close: (id) => $.ui.close({ id }),
    isOpen: async (id) => (await $.ui.panes()).some((pane) => pane.id === id),
    fillPrompt: async (text) => {
      const draft = await $.prompt.read()
      const filled = await $.prompt.fill(
        draft.text.trim() === '' ? { text } : { text: ` ${text}`, mode: 'append' },
      )
      return { isFilled: filled.isFilled, refusal: filled.refusal }
    },
    toast: (text) => {
      $.ui.toast(text)
    },
    log: (text) => {
      $.ui.log(text)
    },
  }
}

function listAnswer(list: TaskPaneList, lead: string): string {
  const shown = list.tasks.length === 0 ? 'The task list is empty.' : listText(list)
  return withTrackerNotice(lead === '' ? shown : `${lead}\n\n${shown}`, list.tasks)
}

async function listResult(host: TaskHost, lead: string): Promise<string> {
  return listAnswer(await readList(host), lead)
}

type ModelAnswer = { deny: string } | { result: string; row: TaskPaneCallRow }

async function keepRow($: EngineInterface, toolUseId: string, row: TaskPaneCallRow) {
  try {
    await $.state.set({ plugin: 'handily-task-pane', key: 'rows', id: toolUseId }, row)
  } catch (error) {
    $.ui.log(`task-pane: the engine draws the row of ${toolUseId}: ${String(error)}`, {
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
    const { value } = await $.state.get({ plugin: 'handily-task-pane', key: 'rows', id: toolUseId })
    return value
  } catch (error) {
    $.ui.log(`task-pane: the engine draws the row of ${toolUseId}: ${String(error)}`, {
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
  const outcome = await host.edit<{ task: TaskPaneTask | undefined; numbers: string }>((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { task, numbers: numbersText(list) } }
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
    { missing: number; numbers: string } | { missing: undefined; task: TaskPaneTask }
  >((list) => {
    const task = findTask(list, id)
    if (task && findTask(list, before)) {
      return { list: moveTask(list, id, before), value: { missing: undefined, task } }
    }
    return { list, value: { missing: task ? before : id, numbers: numbersText(list) } }
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
  $.ui.log(`task-pane: ${tool} failed (${error.kind}): ${error.message ?? 'no message'}`)
  const reason = withoutFinalPeriod(error.message ?? error.kind)
  return { deny: `task-pane could not answer ${tool}: ${reason}.` }
}

export const register: Register = (on, options) => {
  const mode = paneMode(options)
  const redraw: Redraw = { timer: undefined }

  on('session.start', async ($, e, next) => {
    for (const tool of TOOLS) await $.tool.register(tool)
    await $.command.register({
      name: 'task',
      description: 'handily · Show and change the session task list that Claude keeps',
      argumentHint: '[add <text|id> | rm <n> | pane]',
      immediate: true,
    })
    if (mode === 'always') await openPane(uiOf($))
    await $.state.set({ plugin: 'handily-task-pane', key: 'ready' }, { root: $.plugin.root })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetList(hostOf($))
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
    if (!PERSON_ORIGINS.has(e.origin.kind)) return next(e)
    const note = await dueNote($)
    if (note === undefined) return next(e)
    const entered = await next({ ...e, context: [...(e.context ?? []), note.text] })
    if (entered.drop === undefined) await recordNote($, note.calls)
    return entered
  }).catch(($, e, next) => {
    $.ui.log(`task-pane: no plan note (${next.error.kind}): ${next.error.message ?? 'no message'}`)
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
    const sight = { tool: e.tool, target: toolTarget(e, await $.session.cwd()) }
    const { agentId } = e
    if (agentId === undefined) {
      const now = await $.clock.now()
      await update($, ACTIVITY, (current = EMPTY_ACTIVITY) => withMainCall(current, sight, now))
    } else {
      await update($, AGENT_ACTIVITY, (current = []) => withAgentCall(current, agentId, sight))
    }
    return next(e)
  }).catch(($, e, next) => {
    $.ui.log(`task-pane: the work was not tracked (${next.error.kind})`, { to: 'debug' })
    return next(e)
  })

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

  on('command.run', { command: 'task' }, async ($, e) => {
    const host = hostOf($)
    const command = parseTaskCommand(e.args)
    switch (command.kind) {
      case 'list':
        return { text: await listReply(host) }
      case 'add':
        return { text: await personAdd(host, command.text) }
      case 'rm':
        return { text: await personRemove(host, command.text) }
      case 'pane':
        return { text: await paneCommand(uiOf($), mode, command.text) }
      case 'unknown':
        return { text: unknownReply(command.word) }
    }
  }).catch(($, _e, next) => {
    $.ui.log(`task-pane: /task failed (${next.error.kind}): ${next.error.message ?? 'no message'}`)
    const reason = withoutFinalPeriod(next.error.message ?? next.error.kind)
    return { text: `task-pane: /task failed: ${reason}. Run /task to see the list.` }
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const closed = await next(e)
    if (!(await $.ui.panes()).some((pane) => pane.id === PANE_ID)) stopRedraw(redraw)
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

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const { bodyColumns } = e.props
    const elements = { Box, Text, Button, Input, bodyColumns }
    const work = await workOf($)
    startRedraw($, redraw)
    return drawPane(elements, hostOf($), uiOf($), work)
  })
}
