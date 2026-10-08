import { update } from 'claude-code'
import type { EngineInterface, HookFailure, Register, ToolSpec } from 'claude-code'
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
import { PANE_ID, type PaneUi, drawPane, openPane, paneCommand, paneMode } from './pane'
import {
  EMPTY_LIST,
  STATUSES,
  TRACKER_TEXT_IS_DATA,
  addTask,
  findTask,
  isStatus,
  listText,
  numbersText,
  removeTask,
  setStatus,
  taskText,
  withTrackerNotice,
} from './tasks'

const TOOL_ADD = 'mcp__task-pane__task_add'
const TOOL_UPDATE = 'mcp__task-pane__task_update'
const TOOL_LIST = 'mcp__task-pane__task_list'
const REMOVED = 'removed'

const TOOLS: readonly ToolSpec[] = [
  {
    name: 'task_add',
    description: [
      'Add one task to the session task list. Returns the whole list with the task ids.',
      'Keep your plan for this session in this list: add each step of a task with more than one step, set a task to in_progress when you start it and to completed when it is done, with task_update.',
      'The person sees the list in /task and in the task pane, and can add or remove tasks. A message that starts with [task-pane] says that the person changed the list.',
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
      'Set the status of one task in the session task list, or remove it with status "removed". Returns the whole list.',
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
    name: 'task_list',
    description: [
      'Show the session task list: each task id, status, author and title. The author is you for a task that the person added, claude for a task that you added, and tracker for a tracker item that the person added.',
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

function hostOf($: EngineInterface): TaskHost {
  return {
    read: async () => {
      const { value } = await $.state.get({ plugin: 'task-pane', key: 'list' })
      return value
    },
    edit: async <T,>(change: ListEdit<T>) => {
      let outcome: { value: T } | undefined
      await update($, { plugin: 'task-pane', key: 'list' }, (current) => {
        const changed = change(current ?? EMPTY_LIST)
        outcome = { value: changed.value }
        return changed.list
      })
      if (!outcome) throw new Error('task-pane: the state update never ran the change')
      return outcome.value
    },
    snapshot: async () => {
      const { value } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
      return value
    },
    lines: async (snapshot) => {
      const lines = await $.workitems.lines({ snapshot, now: await $.clock.now() })
      return lines.map(({ tone, text }) => ({ tone, text }))
    },
    note: async (text) => {
      const appended = await $.session.append({
        message: { type: 'user', content: [{ type: 'text', text }] },
      })
      return appended.deny
    },
  }
}

function uiOf($: EngineInterface): PaneUi {
  return {
    open: (id, title) => $.ui.open({ id, title }),
    close: (id) => $.ui.close({ id }),
    isOpen: async (id) => (await $.ui.panes()).some((pane) => pane.id === id),
    toast: (text) => {
      $.ui.toast(text)
    },
    log: (text) => {
      $.ui.log(text)
    },
  }
}

async function listResult(host: TaskHost, lead: string): Promise<string> {
  const list = await readList(host)
  const shown = list.tasks.length === 0 ? 'The task list is empty.' : listText(list)
  return withTrackerNotice(lead === '' ? shown : `${lead}\n\n${shown}`, list.tasks)
}

async function modelAdd(host: TaskHost, title: unknown) {
  if (typeof title !== 'string' || title.trim() === '') {
    return {
      deny: 'task_add needs a title: a non-empty string, for example {"title": "Write the tests"}.',
    }
  }
  const outcome = await host.edit((list) => {
    const added = addTask(list, title.trim(), { by: 'model', item: null })
    return { list: 'refusal' in added ? list : added.list, value: added }
  })
  if ('refusal' in outcome) return { deny: `task_add refused: ${outcome.refusal}` }
  const { task } = outcome
  return { result: await listResult(host, `Added task ${String(task.id)}: ${taskText(task)}.`) }
}

async function modelUpdate(host: TaskHost, id: unknown, status: unknown) {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    return { deny: 'task_update needs id: the integer task id that task_list shows.' }
  }
  if (status !== REMOVED && !isStatus(status)) {
    return {
      deny: `task_update needs status: one of ${[...STATUSES, REMOVED].join(', ')}.`,
    }
  }
  const outcome = await host.edit((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { found: false, numbers: numbersText(list) } }
    const next = status === REMOVED ? removeTask(list, id) : setStatus(list, id, status)
    return { list: next, value: { found: true, numbers: '' } }
  })
  if (!outcome.found) {
    const known = outcome.numbers === '' ? 'The list is empty.' : `The ids are ${outcome.numbers}.`
    return { deny: `No task ${String(id)}. ${known} Call task_list to see them.` }
  }
  const lead =
    status === REMOVED ? `Removed task ${String(id)}.` : `Task ${String(id)} is now ${status}.`
  return { result: await listResult(host, lead) }
}

function toolFailed($: EngineInterface, tool: string, error: HookFailure): { deny: string } {
  $.ui.log(`task-pane: ${tool} failed (${error.kind}): ${error.message ?? 'no message'}`)
  const reason = withoutFinalPeriod(error.message ?? error.kind)
  return { deny: `task-pane could not answer ${tool}: ${reason}.` }
}

export const register: Register = (on, options) => {
  const mode = paneMode(options)

  on('session.start', async ($, e, next) => {
    for (const tool of TOOLS) await $.tool.register(tool)
    await $.command.register({
      name: 'task',
      description: 'Show and change the session task list that Claude keeps',
      argumentHint: '[add <text|id> | rm <n> | pane]',
      immediate: true,
    })
    if (mode === 'always') await openPane(uiOf($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await resetList(hostOf($))
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

  on('tool.call', { tool: TOOL_ADD }, ($, e) => modelAdd(hostOf($), e.title)).catch(($, e, next) =>
    toolFailed($, e.tool, next.error),
  )
  on('tool.call', { tool: TOOL_UPDATE }, ($, e) => modelUpdate(hostOf($), e.id, e.status)).catch(
    ($, e, next) => toolFailed($, e.tool, next.error),
  )
  on('tool.call', { tool: TOOL_LIST }, async ($) => ({
    result: await listResult(hostOf($), ''),
  })).catch(($, e, next) => toolFailed($, e.tool, next.error))

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

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const elements = { Box, Text, Button, Input, placement: e.props.placement }
    return drawPane(elements, hostOf($), uiOf($))
  })
}
