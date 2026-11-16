import type { On, RenderPropsOf } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import { FIX_LEAD, MAX_FINDINGS } from './hooks/findings'

const ROOT = '/work/app'
const PLUGIN = 'handily-board'
const PANE = 'tasks'
const START = 1_000
const SURFACES = ['terminal', 'desktop'] as const
const TOOL_FINDING = 'mcp__handily-board__finding_add'
const FINDING = 'The date parser drops the time zone'
const LONG_FINDING = `${FINDING} of every timestamp that the export writes to the report file`
const ENGINE_ROW = { type: 'engine', ref: 0 } as const

type Surface = (typeof SURFACES)[number]

type Run = { exitCode: number; stdout: string; stderr: string }

type World = {
  clock: MockClock
  runs: string[][]
  answer: Run
  gate: Promise<void> | undefined
  toasts: string[]
  fills: { text: string; mode: string | undefined }[]
  draft: string
  submitted: string[]
}

const fakeWorkitems: Plugin = {
  name: 'handily-workitems',
  register(on) {
    on('engine.create', async (_$, e, next) => {
      const built = await next(e)
      return {
        ...built,
        workitems: {
          refresh: () =>
            Promise.resolve({ created: [], updated: [], closed: [], version: 1, state: 'read' }),
          create: async ({ title }) => {
            if (!(await built.session.surfaces()).includes('terminal')) {
              return {
                created: false as const,
                reason: 'the tracker state is terminal-only',
              }
            }
            const run = await built.process.run(['tracker-cli', 'create', title])
            return run.exitCode === 0
              ? { created: true as const, id: run.stdout.trim() }
              : { created: false as const, reason: run.stderr.trim() }
          },
          writeVerbs: () => Promise.reject(new Error('the fake workitems has no write verbs')),
          classify: () => Promise.reject(new Error('the fake workitems classifies no command')),
          trackerFile: () => Promise.reject(new Error('the fake workitems names no tracker file')),
          lines: () => Promise.resolve([]),
        },
      }
    })
  },
}

const withWorkitems = { plugins: [fakeWorkitems] }

const CREATE_RUN = (title: string) => ['tracker-cli', 'create', title]

function world(on: On, surface: Surface = 'terminal'): World {
  const state: World = {
    clock: mock.clock(on, { now: START }),
    runs: [],
    answer: { exitCode: 0, stdout: 'app-7k2q\n', stderr: '' },
    gate: undefined,
    toasts: [],
    fills: [],
    draft: '',
    submitted: [],
  }
  on('session.surfaces', () => ({ value: [surface] }))
  on('process.run', async (_$, e) => {
    state.runs.push([...e.argv])
    await state.gate
    return {
      value: { ...state.answer, isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: ROOT }))
  on('agent.list', () => ({ value: [] }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('telemetry.log', { to: 'collector' }, () => ({ value: undefined }))
  on('ui.render', () => ENGINE_ROW)
  on('prompt.read', () => ({ value: { text: state.draft, cursor: state.draft.length } }))
  on('prompt.fill', (_$, e) => {
    state.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    state.submitted.push(e.text)
    return { text: e.text }
  })
  return state
}

function paneProps(bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: 'Tasks',
    isFocused: false,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }
}

async function startOn($: Engine, surface: Surface): Promise<void> {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
}

async function mountOn($: Engine, surface: Surface, columns = 60) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps(columns),
  })
}

async function record($: Engine, text: unknown, agentId?: string) {
  return $.tool.call({
    tool: TOOL_FINDING,
    text,
    ...(agentId === undefined ? {} : { agentId }),
  })
}

async function settled(seen: World, isDone: () => boolean): Promise<void> {
  for (let round = 0; !isDone(); round += 1) {
    if (round >= 100) throw new Error('the press never settled')
    await seen.clock.settle()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return ''
  const props = isRecord(value.props) ? value.props : {}
  if (value.type === 'Button' && typeof props.label === 'string') return props.label
  const children = Array.isArray(value.children) ? (value.children as unknown[]) : []
  return children.map(textOf).join('')
}

function labelOf(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.props)) return undefined
  return value.props.label
}

describe('findings that Claude records', () => {
  for (const surface of SURFACES) {
    test(
      `when Claude records a finding with finding_add, the board lists it with file, fix and dismiss buttons and runs no tracker CLI, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, surface)
        await startOn($, surface)
        const answer = await record($, FINDING)
        expect(answer.deny).toBeUndefined()
        expect(String(answer.result)).toContain('Recorded finding 1.')
        await record($, 'The retry loop never backs off')
        const ui = await mountOn($, surface, 41)
        expect(textOf(await ui.find({ key: 'findings-head' }))).toBe('Findings  ◆ 2 open')
        expect(textOf(await ui.find({ key: 'row:finding:1' }))).toBe(`◆ 1 ${FINDING}`)
        expect(textOf(await ui.find({ key: 'row:finding:2' }))).toBe(
          '◆ 2 The retry loop never backs off',
        )
        expect(textOf(await ui.find({ key: 'finding-actions:1' }))).toBe('filefixdismiss')
        expect(labelOf(await ui.find({ key: 'finding-file:1' }))).toBe('file')
        expect(labelOf(await ui.find({ key: 'finding-fix:1' }))).toBe('fix')
        expect(labelOf(await ui.find({ key: 'finding-dismiss:1' }))).toBe('dismiss')
        expect(seen.runs).toEqual([])
        await ui.unmount()
      },
    )
  }

  test(
    'pressing file runs one create through the workitems provider with the finding text and removes the row',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await record($, FINDING)
      await record($, 'The retry loop never backs off')
      const ui = await mountOn($, 'terminal')
      expect(seen.runs).toEqual([])
      await ui.press({ key: 'finding-file:1' })
      await settled(seen, () => seen.toasts.length > 0)
      expect(seen.runs).toEqual([CREATE_RUN(FINDING)])
      expect(await ui.find({ key: 'row:finding:1' })).toBeUndefined()
      expect(textOf(await ui.find({ key: 'row:finding:2' }))).toContain('The retry loop')
      expect(seen.toasts.some((text) => text.includes('Filed as app-7k2q'))).toBe(true)
      await ui.unmount()
    },
  )

  test(
    'two presses of file while the tracker CLI runs make one run',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      let release: () => void = () => undefined
      seen.gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await startOn($, 'terminal')
      await record($, FINDING)
      const ui = await mountOn($, 'terminal')
      await ui.press({ key: 'finding-file:1' })
      await settled(seen, () => seen.runs.length > 0)
      await ui.press({ key: 'finding-file:1' })
      await seen.clock.settle()
      release()
      await settled(seen, () => seen.toasts.length > 0)
      await seen.clock.settle()
      expect(seen.runs).toEqual([CREATE_RUN(FINDING)])
      await ui.unmount()
    },
  )

  test(
    'on the desktop app file runs no tracker CLI, keeps the row and names the reason in a toast',
    withWorkitems,
    async ($, on) => {
      const seen = world(on, 'desktop')
      await startOn($, 'desktop')
      await record($, FINDING)
      const ui = await mountOn($, 'desktop')
      await ui.press({ key: 'finding-file:1' })
      await settled(seen, () => seen.toasts.length > 0)
      expect(seen.runs).toEqual([])
      expect(textOf(await ui.find({ key: 'row:finding:1' }))).toContain(FINDING)
      expect(seen.toasts.some((text) => text.includes('the tracker state is terminal-only'))).toBe(
        true,
      )
      await ui.unmount()
    },
  )

  test(
    'a create that workitems refuses keeps the finding and names the reason in a toast',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      seen.answer = { exitCode: 1, stdout: '', stderr: 'handily creates no item in beans' }
      await startOn($, 'terminal')
      await record($, FINDING)
      const ui = await mountOn($, 'terminal')
      await ui.press({ key: 'finding-file:1' })
      await settled(seen, () => seen.toasts.length > 0)
      expect(seen.runs).toEqual([CREATE_RUN(FINDING)])
      expect(textOf(await ui.find({ key: 'row:finding:1' }))).toContain(FINDING)
      expect(seen.toasts.some((text) => text.includes('handily creates no item in beans'))).toBe(
        true,
      )
      await ui.unmount()
    },
  )

  test(
    'pressing fix fills the prompt box with the finding, sends nothing, runs no tracker CLI and keeps the row, also after the person clears the prompt',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await record($, FINDING)
      const ui = await mountOn($, 'terminal')
      await ui.press({ key: 'finding-fix:1' })
      await settled(seen, () => seen.fills.length > 0)
      await seen.clock.settle()
      expect(seen.fills).toEqual([{ text: `${FIX_LEAD} ${FINDING}`, mode: 'replace' }])
      expect(seen.submitted).toEqual([])
      expect(seen.runs).toEqual([])
      expect(textOf(await ui.find({ key: 'row:finding:1' }))).toContain(FINDING)
      seen.draft = ''
      await $.prompt.submit({
        text: 'go on with the task',
        wait: false,
        origin: { kind: 'composer' },
      })
      await seen.clock.settle()
      expect(textOf(await ui.find({ key: 'row:finding:1' }))).toContain(FINDING)
      await ui.unmount()
    },
  )

  test(
    'when the person sends the fix prompt, the row of that finding goes and the others stay',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await record($, FINDING)
      await record($, 'The retry loop never backs off')
      const ui = await mountOn($, 'terminal')
      await ui.press({ key: 'finding-fix:1' })
      await settled(seen, () => seen.fills.length > 0)
      const sent = seen.fills[0]?.text ?? ''
      await $.prompt.submit({ text: sent, wait: false, origin: { kind: 'composer' } })
      await seen.clock.settle()
      expect(seen.submitted).toEqual([sent])
      expect(await ui.find({ key: 'row:finding:1' })).toBeUndefined()
      expect(textOf(await ui.find({ key: 'row:finding:2' }))).toContain('The retry loop')
      expect(seen.runs).toEqual([])
      await ui.unmount()
    },
  )

  test('pressing dismiss removes the row and runs no tracker CLI', withWorkitems, async ($, on) => {
    const seen = world(on, 'desktop')
    await startOn($, 'desktop')
    await record($, FINDING)
    const ui = await mountOn($, 'desktop')
    await ui.press({ key: 'finding-dismiss:1' })
    await seen.clock.settle()
    expect(await ui.find({ key: 'row:finding:1' })).toBeUndefined()
    expect(await ui.find({ key: 'findings-head' })).toBeUndefined()
    expect(seen.runs).toEqual([])
    expect(seen.fills).toEqual([])
    await ui.unmount()
  })

  test(
    'a long finding is cut on its row and shows its whole text under it at 41 columns',
    withWorkitems,
    async ($, on) => {
      world(on)
      await startOn($, 'terminal')
      await record($, LONG_FINDING)
      const ui = await mountOn($, 'terminal', 41)
      const row = textOf(await ui.find({ key: 'row:finding:1' }))
      expect(row.startsWith('◆ 1 The date parser drops the time zone')).toBe(true)
      expect(row.endsWith('…')).toBe(true)
      expect(textOf(await ui.find({ key: 'finding:1' }))).toContain(LONG_FINDING)
      await ui.unmount()
    },
  )

  test(
    'finding_add refuses a subagent, an empty text, a text that starts with a dash and a full list',
    withWorkitems,
    async ($, on) => {
      world(on)
      await startOn($, 'terminal')
      expect((await record($, FINDING, 'a0000001scout')).deny).toContain('only in the main loop')
      expect((await record($, '  ')).deny).toContain('finding_add needs text')
      expect((await record($, '--force the push')).deny).toContain('starts with -')
      for (let index = 0; index < MAX_FINDINGS; index += 1) {
        await record($, `Finding number ${String(index + 1)}`)
      }
      expect((await record($, FINDING)).deny).toContain('the most it keeps')
    },
  )

  test('a cleared session starts with no findings', withWorkitems, async ($, on) => {
    world(on)
    await startOn($, 'terminal')
    await record($, FINDING)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await startOn($, 'terminal')
    const ui = await mountOn($, 'terminal')
    expect(await ui.find({ key: 'findings-head' })).toBeUndefined()
    await ui.unmount()
  })
})
