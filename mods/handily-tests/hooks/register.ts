import { update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderSurface,
  ToolCallInput,
  ToolCallResult,
} from 'claude-code'
import type { TestsFailure, TestsOutcome, TestsRun, TestsRuns } from '../types'
import {
  type TestsUi,
  clearReply,
  closeTests,
  parseTestsCommand,
  testsPane,
  toggleTests,
  unknownReply,
} from './commands'
import { isTestCommand } from './command'
import { bashOutputOf, outcomeOf } from './output'
import { type PaneActions, type PaneView, TESTS_PANE, drawDock, drawInline } from './pane'
import {
  type Running,
  type StatusSetting,
  type ToastSetting,
  failureText,
  keptRuns,
  lastVerdict,
  listText,
  runToastParts,
  statusSettingOf,
  statusText,
  toastSettingOf,
} from './runs'
import { marked } from './toast'
import {
  keepChangedGlyphSetting,
  keepGlyphSetting,
  paneGlyphs,
  settingGlyphs,
  showGlyphToast,
} from './toasting'

const RUNS = { plugin: 'handily-tests', key: 'runs' } as const
const READY = { plugin: 'handily-tests', key: 'ready' } as const

type Look = {
  runId: string | undefined
  opened: number | null
  isAllFailures: boolean
  isAllRuns: boolean
}

type Keep = {
  status: StatusSetting
  toasts: ToastSetting
  running: Map<string, Running>
  look: Look
  shownStatus: string | undefined
}

type BashCall = Extract<ToolCallInput, { tool: 'Bash' }>

type CallSite = { e: BashCall; startedAt: number }

function newLook(runId: string | undefined): Look {
  return { runId, opened: 0, isAllFailures: false, isAllRuns: false }
}

function log($: EngineInterface, text: string): void {
  $.ui.log(text, { to: 'debug' })
}

function redraw($: EngineInterface): void {
  $.ui.invalidate('ui.render')
}

async function runsOf($: EngineInterface): Promise<TestsRuns> {
  return (await $.state.get(RUNS)).value ?? []
}

function latestRunning(keep: Keep): Running | undefined {
  return [...keep.running.values()].at(-1)
}

async function refreshStatus($: EngineInterface, keep: Keep): Promise<void> {
  if (keep.status === 'off') return
  const [last] = await runsOf($)
  const view = { last, running: latestRunning(keep) }
  const text = statusText(keep.status, view, await settingGlyphs($))
  if (text === keep.shownStatus) return
  keep.shownStatus = text
  $.ui.status(text)
}

function uiOf($: EngineInterface): TestsUi {
  return {
    open: (focus) => $.ui.open(focus ? { ...TESTS_PANE, focus } : { ...TESTS_PANE }),
    close: () => $.ui.close({ id: TESTS_PANE.id }),
    panes: () => $.ui.panes(),
  }
}

async function isTabShown($: EngineInterface): Promise<boolean> {
  return (await testsPane(uiOf($)))?.isShown === true
}

async function agentLabel($: EngineInterface, agentId: string | undefined): Promise<string | null> {
  if (agentId === undefined) return null
  try {
    const agent = (await $.agent.list()).find((candidate) => candidate.id === agentId)
    return agent?.name ?? agent?.type ?? 'an agent'
  } catch (error) {
    log($, `handily-tests: the agents were not listed: ${String(error)}`)
    return 'an agent'
  }
}

async function recordRun(
  $: EngineInterface,
  keep: Keep,
  site: CallSite,
  outcome: TestsOutcome,
): Promise<void> {
  const { e, startedAt } = site
  const endedAt = await $.clock.now()
  const run: TestsRun = {
    id: e.tool_use_id,
    command: e.command,
    agent: await agentLabel($, e.agentId),
    endedAt,
    tookMs: Math.max(endedAt - startedAt, 0),
    outcome,
  }
  let before: TestsRun | undefined
  await update($, RUNS, (runs: TestsRuns = []) => {
    before = lastVerdict(runs)
    return keptRuns(run, runs)
  })
  keep.look = newLook(run.id)
  const parts = keep.toasts === 'on' ? runToastParts(run, before) : undefined
  if (parts !== undefined && !(await isTabShown($))) showGlyphToast($, parts)
}

async function noteAnswer(
  $: EngineInterface,
  keep: Keep,
  site: CallSite,
  answer: ToolCallResult,
): Promise<boolean> {
  const output = bashOutputOf(answer, site.e.run_in_background === true)
  if (output === undefined) return false
  const outcome = outcomeOf(output, {
    command: site.e.command,
    cwd: await $.session.cwd(),
    log: (detail) => {
      log($, detail)
    },
  })
  if (outcome === undefined) return false
  await recordRun($, keep, site, outcome)
  return true
}

function copyFailure($: EngineInterface, failure: TestsFailure, surface: RenderSurface): void {
  const failed = (reason: string) => {
    log($, `handily-tests: the failure ${failure.name} was not copied: ${reason}`)
    showGlyphToast($, [marked('blocked', 'Copy failed'), 'the transcript shows why'])
  }
  $.ui
    .copy({ text: failureText(failure), surface })
    .then((result) => {
      if (result.isCopied) {
        showGlyphToast($, [marked('done', 'Copied the failure'), { quoted: failure.name }])
        return
      }
      failed(result.reason)
    })
    .catch((error: unknown) => {
      failed(String(error))
    })
}

function actionsOf($: EngineInterface, keep: Keep): PaneActions {
  return {
    open: (index) => {
      keep.look.opened = keep.look.opened === index ? null : index
      redraw($)
    },
    more: () => {
      keep.look.isAllFailures = !keep.look.isAllFailures
      redraw($)
    },
    older: () => {
      keep.look.isAllRuns = !keep.look.isAllRuns
      redraw($)
    },
    copy: (failure, surface) => {
      copyFailure($, failure, surface)
    },
  }
}

async function paneView($: EngineInterface, keep: Keep): Promise<PaneView> {
  const runs = await runsOf($)
  const [last] = runs
  if (keep.look.runId !== last?.id) keep.look = newLook(last?.id)
  return {
    runs,
    running: latestRunning(keep),
    now: await $.clock.now(),
    opened: keep.look.opened,
    isAllFailures: keep.look.isAllFailures,
    isAllRuns: keep.look.isAllRuns,
  }
}

async function afterChange($: EngineInterface, keep: Keep): Promise<void> {
  redraw($)
  await refreshStatus($, keep)
}

async function endCall(
  $: EngineInterface,
  keep: Keep,
  site: CallSite & { isWatched: boolean },
  answer: ToolCallResult | undefined,
): Promise<void> {
  keep.running.delete(site.e.tool_use_id)
  let isRecorded = false
  try {
    if (answer !== undefined) isRecorded = await noteAnswer($, keep, site, answer)
  } catch (error) {
    log($, `handily-tests: the Bash call was not read: ${String(error)}`)
  }
  if (site.isWatched || isRecorded) await afterChange($, keep)
}

export const register: Register = (on, options) => {
  const keep: Keep = {
    status: statusSettingOf(options.statusLine),
    toasts: toastSettingOf(options.toasts),
    running: new Map(),
    look: newLook(undefined),
    shownStatus: undefined,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tests',
      description: 'handily · Show the tests tab: each failed test by name with its diff',
      argumentHint: '[close | list | clear]',
      immediate: true,
    })
    await $.state.set(READY, { root: $.plugin.root })
    await keepGlyphSetting($)
    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    await keepChangedGlyphSetting($, e)
    await refreshStatus($, keep)
    return result
  })

  on('session.end', async (_$, e, next) => {
    keep.running.clear()
    keep.look = newLook(undefined)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash') return next(e)
    const startedAt = await $.clock.now()
    const isWatched = isTestCommand(e.command) && e.run_in_background !== true
    if (isWatched) {
      keep.running.set(e.tool_use_id, { id: e.tool_use_id, command: e.command, startedAt })
      await afterChange($, keep)
    }
    let answer: ToolCallResult | undefined
    try {
      answer = await next(e)
      return answer
    } finally {
      await endCall($, keep, { e, startedAt, isWatched }, answer)
    }
  })

  on('command.run', { command: 'tests' }, async ($, e) => {
    const command = parseTestsCommand(e.args)
    switch (command.kind) {
      case 'toggle':
        return { text: await toggleTests(uiOf($)) }
      case 'close':
        return { text: await closeTests(uiOf($)) }
      case 'list': {
        const [last] = await runsOf($)
        return { text: listText(last, await $.clock.now(), await settingGlyphs($)) }
      }
      case 'clear': {
        const count = (await runsOf($)).length
        await $.state.set(RUNS, [])
        keep.look = newLook(undefined)
        await afterChange($, keep)
        return { text: clearReply(count) }
      }
      case 'unknown':
        return { text: unknownReply(command.word) }
    }
  }).catch(($, _e, next) => {
    log(
      $,
      `handily-tests: /tests failed (${next.error.kind}): ${next.error.message ?? 'no message'}`,
    )
    return { text: 'handily-tests: /tests failed; see the transcript log.' }
  })

  on('ui.render', { component: 'Pane', requestId: TESTS_PANE.id }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const elements = {
      Box,
      Text,
      Button,
      bodyColumns: e.props.bodyColumns,
      marks: await paneGlyphs($, e.surface),
    }
    const view = await paneView($, keep)
    const actions = actionsOf($, keep)
    return e.props.placement === 'inline'
      ? drawInline(elements, view, actions)
      : drawDock(elements, view, actions)
  })
}
